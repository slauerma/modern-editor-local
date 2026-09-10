import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { inspectSourceRecovery, writeSourceCopy } from '../src/main/source-export.ts';
import { ProjectService } from '../src/main/project-service.ts';
import { digest } from '../src/main/files.ts';
import { pdfPage } from '../src/renderer/pdf-position.ts';
import { CodexService } from '../src/main/codex-service.ts';
import { proposalChanges } from '../src/shared/review.ts';

async function fixture() {
  const root = path.resolve('.test-runs', 'source-export-' + randomUUID());
  const recovery = path.join(root, '.modern-editor/recovery'); await fs.mkdir(recovery, { recursive: true });
  const source = '\uFEFF\\documentclass{article}\r\n\\begin{document}Disk source.\\end{document}\r\n';
  const file = path.join(root, 'main.tex'); await fs.writeFile(file, source);
  return { root, recovery, file, source };
}

test('export preserves BOM, CRLF and Unicode; existing files and links cannot be overwritten', async () => {
  const f = await fixture(), copy = path.join(f.root, 'copy.tex'), text = f.source + 'θ';
  await writeSourceCopy(copy, text); assert.equal(await fs.readFile(copy, 'utf8'), text);
  await assert.rejects(writeSourceCopy(copy, 'overwrite'), { code: 'EEXIST' });
  const link = path.join(f.root, 'link.tex'); await fs.symlink(f.file, link);
  await assert.rejects(writeSourceCopy(link, 'overwrite'), { code: 'EEXIST' });
  assert.equal(await fs.readFile(f.file, 'utf8'), f.source); assert.equal(await fs.readFile(copy, 'utf8'), text);
});

test('corrupt review cannot hide valid recovery source; conflicting records remain separate and untouched', async () => {
  const f = await fixture(), sidecar = path.join(f.root, '.modern-editor/review.json');
  await fs.writeFile(sidecar, '{broken review');
  const session = { schemaVersion: 1, baseDiskHash: digest(f.source), text: 'Newer θ unsaved manuscript', review: { rootFile: 'main.tex', comments: 'invalid review too' }, revision: 8 };
  const save = { ...session, text: 'Different pending save', revision: 7 };
  const sessionText = JSON.stringify(session), saveText = JSON.stringify(save);
  await fs.writeFile(path.join(f.recovery, 'session.json'), sessionText); await fs.writeFile(path.join(f.recovery, 'save.json'), saveText);
  const projects = new ProjectService(path.join(f.root, 'cache'));
  await assert.rejects(projects.open(f.file)); assert.equal(projects.current, null);
  const found = await inspectSourceRecovery(f.file);
  assert.equal(found.choices.length, 3); assert.deepEqual(found.choices.map(c => c.text), [f.source, session.text, save.text]);
  await writeSourceCopy(path.join(f.root, 'recovered.tex'), found.choices[1].text);
  assert.equal(await fs.readFile(sidecar, 'utf8'), '{broken review');
  assert.equal(await fs.readFile(path.join(f.recovery, 'session.json'), 'utf8'), sessionText);
  assert.equal(await fs.readFile(path.join(f.recovery, 'save.json'), 'utf8'), saveText);
  assert.equal(await fs.readFile(f.file, 'utf8'), f.source); assert.equal(projects.current, null);
});

test('recovery inspection refuses wrong-root records and linked recovery paths without altering source', async () => {
  const f = await fixture();
  await fs.writeFile(path.join(f.recovery, 'session.json'), JSON.stringify({ schemaVersion: 1, baseDiskHash: digest(f.source), text: 'foreign', review: { rootFile: 'different.tex' } }));
  let found = await inspectSourceRecovery(f.file); assert.equal(found.choices.length, 1); assert.equal(found.notices.length, 1);
  await fs.rename(f.recovery, f.recovery + '-kept'); await fs.symlink(f.recovery + '-kept', f.recovery);
  found = await inspectSourceRecovery(f.file); assert.equal(found.choices.length, 1); assert.match(found.notices[0], /linked/);
  assert.equal(await fs.readFile(f.file, 'utf8'), f.source);
});

test('PDF page entry clamps invalid and out-of-range positions when a shorter PDF loads', () => {
  assert.equal(pdfPage(99, 3), 3); assert.equal(pdfPage(-2, 3), 1); assert.equal(pdfPage(NaN, 3), 1); assert.equal(pdfPage(2.9, 3), 2);
});

test('a Codex quote outside the selected passage cannot become applicable after persist and reopen', async () => {
  const f = await fixture(), projects = new ProjectService(path.join(f.root, 'cache')), p = await projects.open(f.file);
  const codex = new CodexService(projects, path.join(f.root, 'codex'));
  codex.client.run = async () => ({ comments: [{ title: 'Wrong scope', explanation: 'Model quoted context.', original: 'Disk source.', replacement: 'Unwanted edit', category: 'Clarity', before: '', after: '', packages: [] }] });
  const comments = await codex.review({ projectId: p.id, text: p.text, from: 0, to: p.text.indexOf('\\begin'), instructions: 'Review this preamble only.' }, () => {});
  assert.equal(comments[0].validity, 'missing');
  await projects.persist({ projectId: p.id, text: p.text, review: { ...p.review, comments } });
  const reopened = await projects.open(f.file), c = reopened.review.comments[0];
  assert.notEqual(c.validity, 'current'); assert.throws(() => proposalChanges(reopened.text, c));
  assert.equal(await fs.readFile(f.file, 'utf8'), f.source);
});
