import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWrite, digest, readJSON, writeJSON } from '../src/main/files.ts';
import { JSON_FILE_LIMIT, serializeJSON } from '../src/shared/persistence.ts';
import { bufferSchema, commentSchema, commentsSchema, messageSchema, reviewSchema, type BufferInput, type Review, type WaitingResult } from '../src/shared/contracts.ts';
import { ProjectService } from '../src/main/project-service.ts';
import { documentStatePath } from '../src/main/document-state.ts';
import { inspectSourceRecovery } from '../src/main/source-export.ts';
import { ReviewResults } from '../src/main/review-results.ts';
import { rememberPdf, restorePdf } from '../src/main/pdf-workspace-cache.ts';
import { ResultInbox } from '../src/renderer/result-inbox.ts';
import { commentsField, initialState, patchComments, validateReviewTransaction } from '../src/renderer/editor-state.ts';
import { anchorReview } from '../src/shared/review.ts';

const date = '2026-01-01T00:00:00.000Z', hash = '0'.repeat(64);
const jsonBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value, null, 2));
async function directory(t: TestContext) {
  const root = path.resolve('.test-runs', 'persistence-' + randomUUID());
  await fs.mkdir(root, { recursive: true });
  t.after(async () => { t.mock.restoreAll(); await fs.rm(root, { recursive: true, force: true }); });
  return root;
}
async function fixture(t: TestContext) {
  const root = await directory(t), file = path.join(root, 'paper.tex'), cache = path.join(root, 'runtime');
  await fs.writeFile(file, 'Original source\n');
  const service = new ProjectService(cache), project = await service.open(file);
  return { root, file, cache, service, project, home: documentStatePath(file) };
}
async function inventory(root: string): Promise<Record<string, string>> {
  const records: Record<string, string> = {};
  for (const name of await fs.readdir(root, { recursive: true })) {
    const file = path.join(root, name);
    if ((await fs.lstat(file)).isFile()) records[name] = digest(await fs.readFile(file));
  }
  return records;
}
function emptyLargeReview(): Review {
  return { schemaVersion: 1, rootFile: 'paper.tex', sourceHash: hash, activeId: null, updatedAt: date, comments: [commentSchema.parse({
    id: 'discussion', title: 'Synthetic discussion', explanation: '', original: 'Claim', replacement: null,
    messages: Array.from({ length: 107 }, () => ({ role: 'assistant', text: '', createdAt: date }))
  })] };
}
// Fill legal, bounded messages with deterministic Unicode, without checked-in
// large fixtures. Each message stays at or below 100,000 UTF-16 code units.
function reviewWithBytes(bytes: number): Review {
  const review = emptyLargeReview(); let remaining = bytes - jsonBytes(review);
  assert(remaining >= 0 && remaining <= 107 * 300000);
  for (const message of review.comments[0].messages) {
    const count = Math.min(remaining, 300000), remainder = count % 3;
    message.text = '界'.repeat(Math.floor(count / 3)) + (remainder === 2 ? 'é' : remainder === 1 ? 'x' : '');
    remaining -= count;
  }
  assert.equal(remaining, 0); assert.equal(jsonBytes(review), bytes);
  return review;
}
function envelope(text: string, review: Review, revision = Number.MAX_SAFE_INTEGER) {
  return { schemaVersion: 1, baseDiskHash: hash, text, review, revision };
}
function reviewForEnvelope(text: string, bytes: number): Review {
  const review = emptyLargeReview(), overhead = jsonBytes(envelope(text, review)) - jsonBytes(review);
  return reviewWithBytes(bytes - overhead);
}
function growingAnchorReview(base: Review) {
  const text = '界'.repeat(80) + 'Q' + '界'.repeat(80);
  const review = { ...base, sourceHash: digest(text), comments: Array.from({ length: 2000 }, (_, i) => commentSchema.parse({
    id: 'context-' + i, title: 'Synthetic context', explanation: '', original: 'Q', replacement: null, from: 80, to: 81, validity: 'current'
  })) };
  let remaining = 31_900_000 - jsonBytes(review);
  for (const comment of review.comments) { const bytes = Math.min(remaining, 100000); comment.explanation = 'x'.repeat(bytes); remaining -= bytes; }
  assert.equal(remaining, 0);
  return { text, review };
}

test('JSON UTF-8 byte limits include escaping and formatting, including multibyte boundaries', () => {
  for (const text of ['ascii', 'é界😀', '\n\r\t"\\\u0000', '\ud800']) {
    const value = { text }, bytes = jsonBytes(value);
    assert.throws(() => serializeJSON(value, bytes - 1), /UTF-8 bytes/);
    assert.equal(serializeJSON(value, bytes), JSON.stringify(value, null, 2));
    assert.equal(serializeJSON(value, bytes + 1), JSON.stringify(value, null, 2));
  }
});
test('writeJSON accepts exactly 32,000,000 bytes and rejects one more without replacing readable state', async t => {
  const root = await directory(t), file = path.join(root, 'state.json'), overhead = jsonBytes({ text: '' });
  const value = { text: 'é'.repeat((JSON_FILE_LIMIT - overhead) / 2) };
  assert.equal(jsonBytes(value), JSON_FILE_LIMIT);
  await writeJSON(file, { text: value.text.slice(0, -1) + 'x' });
  assert.equal((await fs.stat(file)).size, JSON_FILE_LIMIT - 1);
  await writeJSON(file, value);
  assert.equal((await fs.stat(file)).size, JSON_FILE_LIMIT);
  assert.equal((await readJSON(file) as typeof value).text, value.text);
  const previous = digest(await fs.readFile(file));
  await assert.rejects(writeJSON(file, { text: value.text + 'x' }), /32000000 UTF-8 bytes/);
  assert.equal(digest(await fs.readFile(file)), previous);
  assert.equal((await readJSON(file) as typeof value).text, value.text);
  assert.deepEqual(await fs.readdir(root), ['state.json']);
});
test('a smaller JSON reader limit is also enforced before replacing its record', async t => {
  const root = await directory(t), file = path.join(root, 'small.json'), value = { text: '界'.repeat(20) }, bytes = jsonBytes(value);
  await writeJSON(file, value, bytes);
  await assert.rejects(writeJSON(file, { text: value.text + 'é' }, bytes), /UTF-8 bytes/);
  assert.deepEqual(await readJSON(file, bytes), value);
});

for (const stage of ['write', 'file-sync', 'file-close', 'guard', 'rename', 'directory-open', 'directory-sync', 'directory-close'] as const) {
  test(`atomicWrite ${stage} failure removes only its pending file and preserves the correct committed state`, async t => {
    const root = await directory(t), file = path.join(root, 'state.json');
    await writeJSON(file, { text: 'previous' });
    const kept = ['.state.json.other.pending', 'save.json', 'conflict-backup.json'];
    for (const name of kept) await fs.writeFile(path.join(root, name), 'intentional recovery');
    const originalOpen = fs.open;
    t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
      const name = String(args[0]), isDirectory = name === root;
      if (stage === 'directory-open' && isDirectory) throw new Error(stage);
      const handle = await originalOpen(...args);
      if (stage === 'write' && name.endsWith('.pending')) t.mock.method(handle, 'writeFile', async () => { throw new Error(stage); });
      if ((stage === 'file-sync' && !isDirectory) || (stage === 'directory-sync' && isDirectory)) t.mock.method(handle, 'sync', async () => { throw new Error(stage); });
      if ((stage === 'file-close' && !isDirectory) || (stage === 'directory-close' && isDirectory)) {
        const close = handle.close.bind(handle);
        t.mock.method(handle, 'close', async () => { await close(); throw new Error(stage); });
      }
      return handle;
    });
    if (stage === 'rename') t.mock.method(fs, 'rename', async () => { throw new Error(stage); });
    await assert.rejects(atomicWrite(file, serializeJSON({ text: 'next' }), async () => { if (stage === 'guard') throw new Error(stage); }), new RegExp(stage));
    t.mock.restoreAll();
    assert.deepEqual(await readJSON(file), { text: stage.startsWith('directory-') ? 'next' : 'previous' });
    assert.deepEqual((await fs.readdir(root)).sort(), [...kept, 'state.json'].sort());
    for (const name of kept) assert.equal(await fs.readFile(path.join(root, name), 'utf8'), 'intentional recovery');
  });
}
test('atomicWrite reports cleanup failure without deleting the destination or hiding the original failure', async t => {
  const root = await directory(t), file = path.join(root, 'state.json'); await writeJSON(file, { text: 'previous' });
  t.mock.method(fs, 'unlink', async () => { throw Object.assign(new Error('cleanup denied'), { code: 'EACCES' }); });
  await assert.rejects(atomicWrite(file, 'next', async () => { throw new Error('replacement rejected'); }), error => {
    assert(error instanceof AggregateError);
    assert.match(error.message, /temporary file could not be removed/);
    assert.match(String(error.errors[0]), /replacement rejected/); assert.match(String(error.errors[1]), /cleanup denied/); return true;
  });
  t.mock.restoreAll();
  assert.deepEqual(await readJSON(file), { text: 'previous' });
  assert.equal((await fs.readdir(root)).filter(name => name.endsWith('.pending')).length, 1);
});
test('unsupported directory sync still completes an atomic replacement', async t => {
  const root = await directory(t), file = path.join(root, 'state.json'), originalOpen = fs.open;
  t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
    const handle = await originalOpen(...args);
    if (String(args[0]) === root) t.mock.method(handle, 'sync', async () => { throw Object.assign(new Error('unsupported'), { code: 'ENOTSUP' }); });
    return handle;
  });
  await writeJSON(file, { text: 'committed' }); t.mock.restoreAll();
  assert.deepEqual(await readJSON(file), { text: 'committed' }); assert.deepEqual(await fs.readdir(root), ['state.json']);
});

test('individually legal messages cannot exceed the aggregate comment or review limit', () => {
  const review = reviewWithBytes(JSON_FILE_LIMIT + 10000);
  for (const message of review.comments[0].messages) assert(messageSchema.safeParse(message).success);
  assert.throws(() => commentsSchema.parse(review.comments), /32000000 UTF-8 bytes/);
  assert.throws(() => reviewSchema.parse(review), /32000000 UTF-8 bytes/);
});
test('draft admission reserves room to select any existing comment as the recovery revision grows', () => {
  const review = reviewForEnvelope('', JSON_FILE_LIMIT - 64), comment = review.comments[0];
  comment.id = 'x'.repeat(200); comment.messages[0].text = comment.messages[0].text.slice(0, -64);
  assert(jsonBytes(envelope('', review)) <= JSON_FILE_LIMIT, 'current null selection still fits');
  assert(jsonBytes(envelope('', { ...review, activeId: comment.id })) > JSON_FILE_LIMIT);
  assert.throws(() => bufferSchema.parse({ projectId: 'p', text: '', review }), /32000000 UTF-8 bytes/);
});
test('clearing a one-character selection reserves the extra byte for JSON null', () => {
  const review = reviewForEnvelope('', JSON_FILE_LIMIT), comment = review.comments[0];
  comment.id = 'c'; review.activeId = 'c'; comment.validity = 'unconfirmed';
  comment.messages.at(-1)!.text += '界界';
  assert.equal(jsonBytes(envelope('', review)), JSON_FILE_LIMIT);
  assert.equal(jsonBytes(envelope('', { ...review, activeId: null })), JSON_FILE_LIMIT + 1);
  assert.throws(() => bufferSchema.parse({ projectId: 'p', text: '', review }), /32000000 UTF-8 bytes/);
  // Remove exactly one UTF-8 byte: both selection states now fit at the boundary.
  comment.messages[0].text = 'é' + comment.messages[0].text.slice(1);
  assert.equal(jsonBytes(envelope('', { ...review, activeId: null })), JSON_FILE_LIMIT);
  bufferSchema.parse({ projectId: 'p', text: '', review });
  bufferSchema.parse({ projectId: 'p', text: '', review: { ...review, activeId: null } });
});
test('trusted anchor context expansion cannot make a persisted review fail to reopen', async t => {
  const f = await fixture(t); await f.service.persist({ projectId: f.project.id, text: f.project.text, review: f.project.review });
  const { text, review } = growingAnchorReview(f.project.review);
  assert(reviewSchema.safeParse(review).success);
  assert(jsonBytes(envelope(text, review)) < JSON_FILE_LIMIT, 'unrefreshed recovery fits');
  assert(!commentsSchema.safeParse(anchorReview(text, review, true).comments).success, 'reopen would expand beyond the comment limit');
  const before = await inventory(f.root), candidate = { projectId: f.project.id, text, review };
  assert.throws(() => bufferSchema.parse(candidate), /32000000 UTF-8 bytes/);
  await assert.rejects(f.service.persist(candidate), /32000000 UTF-8 bytes/);
  await assert.rejects(f.service.save(candidate), /32000000 UTF-8 bytes/);
  assert.deepEqual(await inventory(f.root), before);
  assert.equal((await new ProjectService(f.cache).open(f.file)).text, f.project.text);
});
test('near-limit multibyte recovery persists, opens, saves and reopens without truncation', async t => {
  const f = await fixture(t), text = 'Draft α\n'.repeat(100), review = reviewForEnvelope(text, JSON_FILE_LIMIT - 64);
  const input: BufferInput = { projectId: f.project.id, text, review };
  assert(bufferSchema.safeParse(input).success);
  await f.service.persist(input);
  const expected = digest(JSON.stringify(review.comments)), reopenedService = new ProjectService(f.cache), reopened = await reopenedService.open(f.file);
  assert.equal(reopened.text, text); assert.equal(digest(JSON.stringify(reopened.review.comments)), expected);
  const savedText = 'Saved α\n';
  await reopenedService.save({ projectId: reopened.id, text: savedText, review: reopened.review });
  assert.equal(await fs.readFile(f.file, 'utf8'), savedText);
  const again = await new ProjectService(f.cache).open(f.file);
  assert.equal(again.text, savedText); assert.equal(digest(JSON.stringify(again.review.comments)), expected);
  for (const name of ['review.json', 'recovery/session.json']) {
    assert((await fs.stat(path.join(f.home, name))).size <= JSON_FILE_LIMIT); await readJSON(path.join(f.home, name));
  }
  const recoveryNames = await fs.readdir(path.join(f.home, 'recovery'));
  assert(recoveryNames.some(name => name.startsWith('conflict-'))); assert(!recoveryNames.includes('save.json'));
  assert.equal(again.baseline?.text, 'Original source\n');
});
test('an oversized complete envelope rejects persist and save before changing any source, journal, sidecar or backup', async t => {
  const f = await fixture(t), previous = { projectId: f.project.id, text: 'Previous draft', review: f.project.review };
  await f.service.persist(previous);
  const recovery = path.join(f.home, 'recovery'), pending = { ...envelope('Earlier interrupted draft', f.project.review, 2), baseDiskHash: f.project.diskHash };
  await writeJSON(path.join(recovery, 'save.json'), pending);
  await writeJSON(path.join(recovery, `conflict-${digest('intentional')}-save.json`), pending);
  await fs.mkdir(path.join(f.home, 'backups'));
  await fs.writeFile(path.join(f.home, 'backups', `source-${digest('Original source\n')}.tex`), 'Original source\n');
  const before = await inventory(f.root), text = 'x'.repeat(10000), review = reviewForEnvelope(text, JSON_FILE_LIMIT + 1);
  assert(reviewSchema.safeParse(review).success, 'review itself fits; the complete envelope does not');
  const candidate = { projectId: f.project.id, text, review };
  await assert.rejects(f.service.persist(candidate), /32000000 UTF-8 bytes/);
  await assert.rejects(f.service.save(candidate), /32000000 UTF-8 bytes/);
  assert.deepEqual(await inventory(f.root), before);
  const recovered = await inspectSourceRecovery(f.file);
  assert(recovered.choices.some(choice => choice.text === previous.text));
  assert(recovered.choices.some(choice => choice.text === pending.text));
  assert(!recovered.choices.some(choice => choice.text === text));
  const opened = await new ProjectService(f.cache).open(f.file);
  assert.equal(opened.text, pending.text); assert.equal(await fs.readFile(f.file, 'utf8'), 'Original source\n');
  assert.equal((await new ProjectService(f.cache).open(f.file)).text, pending.text);
});
test('reconciliation rejects a compact legacy journal that would expand past the limit, preserving all recovery choices', async t => {
  const f = await fixture(t); await f.service.persist({ projectId: f.project.id, text: 'Earlier session', review: f.project.review });
  const text = 'Legacy draft', review = reviewForEnvelope(text, JSON_FILE_LIMIT + 1), record = { ...envelope(text, review), baseDiskHash: f.project.diskHash };
  assert(reviewSchema.safeParse(review).success); assert(Buffer.byteLength(JSON.stringify(record)) <= JSON_FILE_LIMIT);
  await fs.writeFile(path.join(f.home, 'recovery/save.json'), JSON.stringify(record));
  const before = await inventory(f.root);
  await assert.rejects(new ProjectService(f.cache).open(f.file), /32000000 UTF-8 bytes/);
  assert.deepEqual(await inventory(f.root), before);
  const recovered = await inspectSourceRecovery(f.file);
  assert(recovered.choices.some(choice => choice.text === text)); assert(recovered.choices.some(choice => choice.text === 'Earlier session'));
});
test('legacy recovery anchor expansion is rejected before retaining, replacing or removing any record', async t => {
  const f = await fixture(t); await f.service.persist({ projectId: f.project.id, text: 'Earlier session', review: f.project.review });
  const { text, review } = growingAnchorReview(f.project.review), record = { ...envelope(text, review, 2), baseDiskHash: f.project.diskHash };
  assert(jsonBytes(record) < JSON_FILE_LIMIT);
  assert(!commentsSchema.safeParse(anchorReview(text, review, true).comments).success);
  await fs.writeFile(path.join(f.home, 'recovery/save.json'), JSON.stringify(record));
  const before = await inventory(f.root);
  await assert.rejects(new ProjectService(f.cache).open(f.file), /32000000 UTF-8 bytes/);
  assert.deepEqual(await inventory(f.root), before, 'source, session, sidecar and journal remain byte-identical; no archive is created');
  const recovered = await inspectSourceRecovery(f.file);
  assert(recovered.choices.some(choice => choice.text === text)); assert(recovered.choices.some(choice => choice.text === 'Earlier session'));
});
test('oversized completed results cannot replace or hide an already retained answer', async t => {
  const f = await fixture(t), store = new ReviewResults(f.service);
  const small: WaitingResult = { schemaVersion: 1, kind: 'review', id: randomUUID(), rootFile: 'paper.tex', sourceHash: f.project.diskHash, createdAt: date, comments: [] };
  await store.retain(f.project.id, small); const before = await inventory(f.root);
  await assert.rejects(store.retain(f.project.id, { ...small, id: randomUUID(), comments: reviewWithBytes(JSON_FILE_LIMIT + 10000).comments }), /32000000 UTF-8 bytes/);
  assert.deepEqual(await inventory(f.root), before); assert.deepEqual((await store.list(f.project.id)).items, [small]);
});
test('renderer comment edits and result adoption check source plus review before installing or acknowledging', async () => {
  const text = 'x'.repeat(10000), review = reviewForEnvelope(text, JSON_FILE_LIMIT - 64), current: BufferInput = { projectId: 'p', text, review };
  const state = initialState(text, review.comments), transaction = state.update({ effects: patchComments.of([{ id: 'discussion', fields: { replyDraft: 'y'.repeat(2000) } }]) });
  assert.throws(() => validateReviewTransaction(transaction, current), /32000000 UTF-8 bytes/);
  assert.equal(state.field(commentsField)[0].replyDraft, '');
  assert.throws(() => validateReviewTransaction(state.update({ changes: { from: text.length, insert: 'y'.repeat(2000) } }), current), /32000000 UTF-8 bytes/);
  assert.equal(state.doc.toString(), text);
  const answer: WaitingResult = { schemaVersion: 1, kind: 'reply', id: randomUUID(), rootFile: 'paper.tex', sourceHash: digest(text), createdAt: date, commentId: 'discussion', original: 'Claim', answer: { reply: 'y'.repeat(2000), replacement: null, packages: [] } };
  let installed = 0, acknowledged = 0, flushed = 0, shown: WaitingResult[] = []; const errors: unknown[] = [];
  const inbox = new ResultInbox({ input: () => current, locked: () => false, begin: () => () => {}, install: () => { installed++; }, flush: async () => { flushed++; },
    api: { waitingResults: async () => ({ items: [answer], notices: [] }), acknowledgeResult: async () => { acknowledged++; } },
    changed: items => { shown = items; }, error: error => { errors.push(error); } });
  await inbox.refresh();
  assert.equal(installed, 0); assert.equal(acknowledged, 0); assert.equal(flushed, 0);
  assert.deepEqual(shown, [answer]); assert.equal(errors.length, 1); assert.match(String(errors[0]), /32000000 UTF-8 bytes/);
});
test('PDF workspace snapshots respect their smaller reader limit and preserve the previous usable snapshot', async t => {
  const root = await directory(t), id = randomUUID(), folder = path.join(root, id), owner = path.join(root, 'paper.tex'), source = 'Source';
  await fs.mkdir(folder); await fs.writeFile(path.join(folder, 'paper.tex'), source); await fs.writeFile(path.join(folder, 'paper.pdf'), '%PDF-1.4\n');
  await writeJSON(path.join(folder, '.editor-build.json'), { schemaVersion: 1, id }, 1000);
  const build = { id, engine: 'pdflatex' as const, success: true, clean: true, sourceHash: digest(source), diagnostics: [], log: '', elapsedMs: 1 };
  await rememberPdf(folder, owner, build); const before = await inventory(root);
  const diagnostics = Array.from({ length: 50 }, () => ({ severity: 'warning' as const, message: '界'.repeat(10000) }));
  await assert.rejects(rememberPdf(folder, owner, { ...build, diagnostics }), /1000000 UTF-8 bytes/);
  assert.deepEqual(await inventory(root), before); assert.equal((await restorePdf(root, owner, id)).text, source);
});
