import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { HelpChat } from '../src/main/help-chat.ts';
import { CodexClient } from '../src/main/codex-client.ts';
import { ProjectService } from '../src/main/project-service.ts';
import { digest, writeJSON } from '../src/main/files.ts';
import { CHAT_LIMITS, chatComments, newChatComments, chatAnswerSchema, chatInputSchema, chatContext, chatHistory, chatTurnSchema, chatCommentForDraft, type ChatInput } from '../src/shared/help-chat.ts';
import { proposalChanges } from '../src/shared/review.ts';
import { initialState, alterComments, commentsField } from '../src/renderer/editor-state.ts';
import { undo } from '@codemirror/commands';
import { chatImageDimensions } from '../src/shared/chat-images.ts';
import { commentSchema } from '../src/shared/contracts.ts';
import type { ReferenceService } from '../src/main/reference-service.ts';

const source = 'The allocation are monotone.\nThe feasible set is compact.';
const help = async () => ({ version: '0.3.0', platform: 'darwin', osVersion: '26', documentation: 'Shift+A accepts; Shift+R rejects. Save writes the source.' });
const image = () => ({ id: randomUUID(), name: 'Synthetic screenshot.png', dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jNnYAAAAASUVORK5CYII=' });
const answer = () => ({ reply: 'Use the singular verb.', suggestion: { title: 'Correct the verb', explanation: 'Allocation is singular.', original: 'The allocation are monotone.', before: '', after: '', replacement: 'The allocation is monotone.', packages: [] } });
async function fixture(write = writeJSON) {
  const root = path.resolve('.test-runs', 'help-chat-' + randomUUID()); await fs.mkdir(root, { recursive: true });
  const file = path.join(root, 'main.tex'); await fs.writeFile(file, source);
  const projects = new ProjectService(path.join(root, 'runtime')), paper = await projects.open(file);
  const client = new CodexClient(path.join(root, 'codex')); client.run = async () => answer();
  const directory = path.join(root, 'runtime', 'help-chats');
  const service = new HelpChat(projects, client, directory, help, undefined, write);
  const input = chatInputSchema.parse({ projectId: paper.id, source, from: 0, to: 27, paper: 'draft', message: 'Improve the language.', editorState: { pdf: 'older', unsaved: true, error: 'Synthetic compile error', compilation: 'Synthetic log' } });
  return { root, file, projects, paper, client, directory, service, input, stored: path.join(directory, digest(paper.path) + '.json') };
}
async function ask(f: Awaited<ReturnType<typeof fixture>>, input = f.input) { const preview = await f.service.preview(input); return f.service.send({ projectId: input.projectId }, preview.id, () => {}); }

test('chat preserves its question before calling Codex, sends real image items separately, and never changes source/review', async () => {
  const f = await fixture(), screenshot = image(); let called = false;
  f.client.run = async (prompt, _schema, _progress, _effort, _fast, _reader, options) => {
    const saved = await f.service.state({ projectId: f.paper.id });
    assert.equal(saved.turns[0].status, 'pending'); assert.equal(saved.turns[0].images[0].dataUrl, screenshot.dataUrl);
    const payload = JSON.parse(prompt); assert.equal(payload.application.version, '0.3.0'); assert.equal(payload.source.text, source);
    assert(!prompt.includes(screenshot.dataUrl)); assert.deepEqual(options, { purpose: 'help', images: [screenshot.dataUrl] }); called = true; return answer();
  };
  const beforeReview = JSON.stringify(f.projects.get(f.paper.id).review);
  const reply = await ask(f, { ...f.input, images: [screenshot] });
  assert(called); assert.equal(reply.comment?.validity, 'current'); assert.equal(reply.comment?.replacement, 'The allocation is monotone.');
  assert.equal(await fs.readFile(f.file, 'utf8'), source); assert.equal(JSON.stringify(f.projects.get(f.paper.id).review), beforeReview);
  const reopened = new HelpChat(f.projects, f.client, f.directory, help);
  assert.deepEqual((await reopened.state({ projectId: f.paper.id })).turns[0], reply);
});

test('editor help has no paper text, references or comment wording; toggles and transcript previews match the request', async () => {
  const f = await fixture();
  const input = chatInputSchema.parse({ ...f.input, projectId: null, source: '', from: 0, to: 0, paper: 'none', message: 'How do I compile?' });
  const preview = await f.service.preview(input), payload = JSON.parse(preview.context);
  assert(!('source' in payload)); assert(!('diagnostics' in payload)); assert(!('comment' in payload)); assert(!preview.context.includes(source));
  f.client.run = async prompt => { assert.equal(prompt, preview.context); return { reply: 'Use Command+T.', suggestion: null }; };
  await f.service.send({ projectId: null }, preview.id, () => {});
  assert.equal((await f.service.state({ projectId: null })).turns.length, 1);
  assert.equal((await f.service.state({ projectId: f.paper.id })).turns.length, 0);
  assert.throws(() => chatInputSchema.parse({ ...input, includeReferences: true }));
  const enabled = chatContext({ ...f.input, paper: 'none', includeDiagnostics: true }, await help(), []);
  assert.equal(enabled.context.diagnostics?.error, 'Synthetic compile error'); assert(!('source' in enabled.context));
});

test('two documents in the same folder keep separate conversations across reopen; clearing one preserves the other and source', async () => {
  const f = await fixture(); await ask(f);
  const otherFile = path.join(f.root, 'other.tex'); await fs.writeFile(otherFile, source);
  const other = await f.projects.open(otherFile);
  await ask(f, { ...f.input, projectId: other.id, message: 'A second paper question.' });
  const freshProjects = new ProjectService(path.join(f.root, 'runtime')), first = await freshProjects.open(f.file);
  const fresh = new HelpChat(freshProjects, f.client, f.directory, help);
  assert.equal((await fresh.state({ projectId: first.id })).turns[0].message, f.input.message);
  await f.service.clear({ projectId: other.id });
  assert.equal((await f.service.state({ projectId: other.id })).turns.length, 0);
  assert.equal((await fresh.state({ projectId: first.id })).turns.length, 1);
  assert.equal(await fs.readFile(otherFile, 'utf8'), source);
});

test('preview is bound to conversation, consumed once and invalidated by a changed saved history', async () => {
  const f = await fixture(); let calls = 0; f.client.run = async () => { calls++; return answer(); };
  const p = await f.service.preview(f.input);
  await assert.rejects(f.service.send({ projectId: null }, p.id, () => {}), /another paper/);
  assert.equal(calls, 0);
  const ready = await f.service.preview(f.input);
  await f.service.send({ projectId: f.paper.id }, ready.id, () => {});
  await assert.rejects(f.service.send({ projectId: f.paper.id }, ready.id, () => {}), /expired/);
  const stale = await f.service.preview(f.input);
  await writeJSON(f.stored, { version: 1, owner: f.paper.path, turns: [] });
  await assert.rejects(f.service.send({ projectId: f.paper.id }, stale.id, () => {}), /conversation changed/);
  assert.equal(calls, 1);
});

test('invented and repeated quotations cannot become directly applicable revisions', async () => {
  const f = await fixture(); f.client.run = async () => ({ ...answer(), suggestion: { ...answer().suggestion, original: 'Invented source.' } });
  const invalid = await ask(f); assert.equal(invalid.comment?.validity, 'missing'); assert.throws(() => proposalChanges(source, invalid.comment!), /passage changed/); assert.match(invalid.error!, /could not be verified/);
  f.client.run = async () => answer();
  const repeated = await ask(f, { ...f.input, source: source + '\n' + source });
  assert.equal(repeated.comment?.validity, 'ambiguous');
  assert.throws(() => proposalChanges(source + '\n' + source, repeated.comment!), /passage changed/);
  const late = chatCommentForDraft((await ask(f)).comment!, false);
  assert.equal(late.validity, 'unconfirmed'); assert.throws(() => proposalChanges(source, late), /passage changed/);
});

test('an explanation can become a question on the selected passage; adding is undoable and does not edit source', async () => {
  const f = await fixture(); f.client.run = async () => ({ reply: 'Please define monotonicity precisely.', suggestion: null });
  const result = await ask(f); assert.equal(result.comment?.replacement, null);
  let state = initialState(source, []);
  state = state.update({ effects: alterComments.of({ add: [result.comment!], remove: [] }) }).state;
  assert.equal(state.field(commentsField).length, 1); assert.equal(state.doc.toString(), source);
  assert(undo({ state, dispatch: tr => { state = tr.state; } }));
  assert.equal(state.field(commentsField).length, 0); assert.equal(state.doc.toString(), source);
});

test('cancel and duplicate send retain the question and cannot deliver a late response or erase another history', async () => {
  const f = await fixture(); let started!: () => void, resolve!: (value: unknown) => void;
  const waiting = new Promise<void>(done => { started = done; });
  f.client.run = async () => { started(); return new Promise(done => { resolve = done; }); };
  const pending = ask(f); await waiting;
  await assert.rejects(f.service.send({ projectId: f.paper.id }, randomUUID(), () => {}), /current Codex request/);
  await assert.rejects(f.service.clear({ projectId: f.paper.id }), /Stop the current/);
  await f.service.cancel(); resolve(answer()); await assert.rejects(pending, /cancelled/);
  const state = await f.service.state({ projectId: f.paper.id }); assert.equal(state.turns.length, 1); assert.equal(state.turns[0].status, 'failed'); assert(!state.turns[0].reply);
  assert.equal(await fs.readFile(f.file, 'utf8'), source);
});

test('a reply-save failure keeps the answer in memory, blocks close and another send, and can be retried', async () => {
  let fail = true;
  const f = await fixture(async (file, value, limit) => { if (fail && (value as any).turns.at(-1).status === 'complete') throw new Error('Synthetic disk failure'); await writeJSON(file, value, limit); });
  const reply = await ask(f); assert.equal(reply.status, 'complete');
  assert((await f.service.state({ projectId: f.paper.id })).needsSave);
  await assert.rejects(f.service.settle(), /not been saved/);
  await assert.rejects(f.service.preview(f.input), /Retry saving/);
  assert.equal(JSON.parse(await fs.readFile(f.stored, 'utf8')).turns[0].status, 'pending');
  fail = false; const retried = await f.service.retry({ projectId: f.paper.id });
  assert(!retried.needsSave); assert.equal(retried.turns[0].reply, reply.reply); await f.service.settle();
});

test('retry recognizes an already committed chat after a post-replacement write error', async () => {
  let writes = 0;
  const f = await fixture(async (file, value, limit) => { writes++; await writeJSON(file, value, limit); if ((value as any).turns.at(-1).status === 'complete') throw new Error('Synthetic error after rename'); });
  const reply = await ask(f); assert((await f.service.state({ projectId: f.paper.id })).needsSave);
  const before = writes, retried = await f.service.retry({ projectId: f.paper.id });
  assert.equal(writes, before); assert(!retried.needsSave); assert.equal(retried.turns[0].reply, reply.reply); await f.service.settle();
});

test('Stop during reference-context persistence never starts a model request', async () => {
  let release!: () => void, paused!: () => void, writes = 0, calls = 0, finished = false;
  const waiting = new Promise<void>(resolve => { paused = resolve; });
  const f = await fixture(async (file, value, limit) => { await writeJSON(file, value, limit); if (++writes === 2) { paused(); await new Promise<void>(resolve => { release = resolve; }); } });
  const references = { begin: async () => ({ context: () => ({ files: ['synthetic.txt'] }) }), finish: async () => { finished = true; } } as unknown as ReferenceService;
  const service = new HelpChat(f.projects, f.client, f.directory, help, references, f.service.write);
  f.client.run = async () => { calls++; return answer(); };
  const preview = await service.preview({ ...f.input, includeReferences: true });
  const pending = service.send({ projectId: f.paper.id }, preview.id, () => {}); await waiting;
  await service.cancel(); release(); await assert.rejects(pending, /cancelled/);
  assert.equal(calls, 0); assert(finished); assert.equal((await service.state({ projectId: f.paper.id })).turns[0].status, 'failed');
});

test('a selected-passage proposal cannot attach to a different occurrence outside the shared passage', async () => {
  const f = await fixture(), text = 'a X b\nc X d'; let helpReads = 0;
  const service = new HelpChat(f.projects, f.client, f.directory, async () => { helpReads++; return help(); });
  f.client.run = async () => ({ reply: 'A scoped revision.', suggestion: { ...answer().suggestion, original: 'X', before: 'c ', after: ' d', replacement: 'Y' } });
  const preview = await service.preview({ ...f.input, source: text, from: 0, to: 5, paper: 'passage' });
  const reply = await service.send({ projectId: f.paper.id }, preview.id, () => {});
  assert.equal(helpReads, 1, 'No asynchronous context rebuild after the model returns');
  assert(reply.comment); assert(reply.comment.to <= 5);
  if (reply.comment.validity === 'current') assert.deepEqual(proposalChanges(text, reply.comment), [{ from: 2, to: 3, insert: 'Y' }]);
});

test('raster headers are size-bounded before decoding and reject mismatches and truncated data', () => {
  const png = Buffer.from(image().dataUrl.split(',')[1], 'base64');
  assert.deepEqual(chatImageDimensions(png, 'image/png'), { width: 1, height: 1 });
  const huge = Buffer.from(png); huge.writeUInt32BE(1000000, 16);
  assert.throws(() => chatImageDimensions(huge, 'image/png'), /4096/);
  assert.throws(() => chatImageDimensions(png, 'image/jpeg'));
  assert.throws(() => chatImageDimensions(png.subarray(0, 20), 'image/png'));
  const jpeg = Uint8Array.from([255,216,255,224,0,4,0,0,255,192,0,11,8,0,20,0,30,1,1,17,0,255,217]);
  assert.deepEqual(chatImageDimensions(jpeg, 'image/jpeg'), { width: 30, height: 20 });
  const tooWide = jpeg.slice(); tooWide[15] = 32; assert.throws(() => chatImageDimensions(tooWide, 'image/jpeg'));
  assert.throws(() => chatImageDimensions(jpeg.subarray(0, 14), 'image/jpeg'));
});

test('oversized UTF-8 aggregate is rejected before a model call, preserving previous readable history', async () => {
  const f = await fixture(); let calls = 0; f.client.run = async () => { calls++; return answer(); };
  await f.service.state({ projectId: f.paper.id });
  const turn = chatTurnSchema.parse({ id: randomUUID(), createdAt: new Date().toISOString(), message: 'Earlier question', context: '界'.repeat(70000), labels: [], images: [], status: 'complete', reply: 'Earlier answer' });
  const record = { version: 1, owner: f.paper.path, turns: Array.from({ length: 70 }, () => ({ ...turn, id: randomUUID() })) };
  await writeJSON(f.stored, record, CHAT_LIMITS.recordBytes); const before = await fs.readFile(f.stored);
  assert(before.length > 14000000 && before.length < CHAT_LIMITS.recordBytes);
  await assert.rejects(f.service.preview(f.input), /16 MB storage limit/);
  assert.equal(calls, 0); assert.deepEqual(await fs.readFile(f.stored), before);
  assert.equal((await f.service.state({ projectId: f.paper.id })).turns.length, 70);
});

test('corrupt chat stays preserved and isolated from manuscript opening', async () => {
  const f = await fixture(); await f.service.state({ projectId: f.paper.id }); await fs.writeFile(f.stored, 'Malformed synthetic JSON');
  await assert.rejects(f.service.state({ projectId: f.paper.id }), /preserved/);
  await assert.rejects(f.service.preview(f.input), /preserved/);
  assert.equal((await f.projects.open(f.file)).text, source); assert.equal(await fs.readFile(f.stored, 'utf8'), 'Malformed synthetic JSON');
});

test('history has explicit bounds and excludes old context/images; long source truncation is visible', async () => {
  const f = await fixture(), sample = await ask(f);
  const turns = Array.from({ length: 20 }, () => ({ ...sample, id: randomUUID(), images: [image()] }));
  const history = chatHistory(turns); assert.equal(history.exchanges.length, 12); assert.equal(history.omittedExchanges, 8);
  assert(!JSON.stringify(history).includes('data:image')); assert(!JSON.stringify(history).includes('application'));
  const built = chatContext({ ...f.input, source: 'x'.repeat(130000) }, await help(), turns);
  assert(built.labels.includes('Draft · truncated')); assert.match(built.context.source!.coverage, /120000 of 130000/);
  assert.throws(() => chatInputSchema.parse({ ...f.input, images: [{ ...image(), dataUrl: 'https://example.invalid/screen.png' }] }));
  assert.throws(() => chatInputSchema.parse({ ...f.input, images: Array.from({ length: 4 }, image) }));
});

test('pending replies remain discoverable and recoverable after switching papers; discard preserves saved history', async () => {
  let fail = true;
  const f = await fixture(async (file, value, limit) => { if (fail && (value as any).turns.at(-1).status === 'complete') throw new Error('Synthetic disk failure'); await writeJSON(file, value, limit); });
  try {
    const reply = await ask(f), stored = await fs.readFile(f.stored, 'utf8');
    const otherFile = path.join(f.root, 'other.tex'); await fs.writeFile(otherFile, source);
    const other = await f.projects.open(otherFile);
    assert(!(await f.service.state({ projectId: other.id })).needsSave);
    const pending = f.service.pending(); assert.equal(pending.length, 1); assert.match(pending[0].label, /main.tex/);
    assert.equal(f.service.pendingReply(pending[0].id).turns.at(-1)?.reply, reply.reply);
    await assert.rejects(f.service.settle(), /main.tex.*Review unsaved replies/);
    await f.service.recover(pending[0].id, 'discard');
    assert.equal(await fs.readFile(f.stored, 'utf8'), stored); assert.equal(f.service.pending().length, 0); await f.service.settle();
    const second = await ask(f, { ...f.input, projectId: other.id });
    const id = f.service.pending()[0].id; fail = false;
    await f.service.recover(id, 'retry'); await f.service.settle();
    assert.equal((await f.service.state({ projectId: other.id })).turns.at(-1)?.reply, second.reply);
    assert.equal(await fs.readFile(f.file, 'utf8'), source);
  } finally { await fs.rm(f.root, { recursive: true, force: true }); }
});


test('a reply keeps multiple independent comments, question-only items and unmatched quotations across reopen', async () => {
  const f = await fixture();
  f.client.run = async () => ({ reply: 'Three comments for inspection.', suggestions: [
    answer().suggestion,
    { ...answer().suggestion, title: 'Explain compactness', explanation: 'State the needed condition.', original: 'The feasible set is compact.', replacement: null },
    { ...answer().suggestion, title: 'Check quotation', original: 'This quotation does not occur.' }
  ] });
  const result = await ask(f), comments = chatComments(result);
  assert.equal(comments.length, 3); assert.equal(new Set(comments.map(c => c.id)).size, 3);
  assert.equal(comments[0].validity, 'current'); assert.equal(comments[1].validity, 'current');
  assert.equal(comments[1].replacement, null); assert.equal(comments[2].validity, 'missing');
  assert.match(result.error!, /1 proposed quotation/);
  assert.equal(await fs.readFile(f.file, 'utf8'), source);
  const reopened = new HelpChat(f.projects, f.client, f.directory, help);
  assert.deepEqual(chatComments((await reopened.state({ projectId: f.paper.id })).turns[0]), comments);
  const history = chatHistory([result]); assert.equal(history.exchanges[0].comments[1].number, 2);
  assert.equal(history.exchanges[0].comments[1].explanation, 'State the needed condition.');
  const stale = comments.map(c => chatCommentForDraft(c, false));
  assert(stale.every(c => c.validity === 'unconfirmed'));
});

test('individual then batch chat import skips existing and rejected comments; the batch has one Undo and leaves source intact', async () => {
  const f = await fixture(); f.client.run = async () => ({ reply: 'Two proposals.', suggestions: [
    answer().suggestion, { ...answer().suggestion, original: 'The feasible set is compact.', replacement: 'The feasible set is closed and bounded.' }
  ] });
  const result = await ask(f), comments = chatComments(result);
  const rejected = { ...comments[0], decision: 'dismissed' as const };
  let state = initialState(source, [rejected]);
  assert.equal(newChatComments(result, state.field(commentsField), rejected.id).length, 0);
  const remaining = newChatComments(result, state.field(commentsField));
  assert.deepEqual(remaining.map(c => c.id), [comments[1].id]);
  state = state.update({ effects: alterComments.of({ add: remaining, remove: [] }) }).state;
  assert.equal(state.doc.toString(), source); assert.equal(newChatComments(result, state.field(commentsField)).length, 0);
  assert(undo({ state, dispatch: tr => { state = tr.state; } }));
  assert.deepEqual(state.field(commentsField), [rejected]);
  state = initialState(source, []);
  state = state.update({ effects: alterComments.of({ add: comments, remove: [] }) }).state;
  assert(undo({ state, dispatch: tr => { state = tr.state; } }));
  assert.equal(state.field(commentsField).length, 0); assert.equal(state.doc.toString(), source);
});

test('Side Chat supports more than thirty short comments and keeps output/storage limits explicit', async () => {
  const f = await fixture(), passages = Array.from({ length: 40 }, (_, i) => `Sentence ${i + 1} are short.`);
  f.client.run = async () => ({ reply: 'Forty local edits.', suggestions: passages.map(original => ({ ...answer().suggestion, original, replacement: original.replace(' are ', ' is ') })) });
  const result = await ask(f, { ...f.input, source: passages.join('\n') });
  assert.equal(chatComments(result).length, 40); assert(chatComments(result).every(c => c.validity === 'current'));
  assert.throws(() => chatAnswerSchema.parse({ reply: 'Too many', suggestions: Array(101).fill(answer().suggestion) }));
  assert.throws(() => chatAnswerSchema.parse({ reply: 'Too large', suggestions: Array(3).fill({ ...answer().suggestion, replacement: 'x'.repeat(90000) }) }), /smaller batch/);
  assert.equal(chatComments(chatTurnSchema.parse({ ...result, comments: undefined, comment: chatComments(result)[0] })).length, 1);
});


test('Side Chat model, effort and speed travel with its frozen request without changing paper preferences', async () => {
  const f = await fixture(), paper = f.projects.get(f.paper.id);
  const before = { effort: paper.effort, fastMode: paper.fastMode };
  f.client.setModel = () => { throw new Error('Chat must not change the shared client model'); };
  let calls = 0;
  f.client.run = async (prompt, schema, progress, effort, fast, reader, options) => {
    assert.equal(options?.model, 'test-chat-model'); assert.equal(effort, 'low'); assert.equal(fast, true);
    assert.deepEqual(JSON.parse(prompt).requestSettings, { model: 'test-chat-model', effort: 'low', speed: 'Fast' });
    calls++; return answer();
  };
  await ask(f, { ...f.input, model: 'test-chat-model', effort: 'low', fastMode: true });
  assert.equal(calls, 1); assert.deepEqual({ effort: paper.effort, fastMode: paper.fastMode }, before);
  assert.equal(chatInputSchema.parse({ ...f.input, model: undefined }).model, null);
});

test('large batches retain the latest reply, numbered index and explicitly chosen exact wording', () => {
  const comments = Array.from({ length: 20 }, (_, i) => commentSchema.parse({ id: 'item-' + i, title: 'Suggestion ' + (i + 1), explanation: 'Reason.', original: 'a'.repeat(1300), replacement: 'b'.repeat(1300) }));
  const turn = chatTurnSchema.parse({ id: randomUUID(), createdAt: new Date().toISOString(), message: 'Review this passage.', context: '{}', labels: [], images: [], status: 'complete', reply: 'Twenty suggestions.', comments });
  const history = chatHistory([turn]);
  assert.equal(history.exchanges.length, 1); assert.equal(history.exchanges[0].answer, turn.reply);
  assert.equal(history.exchanges[0].comments.length, 20); assert(history.exchanges[0].wordingOmitted);
  const chosen = chatHistory([turn], { turnId: turn.id, commentId: comments[6].id });
  assert.equal(chosen.selectedSuggestion?.number, 7); assert.equal(chosen.selectedSuggestion?.original, comments[6].original);
  assert.equal(chosen.selectedSuggestion?.replacement, comments[6].replacement); assert(JSON.stringify(chosen).length <= CHAT_LIMITS.historyChars);
  assert.throws(() => chatHistory([turn], { turnId: randomUUID(), commentId: comments[6].id }), /no longer/);
});

test('chat history stays bounded with escaped text, long replies and a selected older proposal', () => {
  const comments = Array.from({ length: 100 }, (_, i) => commentSchema.parse({ id: 'item-' + i, title: '\u0001'.repeat(300), explanation: 'Reason.', original: 'a'.repeat(1300), replacement: 'b'.repeat(1300) }));
  const make = () => chatTurnSchema.parse({ id: randomUUID(), createdAt: new Date().toISOString(), message: 'q'.repeat(10000), context: '{}', labels: [], images: [], status: 'complete', reply: 'r'.repeat(20000), comments });
  const old = make(), latest = make(), history = chatHistory([old, latest], { turnId: old.id, commentId: 'item-6' });
  assert.equal(history.exchanges.at(-1)?.turnId, latest.id); assert.equal(history.selectedSuggestion?.turnId, old.id);
  assert.equal(history.exchanges.at(-1)?.comments.length, 100); assert(JSON.stringify(history).length <= CHAT_LIMITS.historyChars);
  assert.throws(() => chatHistory([{ ...old, comments: [{ ...comments[0], original: 'a'.repeat(40000) }] }], { turnId: old.id, commentId: comments[0].id }), /too large/);
});
