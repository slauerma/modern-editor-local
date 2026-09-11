import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AttachmentService } from '../src/main/attachment-service.ts';
import { ATTACHMENT_LIMITS, attachmentPromptContext, selectedPdfPages, selectedTextLines, type AttachmentPreview } from '../src/shared/attachments.ts';

const project = 'synthetic-paper';
const pdfModulePath = fileURLToPath(new URL('../node_modules/pdfjs-dist/legacy/build/pdf.mjs', import.meta.url));
async function fixture() {
  const root = path.resolve('.test-runs', 'attachments-' + randomUUID());
  await fs.mkdir(root, { recursive: true });
  return { root, service: new AttachmentService({ pdfModulePath }) };
}
function plainPdf(pages: string[], encrypted = false) {
  const objects: string[] = ['<< /Type /Catalog /Pages 2 0 R >>', ''];
  const kids: string[] = [];
  for (const text of pages) {
    const page = objects.length + 1, stream = page + 1;
    kids.push(`${page} 0 R`);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents ${stream} 0 R >>`);
    const content = text ? 'BT /F1 12 Tf 72 720 Td (' + text.replace(/([\\()])/g, '\\$1') + ') Tj ET' : '';
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  }
  objects[1] = `<< /Type /Pages /Count ${pages.length} /Kids [${kids.join(' ')}] >>`;
  if (encrypted) objects.push('<< /Filter /Standard /V 1 /R 2 /Length 40 /O <' + '00'.repeat(32) + '> /U <' + '00'.repeat(32) + '> /P -4 >>');
  let text = '%PDF-1.4\n', offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(text)); text += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(text);
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  text += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${encrypted ? ` /Encrypt ${objects.length} 0 R /ID [<${'00'.repeat(16)}> <${'00'.repeat(16)}>]` : ''} >>\nstartxref\n${xref}\n%%EOF\n`;
  return text;
}

test('on-demand reference search finds later PDF pages and reports partial coverage with a continuation', async () => {
  const { root, service } = await fixture(), file = path.join(root, 'reference.pdf');
  await fs.writeFile(file, plainPdf(Array.from({ length: 25 }, (_, i) => i === 11 || i === 23 ? 'Finite capacity hypothesis.' : 'Ordinary material.')));
  const inventory = await service.grant(project, [file]), id = inventory.items[0].id;
  const search = await service.searchReference(project, id, 'capacity');
  assert.match(search.excerpts[0].location, /page 12 of 25/);
  assert.equal(search.nextPage, 21); assert.match(search.location, /1-20 of 25/);
  const later = await service.searchReference(project, id, 'capacity', search.nextPage);
  assert.match(later.excerpts[0].location, /page 24 of 25/); assert.equal(later.nextPage, undefined);
  const read = await service.readReference(project, { id, pages: '24' });
  assert.equal(read.excerpts[0].text, 'Finite capacity hypothesis.');
  assert.equal(read.hash, search.hash);
  await service.stop();
});

test('folder inventory excludes hidden, generated, sensitive-name and linked paths; selection is explicit', async () => {
  const { root, service } = await fixture(), folder = path.join(root, 'references');
  await fs.mkdir(path.join(folder, 'nested'), { recursive: true });
  await fs.mkdir(path.join(folder, 'node_modules'), { recursive: true });
  for (const [name, text] of [['paper.tex', 'A claim.'], ['notes.md', '# Notes'], ['.private.txt', 'private'], ['credentials.txt', 'private'], ['AGENTS.md', 'instructions'], ['unsupported.js', 'throw Error()'], ['node_modules/readme.md', 'generated'], ['nested/related.txt', 'A reference']]) await fs.writeFile(path.join(folder, name), text);
  await fs.symlink(path.join(folder, 'paper.tex'), path.join(folder, 'linked.tex'));
  await fs.symlink(path.join(folder, 'nested'), path.join(folder, 'linked-folder'));
  const inventory = await service.grant(project, [folder]);
  assert.deepEqual(inventory.items.map(item => item.name), ['references/nested/related.txt', 'references/notes.md', 'references/paper.tex']);
  assert(inventory.notices.some(notice => /excluded/.test(notice)));
  assert(!JSON.stringify(inventory).includes(root));
  const selected = inventory.items.find(item => item.name.endsWith('paper.tex'))!;
  const preview = await service.preview(project, [{ id: selected.id }]);
  assert.deepEqual(preview.excerpts.map(excerpt => excerpt.text), ['A claim.']);
  assert.equal(preview.selections.length, 1);
  assert(!JSON.stringify(attachmentPromptContext(preview)).includes(root));
  assert(!JSON.stringify(attachmentPromptContext(preview)).includes(selected.id));
  await assert.rejects(service.preview(project, [{ id: randomUUID() }]), /no longer selected/);
});

test('previews are immutable, project-scoped, and revalidated against current file bytes', async () => {
  const { root, service } = await fixture(), file = path.join(root, 'reference.md');
  await fs.writeFile(file, 'Line one\r\nOriginal reference\r\nLine three');
  const { items } = await service.grant(project, [file]);
  const preview = await service.preview(project, [{ id: items[0].id, lines: '2' }]);
  assert.equal(preview.excerpts[0].text, 'Original reference');
  assert.equal(preview.excerpts[0].location, 'Text lines 2-2');
  const payload = attachmentPromptContext(preview);
  preview.excerpts[0].text = 'Tampered renderer copy';
  assert.deepEqual(attachmentPromptContext(await service.resolve(project, preview.id)), payload);
  await assert.rejects(service.resolve('another-paper', preview.id), /no longer current/);
  await fs.writeFile(file, 'Line one\r\nChanged reference\r\nLine three');
  await assert.rejects(service.resolve(project, preview.id), /changed after the preview/);
  const renewed = await service.preview(project, [{ id: items[0].id }]);
  assert.match(renewed.excerpts[0].text, /Changed reference/);
  await assert.rejects(service.resolve(project, preview.id), /no longer current/);
  service.remove(project, items[0].id);
  await assert.rejects(service.resolve(project, renewed.id), /no longer current/);
  assert.equal(await fs.readFile(file, 'utf8'), 'Line one\r\nChanged reference\r\nLine three');
});

test('replaced files, newly linked files and removed grants cannot provide unpreviewed context', async () => {
  const { root, service } = await fixture(), file = path.join(root, 'reference.txt'), outside = path.join(root, 'not-selected.txt');
  await fs.writeFile(file, 'Previewed reference'); await fs.writeFile(outside, 'Unselected data');
  const inventory = await service.grant(project, [file]);
  const preview = await service.preview(project, [{ id: inventory.items[0].id }]);
  await fs.rename(file, path.join(root, 'original.txt')); await fs.symlink(outside, file);
  await assert.rejects(service.resolve(project, preview.id), /location changed/);
  await assert.rejects(service.preview(project, [{ id: inventory.items[0].id }]), /location changed/);
  await service.clear(project);
  assert.deepEqual(service.inventory(project), { items: [], notices: [] });
  assert.equal(await fs.readFile(outside, 'utf8'), 'Unselected data');
});

test('choosing an atomically replaced reference again renews its grant without a duplicate', async () => {
  const { root, service } = await fixture(), file = path.join(root, 'reference.md');
  await fs.writeFile(file, 'Old reference');
  const old = await service.grant(project, [file]);
  await service.preview(project, [{ id: old.items[0].id }]);
  await fs.writeFile(path.join(root, 'replacement.md'), 'New reference');
  await fs.rename(path.join(root, 'replacement.md'), file);
  await assert.rejects(service.preview(project, [{ id: old.items[0].id }]), /location changed/);
  const renewed = await service.grant(project, [file]);
  assert.equal(renewed.items.length, 1);
  assert.equal(renewed.items[0].id, old.items[0].id);
  assert.equal((await service.preview(project, [{ id: renewed.items[0].id }])).excerpts[0].text, 'New reference');
});

test('revoking the previous paper context leaves no usable snapshot or grant in the new paper', async () => {
  const { root, service } = await fixture(), file = path.join(root, 'reference.txt');
  await fs.writeFile(file, 'A privately selected reference.');
  const chosen = await service.grant(project, [file]);
  const prepared = await service.preview(project, [{ id: chosen.items[0].id }]);
  const nextProject = 'new-paper';
  // Revocation is intentionally allowed after the caller has switched its current paper.
  await service.clear(project);
  assert.deepEqual(service.inventory(nextProject), { items: [], notices: [] });
  await assert.rejects(service.resolve(project, prepared.id), /no longer current/);
  await assert.rejects(service.resolve(nextProject, prepared.id), /no longer current/);
  await assert.rejects(service.preview(nextProject, [{ id: chosen.items[0].id }]), /no longer selected/);
  const newlyChosen = await service.grant(nextProject, [file]);
  assert.notEqual(newlyChosen.items[0].id, chosen.items[0].id);
  assert.equal((await service.preview(nextProject, [{ id: newlyChosen.items[0].id }])).excerpts[0].text, 'A privately selected reference.');
  assert.equal(await fs.readFile(file, 'utf8'), 'A privately selected reference.');
});

test('long text is bounded and visibly marked; ranges reach later passages', async () => {
  const { root, service } = await fixture(), files: string[] = [];
  for (let i = 0; i < 8; i++) { const file = path.join(root, `reference-${i}.txt`); files.push(file); await fs.writeFile(file, 'a'.repeat(16000) + '\nRequested later passage'); }
  const inventory = await service.grant(project, files);
  const preview = await service.preview(project, inventory.items.map(item => ({ id: item.id })));
  assert.equal(preview.characters, ATTACHMENT_LIMITS.characters);
  assert.equal(preview.excerpts.length, 8);
  assert.equal(preview.notices.filter(notice => notice.includes('continues beyond')).length, 8);
  assert.equal((await service.preview(project, [{ id: inventory.items[0].id, lines: '2' }])).excerpts[0].text, 'Requested later passage');
  await assert.rejects(service.preview(project, [{ id: inventory.items[0].id, lines: '0' }]), /between 1 and 2/);
  await assert.rejects(service.preview(project, [{ id: inventory.items[0].id, pages: '2' }]), /text lines instead/);
});

test('binary, invalid encoding, empty files and size limits produce explicit errors', async () => {
  const { root, service } = await fixture();
  for (const [name, bytes] of [['binary.txt', Buffer.from([0, 1, 2])], ['legacy.txt', Buffer.from([0xff, 0xfe])], ['empty.txt', Buffer.from('')], ['oversized.txt', Buffer.alloc(ATTACHMENT_LIMITS.textBytes + 1)] ] as [string, Buffer][]) await fs.writeFile(path.join(root, name), bytes);
  const inventory = await service.grant(project, [root]);
  assert(!inventory.items.some(item => item.name.endsWith('oversized.txt')));
  assert(inventory.notices.some(notice => /too large/.test(notice)));
  for (const [suffix, pattern] of [['binary.txt', /binary file/], ['legacy.txt', /UTF-8 text copy/], ['empty.txt', /contain no text/]] as const) await assert.rejects(service.preview(project, [{ id: inventory.items.find(item => item.name.endsWith(suffix))!.id }]), pattern);
});

test('folder depth and file-count limits are disclosed rather than promising a complete inventory', async () => {
  const { root, service } = await fixture();
  await fs.mkdir(path.join(root, 'a/b/c/d'), { recursive: true });
  await fs.writeFile(path.join(root, 'a/b/c/visible.txt'), 'Visible');
  await fs.writeFile(path.join(root, 'a/b/c/d/deeper.txt'), 'Outside depth limit');
  const depth = await service.grant(project, [root]);
  assert.equal(depth.items.length, 1); assert(depth.notices.some(notice => /incomplete/.test(notice)));
  const many = path.join(root, 'many'); await fs.mkdir(many);
  await Promise.all(Array.from({ length: 101 }, (_, i) => fs.writeFile(path.join(many, `file-${i}.txt`), 'Text')));
  const count = await service.grant('count', [many]);
  assert.equal(count.items.length, 100); assert(count.notices.some(notice => /incomplete/.test(notice)));
});

test('PDF worker extracts only chosen pages and preserves explicit page citations', async () => {
  const { root, service } = await fixture(), file = path.join(root, 'reference.pdf');
  await fs.writeFile(file, plainPdf(['Unselected first page', 'The selected lemma is increasing.', 'Unselected final page']));
  const { items } = await service.grant(project, [file]);
  const preview = await service.preview(project, [{ id: items[0].id, pages: '2' }]);
  assert.equal(preview.excerpts.length, 1);
  assert.equal(preview.excerpts[0].location, 'PDF page 2 of 3');
  assert.match(preview.excerpts[0].text, /The selected lemma is increasing/);
  assert.doesNotMatch(JSON.stringify(attachmentPromptContext(preview)), /Unselected/);
  assert(preview.notices.some(notice => /only pages 2 of 3/.test(notice)));
  assert(preview.notices.some(notice => /equation symbols/.test(notice)));
  assert.deepEqual(await service.resolve(project, preview.id), preview);
  await assert.rejects(service.preview(project, [{ id: items[0].id, pages: '4' }]), /between 1 and 3/);
});

test('PDFs with scans/no text, password protection, invalid bytes and page overflow are explained', async () => {
  const { root, service } = await fixture();
  for (const [name, content] of [['scan.pdf', plainPdf([''])], ['protected.pdf', plainPdf(['Secret text'], true)], ['invalid.pdf', '<html>Not a PDF</html>']]) await fs.writeFile(path.join(root, name), content);
  const { items } = await service.grant(project, [root]);
  for (const [name, pattern] of [['scan.pdf', /No selectable text/], ['protected.pdf', /requires a password/], ['invalid.pdf', /not a readable PDF/]] as const) await assert.rejects(service.preview(project, [{ id: items.find(item => item.name.endsWith(name))!.id }]), pattern);
  assert.throws(() => selectedPdfPages('1-21', 100), /at most 20/);
  assert.deepEqual(selectedPdfPages('3, 1-3', 5), [1, 2, 3]);
  assert.deepEqual(selectedPdfPages(undefined, 2), [1, 2]);
  assert.throws(() => selectedPdfPages('2-1', 5), /between/);
  assert.throws(() => selectedTextLines('1, 2', 5), /line range/);
});

test('blocked PDF parsing has a real worker deadline and can be stopped', async () => {
  const { root } = await fixture(), file = path.join(root, 'reference.pdf'), module = path.join(root, 'blocked-pdf.mjs');
  await fs.writeFile(file, plainPdf(['A claim']));
  await fs.writeFile(module, 'while (true) {}');
  const service = new AttachmentService({ pdfModulePath: module, pdfTimeoutMs: 80 });
  const { items } = await service.grant(project, [file]);
  const start = Date.now();
  await assert.rejects(service.preview(project, [{ id: items[0].id }]), /took too long/);
  assert(Date.now() - start < 3000);
  const pending = assert.rejects(service.preview(project, [{ id: items[0].id }]), /cancelled or stopped|selection changed/);
  // Wait only until this controlled worker is in flight, then revoke all grants.
  await new Promise(resolve => setTimeout(resolve, 20));
  await service.clear(project);
  await pending;
  await service.stop();
});

const bundled = await build({ entryPoints: ['src/renderer/AttachmentPanel.tsx'], bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react', 'react/jsx-runtime'], loader: { '.css': 'empty' } });
const compiled = { exports: {} as { AttachmentPanel: any } };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
test('attachment UI displays the exact escaped outgoing excerpts and the cloud/context boundary', () => {
  const preview: AttachmentPreview = { id: randomUUID(), selections: [], characters: 20, notices: ['PDF page 2 is an excerpt.'], excerpts: [{ name: 'paper.pdf', location: 'PDF page 2 of 8', text: '<script>Example</script>\nCOMPLETE ENDING' }] };
  const html = renderToStaticMarkup(createElement(compiled.exports.AttachmentPanel, { api: {}, preview, onPreview: () => { throw Error('Rendering must not send a model request'); } }));
  assert.match(html, /Selecting files makes no Codex request/);
  assert.match(html, /sent to your configured Codex service/);
  assert.match(html, /&lt;script&gt;Example&lt;\/script&gt;\nCOMPLETE ENDING/);
  assert.match(html, /PDF page 2 of 8/);
  assert.match(html, /PDF page 2 is an excerpt/);
});
