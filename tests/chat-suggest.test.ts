import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { HelpChat } from '../src/main/help-chat.ts';
import { ProjectService } from '../src/main/project-service.ts';
import { CodexClient } from '../src/main/codex-client.ts';
import { ReviewResults } from '../src/main/review-results.ts';
import { writeJSON } from '../src/main/files.ts';
import { chatInputSchema, chatComments, suggestEditsSettings } from '../src/shared/help-chat.ts';
import type { CodexReader } from '../src/main/reference-service.ts';

const source = 'The proof are short. The result are useful.';
const suggestion = (original = 'proof are', replacement = 'proof is') => ({ title: original, explanation: 'Use singular agreement.', original, replacement, before: '', after: '', packages: [] });
const deferred = <T = void>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
async function fixture(t: TestContext, write = writeJSON) {
  const root = path.resolve('.test-runs', 'chat-suggest-' + randomUUID());
  await fs.mkdir(root, { recursive: true });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'paper.txt'); await fs.writeFile(file, source);
  const projects = new ProjectService(path.join(root, 'runtime')), paper = await projects.open(file);
  const client = new CodexClient(path.join(root, 'codex'));
  const directory = path.join(root, 'chats');
  const service = new HelpChat(projects, client, directory, async () => ({ version: '1.7.0', platform: 'darwin', osVersion: 'test', documentation: 'Extensive app help excluded from quick edits.' }), undefined, write);
  const input = chatInputSchema.parse({ action: 'suggest', projectId: paper.id, message: 'Correct the verbs.', source, paper: 'draft', model: 'gpt-6-astra', effort: 'high', fastMode: false, includeDiagnostics: true, editorState: { pdf: 'none', unsaved: false, error: 'Do not send this build error.', compilation: '' } });
  const scope = { projectId: paper.id };
  return { root, file, projects, client, directory, service, input, scope };
}

test('Suggest edits uses the quick profile, delivers durable batches before completion, and deduplicates the final answer', async t => {
  const f = await fixture(t), started = deferred(), finish = deferred<unknown>();
  let reader!: CodexReader, notifications = 0;
  f.client.run = async (prompt, _schema, _progress, effort, fast, tools, options) => {
    const context = JSON.parse(prompt);
    assert.equal(options?.model, suggestEditsSettings.model); assert.equal(effort, 'low'); assert.equal(fast, true);
    assert.equal(context.source.text, undefined); assert.equal(context.source.fileId, 'current-draft');
    assert.equal((await tools!.call('references_read', { fileId: 'current-draft' }) as any).excerpts[0].text, source); assert.equal(context.application.documentation, undefined); assert.equal(context.diagnostics, undefined);
    assert.match(context.task, /first useful edit/);
    reader = tools!; started.resolve();
    try { return await finish.promise; } finally { await reader.cancel(); }
  };
  const preview = await f.service.preview(f.input);
  assert.deepEqual(JSON.parse(preview.context).requestSettings, { model: suggestEditsSettings.model, effort: 'low', speed: 'Fast' });
  const send = f.service.send(f.scope, preview.id, () => {}, id => { assert.equal(id, f.scope.projectId); notifications++; });
  await started.promise;
  await reader.call('publish_comments', { comments: [suggestion()] });
  assert.equal(notifications, 1);
  const pending = await f.service.state(f.scope), stored = await f.service.results.list(f.scope.projectId);
  assert.equal(pending.turns[0].status, 'pending');
  assert.equal(stored.items.length, 1);
  assert.equal(stored.items[0].kind === 'review' && stored.items[0].delivery, 'side-chat-suggest');
  const first = chatComments(pending.turns[0])[0];
  assert.equal(first.category, 'Chat'); assert.equal(first.validity, 'current');
  assert.equal(stored.items[0].kind === 'review' && stored.items[0].comments[0].id, first.id);
  assert.equal(await fs.readFile(f.file, 'utf8'), source);
  finish.resolve({ reply: 'Two small edits.', suggestions: [suggestion(), suggestion('result are', 'result is')] });
  const completed = await send;
  assert.equal(chatComments(completed).length, 2); assert.equal(chatComments(completed)[0].id, first.id); assert.equal(notifications, 2);
  assert.equal((await f.service.results.list(f.scope.projectId)).items.length, 2);
  assert.equal(f.input.model, 'gpt-6-astra'); assert.equal(f.input.effort, 'high'); assert.equal(f.input.fastMode, false);
});

test('Stop retains delivered comments in chat and the paper inbox and refuses late batches', async t => {
  const f = await fixture(t), started = deferred(), finish = deferred<unknown>(); let reader!: CodexReader;
  f.client.run = async (_p, _s, _progress, _effort, _fast, tools) => { reader = tools!; started.resolve(); return finish.promise; };
  const preview = await f.service.preview(f.input), send = f.service.send(f.scope, preview.id, () => {});
  const failed = assert.rejects(send, /cancelled/);
  await started.promise; await reader.call('publish_comments', { comments: [suggestion()] });
  await f.service.cancel();
  await assert.rejects(reader.call('publish_comments', { comments: [suggestion('result are', 'result is')] }), /cancelled/);
  finish.resolve({ reply: 'Late response', suggestions: [] }); await failed;
  const saved = (await f.service.state(f.scope)).turns[0];
  assert.equal(saved.status, 'failed'); assert.equal(chatComments(saved).length, 1);
  const reopened = new ReviewResults(f.projects); assert.equal((await reopened.list(f.scope.projectId)).items.length, 1);
  assert.equal(await fs.readFile(f.file, 'utf8'), source);
});

test('failed batch storage publishes nothing; retry and chat-save failure preserve one durable set', async t => {
  let failChat = true;
  const f = await fixture(t, async (file, value, limit) => {
    if (failChat && (value as any).turns?.at(-1)?.comments?.length) throw new Error('Synthetic chat write failure');
    await writeJSON(file, value, limit);
  });
  const retain = f.service.results.retain.bind(f.service.results);
  let failResult = true, notices = 0;
  f.service.results.retain = async (...args) => { if (failResult) throw new Error('Synthetic result write failure'); await retain(...args); };
  f.client.run = async (_p, _s, _progress, _effort, _fast, reader) => {
    await assert.rejects(reader!.call('publish_comments', { comments: [suggestion()] }), /result write failure/);
    assert.equal(chatComments((await f.service.state(f.scope)).turns[0]).length, 0); assert.equal(notices, 0);
    failResult = false; await reader!.call('publish_comments', { comments: [suggestion()] });
    assert((await f.service.state(f.scope)).needsSave);
    await reader!.call('publish_comments', { comments: [suggestion()] }); assert.equal(notices, 1);
    return { reply: 'Ready.', suggestions: [] };
  };
  const preview = await f.service.preview(f.input);
  const result = await f.service.send(f.scope, preview.id, () => {}, () => { notices++; });
  assert.equal(chatComments(result).length, 1); assert.equal((await f.service.results.list(f.scope.projectId)).items.length, 1);
  await assert.rejects(f.service.settle(), /not been saved/);
  failChat = false; await f.service.retry(f.scope); await f.service.settle();
  assert.equal((await f.service.state(f.scope)).needsSave, false);
});

test('streaming obeys the selected passage, validates entire batches, and enforces a cumulative limit', async t => {
  const f = await fixture(t);
  f.client.run = async (_p, _s, _progress, _effort, _fast, reader) => {
    await assert.rejects(reader!.call('publish_comments', { comments: [suggestion(), { title: 'Incomplete' }] }));
    assert.equal((await f.service.results.list(f.scope.projectId)).items.length, 0);
    await reader!.call('publish_comments', { comments: [suggestion(), suggestion('result are', 'result is')] });
    const comments = chatComments((await f.service.state(f.scope)).turns[0]);
    assert.equal(comments[0].validity, 'current'); assert.equal(comments[0].from, source.indexOf('proof are'));
    assert.equal(comments[1].validity, 'missing');
    await assert.rejects(reader!.call('publish_comments', { comments: Array.from({ length: 99 }, (_, i) => suggestion('proof are', `proof is ${i}`)) }), /reply limit/);
    return { reply: 'Check the unmatched quotation.', suggestions: [] };
  };
  const input = { ...f.input, paper: 'passage' as const, from: source.indexOf('proof are'), to: source.indexOf('proof are') + 'proof are'.length };
  const preview = await f.service.preview(input), result = await f.service.send(f.scope, preview.id, () => {});
  assert.equal(chatComments(result).length, 2); assert.match(result.error!, /could not be verified/);
});

test('final-only quick replies deliver once; ordinary Ask keeps manual addition and its own settings', async t => {
  const f = await fixture(t); let calls = 0;
  f.client.run = async (_p, _s, _progress, effort, fast, reader, options) => {
    if (calls++) { assert(reader); assert(!reader.tools.some(t => t.name === 'publish_comments')); assert.equal(options?.model, 'gpt-6-astra'); assert.equal(effort, 'high'); assert.equal(fast, false); }
    return { reply: 'A small edit.', suggestions: [suggestion()] };
  };
  const preview = await f.service.preview(f.input); await f.service.send(f.scope, preview.id, () => {});
  assert.equal((await f.service.results.list(f.scope.projectId)).items.length, 1);
  const ordinary = await f.service.preview({ ...f.input, action: undefined });
  await f.service.send(f.scope, ordinary.id, () => {});
  assert.equal((await f.service.results.list(f.scope.projectId)).items.length, 1);
  assert.throws(() => chatInputSchema.parse({ ...f.input, paper: 'none' }), /current draft/);
});
