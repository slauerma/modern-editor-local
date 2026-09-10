import { documentStatePath } from '../src/main/document-state.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { undo, redo, isolateHistory } from '@codemirror/commands';
import { Transaction } from '@codemirror/state';
import { commentSchema } from '../src/shared/contracts.ts';
import { adoptComment, discussionMessage, historyCommentId, mergeComments, proposalChanges, replyFields, visibleCommentId } from '../src/shared/review.ts';
import { initialState, commentsField, loadComments, patchComments } from '../src/renderer/editor-state.ts';
import { ProjectService } from '../src/main/project-service.ts';
import { CodexService } from '../src/main/codex-service.ts';
import { InvalidCodexResponse } from '../src/main/codex-client.ts';

const quote = 'The allocation is monotone.';
const comment = () => commentSchema.parse({ id: 'ordinary', title: 'Clarity', explanation: '', original: quote, replacement: 'The allocation increases weakly.', from: 14, to: 14 + quote.length, validity: 'current' });
async function fixture(source = 'First result: ' + quote + '\nSecond result: ' + quote) {
  const root = path.resolve('.test-runs', 'review-batch-1-' + randomUUID());
  await fs.mkdir(root, { recursive: true });
  const file = path.join(root, 'main.tex'); await fs.writeFile(file, source);
  const projects = new ProjectService(path.join(root, 'cache')), p = await projects.open(file);
  return { root, file, projects, p };
}

test('an ordinary stale comment cannot relocate to another quote on recovery', async () => {
  const f = await fixture();
  let state = initialState(f.p.text, [comment()]);
  state = state.update({ changes: { from: 14, to: 14 + quote.length, insert: 'Corrected manually.' } }).state;
  assert.equal(state.field(commentsField)[0].validity, 'stale');
  await f.projects.persist({ projectId: f.p.id, text: state.doc.toString(), review: { ...f.p.review, comments: state.field(commentsField) } });
  const reopened = await f.projects.open(f.file), c = reopened.review.comments[0];
  assert.notEqual(c.validity, 'current');
  assert.throws(() => proposalChanges(reopened.text, c));
  assert.equal(await fs.readFile(f.file, 'utf8'), f.p.text);
  assert(undo({ state, dispatch: tr => { state = tr.state; } }));
  assert.equal(state.field(commentsField)[0].validity, 'current');
});

test('an unchanged revision preserves mapped placement and supplies local context', async () => {
  const f = await fixture();
  await f.projects.persist({ projectId: f.p.id, text: f.p.text, review: { ...f.p.review, comments: [comment()] } });
  const reopened = await f.projects.open(f.file), c = reopened.review.comments[0];
  assert.equal(c.from, 14); assert.equal(c.validity, 'current');
  assert.equal(c.before, 'First result: '); assert(c.after.includes('Second result:'));
  assert.doesNotThrow(() => proposalChanges(reopened.text, c));
});

test('a full-review import respects another root and an outdated revision', async () => {
  const f = await fixture('First result: ' + quote), file = path.join(f.root, 'incoming.json');
  const review = { ...f.p.review, rootFile: 'other.tex', comments: [comment()] };
  await fs.writeFile(file, JSON.stringify(review));
  await assert.rejects(f.projects.import(file, f.p.id, f.p.text), /different|belongs/i);
  await fs.writeFile(file, JSON.stringify({ ...review, rootFile: f.p.name, sourceHash: '0'.repeat(64) }));
  const imported = await f.projects.import(file, f.p.id, f.p.text);
  assert.notEqual(imported.comments[0].validity, 'current');
  assert.throws(() => proposalChanges(f.p.text, imported.comments[0]));
});

test('a merged comment list cannot install a state that recovery rejects', () => {
  const comments = Array.from({ length: 2000 }, (_, i) => ({ ...comment(), id: 'c' + i }));
  const state = initialState(quote, comments);
  assert.throws(() => state.update({ effects: loadComments.of([...comments, { ...comment(), id: 'extra' }]) }).state);
  assert.equal(state.field(commentsField).length, 2000);
});

test('discussion and proposal limits reject mutations before changing editor state', () => {
  const message = { role: 'user' as const, text: 'Kept note', createdAt: '2026-09-08' };
  const c = { ...comment(), messages: Array(500).fill(message) }, state = initialState(quote, [c]);
  assert.throws(() => state.update({ effects: patchComments.of([{ id: c.id, fields: { messages: [...c.messages, message] } }]) }).state);
  assert.throws(() => state.update({ effects: patchComments.of([{ id: c.id, fields: { draft: 'x'.repeat(100001) } }]) }).state);
  assert.equal(state.field(commentsField)[0].messages.length, 500);
  assert.equal(state.field(commentsField)[0].draft, undefined);
});

test('a null draft consistently falls back to the saved replacement', () => {
  const c = commentSchema.parse({ ...comment(), from: 0, to: quote.length, draft: null });
  assert.equal(c.draft, undefined);
  assert.equal(proposalChanges(quote, c)[0].insert, c.replacement);
});

for (const scenario of ['edited proposal', 'unchanged proposal', 'dismissed comment', 'edited source']) {
  test(`a delayed reply stays an alternative with ${scenario}`, async () => {
    let state = initialState(quote, [adoptComment(quote, commentSchema.parse({ ...comment(), from: 0, to: quote.length, draft: 'My working version', packages: ['amsmath'] }))]);
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; }).then(() => {
      const now = state.field(commentsField)[0];
      state = state.update({ effects: patchComments.of([{ id: now.id, fields: replyFields(now, { reply: 'Consider this alternative', replacement: 'Model alternative', packages: ['mathtools'] }) }]), annotations: Transaction.addToHistory.of(false) }).state;
    });
    if (scenario === 'edited proposal') state = state.update({ effects: patchComments.of([{ id: 'ordinary', fields: { draft: 'My later exact revision' } }]) }).state;
    if (scenario === 'dismissed comment') state = state.update({ effects: patchComments.of([{ id: 'ordinary', fields: { decision: 'dismissed' } }]) }).state;
    if (scenario === 'edited source') state = state.update({ changes: { from: 0, insert: 'Changed source: ' } }).state;
    const before = state.field(commentsField)[0], source = state.doc.toString();
    release(); await pending;
    const after = state.field(commentsField)[0];
    assert.deepEqual({ ...after, messages: [] }, { ...before, messages: [] });
    assert.equal(after.messages.at(-1)?.proposal?.replacement, 'Model alternative');
    assert.equal(state.doc.toString(), source);
    state = state.update({ effects: patchComments.of([{ id: after.id, fields: { replacement: 'Model alternative', draft: undefined, packages: ['mathtools'] } }]), annotations: isolateHistory.of('full') }).state;
    const changed = state.field(commentsField);
    assert(undo({ state, dispatch: tr => { state = tr.state; } }));
    assert.equal(state.field(commentsField)[0].draft, before.draft);
    assert.deepEqual(state.field(commentsField)[0].messages, after.messages);
    assert.equal(historyCommentId(changed, state.field(commentsField), null), 'ordinary');
    assert(redo({ state, dispatch: tr => { state = tr.state; } }));
    assert.equal(state.field(commentsField)[0].replacement, 'Model alternative');
  });
}

test('merge preflight preserves valid IDs without overflowing a colliding 200-character ID', () => {
  const c = { ...comment(), id: 'a'.repeat(200) };
  const merged = mergeComments([c], [c, c]);
  assert.equal(new Set(merged.map(c => c.id)).size, 3);
  assert(merged.every(c => c.id.length <= 200)); assert.equal(c.id, 'a'.repeat(200));
  assert.throws(() => mergeComments(Array.from({ length: 2000 }, (_, i) => ({ ...c, id: String(i) })), [c]));
});

test('Pending/History selection and undo select the affected comment', () => {
  const a = { ...comment(), id: 'first' }, b = { ...comment(), id: 'last', decision: 'applied' as const };
  assert.equal(visibleCommentId([a, b], b.id, false), a.id);
  assert.equal(visibleCommentId([a, b], b.id, true), b.id);
  const reopened = { ...b, decision: 'open' as const };
  assert.equal(historyCommentId([a, b], [a, reopened], null), b.id);
  assert.equal(visibleCommentId([b], b.id, false), null);
});

test('a source edit exceeding the persistence bound is rejected without changing the buffer', () => {
  let notified = false;
  const state = initialState('Kept manuscript', [], () => { notified = true; });
  const next = state.update({ changes: { from: 0, insert: 'x'.repeat(2000001) } }).state;
  assert.equal(next.doc.toString(), 'Kept manuscript'); assert.equal(notified, true);
});

test('model answers rejected by schema remain separately recoverable', async () => {
  const f = await fixture(), service = new CodexService(f.projects, path.join(f.root, 'fake-client'));
  const response = { reply: 'x'.repeat(100001), replacement: null, packages: [] };
  service.client.run = async () => response;
  await assert.rejects(service.reply({ projectId: f.p.id, text: f.p.text, comment: comment(), message: 'Question' }, () => {}));
  const directory = path.join(documentStatePath(f.file), 'reviews'), files = await fs.readdir(directory);
  const saved = JSON.parse(await fs.readFile(path.join(directory, files.find(n => n.startsWith('reply-'))!), 'utf8'));
  assert.deepEqual(saved.response, response);
  service.client.run = async () => ({ comments: [{ ...comment(), title: 'x'.repeat(301) }] });
  await assert.rejects(service.review({ projectId: f.p.id, text: f.p.text, from: 0, to: f.p.text.length, instructions: '' }, () => {}));
  assert((await fs.readdir(directory)).some(n => n.startsWith('rejected-')));
  assert.equal(await fs.readFile(f.file, 'utf8'), f.p.text);
});

test('completed malformed model text is retained for both review and discussion', async () => {
  const f = await fixture(), service = new CodexService(f.projects, path.join(f.root, 'fake-client'));
  const raw = 'Useful advice, but not JSON: preserve \\theta and the author’s wording.';
  service.client.run = async () => { throw new InvalidCodexResponse(raw); };
  await assert.rejects(service.reply({ projectId: f.p.id, text: f.p.text, comment: comment(), message: 'Question' }, () => {}), /valid structured review/);
  await assert.rejects(service.review({ projectId: f.p.id, text: f.p.text, from: 0, to: f.p.text.length, instructions: '' }, () => {}), /valid structured review/);
  const directory = path.join(documentStatePath(f.file), 'reviews'), files = await fs.readdir(directory);
  assert.equal(files.length, 2); assert(files.every(n => n.startsWith('rejected-') && n.endsWith('.txt')));
  for (const name of files) assert.equal(await fs.readFile(path.join(directory, name), 'utf8'), raw);
  assert.equal(await fs.readFile(f.file, 'utf8'), f.p.text);
});

test('a discussion over the request limit is rejected before clearing its draft', () => {
  const c = { ...comment(), replyDraft: 'x'.repeat(10001) };
  assert.throws(() => discussionMessage(c), /Your draft was kept/);
  assert.equal(c.replyDraft.length, 10001); assert.equal(c.messages.length, 0);
  assert.equal(discussionMessage({ ...c, replyDraft: '  ' + 'x'.repeat(10000) + '  ' }).length, 10000);
  const full = { ...c, replyDraft: 'Question', messages: Array.from({ length: 499 }, () => ({ role: 'user' as const, text: 'note', createdAt: '' })) };
  assert.throws(() => discussionMessage(full), /discussion is full/);
  assert.equal(full.replyDraft, 'Question'); assert.equal(full.messages.length, 499);
});
