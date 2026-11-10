import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { inspectTextEncoding, decodeText } from '../src/main/text-encoding.ts';
import { TextImportService } from '../src/main/text-import.ts';
import { ProjectService } from '../src/main/project-service.ts';
import { TextImportFlow } from '../src/renderer/text-import-flow.ts';
import type { Project } from '../src/shared/contracts.ts';
import type { TextImportPreview } from '../src/shared/text-import.ts';

const windows = Buffer.from('93436166e99420636f7374732080352e0d0a', 'hex');
const wording = '“Café” costs €5.\r\n';
async function fixture(t: TestContext, bytes = windows, name = 'paper.txt') {
  const root = path.resolve('.test-runs', 'text-import-' + randomUUID());
  await fs.mkdir(root, { recursive: true }); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, name); await fs.writeFile(file, bytes);
  return { root, file, service: new TextImportService(), target: path.join(root, 'paper-utf8' + path.extname(name)) };
}
test('UTF-8, UTF-8 BOM and ordinary ASCII open directly without conversion', () => {
  for (const text of ['', 'PK is a name.', 'Café € 漢字 𝑥', '\ufeffUTF-8\r\n']) assert.equal(inspectTextEncoding(Buffer.from(text)), null);
});
test('Windows-1252, true Latin-1 and Mac Roman preserve their distinct characters', () => {
  const preview = inspectTextEncoding(windows)!;
  assert.equal(preview.identified, false);
  assert.equal(preview.choices.find(c => c.encoding === 'windows-1252')?.text, wording);
  assert.equal(decodeText(Buffer.from([0xe9, 0xa0, 0xff]), 'iso-8859-1'), 'é\u00a0ÿ');
  assert.throws(() => decodeText(Buffer.from([0x80]), 'iso-8859-1'), /control/);
  assert.equal(decodeText(Buffer.from([0x8e]), 'macintosh'), 'é');
});
test('UTF-16 BOM determines byte order and preserves Unicode, tabs and line endings', () => {
  const text = 'Café\t𝑥 漢字 🙂\r\nSecond line\n';
  for (const be of [false, true]) {
    const bytes = Buffer.from('\ufeff' + text, 'utf16le'); if (be) bytes.swap16();
    const preview = inspectTextEncoding(bytes)!;
    assert.equal(preview.identified, true); assert.equal(preview.choices.length, 1);
    assert.equal(preview.choices[0].encoding, be ? 'utf-16be' : 'utf-16le'); assert.equal(preview.choices[0].text, text);
  }
});
test('BOM-less UTF-16 is presented as uncertain rather than silently opened as UTF-8', () => {
  const preview = inspectTextEncoding(Buffer.from('Plain text\r\n', 'utf16le'))!;
  assert.equal(preview.identified, false); assert.equal(preview.choices.find(c => c.encoding === 'utf-16le')?.text, 'Plain text\r\n');
});
test('malformed declared Unicode is rejected without a lossy legacy fallback', () => {
  for (const bytes of [Buffer.from([255, 254, 65]), Buffer.from([255, 254, 0, 216]), Buffer.from([254, 255, 216, 0]), Buffer.from([239, 187, 191, 255])]) assert.throws(() => inspectTextEncoding(bytes), /safely/);
});
test('formatted documents, UTF-32 and oversized conversion are explicit limitations', () => {
  for (const bytes of [Buffer.from('%PDF-1.7'), Buffer.from('{\\rtf1 text}'), Buffer.from('504b0304', 'hex'), Buffer.from('d0cf11e0a1b11ae1', 'hex'), Buffer.from([255, 254, 0, 0])]) assert.throws(() => inspectTextEncoding(bytes), /not supported/);
  assert.throws(() => inspectTextEncoding(Buffer.alloc(2_000_001, 65)), /2 MB/);
  assert.throws(() => decodeText(Buffer.alloc(800_000, 0x80), 'windows-1252'), /2 MB/);
});
test('legacy LaTeX declarations are visible limitations, while comments and UTF-8 declarations are allowed', () => {
  for (const declaration of ['\\usepackage[latin1]{inputenc}', '\\inputencoding{ansinew}', '\\XeTeXinputencoding "latin1"']) {
    assert.match(inspectTextEncoding(Buffer.from(declaration + '\nCafé', 'latin1'), true)!.choices[0].limitation!, /included files/);
  }
  for (const declaration of ['% \\usepackage[latin1]{inputenc}', '\\usepackage[utf8]{inputenc}']) assert.equal(inspectTextEncoding(Buffer.from(declaration + '\nCafé', 'latin1'), true)!.choices[0].limitation, undefined);
});
test('conversion creates an editable UTF-8 copy and never touches original bytes or timestamps', async t => {
  const f = await fixture(t), before = await fs.stat(f.file), preview = await f.service.prepare(f.file);
  assert(preview); assert.equal(f.service.defaultPath(preview.id), f.target);
  assert.equal(await f.service.save(preview.id, 'windows-1252', f.target), f.target);
  assert.equal(await fs.readFile(f.target, 'utf8'), wording); assert.deepEqual(await fs.readFile(f.file), windows);
  assert.equal((await fs.stat(f.file)).mtimeMs, before.mtimeMs);
  const projects = new ProjectService(path.join(f.root, 'runtime')), project = await projects.open(f.target);
  assert.equal(project.text, wording.replaceAll('\r\n', '\n'));
  await projects.save({ projectId: project.id, text: project.text + 'Edited.\n', review: project.review });
  assert.equal(await fs.readFile(f.target, 'utf8'), wording + 'Edited.\r\n');
  assert.deepEqual(await fs.readFile(f.file), windows);
  assert((await new ProjectService(path.join(f.root, 'runtime')).open(f.target)).text.endsWith('Edited.\n'));
});
test('pre-existing destination, original, hard link and symlink cannot be overwritten', async t => {
  const f = await fixture(t), preview = (await f.service.prepare(f.file))!;
  await fs.writeFile(f.target, 'Keep');
  const link = path.join(f.root, 'linked.txt'), hard = path.join(f.root, 'hard.txt');
  await fs.symlink(f.file, link); await fs.link(f.file, hard);
  for (const target of [f.file, f.target, link, hard]) await assert.rejects(f.service.save(preview.id, 'windows-1252', target), /already exists/);
  assert.equal(await fs.readFile(f.target, 'utf8'), 'Keep'); assert.deepEqual(await fs.readFile(f.file), windows);
  // Remove the extra hard link before recursive fixture cleanup, which may unlink siblings concurrently.
  await fs.unlink(hard);
});
test('stale or replaced original, cancelled preview and unsupported encoding do not create output', async t => {
  const f = await fixture(t), preview = (await f.service.prepare(f.file))!;
  await assert.rejects(f.service.save(preview.id, 'utf-16le', f.target), /Choose an encoding/);
  await fs.writeFile(f.file, Buffer.from('Changed'));
  await assert.rejects(f.service.save(preview.id, 'windows-1252', f.target), /changed/);
  await fs.rename(f.file, f.file + '.kept'); await fs.writeFile(f.file, windows);
  await assert.rejects(f.service.save(preview.id, 'windows-1252', f.target));
  f.service.cancel(preview.id); await assert.rejects(f.service.save(preview.id, 'windows-1252', f.target), /expired/);
  await assert.rejects(fs.stat(f.target), { code: 'ENOENT' });
});
test('legacy LaTeX is not written and extension changes are refused', async t => {
  const f = await fixture(t, Buffer.from('\\usepackage[latin1]{inputenc}\nCafé', 'latin1'), 'paper.tex');
  const preview = (await f.service.prepare(f.file))!;
  await assert.rejects(f.service.save(preview.id, 'windows-1252', f.target), /preamble/);
  const g = await fixture(t), other = (await g.service.prepare(g.file))!;
  await assert.rejects(g.service.save(other.id, 'windows-1252', path.join(g.root, 'copy.tex')), /extension/);
});
const preview: TextImportPreview = { kind: 'text-import', id: 'test', name: 'paper.txt', sourcePath: '/synthetic/paper.txt', identified: false, choices: [{ encoding: 'windows-1252', text: wording }] };
test('cancelled Save As keeps the preview open; Cancel releases the opening gate', async () => {
  const shown: unknown[] = [], cancelled: string[] = [];
  const flow = new TextImportFlow({ saveTextImport: async () => null, cancelTextImport: async id => { cancelled.push(id); } }, p => shown.push(p));
  const opening = flow.request(preview);
  await flow.save('windows-1252'); assert.deepEqual(shown, [preview]);
  await flow.cancel(); assert.equal(await opening, null); assert.deepEqual(shown, [preview, null]); assert.deepEqual(cancelled, ['test']);
});
test('window close waits for a saving import and retains the resulting project switch', async () => {
  let release!: (p: Project) => void, cancels = 0;
  const flow = new TextImportFlow({ saveTextImport: () => new Promise(resolve => { release = resolve; }), cancelTextImport: async () => { cancels++; } }, () => {});
  const opening = flow.request(preview), saving = flow.save('windows-1252'), closing = flow.cancel();
  const project = { id: 'new-project' } as Project; release(project);
  await saving; await closing; assert.equal(await opening, project); assert.equal(cancels, 0);
});
test('window close also releases a failed import without swallowing its visible error', async () => {
  let fail!: (e: Error) => void;
  const flow = new TextImportFlow({ saveTextImport: () => new Promise((_, reject) => { fail = reject; }), cancelTextImport: async () => {} }, () => {});
  const opening = flow.request(preview), saving = flow.save('windows-1252'), closing = flow.cancel();
  fail(new Error('Disk full')); await assert.rejects(saving, /Disk full/); await closing; assert.equal(await opening, null);
});
