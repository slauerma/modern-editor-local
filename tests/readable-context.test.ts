import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { draftOnlySession, ReferenceService, type CodexReader } from '../src/main/reference-service.ts';
import { AttachmentService } from '../src/main/attachment-service.ts';
import { ProjectService } from '../src/main/project-service.ts';
import { CodexService } from '../src/main/codex-service.ts';
import { HelpChat } from '../src/main/help-chat.ts';
import { CodexClient } from '../src/main/codex-client.ts';
import { ReviewConversations } from '../src/main/review-conversations.ts';
import { proposalChanges } from '../src/shared/review.ts';
import { digest } from '../src/main/files.ts';
import { commentSchema } from '../src/shared/contracts.ts';
import { chatInputSchema } from '../src/shared/help-chat.ts';
import { paperContextDocuments } from '../src/shared/context-documents.ts';

async function readAll(reader: CodexReader, fileId: string) {
  let text = '', offset = 0;
  for (;;) {
    const page = await reader.call('references_read', { fileId, offset }) as any;
    text += page.excerpts.map((e: any) => e.text).join('');
    if (page.nextOffset === null) return text;
    assert(page.nextOffset > offset); offset = page.nextOffset;
  }
}

test('the maximum review snapshot and guidance can be paged completely, including Unicode and long lines', async () => {
  const source = 'θ界'.repeat(60000), reader = draftOnlySession('paper.tex', source, 'review', () => {});
  reader.addDocuments(paperContextDocuments('Preserve the exact symbols.'));
  assert.match(await readAll(reader, 'paper-instructions'), /Preserve the exact symbols/);
  assert.equal(await readAll(reader, 'current-draft'), source);
  await reader.cancel(); await assert.rejects(reader.call('references_read', { fileId: 'current-draft' }), /cancelled/);
});

test('readable decisions are frozen, searchable and distinguish rejection reasons from model explanations', async () => {
  const comments = [commentSchema.parse({ id: 'declined', title: 'Change terminology', explanation: 'MODEL_REASON', original: 'old word', replacement: 'new word', draft: 'edited option', decision: 'dismissed', rejectionReason: 'AUTHOR_REASON' })];
  const reader = draftOnlySession('paper.txt', 'Unsaved source.', 'review', () => {});
  reader.addDocuments(paperContextDocuments('AUTHOR_INSTRUCTION', undefined, comments));
  comments[0].rejectionReason = 'Changed later.';
  const listing = await reader.call('references_list', {}) as any;
  assert.deepEqual(listing.files.map((f: any) => f.id), ['current-draft', 'paper-instructions', 'review-decisions']);
  const found = await reader.call('references_search', { fileId: 'review-decisions', query: 'AUTHOR_REASON' });
  assert.match(JSON.stringify(found), /AUTHOR_REASON/);
  const decisions = await readAll(reader, 'review-decisions');
  assert.match(decisions, /Author’s rejection reason\n\nAUTHOR_REASON/); assert.match(decisions, /Explanation from the suggestion\n\nMODEL_REASON/);
  assert(decisions.includes('new word') && decisions.includes('edited option')); assert(!decisions.includes('Changed later.'));
  assert.throws(() => reader.addDocuments([]), /fixed before/);
  await reader.cancel();
});

test('reviews read unsaved text and per-request instructions, publish within scope, and never embed the paper or saved context', async t => {
  const root = path.resolve('.test-runs', 'readable-review-' + randomUUID()); await fs.mkdir(root, { recursive: true });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'paper.txt'); await fs.writeFile(file, 'DISK_ONLY');
  const projects = new ProjectService(path.join(root, 'runtime')), paper = await projects.open(file);
  await projects.setPaperInstructions(paper.id, 'AUTHOR_PRIVATE_GUIDANCE');
  paper.review.comments = [commentSchema.parse({ id: 'r', title: 'Earlier change', original: 'EARLIER_QUOTE', replacement: 'EARLIER_PROPOSAL', explanation: 'A reason.', decision: 'dismissed', rejectionReason: 'REJECTION_REASON' })];
  const service = new CodexService(projects, path.join(root, 'codex'));
  const source = 'UNSAVED_PREFIX\nThe result are clear.\nUNSAVED_SUFFIX', from = source.indexOf('The'), to = source.indexOf('\nUNSAVED_SUFFIX');
  service.client.run = async (prompt, _schema, _progress, _effort, _fast, reader) => {
    for (const secret of ['DISK_ONLY', 'UNSAVED_PREFIX', 'The result are clear.', 'AUTHOR_PRIVATE_GUIDANCE', 'EARLIER_QUOTE', 'REJECTION_REASON']) assert(!prompt.includes(secret));
    const context = JSON.parse(prompt); assert.deepEqual([context.scope.from, context.scope.to], [from, to]); assert(prompt.length < 4000); assert(reader);
    assert.equal(await readAll(reader, 'current-draft'), source);
    const guidance = await readAll(reader, 'paper-instructions');
    assert(guidance.includes('AUTHOR_PRIVATE_GUIDANCE')); assert.match(guidance, /Smallest-local-edits preference is off/);
    const suggestion = { category: 'Language', title: 'Verb', explanation: 'Singular subject.', original: 'result are', before: '', after: '', replacement: 'result is', packages: [] };
    await reader.call('publish_comments', { comments: [suggestion] });
    await reader.call('publish_comments', { comments: [{ ...suggestion, original: 'UNSAVED_SUFFIX', replacement: 'Outside scope.' }] });
    return { comments: [] };
  };
  const comments = await service.review({ projectId: paper.id, text: source, from, to, instructions: 'Improve language.', localEditsOnly: false }, () => {});
  assert.equal(comments.length, 2); assert.equal(comments[0].validity, 'current');
  assert.equal(comments[1].validity, 'missing'); assert.throws(() => proposalChanges(source, comments[1]), /passage/);
  assert.equal(await fs.readFile(file, 'utf8'), 'DISK_ONLY');
});

test('history opens at the exchange rather than the old prompt; search, alternatives and continuation remain available', async t => {
  const root = path.resolve('.test-runs', 'readable-history-' + randomUUID()); await fs.mkdir(root, { recursive: true });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'paper.txt'); await fs.writeFile(file, 'Paper.');
  const projects = new ProjectService(path.join(root, 'runtime')), paper = await projects.open(file);
  const history = new ReviewConversations(projects, path.join(root, 'history'));
  const request = { kind: 'discussion' as const, instruction: 'Why keep this terminology?', sourceHash: digest('Earlier paper.') };
  await history.run(paper.id, 'continue', request, async s => {
    await s.prompt('OLD_EMBEDDED_DRAFT'.repeat(10000));
    return { reply: 'SAVED_ANSWER', replacement: null, alternatives: [{ label: 'Concise', reason: 'SAVED_TRADEOFF', replacement: 'Long proposal ' + 'x'.repeat(15000), packages: [] }] };
  });
  await history.run(paper.id, 'continue', { ...request, instruction: 'More comments.' }, async s => {
    const reader = s.reader(), index = await reader.call('review_history', { query: 'SAVED_ANSWER' }) as any;
    assert.equal(index.name, 'review-history.md'); assert.equal(index.items.length, 1);
    const first = await reader.call('review_history', { requestId: index.items[0].id }) as any;
    assert.match(first.name, /^review-.*\.md$/); assert(first.text.includes('SAVED_ANSWER')); assert(first.text.includes('SAVED_TRADEOFF'));
    assert(!first.text.includes('OLD_EMBEDDED_DRAFT')); assert(first.historical); assert(first.nextOffset > 0);
    const last = await reader.call('review_history', { requestId: index.items[0].id, offset: first.nextOffset }) as any;
    assert.equal(last.nextOffset, null); assert((first.text + last.text).includes('x'.repeat(15000)));
    return { comments: [] };
  });
});

test('Side Chat reads draft and saved context with additional references off, without exposing the project folder', async t => {
  const root = path.resolve('.test-runs', 'readable-chat-' + randomUUID()); await fs.mkdir(root, { recursive: true });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'paper.txt'); await fs.writeFile(file, 'DISK_SOURCE'); await fs.writeFile(path.join(root, 'private.md'), 'OTHER_FILE');
  const projects = new ProjectService(path.join(root, 'runtime')), paper = await projects.open(file);
  const refs = new ReferenceService(projects, path.join(root, 'references'), new AttachmentService({ pdfModulePath: path.resolve('node_modules/pdfjs-dist/legacy/build/pdf.mjs') }));
  const client = new CodexClient(path.join(root, 'codex'));
  const chat = new HelpChat(projects, client, path.join(root, 'chats'), async () => ({ version: 'test', platform: 'test', osVersion: '', documentation: 'BUNDLED_HELP' }), refs);
  client.run = async (prompt, _schema, _progress, _effort, _fast, reader) => {
    assert(!prompt.includes('UNSAVED_DRAFT') && !prompt.includes('BUNDLED_HELP')); assert(reader);
    const listed = await reader.call('references_list', {}) as any;
    assert(!listed.files.some((f: any) => f.name === 'private.md')); assert(!JSON.parse(prompt).availableReferences.projectFolderEnabled);
    assert.equal(await readAll(reader, 'current-draft'), 'UNSAVED_DRAFT'); assert.match(await readAll(reader, 'editor-help'), /BUNDLED_HELP/);
    return { reply: 'Read the requested context.', suggestions: [] };
  };
  const input = chatInputSchema.parse({ projectId: paper.id, source: 'UNSAVED_DRAFT', paper: 'draft', includeReferences: false, message: 'Explain.', editorState: { pdf: 'none', unsaved: true, error: '', compilation: '' } });
  const preview = await chat.preview(input); await chat.send({ projectId: paper.id }, preview.id, () => {});
  client.run = async (prompt, _schema, _progress, _effort, _fast, reader) => {
    assert(reader); const scope = JSON.parse(prompt).source; assert.equal(scope.from, 0); assert.equal(scope.to, 8);
    assert.equal(await readAll(reader, 'current-draft'), 'SELECTED');
    assert(!JSON.stringify(await reader.call('references_search', { fileId: 'current-draft', query: 'PRIVATE' })).includes('PRIVATE_PREFIX'));
    return { reply: 'Only the selected passage was readable.', suggestions: [] };
  };
  const selection = await chat.preview({ ...input, source: 'PRIVATE_PREFIX SELECTED PRIVATE_SUFFIX', paper: 'passage', from: 15, to: 23 });
  await chat.send({ projectId: paper.id }, selection.id, () => {});
  assert.equal(await fs.readFile(file, 'utf8'), 'DISK_SOURCE');
});
