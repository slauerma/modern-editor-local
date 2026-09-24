import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { documentBody, documentMode, documentModeNotice } from '../src/shared/document-mode.ts';
import { pdfPreviewProblem, proposalPreview, proposalSignature } from '../src/shared/proposal-preview.ts';
import { commentSchema, type Build } from '../src/shared/contracts.ts';
import { ProjectService } from '../src/main/project-service.ts';
import { rememberPdf, restorePdf } from '../src/main/pdf-workspace-cache.ts';
import { digest } from '../src/main/files.ts';
import { initialState, applyProposal, commentsField } from '../src/renderer/editor-state.ts';
import { reviewContext, replyContext } from '../src/shared/codex-context.ts';
import { feedbackContext } from '../src/shared/feedback.ts';

const source = '\\documentclass{article}\n\\begin{document}\nThe allocation are monotone.\n\\end{document}\n';
function comment(text = source) {
  const original = 'The allocation are monotone.', from = text.indexOf(original);
  return commentSchema.parse({ id: 'example', title: 'Grammar', explanation: 'Use a singular verb.', original, replacement: 'The allocation is monotone.', from, to: from + original.length, validity: 'current' });
}
test('text mode recognizes ordinary wrappers, not examples, comments or partial wrappers', () => {
  assert.equal(documentMode(source), 'latex');
  assert.equal(documentMode('Plain prose\n\nA paragraph.'), 'text');
  assert.equal(documentMode('% \\begin{document}\nWords\n% \\end{document}'), 'text');
  assert.equal(documentMode('\\newcommand{\\sample}{\\begin{document} Example \\end{document}}'), 'text');
  assert.equal(documentMode('\\verb|\\begin{document}| \\verb|\\end{document}|'), 'text');
  assert.equal(documentMode('\\begin{verbatim}\n' + source + '\\end{verbatim}'), 'text');
  assert.equal(documentMode('\\begin{document}\nFragment'), 'text');
  assert.equal(documentMode('\\end{document}\n\\begin{document}'), 'text');
  assert.equal(documentMode(source + source), 'text');
  assert(documentBody('\\begin % comment\n {document}\nBody\n\\end {document}'));
  assert.match(documentModeNotice('\\begin{document}\nFragment')!, /incomplete or ambiguous/);
  assert.equal(documentModeNotice(source), null);
  assert.equal(documentModeNotice('Plain prose'), null);
  assert.equal(documentModeNotice('% \\begin{document}\nPlain prose'), null);
});
test('preview uses the edited proposal and package changes exactly like acceptance, without touching state', () => {
  const c = { ...comment(), draft: 'A more compact correction.', packages: ['amsmath'] };
  const state = initialState(source, [c]), before = JSON.stringify(state.field(commentsField));
  const preview = proposalPreview(source, c);
  assert.equal(preview.text, state.update(applyProposal(state, c.id)).newDoc.toString());
  assert.equal(preview.text.slice(preview.from, preview.to), c.draft);
  assert(preview.text.includes('\\usepackage{amsmath}'));
  assert.equal(pdfPreviewProblem(source, c, preview), null);
  assert.equal(state.doc.toString(), source); assert.equal(JSON.stringify(state.field(commentsField)), before);
  assert.notEqual(proposalSignature(c), proposalSignature({ ...c, draft: 'Different' }));
  assert.throws(() => proposalPreview(source + 'x', { ...c, validity: 'stale' }), /source passage changed/);
});
test('text preview supports deletions and paragraph edits; unsupported PDF targets are rejected before compilation', () => {
  const plain = 'Intro\n\nThe allocation are monotone.\n\nConclusion.', c = { ...comment(plain), draft: '' };
  const preview = proposalPreview(plain, c);
  assert.equal(preview.text, 'Intro\n\n\n\nConclusion.');
  assert(pdfPreviewProblem(plain, c, preview));
  const deletion = { ...comment(), replacement: '' };
  assert.match(pdfPreviewProblem(source, deletion, proposalPreview(source, deletion))!, /deletion/);
  const preamble = commentSchema.parse({ ...comment(), original: '\\documentclass{article}', replacement: '\\documentclass{book}', from: 0, to: 23 });
  assert.match(pdfPreviewProblem(source, preamble, proposalPreview(source, preamble))!, /outside the document body/);
});
test('text review, discussion and imported feedback request format-preserving edits', () => {
  const text = 'The allocation are monotone.', request = { projectId: 'paper', text, from: 0, to: text.length, instructions: 'Language check' };
  for (const context of [reviewContext(request), replyContext({ ...request, comment: comment(text), message: 'Shorten it' }), feedbackContext({ ...request, label: 'Reader', feedback: 'Fix grammar' })]) {
    assert.match(context.format, /text or a LaTeX fragment/); assert.match(context.format, /Do not add a preamble/);
  }
});
test('txt save, recovery and reopen preserve source and comments; session baseline survives Save', async t => {
  const root = path.resolve('.test-runs/viewer-' + randomUUID()); await fs.mkdir(root, { recursive: true });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'draft.txt'), cache = path.join(root, 'cache'), original = 'The allocation are monotone.\n\nA second paragraph.\n';
  await fs.writeFile(file, '\uFEFF' + original.replace(/\n/g, '\r\n'));
  const service = new ProjectService(cache), project = await service.open(file), c = comment(original);
  assert.equal(project.sessionBaseline?.text, original);
  const revised = 'The allocation is monotone.\n\nA second paragraph.\n';
  await service.persist({ projectId: project.id, text: revised, review: { ...project.review, comments: [c] } });
  assert.notEqual(await fs.readFile(file, 'utf8'), revised);
  await service.save({ projectId: project.id, text: revised, review: { ...project.review, comments: [c] } });
  assert.equal(service.get(project.id).sessionBaseline?.text, original);
  assert.equal(await fs.readFile(file, 'utf8'), '\uFEFF' + revised.replace(/\n/g, '\r\n'));
  const reopened = await new ProjectService(cache).open(file);
  assert.equal(reopened.text, revised); assert.equal(reopened.sessionBaseline?.text, revised);
  assert.equal(reopened.review.comments.length, 1);
  const home = await service.stateDirectory(project.id);
  assert.equal(JSON.parse(await fs.readFile(path.join(home, 'session-start.json'), 'utf8')).text, revised);
});
test('proposal PDF cannot be stored or restored as an ordinary paper PDF', async t => {
  const root = path.resolve('.test-runs/viewer-pdf-' + randomUUID()), id = randomUUID(), folder = path.join(root, id), owner = path.join(root, 'draft.txt');
  await fs.mkdir(folder, { recursive: true }); t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(folder, 'draft.txt'), source); await fs.writeFile(path.join(folder, 'draft.pdf'), '%PDF-synthetic');
  await fs.writeFile(path.join(folder, '.editor-build.json'), JSON.stringify({ schemaVersion: 1, id }));
  const build: Build = { id, purpose: 'paper', engine: 'pdflatex', sourceHash: digest(source), success: true, clean: true, diagnostics: [], log: '', elapsedMs: 1 };
  await rememberPdf(folder, owner, build);
  const file = path.join(folder, '.editor-pdf-snapshot.json'), before = await fs.readFile(file);
  await assert.rejects(rememberPdf(folder, owner, { ...build, purpose: 'proposal' }), /proposal preview/);
  assert.deepEqual(await fs.readFile(file), before); assert.equal((await restorePdf(root, owner, id)).text, source);
  const tampered = JSON.parse(before.toString()); tampered.build.purpose = 'proposal'; await fs.writeFile(file, JSON.stringify(tampered));
  await assert.rejects(restorePdf(root, owner, id));
});
