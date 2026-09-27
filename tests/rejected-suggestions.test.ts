import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { commentSchema, type BufferInput, type WaitingResult } from '../src/shared/contracts.ts';
import { captureContext } from '../src/shared/review.ts';
import { isRejectedRepeat, rejectionContext } from '../src/shared/rejected-suggestions.ts';
import { mergeResult } from '../src/shared/result-arrival.ts';
import { feedbackComments } from '../src/shared/feedback.ts';
import { ResultInbox } from '../src/renderer/result-inbox.ts';
import { ProjectService } from '../src/main/project-service.ts';
import { CodexService } from '../src/main/codex-service.ts';
import { digest } from '../src/main/files.ts';

const text = 'An imprecise claim.\nA second claim.';
const comment = (id = 'c') => captureContext(text, commentSchema.parse({ id, title: 'Clarify', explanation: 'Explain the scope.', original: 'An imprecise claim.', replacement: 'A precise claim.', from: 0, to: 19, validity: 'current' }));
const result = (comments = [comment('new')]): WaitingResult => ({ schemaVersion: 1, id: randomUUID(), kind: 'review', rootFile: 'paper.txt', sourceHash: digest(text), comments, createdAt: new Date().toISOString(), autoAddComments: true });

test('rejection made during generation suppresses exact repeat on arrival, preserving the raw result and other fixes', () => {
  const old = { ...comment(), decision: 'dismissed' as const }, raw = result([comment('repeat'), { ...comment('different'), replacement: 'A qualified claim.' }]);
  const merged = mergeResult(text, [old], raw, true);
  assert.deepEqual(merged.map(c => c.id), ['c', 'different']); assert.equal(merged[0].decision, 'dismissed');
  assert.equal(raw.kind === 'review' && raw.comments.length, 2);
  assert(!isRejectedRepeat(comment(), [{ ...old, decision: 'open' }], text), 'Reopen clears rejection');
  assert(!isRejectedRepeat({ ...comment(), packages: ['xcolor'] }, [old], text));
  const noPlan = { schemaVersion: 1 as const, id: randomUUID(), rootFile: 'paper.txt', createdAt: '', label: 'Another round', feedback: 'Clarify.', source: text, status: 'complete' as const, error: '', comments: [comment('repeat')] };
  assert.equal(feedbackComments(noPlan, text, [old]).length, 0);
});

test('rejecting an edited comment remembers both original options and their drafts', () => {
  const old = { ...comment(), decision: 'dismissed' as const, draft: 'My precise claim.' };
  assert(isRejectedRepeat(comment(), [old], text));
  assert(isRejectedRepeat({ ...comment(), replacement: old.draft }, [old], text));
  assert(!isRejectedRepeat({ ...comment(), replacement: 'A genuinely different concern.' }, [old], text));
  assert.deepEqual(rejectionContext([old]).items[0].otherRejectedWordings, ['A precise claim.']);
  const withOptions = { ...old, alternatives: [{ id: 'option', original: old.original, label: 'Another', reason: '', replacement: 'Another precise claim.', draft: 'My alternative draft.', packages: [] }] };
  for (const replacement of ['Another precise claim.', 'My alternative draft.']) assert(isRejectedRepeat({ ...comment(), replacement }, [withOptions], text));
  assert.deepEqual(rejectionContext([withOptions]).items[0].otherRejectedWordings, ['A precise claim.', 'Another precise claim.', 'My alternative draft.']);
});

test('same text at a different passage is not suppressed without matching context, and rejection context stays bounded', () => {
  const repeated = text + '\nElsewhere: An imprecise claim.';
  const old = { ...comment(), decision: 'dismissed' as const };
  assert(!isRejectedRepeat({ ...comment(), before: 'Elsewhere: ', after: '' }, [old], repeated));
  assert(isRejectedRepeat(comment(), [old], repeated));
  const history = Array.from({ length: 2000 }, (_, i) => ({ ...old, id: String(i), explanation: 'e'.repeat(100000), original: 'o'.repeat(100000), replacement: 'r'.repeat(100000) }));
  const context = rejectionContext(history);
  assert.equal(context.totalRejected, 2000); assert(context.included > 0 && context.included < 40);
  assert(new TextEncoder().encode(JSON.stringify(context)).length < 22000);
});

test('latest toggle governs in-flight arrivals and enabling it integrates waiting comments without changing the active draft', async () => {
  let autoAdd = false, current: BufferInput = { projectId: 'p', text, review: { schemaVersion: 1, rootFile: 'paper.txt', sourceHash: digest(text), activeId: 'c', comments: [{ ...comment(), draft: 'My unfinished wording.' }], updatedAt: '' } };
  let retained = [result([{ ...comment('new'), replacement: 'A different point.' }])], writes = 0;
  const inbox = new ResultInbox({ input: () => current, locked: () => false, begin: () => () => {}, autoAddComments: () => autoAdd,
    api: { waitingResults: async () => ({ items: retained, notices: [] }), acknowledgeResult: async () => { assert(writes > 0); retained = []; } },
    install: comments => { current = { ...current, review: { ...current.review, comments } }; },
    flush: async () => { writes++; }, changed: () => {}, error: e => { throw e; } });
  await inbox.refresh(); assert.equal(current.review.comments.length, 1); assert.equal(retained.length, 1);
  autoAdd = true; retained[0] = { ...retained[0], autoAddComments: false } as WaitingResult;
  await inbox.refresh(); assert.equal(current.review.comments.length, 2); assert.equal(retained.length, 0);
  assert.equal(current.review.activeId, 'c'); assert.equal(current.review.comments[0].draft, 'My unfinished wording.'); assert.equal(current.text, text);
});

for (const reopen of [false, true]) test(`review requests include persisted rejections ${reopen ? 'after reopening' : 'before any source Save'}, and keep history`, async t => {
  const root = path.resolve('.test-runs', 'rejected-memory-' + randomUUID()); await fs.mkdir(root, { recursive: true });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'paper.txt'); await fs.writeFile(file, text);
  const first = new ProjectService(path.join(root, 'runtime')), paper = await first.open(file);
  await first.persist({ projectId: paper.id, text, review: { ...paper.review, comments: [{ ...comment(), decision: 'dismissed' }] } });
  const projects = reopen ? new ProjectService(path.join(root, 'second-runtime')) : first, reopened = reopen ? await projects.open(file) : paper;
  const service = new CodexService(projects, path.join(root, 'codex')); let sent: any;
  service.client.run = async prompt => { sent = JSON.parse(prompt); return { comments: [] }; };
  await service.review({ projectId: reopened.id, text, from: 0, to: text.length, instructions: 'Review again.' }, () => {});
  assert.equal(sent.rejectedSuggestions.totalRejected, 1); assert.equal(sent.rejectedSuggestions.items[0].rejectedWording, 'A precise claim.');
  assert.match(sent.rejectedSuggestions.instruction, /Do not repeat/);
  assert.equal(projects.get(reopened.id).review.comments[0].decision, 'dismissed'); assert.equal(await fs.readFile(file, 'utf8'), text);
});
