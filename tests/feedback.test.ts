import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { ProjectService } from '../src/main/project-service.ts';
import { CodexService } from '../src/main/codex-service.ts';
import { AttachmentService } from '../src/main/attachment-service.ts';
import { commentSchema } from '../src/shared/contracts.ts';
import { feedbackComments, feedbackContext, feedbackRequestSchema, type FeedbackRecord } from '../src/shared/feedback.ts';
import { attachmentPromptContext } from '../src/shared/attachments.ts';
import { reviewContext, replyContext } from '../src/shared/codex-context.ts';
import { proposalChanges } from '../src/shared/review.ts';

const source = 'The allocation is monotone.\nThe feasible set is compact.';
const rawFeedback = '\n  Referee notes:\r\n  Explain the monotonicity claim.\n\n';
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function fixture() {
  const root = path.resolve('.test-runs', 'outside-feedback-' + randomUUID());
  await fs.mkdir(root, { recursive: true });
  const file = path.join(root, 'main.tex'); await fs.writeFile(file, source);
  const projects = new ProjectService(path.join(root, 'runtime')), p = await projects.open(file);
  const attachments = new AttachmentService({ pdfModulePath: fileURLToPath(new URL('../node_modules/pdfjs-dist/legacy/build/pdf.mjs', import.meta.url)) });
  const service = new CodexService(projects, path.join(root, 'codex'), attachments);
  const request = { projectId: p.id, text: source, label: 'Referee report', feedback: rawFeedback };
  return { root, file, projects, p, service, attachments, request };
}
function suggestion(overrides: Record<string, unknown> = {}) {
  return { category: 'Clarity', title: 'Clarify monotonicity', explanation: 'Specify the direction of the comparison.', original: 'The allocation is monotone.', replacement: 'The allocation is weakly increasing.', before: '', after: '', packages: [], ...overrides };
}
function record(comments = [commentSchema.parse({ ...suggestion(), id: randomUUID() })]): FeedbackRecord {
  return { schemaVersion: 1, id: randomUUID(), rootFile: 'main.tex', createdAt: '2026-09-10T12:00:00Z', label: 'Outside feedback', feedback: rawFeedback, source, status: 'complete', error: '', comments };
}

test('outside feedback is retained exactly before the model request and survives reopening', async () => {
  const f = await fixture();
  let calls = 0;
  f.service.client.run = async prompt => {
    calls++;
    const saved = await f.service.feedback.list(f.p.id);
    assert.equal(saved.items.length, 1);
    assert.equal(saved.items[0].status, 'saved');
    assert.equal(saved.items[0].feedback, rawFeedback);
    assert.equal(saved.items[0].source, source);
    assert.deepEqual(JSON.parse(prompt), feedbackContext(f.request, f.p.paperInstructions));
    return { comments: [suggestion()] };
  };
  const converted = await f.service.convertFeedback(f.request, () => {});
  assert.equal(calls, 1); assert.equal(converted.status, 'complete');
  assert.equal(converted.feedback, rawFeedback);
  assert.equal(converted.comments[0].validity, 'current');
  assert.equal(await fs.readFile(f.file, 'utf8'), source);
  const reopenedProjects = new ProjectService(path.join(f.root, 'runtime'));
  const reopened = await reopenedProjects.open(f.file);
  const resumed = new CodexService(reopenedProjects, path.join(f.root, 'codex'));
  const saved = await resumed.feedback.list(reopened.id);
  assert.equal(saved.items[0].feedback, rawFeedback);
  assert.equal(saved.items[0].id, converted.id);
  assert.equal(saved.items[0].status, 'complete');
  assert.throws(() => feedbackRequestSchema.parse({ ...f.request, feedback: '  \r\n' }), /feedback/);
});

test('failed and malformed conversions keep raw advice and the original source intact', async () => {
  const f = await fixture();
  f.service.client.run = async () => { throw new Error('Synthetic unavailable model'); };
  await assert.rejects(f.service.convertFeedback(f.request, () => {}), /Synthetic unavailable model/);
  const failed = (await f.service.feedback.list(f.p.id)).items[0];
  assert.equal(failed.status, 'failed'); assert.equal(failed.feedback, rawFeedback); assert.match(failed.error, /Synthetic unavailable model/);
  f.service.client.run = async () => ({ comments: Array.from({ length: 31 }, () => suggestion()) });
  await assert.rejects(f.service.convertFeedback({ ...f.request, label: 'Too many returned comments' }, () => {}), /invalid feedback list/);
  const saved = await f.service.feedback.list(f.p.id);
  assert.equal(saved.items.length, 2);
  assert(saved.items.every(item => item.status === 'failed' && item.feedback === rawFeedback));
  assert.equal(await fs.readFile(f.file, 'utf8'), source);
});

test('unmatched advice stays inspectable and a changed source requires confirmation', async () => {
  const f = await fixture();
  f.service.client.run = async () => ({ comments: [suggestion(), suggestion({ title: 'Discuss robustness', original: '', replacement: null, explanation: 'Discuss whether the conclusion needs compactness.' }), suggestion({ title: 'Unmatched quote', original: 'A quotation absent from this source.', replacement: null })] });
  const converted = await f.service.convertFeedback(f.request, () => {});
  const originalAdvice = feedbackComments(converted, source, []);
  assert.equal(originalAdvice.length, 3);
  assert.equal(originalAdvice[0].validity, 'current');
  assert.equal(originalAdvice[1].replacement, null); assert.equal(originalAdvice[1].validity, 'missing');
  assert.equal(originalAdvice[2].validity, 'missing');
  const editedSource = 'New introduction.\n' + source;
  const changed = feedbackComments(converted, editedSource, []);
  assert.equal(changed[0].validity, 'unconfirmed');
  assert.throws(() => proposalChanges(editedSource, changed[0]), /confirm|current|stale|matched|changed/i);
  assert.equal(await fs.readFile(f.file, 'utf8'), source);
});

test('repeat imports suppress true duplicates but keep distinct general advice with the same title', () => {
  const first = commentSchema.parse({ ...suggestion({ title: 'General advice', original: '', replacement: null, explanation: 'Explain the economic intuition.' }), id: randomUUID() });
  const exact = { ...first, id: randomUUID() };
  const other = { ...first, id: randomUUID(), explanation: 'Explain which assumptions are necessary.' };
  const saved = record([first]);
  assert.deepEqual(feedbackComments(saved, source, [first]), []);
  assert.deepEqual(feedbackComments(record([exact]), source, [first]), []);
  const distinct = feedbackComments(record([other]), source, [first]);
  assert.equal(distinct.length, 1); assert.equal(distinct[0].explanation, other.explanation);
});

test('saved feedback belongs to the correct document even when another paper is in the same folder', async () => {
  const f = await fixture(); f.service.client.run = async () => ({ comments: [] });
  const saved = await f.service.convertFeedback(f.request, () => {});
  const otherFile = path.join(f.root, 'other.tex'); await fs.writeFile(otherFile, source);
  const other = await f.projects.open(otherFile);
  assert.deepEqual((await f.service.feedback.list(other.id)).items, []);
  await assert.rejects(f.service.feedback.save(other.id, saved), /another paper/);
  await assert.rejects(f.service.feedback.list(f.p.id), /no longer open/);
  assert.equal(await fs.readFile(otherFile, 'utf8'), source);
});

test('the newest converted feedback remains visible once the fifty-record display limit is reached', async () => {
  const f = await fixture();
  let newest = '', oldest = '';
  for (let index = 0; index < 51; index++) {
    const entry = { ...record([]), createdAt: new Date(Date.UTC(2026, 8, 10, 12, 0, index)).toISOString(), label: `Record ${index}` };
    if (!index) oldest = entry.id; newest = entry.id;
    await f.service.feedback.save(f.p.id, entry);
  }
  const saved = await f.service.feedback.list(f.p.id);
  assert.equal(saved.items.length, 50); assert.equal(saved.items[0].id, newest);
  assert(!saved.items.some(item => item.id === oldest));
  assert(saved.notices.some(notice => /older|limit/i.test(notice)));
  const directory = path.join(await f.projects.stateDirectory(f.p.id), 'feedback');
  assert.equal((await fs.readdir(directory)).filter(name => name.endsWith('.json')).length, 51);
});

test('cancel during raw-feedback persistence prevents a later model request and preserves the raw record', async () => {
  const f = await fixture(), entered = deferred(), release = deferred();
  const originalSave = f.service.feedback.save.bind(f.service.feedback);
  let first = true, calls = 0;
  f.service.feedback.save = async (id, value) => {
    const saved = await originalSave(id, value);
    if (first) { first = false; entered.resolve(); await release.promise; }
    return saved;
  };
  f.service.client.run = async () => { calls++; return { comments: [] }; };
  const pending = f.service.convertFeedback(f.request, () => {}).then(() => null, error => error as Error);
  await entered.promise;
  const cancelled = f.service.cancel(); release.resolve(); await cancelled;
  const error = await pending;
  assert(error instanceof Error); assert.match(error.message, /cancel/i);
  assert.equal(calls, 0);
  const saved = await f.service.feedback.list(f.p.id);
  assert.equal(saved.items.length, 1); assert.equal(saved.items[0].feedback, rawFeedback);
  assert.notEqual(saved.items[0].status, 'complete');
  assert.equal(await fs.readFile(f.file, 'utf8'), source);
  await f.service.settle();
});

test('cancel during reference validation prevents review and reply model requests', async () => {
  for (const kind of ['review', 'reply'] as const) {
    const f = await fixture(), file = path.join(f.root, 'reference.md');
    await fs.writeFile(file, 'A selected supporting result.');
    const inventory = await f.attachments.grant(f.p.id, [file]);
    const preview = await f.attachments.preview(f.p.id, [{ id: inventory.items[0].id }]);
    const entered = deferred(), release = deferred(), resolve = f.attachments.resolve.bind(f.attachments);
    f.attachments.resolve = async (id, snapshot) => { entered.resolve(); await release.promise; return resolve(id, snapshot); };
    let calls = 0; f.service.client.run = async () => { calls++; return kind === 'review' ? { comments: [] } : { reply: 'A reply', replacement: null, packages: [] }; };
    const common = { projectId: f.p.id, text: source, attachmentPreviewId: preview.id };
    const pending = (kind === 'review'
      ? f.service.review({ ...common, from: 0, to: source.length, instructions: 'Check language.' }, () => {})
      : f.service.reply({ ...common, comment: commentSchema.parse({ ...suggestion(), id: randomUUID() }), message: 'Explain this.' }, () => {})).then(() => null, error => error as Error);
    await entered.promise;
    const cancelled = f.service.cancel(); release.resolve(); await cancelled;
    const error = await pending;
    assert(error instanceof Error); assert.match(error.message, /cancel/i); assert.equal(calls, 0);
    await f.service.settle();
  }
});

test('the actual review and reply service use exactly the displayed reference payload and reject changes', async () => {
  const f = await fixture(), file = path.join(f.root, 'reference.md');
  await fs.writeFile(file, 'Not selected\nRelevant supporting argument.\nNot selected either');
  const inventory = await f.attachments.grant(f.p.id, [file]);
  const preview = await f.attachments.preview(f.p.id, [{ id: inventory.items[0].id, lines: '2' }]);
  const review = { projectId: f.p.id, text: source, from: 0, to: source.length, instructions: 'Check reasoning.', attachmentPreviewId: preview.id };
  const reply = { projectId: f.p.id, text: source, comment: commentSchema.parse({ ...suggestion(), id: randomUUID() }), message: 'Compare with the reference.', attachmentPreviewId: preview.id };
  const prompts: unknown[] = [];
  f.service.client.run = async prompt => { prompts.push(JSON.parse(prompt)); return prompts.length === 1 ? { comments: [] } : { reply: 'Compare the hypotheses.', replacement: null, packages: [] }; };
  await f.service.review(review, () => {});
  await f.service.reply(reply, () => {});
  assert.deepEqual(prompts[0], reviewContext(review, f.p.paperInstructions, attachmentPromptContext(preview)));
  assert.deepEqual(prompts[1], replyContext(reply, f.p.paperInstructions, attachmentPromptContext(preview)));
  assert.doesNotMatch(JSON.stringify(prompts), /Not selected/);
  assert(!JSON.stringify(prompts).includes(f.root));
  await fs.writeFile(file, 'Changed supporting argument.');
  await assert.rejects(f.service.review(review, () => {}), /changed after the preview/);
  assert.equal(prompts.length, 2);
  assert.equal(await fs.readFile(f.file, 'utf8'), source);
});
