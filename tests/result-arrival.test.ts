import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Transaction } from '@codemirror/state';
import { undo } from '@codemirror/commands';
import { commentSchema, type BufferInput, type WaitingResult } from '../src/shared/contracts.ts';
import { captureContext } from '../src/shared/review.ts';
import { mergeResult } from '../src/shared/result-arrival.ts';
import { ResultInbox } from '../src/renderer/result-inbox.ts';
import { initialState, commentsField, loadComments, applyProposal, patchComments } from '../src/renderer/editor-state.ts';
import { WorkGate } from '../src/renderer/work-gate.ts';
import { ProjectService } from '../src/main/project-service.ts';
import { ReviewResults } from '../src/main/review-results.ts';
import { digest } from '../src/main/files.ts';

const source = 'A first claim.\nA second claim.';
const comment = (id: string, original = 'A first claim.') => captureContext(source, commentSchema.parse({ id, title: 'Clarify', explanation: 'Clarify claim.', original, replacement: 'A precise claim.', from: source.indexOf(original), to: source.indexOf(original) + original.length, validity: 'current' }));
const result = (comments = [comment('new')]): WaitingResult => ({ schemaVersion: 1, id: randomUUID(), kind: 'review', rootFile: 'main.tex', sourceHash: digest(source), createdAt: new Date().toISOString(), comments });
const defer = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
function fixture() {
  let state = initialState(source, [comment('old')]);
  let stored = [result()], shown: WaitingResult[] = [], errors: unknown[] = [], saved: BufferInput[] = [];
  const gate = new WorkGate(); let failPersist = false, hold: Promise<void> | null = null, flushHold: Promise<void> | null = null;
  const input = (): BufferInput => ({ projectId: 'p', text: state.doc.toString(), review: { schemaVersion: 1, rootFile: 'main.tex', sourceHash: '', activeId: 'old', comments: state.field(commentsField), updatedAt: '' } });
  const inbox = new ResultInbox({ input, locked: () => gate.locked, begin: () => gate.begin('results'),
    api: { waitingResults: async () => { if (hold) await hold; return { items: stored, notices: [] }; }, acknowledgeResult: async ({ resultId }) => { assert(saved.length, 'must persist before ack'); stored = stored.filter(item => item.id !== resultId); } },
    install: comments => { state = state.update({ effects: loadComments.of(comments), annotations: Transaction.addToHistory.of(false) }).state; },
    flush: async () => { if (failPersist) throw new Error('Disk full'); if (flushHold) await flushHold; saved.push(input()); },
    changed: items => { shown = items; }, error: e => { errors.push(e); } });
  return { inbox, gate, input, dispatch: (tr: any) => { state = state.update(tr).state; }, get state() { return state; }, get shown() { return shown; }, get errors() { return errors; }, get stored() { return stored; }, setStored: (value: WaitingResult[]) => { stored = value; }, fail: (v: boolean) => { failPersist = v; }, hold: (v: Promise<void>) => { hold = v; }, holdFlush: (v: Promise<void>) => { flushHold = v; } };
}
test('result arrival preserves active selection, edited proposal, decisions and Undo', async () => {
  const f = fixture(); f.dispatch({ selection: { anchor: source.length } });
  f.dispatch({ effects: patchComments.of([{ id: 'old', fields: { draft: 'My prose' } }]) });
  f.dispatch(applyProposal(f.state, 'old'));
  await f.inbox.refresh(); assert.equal(f.shown.length, 1, 'older source waits');
  await f.inbox.handle(f.shown[0].id, 'adopted');
  assert.equal(f.input().review.activeId, 'old'); assert.equal(f.state.selection.main.head, f.state.doc.length);
  assert.equal(f.state.field(commentsField)[0].draft, 'My prose'); assert.equal(f.state.field(commentsField)[0].decision, 'applied');
  assert(undo({ state: f.state, dispatch: (tr: any) => f.dispatch(tr) }));
  assert.equal(f.state.doc.toString(), source); assert.equal(f.state.field(commentsField).length, 2);
  assert.equal(f.state.field(commentsField)[0].decision, 'open');
});
test('a result arriving during Save waits and delivers after the barrier', async () => {
  const f = fixture(), fetching = defer(), saving = defer(); f.hold(fetching.promise);
  const refresh = f.inbox.refresh(), save = f.gate.commit(() => saving.promise);
  fetching.resolve(); await refresh; assert.equal(f.state.field(commentsField).length, 1); assert.equal(f.shown.length, 1);
  saving.resolve(); await save; await f.inbox.refresh();
  assert.equal(f.state.field(commentsField).length, 2); assert.equal(f.shown.length, 0);
});
test('typing during retrieval keeps results waiting and changed context stays unconfirmed', async () => {
  const f = fixture(), fetching = defer(); f.hold(fetching.promise);
  const refresh = f.inbox.refresh(); f.dispatch({ changes: { from: 0, insert: 'Changed context. ' } }); fetching.resolve(); await refresh;
  assert.equal(f.state.field(commentsField).length, 1); await f.inbox.handle(f.shown[0].id, 'adopted');
  // Prefix context at the beginning is empty, but unchanged suffix disambiguates.
  assert.equal(f.state.field(commentsField).length, 2); assert.match(f.state.doc.toString(), /^Changed context/);
  const moved = mergeResult('A first claim. Completely changed context', [], result(), false)[0]; assert.equal(moved.validity, 'unconfirmed');
});
test('failed recovery leaves an idempotent result; retry never restores an old draft or decision', async () => {
  const f = fixture(); f.fail(true); await f.inbox.refresh();
  assert.equal(f.errors.length, 1); assert.equal(f.stored.length, 1); assert.equal(f.state.field(commentsField).length, 2);
  f.dispatch({ effects: patchComments.of([{ id: 'new', fields: { draft: 'Edited after arrival', decision: 'dismissed' } }]) });
  f.fail(false); await f.inbox.refresh();
  assert.equal(f.state.field(commentsField).length, 2); assert.equal(f.state.field(commentsField)[1].draft, 'Edited after arrival'); assert.equal(f.state.field(commentsField)[1].decision, 'dismissed'); assert.equal(f.stored.length, 0);
});
test('reply adoption appends an alternative once, preserving ongoing notes and manual replacement', () => {
  const c = { ...comment('old'), draft: 'Manual proposal', replyDraft: 'Next question' };
  const r: WaitingResult = { ...result(), kind: 'reply', commentId: c.id, original: c.original, answer: { reply: 'Explanation', replacement: 'Alternative', packages: [] } };
  const once = mergeResult(source, [c], r, true), twice = mergeResult(source, once, r, true);
  assert.equal(twice[0].messages.length, 1); assert.equal(twice[0].draft, c.draft); assert.equal(twice[0].replyDraft, c.replyDraft);
  assert.equal(twice[0].replacement, c.replacement); assert.equal(twice[0].messages[0].resultId, r.id);
  assert.throws(() => mergeResult(source, [], r, true), /no longer available/);
  assert.notEqual(mergeResult(source, [], result([{ ...comment('bad'), validity: 'missing' }]), false)[0].validity, 'current');
});
test('closing during inbox retrieval leaves results retained and installs nothing', async () => {
  const f = fixture(), fetched = defer(); f.hold(fetched.promise); const refresh = f.inbox.refresh(); let closed = false;
  const close = f.gate.close(async () => {}, async () => {}, async () => { closed = true; });
  fetched.resolve(); await Promise.all([refresh, close]); assert(closed); assert.equal(f.state.field(commentsField).length, 1); assert.equal(f.stored.length, 1);
});
test('completed result store survives reopening, binds roots and receipts, and preserves original bytes', async () => {
  const root = path.resolve('.test-runs', 'inbox-' + randomUUID()); await fs.mkdir(root, { recursive: true });
  const file = path.join(root, 'main.tex'); await fs.writeFile(file, source);
  const projects = new ProjectService(path.join(root, 'runtime')); const p = await projects.open(file), results = new ReviewResults(projects), r = result();
  await results.retain(p.id, r); await assert.rejects(results.retain(p.id, r), /already exists/);
  await assert.rejects(results.retain(p.id, { ...r, id: randomUUID(), rootFile: 'other.tex' }), /another document/);
  const reopened = await new ProjectService(path.join(root, 'runtime2')).open(file); assert.equal(reopened.text, source);
  assert.equal((await results.list(p.id)).items[0].id, r.id);
  const dir = path.join(await projects.stateDirectory(p.id), 'reviews'), raw = await fs.readFile(path.join(dir, `result-${r.id}.json`));
  await results.acknowledge(p.id, r.id, 'adopted'); assert.equal((await results.list(p.id)).items.length, 0);
  assert.deepEqual(await fs.readFile(path.join(dir, `result-${r.id}.json`)), raw); assert.equal(await fs.readFile(file, 'utf8'), source);
});
test('a second arrival during manual adoption is fetched automatically when that adoption settles', async () => {
  const f = fixture(), flush = defer(); f.dispatch({ changes: { from: source.length, insert: '\nNew context' } });
  await f.inbox.refresh(); const old = f.shown[0]; f.holdFlush(flush.promise);
  const adoption = f.inbox.handle(old.id, 'adopted');
  for (let i = 0; i < 100 && f.state.field(commentsField).length === 1; i++) await new Promise(resolve => setTimeout(resolve, 2));
  assert.equal(f.state.field(commentsField).length, 2);
  const incoming = { ...result([comment('second-arrival')]), sourceHash: digest(f.input().text) };
  f.setStored([...f.stored, incoming]); await f.inbox.refresh(); flush.resolve(); await adoption;
  for (let i = 0; i < 100 && f.stored.length; i++) await new Promise(resolve => setTimeout(resolve, 2));
  assert.equal(f.state.field(commentsField).length, 3); assert.equal(f.stored.length, 0); assert.equal(f.shown.length, 0);
});
