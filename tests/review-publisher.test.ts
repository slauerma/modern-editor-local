import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ReviewPublisher } from '../src/main/review-publisher.ts';
import { CodexService, reviewOutputSchema } from '../src/main/codex-service.ts';
import { ProjectService } from '../src/main/project-service.ts';
import type { Comment } from '../src/shared/contracts.ts';

const draft = 'Outside quotation. The proof are short. The result are useful.';
const comment = (original = 'proof are', replacement = 'proof is') => ({ title: 'Agreement', explanation: 'Use singular agreement.', original, replacement, before: '', after: '', packages: [] });
const payload = (...comments: unknown[]) => ({ comments });
test('complete batches persist before delivery returns, anchor to the frozen selection, and deduplicate the final answer', async () => {
  const saved: Comment[][] = [];
  const publisher = new ReviewPublisher(draft, 19, draft.length, async c => { saved.push(c); }, () => true);
  const reader = publisher.reader(reviewOutputSchema);
  assert.deepEqual(await reader.call('publish_comments', payload(comment(), comment())), { published: 1, total: 1 });
  assert.equal(saved.length, 1);
  const first = saved[0][0];
  assert.equal(draft.slice(first.from, first.to), first.original);
  assert.equal(first.validity, 'current');
  await reader.cancel(); // The CLI ends its reading tools before final delivery.
  const all = await publisher.finish(payload(comment(), comment('result are', 'result is')));
  assert.equal(all.length, 2); assert.equal(saved.length, 2); assert.equal(all[0].id, first.id);
  assert.equal(new Set(all.map(c => c.id)).size, 2);
  await assert.rejects(reader.call('publish_comments', payload(comment())), /cancelled/);
});
test('invalid batches are all-or-nothing; missing and out-of-selection quotes remain non-applicable', async () => {
  const saved: Comment[][] = [];
  const p = new ReviewPublisher(draft, 19, draft.length, async c => { saved.push(c); }, () => true);
  const reader = p.reader(reviewOutputSchema);
  await assert.rejects(reader.call('publish_comments', payload(comment(), { ...comment(), packages: ['../bad'] })));
  assert.equal(saved.length, 0);
  await reader.call('publish_comments', payload({ ...comment('Outside quotation', 'Outside text'), from: 0, to: 17, decision: 'applied' }, comment('invented passage', 'new text')));
  assert(saved[0].every(c => c.validity === 'missing' && c.decision === 'open'));
});
test('identical corrections at separately anchored repeated passages survive delivery and final deduplication', async () => {
  const setup = 'This is the common setup. '.repeat(5), tail = ' This is the common conclusion.'.repeat(5);
  const original = 'The conclusion are immediate.', replacement = 'The conclusion is immediate.';
  const first = `First theorem. ${setup}`, second = `Second theorem. ${setup}`;
  const text = `${first}${original}${tail}\n\n${second}${original}${tail}`;
  const publisher = new ReviewPublisher(text, 0, text.length, async () => {}, () => true);
  const reader = publisher.reader(reviewOutputSchema);
  const one = { ...comment(original, replacement), before: first }, two = { ...one, before: second };
  assert.deepEqual(await reader.call('publish_comments', payload(one)), { published: 1, total: 1 });
  assert.deepEqual(await reader.call('publish_comments', payload(two)), { published: 1, total: 2 });
  const all = await publisher.finish(payload(one, two));
  assert.deepEqual(all.map(c => c.from), [text.indexOf(original), text.lastIndexOf(original)]);
  assert(all.every(c => c.validity === 'current'));
  assert.equal(all[0].before, all[1].before); // Canonical short context alone cannot distinguish them.
});
test('failed storage can be retried; cancellation drains an in-flight save but forbids later batches and final delivery', async () => {
  let reject = true, active = true, saved = 0;
  const p = new ReviewPublisher(draft, 0, draft.length, async () => { if (reject) throw Error('disk unavailable'); saved++; }, () => active);
  const r = p.reader(reviewOutputSchema);
  await assert.rejects(r.call('publish_comments', payload(comment())), /disk unavailable/);
  reject = false;
  assert.deepEqual(await r.call('publish_comments', payload(comment())), { published: 1, total: 1 });
  active = false; await r.cancel();
  await assert.rejects(p.finish(payload(comment('result are', 'result is'))), /cancelled/);
  assert.equal(saved, 1);

  let release!: () => void, started!: () => void;
  const began = new Promise<void>(resolve => { started = resolve; });
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const q = new ReviewPublisher(draft, 0, draft.length, async () => { started(); await waiting; }, () => true);
  const reader = q.reader(reviewOutputSchema), batch = reader.call('publish_comments', payload(comment()));
  await began; let closed = false;
  const closing = reader.cancel().then(() => { closed = true; });
  await Promise.resolve(); assert.equal(closed, false);
  release(); await batch; await closing; assert.equal(closed, true);
});
test('review service retains early batches while running and after Stop; completed history includes all batches once', async t => {
  const root = path.resolve('.test-runs', 'batches-' + randomUUID());
  await fs.mkdir(root, { recursive: true });
  const file = path.join(root, 'paper.txt'); await fs.writeFile(file, draft);
  const projects = new ProjectService(path.join(root, 'runtime')), paper = await projects.open(file);
  const service = new CodexService(projects, path.join(root, 'runtime/codex'));
  t.after(async () => { await service.cancel(); await fs.rm(root, { recursive: true, force: true }); });
  let release!: () => void, signal!: () => void;
  const begun = new Promise<void>(resolve => { signal = resolve; });
  service.client.run = async (_prompt, _schema, _progress, _effort, _fast, reader) => {
    assert(reader);
    await reader.call('publish_comments', payload(comment())); signal();
    await new Promise<void>(resolve => { release = resolve; });
    await reader.cancel();
    return payload(comment(), comment('result are', 'result is'));
  };
  let delivered = 0;
  const request = { projectId: paper.id, text: draft, from: 0, to: draft.length, instructions: 'Grammar.', autoAddComments: false };
  const running = service.review(request, () => {}, () => { delivered++; });
  await begun;
  const early = await service.results.list(paper.id);
  assert.equal(early.items.length, 1); assert.equal(early.items[0].kind, 'review');
  assert.equal(delivered, 1); assert.equal(early.items[0].autoAddComments, false);
  release(); const all = await running;
  assert.equal(all.length, 2); assert.equal(delivered, 2);
  assert.equal((await service.results.list(paper.id)).items.length, 2);
  const conversation = (await service.conversations.current(paper.id))!;
  const history = await service.conversations.history(paper.id, conversation.id);
  const turn = JSON.parse(await service.conversations.inspect(paper.id, conversation.id, history.items[0].id));
  assert.equal(turn.response.comments.length, 2);

  let stop!: () => void;
  const stopping = new Promise<void>(resolve => { stop = resolve; });
  service.client.run = async (_p, _s, _pr, _e, _f, reader) => {
    await reader!.call('publish_comments', payload(comment('result are', 'result is')));
    stop(); await new Promise<void>(resolve => { release = resolve; });
    throw Error('cancelled');
  };
  const second = service.review({ ...request, conversationMode: 'fresh' }, () => {});
  const rejected = assert.rejects(second, /cancelled/);
  await stopping; await service.cancel(); release(); await rejected;
  assert.equal((await service.results.list(paper.id)).items.length, 3);
  assert.equal(await fs.readFile(file, 'utf8'), draft);
});
