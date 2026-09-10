import { documentStatePath, prepareDocumentState } from '../src/main/document-state.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProjectService } from '../src/main/project-service.ts';
import { digest } from '../src/main/files.ts';
import { commentSchema } from '../src/shared/contracts.ts';
import { locate, proposalChanges, reattachComment } from '../src/shared/review.ts';
import { initialState, commentsField } from '../src/renderer/editor-state.ts';

async function fixture(bytes = 'Original source\n') {
  const root = path.resolve('.test-runs', 'files-' + randomUUID()), paper = path.join(root, 'paper');
  await fs.mkdir(paper, { recursive: true }); const file = path.join(paper, 'main.tex'); await fs.writeFile(file, bytes);
  const service = new ProjectService(path.join(root, 'cache')), project = await service.open(file);
  return { root, paper, file, service, project };
}
test('unsaved recovery preserves original source and resumes text and comments together', async () => {
  const f = await fixture(), text = 'Unsaved source\n';
  await f.service.persist({ projectId: f.project.id, text, review: f.project.review });
  assert.equal(await fs.readFile(f.file, 'utf8'), 'Original source\n');
  const resumed = await new ProjectService(path.join(f.root, 'cache')).resume();
  assert.equal(resumed?.text, text); assert.equal(resumed?.recovered, true); assert.equal(resumed?.review.sourceHash, digest(text));
});
test('persist and reopen cannot confirm an uncertain comment at a different passage', async () => {
  const quote = 'The allocation is monotone.', source = 'Other result: ' + quote;
  const f = await fixture(source);
  const comment = locate(source, commentSchema.parse({ id: 'placement', title: 'Clarity', explanation: '', original: quote, replacement: 'The allocation increases weakly.', before: 'First: ', replyDraft: 'Keep my question' }));
  let state = initialState(source, [comment]);
  let project = f.project;
  const service = new ProjectService(path.join(f.root, 'cache'));
  for (const text of ['A different passage\nFirst: ' + quote, 'No quotation remains.', quote + '\n' + quote, 'First: ' + quote]) {
    state = state.update({ changes: { from: 0, to: state.doc.length, insert: text } }).state;
    const writer = project.id === f.project.id ? f.service : service;
    await writer.persist({ projectId: project.id, text, review: { ...project.review, comments: state.field(commentsField) } });
    project = await service.open(f.file);
    assert.equal(project.text, text);
    assert.equal(project.review.comments[0].validity, 'unconfirmed');
    assert.equal(project.review.comments[0].replyDraft, 'Keep my question');
    assert.throws(() => proposalChanges(project.text, project.review.comments[0]));
    state = initialState(project.text, project.review.comments);
  }
  const attached = reattachComment(project.text, project.review.comments[0], 7, project.text.length);
  await service.persist({ projectId: project.id, text: project.text, review: { ...project.review, comments: [attached] } });
  const reopened = await service.open(f.file);
  assert.equal(reopened.review.comments[0].validity, 'current');
  assert.equal(reopened.review.comments[0].replyDraft, 'Keep my question');
  assert.doesNotThrow(() => proposalChanges(reopened.text, reopened.review.comments[0]));
  assert.equal(await fs.readFile(f.file, 'utf8'), source);
});
test('save preserves CRLF and UTF-8 BOM', async () => {
  const f = await fixture('\uFEFFFirst\r\nSecond\r\n');
  assert.equal(f.project.text, 'First\nSecond\n');
  await f.service.save({ projectId: f.project.id, text: 'First\nChanged 😀\n', review: f.project.review });
  assert.equal(await fs.readFile(f.file, 'utf8'), '\uFEFFFirst\r\nChanged 😀\r\n');
});
test('save refuses to overwrite a concurrent external edit', async () => {
  const f = await fixture(); await fs.writeFile(f.file, 'Changed elsewhere\n');
  await assert.rejects(f.service.save({ projectId: f.project.id, text: 'My edit', review: f.project.review }), /another editor/);
  assert.equal(await fs.readFile(f.file, 'utf8'), 'Changed elsewhere\n');
});
test('a failed open does not change the current paper encoding or line endings', async () => {
  const f = await fixture('\uFEFFOriginal\r\n'), secondDir = path.join(f.root, 'second');
  await fs.mkdir(path.join(secondDir, '.modern-editor'), { recursive: true });
  await fs.writeFile(path.join(secondDir, 'main.tex'), 'Other\n');
  const secondHome = await prepareDocumentState(path.join(secondDir, 'main.tex'), true);
  await fs.writeFile(path.join(secondHome, 'review.json'), 'invalid');
  await assert.rejects(f.service.open(path.join(secondDir, 'main.tex')));
  assert.equal(f.service.current?.id, f.project.id);
  await f.service.save({ projectId: f.project.id, text: 'Edited\n', review: f.project.review });
  assert.equal(await fs.readFile(f.file, 'utf8'), '\uFEFFEdited\r\n');
});
test('conflicting unsaved recovery is retained instead of replacing the external file', async () => {
  const f = await fixture(); await f.service.persist({ projectId: f.project.id, text: 'Unsaved old work', review: f.project.review });
  await fs.writeFile(f.file, 'External version');
  const p = await f.service.open(f.file); assert.equal(p.text, 'External version'); assert.equal(p.recovered, false);
  await f.service.persist({ projectId: p.id, text: p.text, review: p.review });
  const names = await fs.readdir(path.join(documentStatePath(f.file), 'recovery'));
  const archive = names.find(n => n.startsWith('conflict-'))!;
  assert(archive); assert((await fs.readFile(path.join(documentStatePath(f.file), 'recovery', archive), 'utf8')).includes('Unsaved old work'));
});
test('an interrupted save after source rename recovers the matching review', async () => {
  const f = await fixture(); await f.service.persist({ projectId: f.project.id, text: f.project.text, review: f.project.review });
  const next = 'Saved new source\n', review = { ...f.project.review, sourceHash: digest(next), activeId: 'remember-position' };
  await fs.writeFile(path.join(documentStatePath(f.file), 'recovery/save.json'), JSON.stringify({ schemaVersion: 1, baseDiskHash: f.project.diskHash, text: next, review }));
  await fs.writeFile(f.file, next);
  const p = await f.service.open(f.file); assert.equal(p.review.activeId, 'remember-position'); assert.equal(p.text, next); assert.equal(p.recovered, false);
});
test('an interrupted save before source rename restores the unsaved intended change', async () => {
  const f = await fixture(); await f.service.persist({ projectId: f.project.id, text: f.project.text, review: f.project.review });
  const next = 'Pending change\n';
  await fs.writeFile(path.join(documentStatePath(f.file), 'recovery/save.json'), JSON.stringify({ schemaVersion: 1, baseDiskHash: f.project.diskHash, text: next, review: { ...f.project.review, sourceHash: digest(next) } }));
  const p = await f.service.open(f.file); assert.equal(p.text, next); assert.equal(p.recovered, true); assert.equal(await fs.readFile(f.file, 'utf8'), 'Original source\n');
});
test('a request for a previously open paper cannot write to the current paper', async () => {
  const f = await fixture(), second = path.join(f.paper, 'second.tex'); await fs.writeFile(second, 'Second'); await f.service.open(second);
  await assert.rejects(f.service.save({ projectId: f.project.id, text: 'Wrong paper', review: f.project.review }), /no longer open/);
  assert.equal(await fs.readFile(second, 'utf8'), 'Second');
});
test('a symlinked review directory cannot redirect writes', async () => {
  const f = await fixture(), target = path.join(f.root, 'elsewhere'); await fs.mkdir(target);
  await fs.symlink(target, path.join(f.paper, '.modern-editor'));
  await assert.rejects(f.service.persist({ projectId: f.project.id, text: f.project.text, review: f.project.review }), /regular directory/);
  assert.deepEqual(await fs.readdir(target), []);
});
test('malformed review JSON does not overwrite a paper or the malformed data', async () => {
  const f = await fixture(); const reviewFile = path.join(await f.service.stateDirectory(f.project.id), 'review.json'); await fs.writeFile(reviewFile, 'invalid-json');
  await assert.rejects(f.service.open(f.file)); assert.equal(await fs.readFile(reviewFile, 'utf8'), 'invalid-json'); assert.equal(await fs.readFile(f.file, 'utf8'), 'Original source\n');
});
test('the chosen engine survives reopening without saving the source or losing its draft', async () => {
  const f = await fixture();
  await f.service.persist({ projectId: f.project.id, text: 'Keep my unsaved edit', review: f.project.review });
  await f.service.setEngine(f.project.id, 'lualatex');
  const reopened = await new ProjectService(path.join(f.root, 'cache')).open(f.file);
  assert.equal(reopened.engine, 'lualatex'); assert.equal(reopened.text, 'Keep my unsaved edit');
  assert.equal(await fs.readFile(f.file, 'utf8'), 'Original source\n');
  await assert.rejects(f.service.setEngine('old-paper-id', 'xelatex'), /no longer open/);
});
test('malformed optional engine settings do not prevent opening the manuscript', async () => {
  const f = await fixture(); await fs.mkdir(path.join(f.paper, '.modern-editor'));
  const settings = path.join(f.paper, '.modern-editor/settings.json'); await fs.writeFile(settings, 'invalid');
  const p = await f.service.open(f.file);
  assert.equal(p.text, 'Original source\n'); assert.equal(p.engine, 'pdflatex');
  assert(p.notices.some(n => n.includes('settings.json'))); assert.equal(await fs.readFile(settings, 'utf8'), 'invalid');
});
