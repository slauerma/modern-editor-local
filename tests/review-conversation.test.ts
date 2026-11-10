import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { undo, redo } from '@codemirror/commands';
import { isolateHistory } from '@codemirror/commands';
import { ProjectService } from '../src/main/project-service.ts';
import { ReviewConversations } from '../src/main/review-conversations.ts';
import { CodexClient } from '../src/main/codex-client.ts';
import { CodexService, replyOutputSchema } from '../src/main/codex-service.ts';
import { digest } from '../src/main/files.ts';
import { commentSchema } from '../src/shared/contracts.ts';
import { reviewDecisions } from '../src/shared/review-conversation.ts';
import { rejectionContext } from '../src/shared/rejected-suggestions.ts';
import { usageSince, type UsageRecord } from '../src/shared/usage.ts';
import { initialState, commentsField, patchComments } from '../src/renderer/editor-state.ts';
import { SectionReview } from '../src/shared/section-review.ts';
import { HelpChat } from '../src/main/help-chat.ts';
import { chatInputSchema } from '../src/shared/help-chat.ts';

async function fixture(t: any) {
  const root = path.resolve('.test-runs', 'continuity-' + randomUUID()), file = path.join(root, 'paper.tex');
  await fs.mkdir(root, { recursive: true }); await fs.writeFile(file, 'Disk draft.');
  const projects = new ProjectService(path.join(root, 'runtime')), paper = await projects.open(file);
  const directory = path.join(root, 'runtime/review-conversations'), store = new ReviewConversations(projects, directory);
  const cli = path.join(root, 'runtime/codex'); await fs.mkdir(cli, { recursive: true });
  await fs.writeFile(path.join(cli, 'new-version'), '');
  const client = new CodexClient(cli, path.resolve('tests/fixtures/fake-codex.mjs'));
  t.after(async () => { await client.cancel(); await fs.rm(root, { recursive: true, force: true }); });
  const request = { kind: 'review' as const, instruction: 'Review the argument.', sourceHash: digest('Current unsaved draft.') };
  const requests = async () => JSON.parse(await fs.readFile(path.join(cli, 'requests.json'), 'utf8'));
  const run = (mode: 'continue' | 'fresh' = 'continue', prompt = 'normal', currentStore = store) => currentStore.run(paper.id, mode, request, async session => {
    await session.prompt(prompt);
    return client.run(prompt, replyOutputSchema, () => {}, 'medium', false, session.reader(), { conversation: session.options });
  });
  return { root, file, projects, paper, directory, store, cli, client, request, requests, run };
}

test('persistent review resumes across app-server and store restarts; Fresh preserves inspectable earlier history', async t => {
  const f = await fixture(t), usage: UsageRecord[] = []; f.client.usageRecord = r => usage.push(r);
  for (const flag of ['usage-events', 'cumulative-usage']) await fs.writeFile(path.join(f.cli, flag), '');
  await f.run();
  const first = (await f.store.state(f.paper.id)).active!, calls = await f.requests();
  assert.equal(calls.find((r: any) => r.method === 'thread/start').params.ephemeral, false);
  const restored = new ReviewConversations(f.projects, f.directory);
  await f.run('continue', 'normal', restored);
  const resumed = await f.requests(), resume = resumed.find((r: any) => r.method === 'thread/resume');
  assert(resume); assert.equal(resume.params.threadId, '00000000-0000-4000-8000-000000000001');
  assert(!resumed.some((r: any) => r.method === 'thread/start'));
  for (const key of ['ephemeral', 'dynamicTools', 'environments', 'selectedCapabilityRoots']) assert.equal(resume.params[key], undefined);
  assert.equal(resume.params.approvalPolicy, 'never'); assert.equal(resume.params.sandbox, 'read-only');
  assert.equal(resume.params.config.web_search, 'disabled');
  assert.deepEqual(usage.map(r => [r.reviewMode, r.tokens?.totalTokens]), [['fresh', 120], ['continue', 120]]);
  assert.equal((await restored.current(f.paper.id))?.id, first.id);
  assert.equal((await restored.history(f.paper.id, first.id)).items.length, 2);
  await f.run('fresh');
  const state = await restored.state(f.paper.id);
  assert.equal(state.conversations.length, 2); assert.notEqual(state.active!.id, first.id);
  const old = await restored.history(f.paper.id, first.id);
  assert.match(await restored.inspect(f.paper.id, first.id, old.items[0].id), /Precise.*advice/);
  assert.equal(await fs.readFile(f.file, 'utf8'), 'Disk draft.');
});

test('Side Chat notes commit during a review and survive concurrent thread and final metadata writes', async t => {
  const f = await fixture(t);
  let started!: (session: any) => void, finish!: () => void;
  const ready = new Promise<any>(resolve => { started = resolve; });
  const held = new Promise<void>(resolve => { finish = resolve; });
  const review = f.store.run(f.paper.id, 'continue', f.request, async session => {
    started(session); await held; return { comments: [] };
  });
  const session = await ready, active = (await f.store.current(f.paper.id))!;
  const note = { ...f.request, kind: 'paper-chat' as const, instruction: 'Keep the notation.' };
  await Promise.all([
    f.store.addPaperChat(f.paper.id, note, { reply: 'Understood.' }),
    session.options.onThread('parallel-review')
  ]);
  assert.deepEqual((await f.store.history(f.paper.id, active.id)).items.map(e => e.status), ['complete', 'pending']);
  finish();
  await Promise.all([review, f.store.addPaperChat(f.paper.id, { ...note, instruction: 'Keep the title.' }, { reply: 'Yes.' })]);
  const restored = new ReviewConversations(f.projects, f.directory);
  const history = await restored.history(f.paper.id, active.id);
  assert.equal(history.items.length, 3); assert(history.items.every(e => e.status === 'complete'));
  assert.equal((await restored.current(f.paper.id))!.requests, 1);
  assert.equal((await restored.paperChatNotes(f.paper.id, active.id)).total, 2);
  const turns = await Promise.all(history.items.map(e => restored.inspect(f.paper.id, active.id, e.id).then(JSON.parse)));
  assert.equal(new Set(turns.map(t => t.sequence)).size, 3);
  await restored.run(f.paper.id, 'continue', f.request, async session => { assert.equal(session.options.threadId, 'parallel-review'); });
});

test('missing or wrong resumed thread fails before sending source, without silently starting fresh', async t => {
  const f = await fixture(t); await f.run(); const active = (await f.store.current(f.paper.id))!;
  for (const flag of ['missing-thread', 'wrong-resume']) {
    await fs.writeFile(path.join(f.cli, flag), '');
    await assert.rejects(f.run('continue', 'PRIVATE CURRENT SOURCE'), /unavailable|different review/);
    const calls = await f.requests();
    assert(!calls.some((r: any) => r.method === 'turn/start' || r.method === 'thread/start'));
    assert.equal((await f.store.current(f.paper.id))!.id, active.id);
    await fs.unlink(path.join(f.cli, flag));
  }
  assert.equal((await f.store.history(f.paper.id, active.id)).items[0].status, 'failed');
  await f.run('fresh'); assert.notEqual((await f.store.current(f.paper.id))!.id, active.id);
});

test('unknown usage after an interrupted report stays unknown rather than recounting a previous turn', async t => {
  const f = await fixture(t), usage: UsageRecord[] = []; f.client.usageRecord = r => usage.push(r);
  for (const flag of ['usage-events', 'cumulative-usage']) await fs.writeFile(path.join(f.cli, flag), '');
  await f.run(); await fs.unlink(path.join(f.cli, 'usage-events'));
  await f.run(); // A completed turn with no usage notification.
  await fs.writeFile(path.join(f.cli, 'usage-events'), '');
  await f.run(); await f.run();
  assert.deepEqual(usage.map(r => r.tokens?.totalTokens ?? null), [120, null, null, 120]);
  assert.equal(usageSince({ totalTokens: 1, inputTokens: 1, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 }, { totalTokens: 120, inputTokens: 100, cachedInputTokens: 30, outputTokens: 20, reasoningOutputTokens: 10 }), null);
});

test('continuation uses current model and effort choices, including returning to Codex default', async t => {
  const f = await fixture(t); await fs.writeFile(path.join(f.cli, 'gpt6-models'), '');
  f.client.setModel('gpt-6.1-sol'); await f.run();
  f.client.setModel('gpt-6-luna'); await f.run();
  assert.equal((await f.requests()).find((r: any) => r.method === 'thread/resume').params.model, 'gpt-6-luna');
  f.client.setModel(null); await f.run();
  assert.equal((await f.requests()).find((r: any) => r.method === 'thread/resume').params.model, 'fixture-model');
  assert.equal((await f.store.state(f.paper.id)).conversations.length, 1);
});

test('cancellation keeps prior exchanges and the same resumable paper thread', async t => {
  const f = await fixture(t); await f.run(); const active = (await f.store.current(f.paper.id))!;
  let signal!: () => void; const started = new Promise<void>(r => { signal = r; });
  f.client.once('notification', () => {}); // Listener below watches the exact model turn.
  const listener = (event: any) => { if (event.method === 'turn/started') signal(); };
  f.client.on('notification', listener);
  const waiting = f.run('continue', 'wait'); const rejected = assert.rejects(waiting, /cancel/);
  await started; await f.client.cancel(); await rejected; f.client.removeListener('notification', listener);
  assert.equal((await f.store.current(f.paper.id))!.id, active.id);
  assert.deepEqual((await f.store.history(f.paper.id, active.id)).items.map(t => t.status), ['failed', 'complete']);
  await f.run(); assert.equal((await f.store.current(f.paper.id))!.requests, 3);
});

test('history tools stay within this paper and conversation and use the current reading grant', async t => {
  const f = await fixture(t); await f.run(); const first = (await f.store.current(f.paper.id))!;
  const oldId = (await f.store.history(f.paper.id, first.id)).items[0].id;
  const other = path.join(f.root, 'other.tex'); await fs.writeFile(other, 'Different.');
  const otherPaper = await f.projects.open(other);
  await assert.rejects(f.store.inspect(otherPaper.id, first.id, oldId));
  f.paper = await f.projects.open(f.file);
  await assert.rejects(f.store.inspect(f.paper.id, '../outside', oldId));
  await f.store.run(f.paper.id, 'fresh', f.request, async session => {
    const reader = session.reader({ tools: [], cancel: async () => {}, call: async () => { throw new Error('Folder access is disabled now.'); } });
    await assert.rejects(reader.call('review_history', { requestId: oldId }), /ENOENT/);
    await assert.rejects(reader.call('references_read', { fileId: 'old-file-id' }), /disabled now/);
    const current = await reader.call('review_history', {}) as any;
    assert.equal(current.items.length, 1);
    await assert.rejects(reader.call('review_history', { requestId: '../../secrets' }));
    await reader.cancel(); await assert.rejects(reader.call('review_history', {}), /cancelled/);
    return { comments: [] };
  });
  assert.equal((await f.store.history(f.paper.id, first.id)).items.length, 1);
});

test('an unreadable active pointer is preserved and Fresh is an explicit escape', async t => {
  const f = await fixture(t); await f.run(); const first = (await f.store.current(f.paper.id))!;
  const pointer = path.join(f.directory, digest(f.file), 'active.json'); await fs.writeFile(pointer, 'broken');
  await assert.rejects(f.store.run(f.paper.id, 'continue', f.request, async () => {}), /preserved.*Fresh/);
  assert.equal(await fs.readFile(pointer, 'utf8'), 'broken');
  await f.run('fresh');
  assert.equal((await f.store.history(f.paper.id, first.id)).items.length, 1);
});

test('review service refreshes current unsaved source, saved instructions, decisions and paper-chat notes on continuation', async t => {
  const f = await fixture(t), service = new CodexService(f.projects, path.join(f.root, 'runtime/codex'));
  const captured: any[] = [];
  service.client.run = async (prompt, _schema, _progress, _effort, _fast, reader, options) => {
    assert(reader?.tools.some(t => t.name === 'review_history'));
    const draft = await reader!.call('references_read', { fileId: 'current-draft' });
    const guidance = await reader!.call('references_read', { fileId: 'paper-instructions' });
    const decisions = await reader!.call('references_read', { fileId: 'review-decisions' });
    const history = await reader!.call('review_history', { query: 'Keep the teaching example' });
    captured.push({ prompt: JSON.parse(prompt), thread: options?.conversation?.threadId, draft, guidance, decisions, history });
    await options!.conversation!.onThread('persisted-native-id');
    return { comments: [] };
  };
  const request = { projectId: f.paper.id, text: 'Unsaved first version.', from: 0, to: 22, instructions: 'Check the argument.' };
  request.to = request.text.length;
  await service.review(request, () => {});
  const paper = f.projects.get(f.paper.id);
  paper.paperInstructions = 'Preserve my notation.';
  paper.review.comments = [commentSchema.parse({ id: 'rejected', title: 'Change terminology', explanation: 'The model prefers a new word.', original: 'first', replacement: 'initial', decision: 'dismissed', rejectionReason: 'This is a technical term.' })];
  await service.conversations.addPaperChat(f.paper.id, { kind: 'paper-chat', instruction: 'Keep the teaching example.', sourceHash: digest(request.text) }, { reply: 'Understood.' });
  await service.review({ ...request, text: 'Unsaved newer version.', instructions: 'More comments.' }, () => {});
  const next = captured[1];
  assert.equal(next.thread, 'persisted-native-id'); assert.equal(next.draft.excerpts[0].text, 'Unsaved newer version.');
  assert.doesNotMatch(JSON.stringify(next.prompt), /Unsaved newer version|Preserve my notation|technical term|teaching example/);
  assert.match(next.guidance.excerpts[0].text, /Preserve my notation/); assert.match(next.decisions.excerpts[0].text, /This is a technical term/);
  assert.equal(next.history.items[0].instruction, 'Keep the teaching example.');
  await service.review({ ...request, conversationMode: 'fresh' }, () => {});
  assert.equal(captured[2].thread, null); assert.equal(captured[2].history.items.length, 0);
  assert.match(captured[2].decisions.excerpts[0].text, /This is a technical term/);
  assert.equal(await fs.readFile(f.file, 'utf8'), 'Disk draft.');
});

test('author rejection reasons persist in comments and Undo; a model explanation never becomes the author reason', () => {
  const c = commentSchema.parse({ id: 'one', title: 'Typo', explanation: 'A grammar improvement.', original: 'are', replacement: 'is', from: 6, to: 9, validity: 'current' });
  let state = initialState('There are one.', [c]);
  state = state.update({ effects: patchComments.of([{ id: c.id, fields: { decision: 'dismissed', rejectionReason: 'Intentional quotation.' } }]), annotations: isolateHistory.of('full') }).state;
  const rejected = state.field(commentsField);
  assert.equal(commentSchema.parse(JSON.parse(JSON.stringify(rejected[0]))).rejectionReason, 'Intentional quotation.');
  assert.equal(rejectionContext(rejected).items[0].authorReason, 'Intentional quotation.');
  assert.equal(rejectionContext(rejected).items[0].suggestionExplanation, 'A grammar improvement.');
  assert(undo({ state, dispatch: tr => { state = tr.state; } })); assert.deepEqual(JSON.parse(JSON.stringify(state.field(commentsField))), [c]);
  assert(redo({ state, dispatch: tr => { state = tr.state; } })); assert.deepEqual(state.field(commentsField), rejected);
  assert.equal(state.doc.toString(), 'There are one.');
  assert.equal(reviewDecisions([{ ...rejected[0], decision: 'open' }]).items[0].authorReason, undefined);
  assert.equal(rejectionContext([{ ...c, decision: 'dismissed' }]).items[0].authorReason, undefined);
});

test('only paper Side Chat exchanges become active review notes; sharing failures preserve the answer', async t => {
  const f = await fixture(t); await f.run(); const id = (await f.store.current(f.paper.id))!.id;
  const client = new CodexClient(path.join(f.root, 'chat'));
  client.run = async () => ({ reply: 'Keep the example and its notation.', suggestions: [] });
  const chat = new HelpChat(f.projects, client, path.join(f.root, 'runtime/chat'), async () => ({ version: '1.7.0', platform: 'darwin', osVersion: '26', documentation: 'Editor help.' }));
  chat.reviewConversations = f.store;
  const input = chatInputSchema.parse({ projectId: f.paper.id, source: 'Current draft.', from: 0, to: 0, paper: 'draft', message: 'Keep the teaching example.', editorState: { pdf: 'none', unsaved: true, error: '', compilation: '' } });
  const ask = async (value = input) => { const p = await chat.preview(value); return chat.send({ projectId: value.projectId }, p.id, () => {}); };
  await ask(); assert.equal((await f.store.paperChatNotes(f.paper.id, id)).items[0].question, input.message);
  await ask(chatInputSchema.parse({ ...input, projectId: null, source: '', paper: 'none', message: 'How do I save?' }));
  await ask(chatInputSchema.parse({ ...input, paper: 'none', includeReferences: false, includeComment: false, message: 'No paper context.' }));
  assert.equal((await f.store.paperChatNotes(f.paper.id, id)).total, 1);
  f.store.addPaperChat = async () => { throw new Error('Synthetic history write failure.'); };
  const answer = await ask(); assert.equal(answer.status, 'complete'); assert.match(answer.error!, /could not be shared/);
  assert.equal((await chat.state({ projectId: f.paper.id })).turns.at(-1)!.reply, 'Keep the example and its notation.');
  assert.equal(await fs.readFile(f.file, 'utf8'), 'Disk draft.');
});

test('section review starts Fresh only once, then continues the same fixed snapshot', async () => {
  const requests: any[] = [], text = '\\section{A}\nFirst.\n\\section{B}\nSecond.';
  const runner = new SectionReview({ request: async r => { requests.push(r); }, delivered: async () => {}, cancel: async () => {}, changed: () => {} });
  await runner.run({ projectId: randomUUID(), text, instructions: 'Review.', conversationMode: 'fresh' });
  assert.deepEqual(requests.map(r => r.conversationMode), ['fresh', 'continue']);
  assert(requests.every(r => r.text === text)); assert.equal(requests[1].from, text.indexOf('\\section{B}'));
});
