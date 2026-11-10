import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProjectService } from '../src/main/project-service.ts';
import { CodexService } from '../src/main/codex-service.ts';
import { ReviewConversations } from '../src/main/review-conversations.ts';
import { ReviewResults } from '../src/main/review-results.ts';
import { UsageStore } from '../src/main/usage-store.ts';
import { digest } from '../src/main/files.ts';
import { commentSchema } from '../src/shared/contracts.ts';
import { summarizeReviewResults } from '../src/shared/review-outcome.ts';

const source = 'The proof are short. The result are useful.';
const proposal = { title: 'Agreement', explanation: 'Use singular agreement.', original: 'proof are', replacement: 'proof is', before: '', after: '', packages: [] };
async function fixture(t: any) {
  const root = path.resolve('.test-runs', 'outcomes-' + randomUUID()), file = path.join(root, 'paper.txt');
  await fs.mkdir(root, { recursive: true }); await fs.writeFile(file, source);
  const projects = new ProjectService(path.join(root, 'runtime')), paper = await projects.open(file);
  const service = new CodexService(projects, path.join(root, 'runtime/codex'));
  t.after(async () => { await service.cancel(); await fs.rm(root, { recursive: true, force: true }); });
  return { root, file, projects, paper, service };
}
test('readable history retains full reusable instructions, separates raw prompts, and survives reopening', async t => {
  const f = await fixture(t), instruction = 'Keep this qualification. '.repeat(30) + '\nFINAL INSTRUCTION';
  const requestId = randomUUID();
  f.service.client.run = async () => ({ comments: [proposal] });
  await f.service.review({ projectId: f.paper.id, text: source, from: 0, to: source.length, instructions: instruction, requestId }, () => {});
  const store = new ReviewConversations(f.projects, f.service.conversations.directory);
  const conversation = (await store.current(f.paper.id))!, history = await store.history(f.paper.id, conversation.id);
  assert.equal(history.items[0].instruction.length, 160);
  const view = await store.exchange(f.paper.id, conversation.id, history.items[0].id);
  assert.equal(view.instruction, instruction); assert.equal(view.originRequestId, requestId);
  assert.equal(view.status, 'complete'); assert.equal(view.suggestions[0].replacement, 'proof is');
  assert.equal('prompt' in view, false);
  assert.equal(typeof JSON.parse(await store.inspect(f.paper.id, conversation.id, view.id)).prompt, 'string');
  const otherFile = path.join(f.root, 'other.txt'); await fs.writeFile(otherFile, 'Other.');
  const other = await f.projects.open(otherFile);
  await assert.rejects(store.exchange(other.id, conversation.id, view.id));
  assert.equal(await fs.readFile(f.file, 'utf8'), source);
});

test('invalid final review preserves early batches and records processing failure separately from a completed model response', async t => {
  const f = await fixture(t), requestId = randomUUID(), usage = new UsageStore(path.join(f.root, 'usage'));
  f.service.client.usageReviewOutcome = (id, outcome) => { void usage.reviewOutcome(id, outcome); };
  f.service.client.run = async (_p, _s, _pr, _e, _f, reader) => {
    usage.startComments(requestId, performance.now());
    await reader!.call('publish_comments', { comments: [proposal] });
    await usage.record({ id: requestId, createdAt: new Date().toISOString(), scope: null, purpose: 'review', model: null, effort: 'medium', fastMode: false, outcome: 'complete', elapsedMs: 1, firstAnswerMs: 1, connectMs: 0, setupMs: 0, tokens: null });
    return { comments: [{ ...proposal, replacement: 123 }] };
  };
  await assert.rejects(f.service.review({ projectId: f.paper.id, text: source, from: 0, to: source.length, instructions: 'Grammar.', requestId }, () => {}));
  const report = await f.service.results.forRequests(f.paper.id, [requestId]);
  assert.equal(report.items.length, 1);
  assert.deepEqual(summarizeReviewResults(report, []), { saved: 1, inComments: 0, waiting: 1, outside: 0, waitingResults: 1 });
  const entry = (await usage.state()).entries[0];
  assert.equal(entry.outcome, 'complete'); assert.equal(entry.reviewOutcome, 'failed');
  const conversation = (await f.service.conversations.current(f.paper.id))!;
  const turn = (await f.service.conversations.history(f.paper.id, conversation.id)).items[0];
  assert.equal(turn.status, 'failed');
  const view = await f.service.conversations.exchange(f.paper.id, conversation.id, turn.id);
  assert.equal(view.originRequestId, requestId);
  assert.match(view.error!, /Technical details/);
  assert(!view.error!.includes('invalid_type'));
  assert.match(await f.service.conversations.inspect(f.paper.id, conversation.id, turn.id), /invalid_type/);
  assert.equal(await fs.readFile(f.file, 'utf8'), source);
});

test('request summaries require verified receipts, isolate other jobs, and keep Undo/dismissed results accounted for', async t => {
  const f = await fixture(t), requestId = randomUUID(), other = randomUUID();
  const comment = (id: string) => commentSchema.parse({ ...proposal, id });
  const result = (origin: string, id: string) => ({ schemaVersion: 1 as const, id: randomUUID(), originRequestId: origin, kind: 'review' as const, rootFile: f.paper.name, sourceHash: digest(source), createdAt: new Date().toISOString(), comments: [comment(id)] });
  const one = result(requestId, 'one'), two = result(requestId, 'two'), three = result(requestId, 'three');
  for (const r of [one, two, three, result(other, 'unrelated')]) await f.service.results.retain(f.paper.id, r);
  await f.service.results.acknowledge(f.paper.id, one.id, 'adopted');
  await f.service.results.acknowledge(f.paper.id, three.id, 'dismissed');
  let report = await new ReviewResults(f.projects).forRequests(f.paper.id, [requestId]);
  const current = [comment('one'), comment('two')]; // two is visible, but recovery/receipt is unconfirmed.
  assert.deepEqual(summarizeReviewResults(report, current), { saved: 3, inComments: 1, waiting: 1, outside: 1, waitingResults: 1 });
  assert.deepEqual(summarizeReviewResults(report, []), { saved: 3, inComments: 0, waiting: 1, outside: 2, waitingResults: 1 });
  const directory = path.join(await f.projects.stateDirectory(f.paper.id), 'reviews');
  await fs.writeFile(path.join(directory, 'received-' + two.id + '.json'), JSON.stringify({ rootFile: f.paper.name, resultHash: 'wrong', outcome: 'adopted' }));
  report = await f.service.results.forRequests(f.paper.id, [requestId]);
  assert.equal(report.notices.length, 1); assert.equal(summarizeReviewResults(report, current).waiting, 1);
  await f.service.results.acknowledge(f.paper.id, two.id, 'adopted');
  report = await f.service.results.forRequests(f.paper.id, [requestId]);
  assert.equal(report.notices.length, 0); assert.equal(summarizeReviewResults(report, current).inComments, 2);
  assert.equal((await f.service.results.forRequests(f.paper.id, [other])).items.length, 1);
  assert.equal(await fs.readFile(f.file, 'utf8'), source);
});

test('Stop records a stopped exchange and retains only batches already saved for that request', async t => {
  const f = await fixture(t), requestId = randomUUID();
  let ready!: () => void, release!: () => void;
  const published = new Promise<void>(r => { ready = r; });
  f.service.client.run = async (_p, _s, _pr, _e, _f, reader) => {
    await reader!.call('publish_comments', { comments: [proposal] }); ready();
    await new Promise<void>(r => { release = r; });
    throw Error('Cancelled');
  };
  const running = f.service.review({ projectId: f.paper.id, text: source, from: 0, to: source.length, instructions: 'Grammar.', requestId }, () => {});
  const rejected = assert.rejects(running, /Cancelled/);
  await published; await f.service.cancel(); release(); await rejected;
  const conversation = (await f.service.conversations.current(f.paper.id))!;
  assert.equal((await f.service.conversations.history(f.paper.id, conversation.id)).items[0].status, 'stopped');
  assert.equal((await f.service.results.forRequests(f.paper.id, [requestId])).items.length, 1);
});
