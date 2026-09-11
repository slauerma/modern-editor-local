import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { HelpChat } from '../src/main/help-chat.ts';
import { CodexClient } from '../src/main/codex-client.ts';
import { ProjectService } from '../src/main/project-service.ts';
import { digest, writeJSON } from '../src/main/files.ts';
import { CHAT_LIMITS, chatInputSchema, chatContext, chatHistory, chatTurnSchema, chatCommentForDraft, type ChatInput } from '../src/shared/help-chat.ts';
import { proposalChanges } from '../src/shared/review.ts';
import { initialState, alterComments, commentsField } from '../src/renderer/editor-state.ts';
import { undo } from '@codemirror/commands';
import { chatImageDimensions } from '../src/shared/chat-images.ts';
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
  const invalid = await ask(f); assert(!invalid.comment); assert.match(invalid.error!, /could not be verified/);
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
