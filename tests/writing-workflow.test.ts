import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProjectService } from '../src/main/project-service.ts';
import { CodexService } from '../src/main/codex-service.ts';
import { commentSchema } from '../src/shared/contracts.ts';
import { replyContext, reviewContext, deeperQuestion } from '../src/shared/codex-context.ts';
import { reviewSections, SectionReview, type SectionProgress } from '../src/shared/section-review.ts';

const text = '\\documentclass{article}\n\\begin{document}\n\\section{First}\nA first claim.\n\\section{Second}\nA second claim.\n\\end{document}';
const defer = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
test('paper instructions survive engine/effort changes and reopen; neighboring roots keep their own settings', async () => {
  const root = path.resolve('.test-runs', 'instructions-' + randomUUID()); await fs.mkdir(root, { recursive: true });
  const first = path.join(root, 'main.tex'), second = path.join(root, 'copy.tex'); await fs.writeFile(first, text); await fs.writeFile(second, text);
  const service = new ProjectService(path.join(root, 'runtime')), p = await service.open(first);
  await service.setFastMode(p.id, true); await service.setPaperInstructions(p.id, 'Keep the term stable assignment.'); await service.setEffort(p.id, 'max'); await service.setEngine(p.id, 'xelatex');
  const q = await service.open(second); assert.equal(q.paperInstructions, ''); assert.equal(q.fastMode, false); await service.setPaperInstructions(q.id, 'Different notation.');
  const reopened = await service.open(first); assert.equal(reopened.paperInstructions, 'Keep the term stable assignment.'); assert.equal(reopened.engine, 'xelatex'); assert.equal(reopened.effort, 'max'); assert.equal(reopened.fastMode, true);
  await assert.rejects(service.setPaperInstructions(reopened.id, 'a'.repeat(10001)));
  assert.equal(await fs.readFile(first, 'utf8'), text); assert.equal(await fs.readFile(second, 'utf8'), text);
});
test('review and discussion use the previewed context; Think more requests high effort without changing paper preference', async () => {
  const root = path.resolve('.test-runs', 'context-' + randomUUID()); await fs.mkdir(root, { recursive: true });
  const file = path.join(root, 'main.tex'); await fs.writeFile(file, text); const projects = new ProjectService(path.join(root, 'runtime')), p = await projects.open(file);
  await projects.setPaperInstructions(p.id, 'Preserve notation.'); await projects.setEffort(p.id, 'low');
  const service = new CodexService(projects, path.join(root, 'codex')), calls: any[] = [];
  service.client.run = async (prompt, _schema, _progress, effort) => { calls.push({ prompt: JSON.parse(prompt), effort }); return calls.length === 1 ? { comments: [] } : { reply: 'The concern depends on this assumption.', replacement: null, packages: [] }; };
  const request = { projectId: p.id, text, from: text.indexOf('A first'), to: text.indexOf('A first') + 14, instructions: 'Check clarity.' };
  await service.review(request, () => {}); assert.deepEqual(calls[0].prompt, reviewContext(request, projects.get(p.id).paperInstructions)); assert.equal(calls[0].effort, 'low');
  const c = commentSchema.parse({ id: 'c', title: 'Check', explanation: 'Why?', original: 'A first claim.', replacement: null, from: request.from, to: request.to });
  const reply = { projectId: p.id, text, comment: c, message: deeperQuestion, deeper: true };
  await service.reply(reply, () => {}); assert.deepEqual(calls[1].prompt, replyContext(reply, projects.get(p.id).paperInstructions)); assert.equal(calls[1].effort, 'high'); assert.equal(projects.get(p.id).effort, 'low');
  assert.equal((await service.results.list(p.id)).items.length, 2); assert.equal(await fs.readFile(file, 'utf8'), text);
});
test('Fast and Max reach review/reply/preamble without Think more reducing Max', async () => {
  const root = path.resolve('.test-runs', 'max-fast-' + randomUUID()); await fs.mkdir(root, { recursive: true });
  const file = path.join(root, 'main.tex'); await fs.writeFile(file, text);
  const projects = new ProjectService(path.join(root, 'runtime')), p = await projects.open(file); await projects.setFastMode(p.id, true); await projects.setEffort(p.id, 'max');
  const service = new CodexService(projects, path.join(root, 'codex')), calls: any[] = [];
  service.client.run = async (_prompt, _schema, _progress, effort, fast) => { calls.push({ effort, fast }); return calls.length === 1 ? { comments: [] } : calls.length === 2 ? { reply: 'Reconsidered.', replacement: null, packages: [] } : { explanation: 'Complete', preamble: '', ending: '', needsInput: null }; };
  await service.review({ projectId:p.id, text, from:0, to:text.length, instructions:'' }, () => {});
  await service.reply({ projectId:p.id, text, comment:commentSchema.parse({ id:'c', title:'', explanation:'', original:'A first claim.', replacement:null }), message:'Reconsider', deeper:true }, () => {});
  await service.preamble({ projectId:p.id, text, engine:'pdflatex' }, () => {});
  assert.deepEqual(calls, [{ effort:'max',fast:true },{ effort:'max',fast:true },{ effort:'max',fast:true }]);
  assert.equal(await fs.readFile(file,'utf8'),text);
});
test('section boundaries preserve whole sections, ignore comments/verbatim, and refuse excessive batches', () => {
  const sections = reviewSections(text); assert.deepEqual(sections.map(s => s.label), ['First', 'Second']);
  assert(sections.every(s => text.slice(s.from, s.to).startsWith('\\section'))); assert(!text.slice(sections[1].from, sections[1].to).includes('\\end{document}'));
  const more = text.replace('A first claim.', '% \\section{False}\n\\begin{verbatim}\n\\section{Quoted}\n\\end{verbatim}\nA first claim.'); assert.equal(reviewSections(more).length, 2);
  assert.throws(() => reviewSections('a'.repeat(120001)), /not cut through a proof/);
  assert.throws(() => reviewSections(Array.from({ length: 41 }, (_, i) => `\\section{${i}}Body`).join('\n')), /40 sections/);
});
test('section review delivers each completed batch, pauses at a boundary and resumes the same frozen snapshot', async () => {
  const first = defer(), called: any[] = [], phases: SectionProgress[] = []; let deliveries = 0;
  const runner = new SectionReview({ request: async request => { called.push(request); if (called.length === 1) await first.promise; }, delivered: async () => { deliveries++; }, cancel: async () => {}, changed: p => phases.push(p) });
  const running = runner.run({ projectId: 'p', text, instructions: '' }); runner.pause(); first.resolve(); await tick();
  assert.equal(called.length, 1); assert.equal(deliveries, 1); assert.equal(phases.at(-1)?.phase, 'paused');
  runner.resume(); await running; assert.equal(called.length, 2); assert.equal(deliveries, 2); assert.equal(phases.at(-1)?.phase, 'complete');
  assert(called.every(c => c.text === text)); assert.notEqual(called[0].requestId, called[1].requestId);
});
test('Stop releases a paused queue and close can settle it without sending another section', async () => {
  const first = defer(); let requests = 0, cancel = 0; const phases: SectionProgress[] = [];
  const runner = new SectionReview({ request: async () => { requests++; await first.promise; }, delivered: async () => {}, cancel: async () => { cancel++; }, changed: p => phases.push(p) });
  const running = runner.run({ projectId: 'p', text, instructions: '' }); runner.pause(); first.resolve(); await tick(); await runner.stop(); await running;
  assert.equal(requests, 1); assert.equal(cancel, 1); assert.equal(phases.at(-1)?.phase, 'stopped'); assert.equal(phases.at(-1)?.completed, 1);
});
test('a failed later section reports its partial completion without rerunning completed requests', async () => {
  let requests = 0, delivered = 0; const phases: SectionProgress[] = [];
  const runner = new SectionReview({ request: async () => { if (++requests === 2) throw new Error('Offline'); }, delivered: async () => { delivered++; }, cancel: async () => {}, changed: p => phases.push(p) });
  await assert.rejects(runner.run({ projectId: 'p', text, instructions: '' }), /Offline/);
  assert.equal(delivered, 1); assert.equal(phases.at(-1)?.completed, 1); assert.equal(phases.at(-1)?.phase, 'failed');
});
test('main service settle waits beyond model completion through review, reply and preamble retention', async () => {
  const root = path.resolve('.test-runs', 'codex-settle-' + randomUUID()); await fs.mkdir(root, { recursive: true });
  const file = path.join(root, 'main.tex'); await fs.writeFile(file, text);
  const projects = new ProjectService(path.join(root, 'runtime')), p = await projects.open(file), service = new CodexService(projects, path.join(root, 'codex'));
  const actualDirectory = projects.stateDirectory.bind(projects);
  for (const kind of ['review', 'reply', 'preamble'] as const) {
    const entered = defer(), release = defer(); let settled = false;
    projects.stateDirectory = async id => { entered.resolve(); await release.promise; return actualDirectory(id); };
    service.client.run = async () => kind === 'review' ? { comments: [] } : kind === 'reply' ? { reply: 'Completed answer', replacement: null, packages: [] } : { explanation: 'Already complete', preamble: '', ending: '', needsInput: null };
    const operation = kind === 'review' ? service.review({ projectId: p.id, text, from: 0, to: text.length, instructions: '' }, () => {}) : kind === 'reply' ? service.reply({ projectId: p.id, text, comment: commentSchema.parse({ id: 'c', title: '', explanation: '', original: 'A first claim.', replacement: null }), message: 'Explain' }, () => {}) : service.preamble({ projectId: p.id, text, engine: 'pdflatex' }, () => {});
    await entered.promise; await service.client.stop(); const closing = service.settle().then(() => { settled = true; }); await tick();
    assert.equal(settled, false, `${kind} retention must precede close`); release.resolve(); await operation; await closing; assert(settled);
    projects.stateDirectory = actualDirectory;
  }
  const files = await fs.readdir(path.join(await actualDirectory(p.id), 'reviews'));
  assert.equal(files.filter(n => n.startsWith('result-')).length, 2); assert.equal(files.filter(n => n.startsWith('preamble-')).length, 1);
  assert.equal(await fs.readFile(file, 'utf8'), text);
});
