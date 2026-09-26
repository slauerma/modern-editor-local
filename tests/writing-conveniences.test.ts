import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ProjectService } from '../src/main/project-service.ts';
import { ReferenceService } from '../src/main/reference-service.ts';
import { AttachmentService } from '../src/main/attachment-service.ts';
import { CompileService } from '../src/main/compile-service.ts';
import { ProjectFilesService } from '../src/main/project-files.ts';
import { HelpChat } from '../src/main/help-chat.ts';
import { CodexClient } from '../src/main/codex-client.ts';
import { digest } from '../src/main/files.ts';
import { PASTED_CONTEXT_BYTES } from '../src/shared/references.ts';
import { commentSchema, defaultWorkspace } from '../src/shared/contracts.ts';
import { reviewContext, replyContext } from '../src/shared/codex-context.ts';
import { feedbackContext } from '../src/shared/feedback.ts';
import { chatInputSchema, chatContext } from '../src/shared/help-chat.ts';
import { paperGuidance, defaultEditPreferences } from '../src/shared/paper-guidance.ts';

async function fixture(t: TestContext) {
  const root = path.resolve('.test-runs', 'conveniences-' + randomUUID());
  await fs.mkdir(root, { recursive: true });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'paper.txt'), text = 'An allocation is feasible.';
  await fs.writeFile(file, text);
  const runtime = path.join(root, 'runtime'), projects = new ProjectService(runtime), paper = await projects.open(file);
  const attachments = new AttachmentService({ pdfModulePath: fileURLToPath(new URL('../node_modules/pdfjs-dist/legacy/build/pdf.mjs', import.meta.url)) });
  const references = new ReferenceService(projects, path.join(runtime, 'references'), attachments);
  return { root, file, text, runtime, projects, paper, attachments, references };
}
const help = { version: 'test', platform: 'test', osVersion: 'test', documentation: 'Synthetic editor help.' };

test('large pasted context preserves exact Unicode, BOM, CRLF and final whitespace, and tools reach its last passage', async t => {
  const f = await fixture(t), text = '\uFEFF  Opening\r\n' + 'A long reference paragraph.\r\n'.repeat(42000) + 'Unique final claim Ω.  \r\n';
  const state = await f.references.paste(f.paper.id, { name: 'Reference notes', text });
  assert.equal(state.roots[0].kind, 'paste'); assert(state.roots[0].enabled);
  assert.equal(state.roots[0].bytes, Buffer.byteLength(text));
  const disk = (await f.references.files(f.paper.id)).find(x => x.path.endsWith('.txt'))!;
  assert.deepEqual(await fs.readFile(disk.path), Buffer.from(text));
  const reopened = new ReferenceService(f.projects, f.references.directory, f.attachments);
  assert.equal((await reopened.inspectPaste(f.paper.id, state.roots[0].id)).text, text);
  const session = await reopened.begin(f.paper.id, f.text, 'review', () => {}); assert(session);
  const list = await session.call('references_list', {}) as any;
  const id = list.files.find((x: any) => x.name === 'Reference notes').id;
  const match = await session.call('references_search', { fileId: id, query: 'Unique final claim' }) as any;
  assert.match(match.results[0].excerpts[0].text, /Unique final claim Ω/);
  const final = await session.call('references_read', { fileId: id, lines: '42002-42003' }) as any;
  assert.equal(final.excerpts[0].text, 'Unique final claim Ω.  \r\n');
  assert(!JSON.stringify(list).includes(f.root));
  await reopened.finish(session, true);
  assert.equal(await fs.readFile(f.file, 'utf8'), f.text);
  assert.equal((await reopened.history(f.paper.id)).items[0].sources.length, 2);
});

test('pasted long-line continuation, rename, disable and remove stay local and scoped to the paper', async t => {
  const f = await fixture(t), text = 'x'.repeat(16000) + ' final sentinel';
  const saved = await f.references.paste(f.paper.id, { name: 'Long line', text }), id = saved.roots[0].id;
  await f.references.renamePaste(f.paper.id, id, 'Renamed context');
  assert.deepEqual(await f.references.inspectPaste(f.paper.id, id), { name: 'Renamed context', text });
  const session = await f.references.begin(f.paper.id, f.text, 'reply', () => {}); assert(session);
  let offset = 0, joined = '';
  do {
    const result = await session.call('references_read', { fileId: 'paste-' + id, offset }) as any;
    joined += result.excerpts[0].text; offset = result.nextOffset;
  } while (offset !== null);
  assert.equal(joined, text);
  await f.references.change(f.paper.id, id, false);
  await assert.rejects(session.call('references_read', { fileId: 'paste-' + id }), /cancelled|changed/);
  await f.references.finish(session, false);
  assert.equal(await f.references.begin(f.paper.id, f.text, 'reply', () => {}), undefined);
  const other = path.join(f.root, 'other.txt'); await fs.writeFile(other, f.text);
  const next = await f.projects.open(other);
  assert.deepEqual((await f.references.state(next.id)).roots, []);
  await assert.rejects(f.references.inspectPaste(next.id, id), /no longer attached/);
  const previous = await f.projects.open(f.file);
  assert.equal((await f.references.inspectPaste(previous.id, id)).text, text);
  const disk = (await f.references.files(previous.id)).find(x => x.path.endsWith('.txt'))!.path;
  await f.references.change(previous.id, id, null);
  assert.deepEqual((await f.references.state(previous.id)).roots, []);
  await assert.rejects(fs.stat(disk), { code: 'ENOENT' });
  assert.equal(await fs.readFile(f.file, 'utf8'), f.text);
});

test('oversized or invalid pasted text is refused without replacing saved context', async t => {
  const f = await fixture(t); const saved = await f.references.paste(f.paper.id, { name: 'Keep', text: 'Kept verbatim.' });
  for (const text of ['Ω'.repeat(PASTED_CONTEXT_BYTES / 2 + 1), 'bad\0text', '\ud800', '  ']) {
    await assert.rejects(f.references.paste(f.paper.id, { name: 'Rejected', text }));
    assert.deepEqual((await f.references.state(f.paper.id)).roots, saved.roots);
  }
  assert.equal((await f.references.inspectPaste(f.paper.id, saved.roots[0].id)).text, 'Kept verbatim.');
});

test('paper guidance and Classic workspace survive reopen and are shared across all paper request builders', async t => {
  const f = await fixture(t), instructions = 'Keep the established notation.', preferences = { localEditsOnly: false, preserveVoice: true };
  await f.projects.setPaperGuidance(f.paper.id, instructions, preferences);
  await f.projects.setEngine(f.paper.id, 'xelatex'); await f.projects.setEffort(f.paper.id, 'high');
  await f.projects.setWorkspace(f.paper.id, { ...defaultWorkspace(), classic: true, classicSurface: 'pdf', layout: 'three', pdf: { ...defaultWorkspace().pdf, page: 3 } });
  const fresh = await new ProjectService(f.runtime).open(f.file);
  assert.deepEqual(fresh.editPreferences, preferences); assert.equal(fresh.paperInstructions, instructions);
  assert(fresh.workspace?.classic); assert.equal(fresh.workspace?.classicSurface, 'pdf'); assert.equal(fresh.workspace?.layout, 'three'); assert.equal(fresh.workspace?.pdf.page, 3);
  const comment = commentSchema.parse({ id: 'c1', title: 'Clarity', original: f.text, replacement: null, explanation: 'Explain.' });
  const chat = chatInputSchema.parse({ projectId: f.paper.id, source: f.text, from: 0, to: f.text.length, paper: 'draft', editorState: { pdf: 'none', unsaved: false, error: '', compilation: '' }, message: 'Explain this.' });
  const payloads = [
    reviewContext({ projectId: f.paper.id, text: f.text, from: 0, to: f.text.length, instructions: '' }, instructions, undefined, preferences),
    replyContext({ projectId: f.paper.id, text: f.text, comment, message: 'Why?' }, instructions, undefined, preferences),
    feedbackContext({ projectId: f.paper.id, text: f.text, label: 'Notes', feedback: 'Check clarity.' }, instructions, preferences),
    chatContext(chat, help, [], instructions, preferences).context
  ];
  for (const payload of payloads) for (const [key,value] of Object.entries(paperGuidance(instructions, preferences))) assert.equal((payload as any)[key], value);
  assert(payloads.every(p => !('editPolicy' in p)));
  const editorHelp = chatContext({ ...chat, projectId: null, paper: 'none', source: '', from: 0, to: 0 }, help, [], instructions, preferences).context;
  assert(!('paperInstructions' in editorHelp)); assert(!('stylePolicy' in editorHelp));
  const other = path.join(f.root, 'other.txt'); await fs.writeFile(other, 'Other paper.');
  const p2 = await f.projects.open(other);
  assert.equal(p2.paperInstructions, ''); assert.deepEqual(p2.editPreferences ?? defaultEditPreferences(), defaultEditPreferences());
  assert.equal(await fs.readFile(f.file, 'utf8'), f.text);
});

test('saving new guidance invalidates an unsent chat preview before model use; new preview uses new guidance', async t => {
  const f = await fixture(t), client = new CodexClient(path.join(f.root, 'codex'));
  let calls = 0;
  client.run = async prompt => { calls++; const value = JSON.parse(prompt); assert.equal(value.paperInstructions, 'New guidance.'); assert(!('editPolicy' in value)); return { reply: 'Synthetic response.', suggestion: null }; };
  const service = new HelpChat(f.projects, client, path.join(f.runtime, 'help-chats'), async () => help);
  const input = chatInputSchema.parse({ projectId: f.paper.id, source: f.text, from: 0, to: 0, paper: 'draft', editorState: { pdf: 'none', unsaved: false, error: '', compilation: '' }, message: 'Explain.' });
  const stale = await service.preview(input);
  await f.projects.setPaperGuidance(f.paper.id, 'New guidance.', { localEditsOnly: false, preserveVoice: true });
  await assert.rejects(service.send({ projectId: f.paper.id }, stale.id, () => {}), /guidance changed/);
  assert.equal(calls, 0); assert.equal((await service.state({ projectId: f.paper.id })).turns.length, 0);
  const fresh = await service.preview(input); await service.send({ projectId: f.paper.id }, fresh.id, () => {});
  assert.equal(calls, 1); assert.equal(await fs.readFile(f.file, 'utf8'), f.text);
});

test('Files inventory and PDF export use exact paper-scoped artifacts and survive unavailable context metadata', async t => {
  const f = await fixture(t), compiler = new CompileService(f.projects, path.join(f.runtime, 'builds'));
  const pdfPath = path.join(f.root, 'captured.pdf'), bytes = Buffer.from('%PDF-1.4\nSynthetic immutable export\n%%EOF');
  await fs.writeFile(pdfPath, bytes);
  (compiler as any).records.set('build', { projectId: f.paper.id, pdf: pdfPath, build: { id: 'build', success: true, purpose: 'proposal', sourceHash: digest('Candidate source') } });
  const snapshot = await compiler.exportPdf(f.paper.id, 'build');
  assert.deepEqual(Buffer.from(snapshot.bytes), bytes); assert.equal(snapshot.purpose, 'proposal'); assert.equal(snapshot.sourceHash, digest('Candidate source'));
  await assert.rejects(compiler.exportPdf('other-project', 'build'), /no longer open/);
  await f.references.paste(f.paper.id, { name: 'Attached note', text: 'Private context.' });
  const service = new ProjectFilesService(f.projects, compiler, f.references, path.join(f.runtime, 'help-chats'));
  const listed = await service.list(f.paper.id);
  const source = listed.items.find(i => i.path === f.file)!; assert(source); assert(listed.items.some(i => i.name === 'Attached note'));
  assert.equal(await service.resolve(f.paper.id, source.id), f.file);
  await assert.rejects(service.resolve(f.paper.id, f.file), /Refresh/);
  await assert.rejects(service.resolve('other-project', source.id), /Refresh/);
  await fs.writeFile(path.join(f.references.directory, digest(f.file) + '.json'), '{broken');
  const partial = await service.list(f.paper.id);
  assert(partial.items.some(i => i.path === f.file)); assert(partial.notices.some(n => n.includes('Context')));
  assert.equal(await fs.readFile(f.file, 'utf8'), f.text);
});
