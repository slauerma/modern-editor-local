import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { undo, isolateHistory } from '@codemirror/commands';
import { commentSchema, defaultWorkspace } from '../src/shared/contracts.ts';
import { CompileService } from '../src/main/compile-service.ts';
import { adoptComment, nextCommentId, visibleCommentId } from '../src/shared/review.ts';
import { initialState, commentsField, patchComments } from '../src/renderer/editor-state.ts';
import { ProjectService } from '../src/main/project-service.ts';
import { atomicWrite, digest } from '../src/main/files.ts';
import { SectionReview, type SectionProgress } from '../src/shared/section-review.ts';
import { LatestTask } from '../src/renderer/workspace-state.ts';
import { revealOffset } from '../src/renderer/pdf-position.ts';

const tick = () => new Promise<void>(r => setImmediate(r));
const defer = () => { let resolve!: () => void, reject!: (error: Error) => void; const promise = new Promise<void>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const sections = '\\section{First}\nFirst claim.\n\\section{Second}\nSecond claim.';

test('Later preserves source, decision, proposal and notes; pending/later navigation is separate and undoable', () => {
  const text = 'First claim. Second claim.';
  const comments = ['First claim.', 'Second claim.'].map((original, i) => adoptComment(text, commentSchema.parse({ id: `c${i}`, title: 'Check', explanation: 'Explain', original, replacement: 'Revised claim.', draft: 'Manual proposal', replyDraft: 'My unsent question' })));
  let state = initialState(text, comments);
  state = state.update({ effects: patchComments.of([{ id: 'c0', fields: { later: true } }]), annotations: isolateHistory.of('full') }).state;
  const updated = state.field(commentsField);
  assert.equal(updated[0].decision, 'open'); assert.equal(updated[0].draft, 'Manual proposal'); assert.equal(updated[0].replyDraft, 'My unsent question');
  assert.equal(nextCommentId(updated, 'c1', 1), 'c1'); assert.equal(visibleCommentId(updated, 'c0', false), 'c1');
  assert.equal(nextCommentId(updated, 'c1', 1, false, true), 'c0'); assert.equal(nextCommentId(updated, 'c1', 1, true), 'c0');
  assert(undo({ get state() { return state; }, dispatch: tr => { state = tr.state; } }));
  assert.equal(state.field(commentsField)[0].later, false); assert.equal(state.doc.toString(), text);
});

test('Later survives recovery, Save and reopen, without a new comment decision or a manuscript change', async () => {
  const root = path.resolve('.test-runs', 'review-flow-' + randomUUID()); await fs.mkdir(root, { recursive: true });
  const file = path.join(root, 'main.tex'), text = 'A claim.'; await fs.writeFile(file, text);
  const service = new ProjectService(path.join(root, 'runtime')), p = await service.open(file);
  const c = adoptComment(text, commentSchema.parse({ id: 'c', title: 'Check', explanation: '', original: text, replacement: null, later: true, messages: [{ role: 'user', text: 'Check Proposition 3', createdAt: new Date().toISOString() }] }));
  const input = { projectId: p.id, text, review: { ...p.review, activeId: c.id, comments: [c] } };
  await service.persist(input); await service.save(input);
  const reopened = await service.open(file);
  assert.equal(reopened.review.comments[0].later, true); assert.equal(reopened.review.comments[0].decision, 'open');
  assert.equal(reopened.review.comments[0].messages[0].text, 'Check Proposition 3'); assert.equal(await fs.readFile(file, 'utf8'), text);
});

test('workspace settings are per root, do not Save source, and corrupt view state does not block opening or source Save', async () => {
  const root = path.resolve('.test-runs', 'workspace-' + randomUUID()); await fs.mkdir(root, { recursive: true });
  const file = path.join(root, 'main.tex'), second = path.join(root, 'other.tex'); await fs.writeFile(file, 'Original'); await fs.writeFile(second, 'Other');
  const service = new ProjectService(path.join(root, 'runtime')), p = await service.open(file), view = defaultWorkspace();
  view.pdf = { page: 9, zoom: 1.5, scrollX: .2, scrollY: .6 }; view.followComments = false; view.reviewView = 'later';
  view.source = { anchor: 3, head: 6, topLine: 4, offset: 17 }; view.toolbarCollapsed = true; view.commentsHidden = true;
  await service.setWorkspace(p.id, view);
  assert.equal((await service.open(second)).workspace, undefined);
  const reopened = await service.open(file); assert.deepEqual(reopened.workspace, view); assert.equal(await fs.readFile(file, 'utf8'), 'Original');
  await assert.rejects(service.setWorkspace(p.id, view), /no longer open/);
  await assert.rejects(service.setWorkspace(reopened.id, { ...view, paneSizes: [1, 1, 1] }));
  const state = path.join(await service.stateDirectory(reopened.id), 'workspace.json'); await fs.writeFile(state, '{ broken');
  const damaged = await service.open(file); assert.equal(damaged.workspace, undefined); assert(damaged.notices.some(n => n.includes('workspace')));
  await service.setWorkspace(damaged.id, view);
  assert.equal(await fs.readFile(path.join(path.dirname(state), `workspace-invalid-${digest('{ broken')}.json`), 'utf8'), '{ broken');
  assert.deepEqual(JSON.parse(await fs.readFile(state, 'utf8')), { rootFile: 'main.tex', workspace: view });
  const reset = await service.open(file); assert.deepEqual(reset.workspace, view); assert.equal(await fs.readFile(file, 'utf8'), 'Original');
  await service.save({ projectId: reset.id, text: 'Explicitly saved', review: reset.review }); assert.equal(await fs.readFile(file, 'utf8'), 'Explicitly saved');
});

test('workspace reset preserves malformed bytes before replacement, and archive failure leaves source and review untouched', async () => {
  const root = path.resolve('.test-runs', 'workspace-reset-' + randomUUID()); await fs.mkdir(root, { recursive: true });
  const file = path.join(root, 'main.tex'); await fs.writeFile(file, 'Original');
  let failArchive = true;
  const service = new ProjectService(path.join(root, 'runtime'), async (target, bytes, guard) => {
    if (failArchive && path.basename(target).startsWith('workspace-invalid-')) throw new Error('Injected workspace archive failure');
    await atomicWrite(target, bytes, guard);
  }), p = await service.open(file), home = await service.stateDirectory(p.id), state = path.join(home, 'workspace.json');
  await service.persist({ projectId: p.id, text: 'Unsaved draft', review: p.review });
  const reviewFile = path.join(home, 'review.json'), reviewBytes = await fs.readFile(reviewFile);
  const damaged = Buffer.from('\uFEFF{ "rootFile": "main.tex", "workspace": { "invalid": true } }\r\n');
  await fs.writeFile(state, damaged);
  await assert.rejects(service.setWorkspace(p.id, defaultWorkspace()), /Injected workspace archive failure/);
  assert.deepEqual(await fs.readFile(state), damaged); assert.equal(p.workspace, undefined);
  assert.deepEqual(await fs.readFile(reviewFile), reviewBytes); assert.equal(await fs.readFile(file, 'utf8'), 'Original');
  failArchive = false; await service.setWorkspace(p.id, defaultWorkspace());
  const archive = path.join(home, `workspace-invalid-${digest(damaged)}.json`);
  assert.deepEqual(await fs.readFile(archive), damaged);
  const reopened = await service.open(file); assert.deepEqual(reopened.workspace, defaultWorkspace()); assert.equal(reopened.text, 'Unsaved draft');
  assert.deepEqual(await fs.readFile(reviewFile), reviewBytes); assert.equal(await fs.readFile(file, 'utf8'), 'Original');
});

test('workspace reset refuses another paper, linked records and inconsistent diagnostic archives', async () => {
  const root = path.resolve('.test-runs', 'workspace-owner-' + randomUUID()); await fs.mkdir(root, { recursive: true });
  const file = path.join(root, 'main.tex'); await fs.writeFile(file, 'Original');
  const service = new ProjectService(path.join(root, 'runtime')), p = await service.open(file), home = await service.stateDirectory(p.id), state = path.join(home, 'workspace.json');
  const foreign = JSON.stringify({ rootFile: 'other.tex', workspace: defaultWorkspace() }); await fs.writeFile(state, foreign);
  await assert.rejects(service.setWorkspace(p.id, defaultWorkspace()), /another document/); assert.equal(await fs.readFile(state, 'utf8'), foreign);
  const outside = path.join(root, 'outside-workspace.json'); await fs.writeFile(outside, '{ outside record'); await fs.unlink(state); await fs.symlink(outside, state);
  await assert.rejects(service.setWorkspace(p.id, defaultWorkspace())); assert((await fs.lstat(state)).isSymbolicLink()); assert.equal(await fs.readFile(outside, 'utf8'), '{ outside record');
  await fs.unlink(state); const damaged = '{ malformed'; await fs.writeFile(state, damaged);
  const archive = path.join(home, `workspace-invalid-${digest(damaged)}.json`); await fs.writeFile(archive, 'Preserved pre-existing diagnostic');
  await assert.rejects(service.setWorkspace(p.id, defaultWorkspace()), /archive is inconsistent/);
  assert.equal(await fs.readFile(state, 'utf8'), damaged); assert.equal(await fs.readFile(archive, 'utf8'), 'Preserved pre-existing diagnostic');
  assert.equal(await fs.readFile(file, 'utf8'), 'Original');
});

test('restored PDF requires matching owner, source and PDF bytes, and never claims current dependency verification', async () => {
  const root = path.resolve('.test-runs', 'pdf-workspace-' + randomUUID()), paper = path.join(root, 'paper'); await fs.mkdir(paper, { recursive: true });
  const file = path.join(paper, 'main.tex'); await fs.writeFile(file, 'Original');
  const command = path.join(root, 'compiler.mjs'); await fs.copyFile('tests/fixtures/stub-compiler.mjs', command); await fs.chmod(command, 0o700);
  const runtime = path.join(root, 'runtime'), cache = path.join(runtime, 'builds'), service = new ProjectService(runtime), p = await service.open(file);
  const compiler = new CompileService(service, cache, command), build = await compiler.compile(p.id, 'OK unsaved snapshot', 'pdflatex'); assert(build.success);
  const freshProjects = new ProjectService(runtime), reopened = await freshProjects.open(file), fresh = new CompileService(freshProjects, cache, command);
  const restored = await fresh.restore(reopened.id, build.id); assert.equal(restored.text, 'OK unsaved snapshot'); assert.equal(restored.build.id, build.id);
  assert.equal(await fresh.validate(reopened.id, build.id, restored.text), false); assert((await fresh.pdf(build.id)).length > 0);
  await assert.rejects(fresh.restore(reopened.id, '../outside'));
  const otherFile = path.join(paper, 'copy.tex'); await fs.writeFile(otherFile, 'Original'); const other = await freshProjects.open(otherFile);
  await assert.rejects(fresh.restore(other.id, build.id), /another paper/);
  const again = await freshProjects.open(file); await fs.appendFile(path.join(cache, build.id, 'main.pdf'), 'tampered');
  await assert.rejects(fresh.restore(again.id, build.id), /changed/);
  assert.equal(await fs.readFile(file, 'utf8'), 'Original');
});

test('discussion waits for section retention, then pauses; duplicate questions cannot run concurrently, Continue keeps the frozen draft', async () => {
  const first = defer(), delivered = defer(), question = defer(), events: string[] = [], phases: SectionProgress[] = [];
  const runner = new SectionReview({ request: async request => { assert.equal(request.text, sections); events.push('section'); if (events.length === 1) await first.promise; }, delivered: async () => { events.push('retaining'); await delivered.promise; }, cancel: async () => {}, changed: value => phases.push(value) });
  const running = runner.run({ projectId: 'p', text: sections, instructions: '' }); await tick();
  const reply = runner.interrupt(async () => { events.push('question'); await question.promise; });
  assert.equal(await runner.interrupt(async () => { throw new Error('Must not start'); }), false);
  runner.resume(); first.resolve(); await tick(); assert.deepEqual(events, ['section', 'retaining']);
  delivered.resolve(); await tick(); assert.deepEqual(events, ['section', 'retaining', 'question']); assert.equal(phases.at(-1)?.phase, 'discussing');
  question.resolve(); assert.equal(await reply, true); await tick(); assert.equal(phases.at(-1)?.phase, 'paused'); assert.equal(events.filter(v => v === 'section').length, 1);
  runner.resume(); await running; assert.equal(events.filter(v => v === 'section').length, 2); assert.equal(phases.at(-1)?.phase, 'complete');
});

test('questions can run while already paused, including another question before Continue; failed questions retain the section queue', async () => {
  const first = defer(), phases: SectionProgress[] = []; let requests = 0, questions = 0;
  const runner = new SectionReview({ request: async () => { requests++; await first.promise; }, delivered: async () => {}, cancel: async () => {}, changed: p => phases.push(p) });
  const running = runner.run({ projectId: 'p', text: sections, instructions: '' }); await tick(); runner.pause(); first.resolve(); await tick();
  assert.equal(await runner.interrupt(async () => { questions++; }), true); await tick(); assert.equal(phases.at(-1)?.phase, 'paused');
  await assert.rejects(runner.interrupt(async () => { questions++; throw new Error('Offline'); }), /Offline/); await tick();
  assert.equal(questions, 2); assert.equal(requests, 1); assert.equal(phases.at(-1)?.phase, 'paused');
  await runner.stop(); await running;
});

test('Stop or a failed section releases queued questions without sending them; stopping an active question settles both jobs', async () => {
  for (const failure of [false, true]) {
    const first = defer(); let sent = false;
    const runner = new SectionReview({ request: () => first.promise, delivered: async () => {}, cancel: async () => first.reject(new Error('Cancelled')), changed: () => {} });
    const running = runner.run({ projectId: 'p', text: sections, instructions: '' }); const settlement = running.catch(e => { if (!failure) throw e; }); await tick();
    const queued = runner.interrupt(async () => { sent = true; });
    if (failure) first.reject(new Error('Offline')); else await runner.stop();
    assert.equal(await queued, false); await settlement; assert.equal(sent, false);
  }
  const question = defer(); let requests = 0;
  const runner = new SectionReview({ request: async () => { requests++; }, delivered: async () => {}, cancel: async () => question.reject(new Error('Cancelled question')), changed: () => {} });
  const running = runner.run({ projectId: 'p', text: sections, instructions: '' });
  const queued = runner.interrupt(() => question.promise); const rejection = assert.rejects(queued, /Cancelled question/); await tick();
  await runner.stop(); await Promise.all([running, rejection]); assert(requests <= 1);
});

test('a question queued during the final section is answered before completion, without leaving a dead Continue control', async () => {
  const section = defer(); const phases: SectionProgress[] = []; let sent = 0;
  const runner = new SectionReview({ request: () => section.promise, delivered: async () => {}, cancel: async () => {}, changed: p => phases.push(p) });
  const running = runner.run({ projectId: 'p', text: 'Only one section.', instructions: '' }); await tick();
  const queued = runner.interrupt(async () => { sent++; }); section.resolve(); assert.equal(await queued, true); await running;
  assert.equal(sent, 1); assert.equal(phases.at(-1)?.phase, 'complete'); assert.equal(runner.canDiscuss, false);
});

test('PDF reveal leaves visible passages still, and rapid following retains only the newest queued lookup', async () => {
  assert.equal(revealOffset(45, 20, 400), 0); assert.equal(revealOffset(45, 600, 400), 0);
  assert.equal(revealOffset(5, 20, 400), 0); assert.equal(revealOffset(375, 20, 400), 0);
  assert(revealOffset(600, 20, 400) > 0); assert(revealOffset(-50, 20, 400) < 0);
  const tasks = new LatestTask(), first = defer(), calls: number[] = [];
  tasks.replace(async () => { calls.push(1); await first.promise; });
  for (let n = 2; n <= 20; n++) tasks.replace(async () => { calls.push(n); });
  first.resolve(); await tick(); assert.deepEqual(calls, [1, 20]);
  const second = defer(); tasks.replace(() => second.promise); tasks.replace(async () => { calls.push(21); }); tasks.clear(); second.resolve(); await tick(); assert.deepEqual(calls, [1, 20]);
});


test('earlier workspace records default to visible comments without losing reading state', async () => {
  const root = path.resolve('.test-runs', 'workspace-legacy-layout-' + randomUUID()); await fs.mkdir(root, { recursive: true });
  const file = path.join(root, 'main.tex'); await fs.writeFile(file, 'Original source');
  const service = new ProjectService(path.join(root, 'runtime')), paper = await service.open(file);
  const home = await service.stateDirectory(paper.id), legacy = { ...defaultWorkspace(), pdfOpen: true } as Partial<ReturnType<typeof defaultWorkspace>>;
  delete legacy.commentsHidden;
  await fs.writeFile(path.join(home, 'workspace.json'), JSON.stringify({ rootFile: 'main.tex', workspace: legacy }));
  const reopened = await service.open(file);
  assert.equal(reopened.workspace?.commentsHidden, false); assert.equal(reopened.workspace?.pdfOpen, true);
  assert.deepEqual(reopened.workspace?.paneSizes, legacy.paneSizes); assert.equal(await fs.readFile(file, 'utf8'), 'Original source');
});
