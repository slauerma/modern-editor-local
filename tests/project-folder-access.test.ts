import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ProjectService } from '../src/main/project-service.ts';
import { AttachmentService } from '../src/main/attachment-service.ts';
import { ReferenceService } from '../src/main/reference-service.ts';
import { CodexService } from '../src/main/codex-service.ts';
import { commentSchema } from '../src/shared/contracts.ts';
import { digest } from '../src/main/files.ts';

async function fixture(t: any) {
  const root = path.resolve('.test-runs', 'project-access-' + randomUUID()), folder = path.join(root, 'paper');
  await fs.mkdir(folder, { recursive: true });
  const file = path.join(folder, 'main.tex'); await fs.writeFile(file, 'Disk version.');
  const projects = new ProjectService(path.join(root, 'runtime')), paper = await projects.open(file);
  const attachments = new AttachmentService({ pdfModulePath: fileURLToPath(new URL('../node_modules/pdfjs-dist/legacy/build/pdf.mjs', import.meta.url)) });
  const directory = path.join(root, 'runtime/references'), refs = new ReferenceService(projects, directory, attachments);
  t.after(async () => { await refs.stop(); await fs.rm(root, { recursive: true, force: true }); });
  return { root, folder, file, projects, paper, attachments, directory, refs };
}

test('default folder access reaches nested TeX, bibliography, styles and comment JSON without manual grants', async t => {
  const f = await fixture(t), nested = path.join(f.folder, 'one/two/three/four/five'); await fs.mkdir(nested, { recursive: true });
  for (const ext of ['tex', 'bib', 'sty', 'cls', 'json']) await fs.writeFile(path.join(nested, 'related.' + ext), 'Nested ' + ext);
  // More than the manual excerpt picker's 100 files must remain addressable.
  for (let i = 0; i < 110; i++) await fs.writeFile(path.join(f.folder, `note-${i}.txt`), 'Metadata only unless requested.');
  const state = await f.refs.state(f.paper.id);
  assert.deepEqual(state.projectFolder, { name: 'paper', enabled: true, available: true }); assert.deepEqual(state.roots, []);
  const session = await f.refs.begin(f.paper.id, 'Authoritative unsaved version.', 'review', () => {});
  for (const ext of ['tex', 'bib', 'sty', 'cls', 'json']) {
    const list = await session.call('references_list', { query: 'related.' + ext }) as any;
    assert.equal(list.files.length, 1);
    assert.equal((await session.call('references_read', { fileId: list.files[0].id }) as any).excerpts[0].text, 'Nested ' + ext);
  }
  assert.equal((await session.call('references_list', { query: 'note-109.txt' }) as any).files.length, 1);
  assert.equal((await session.call('references_read', { fileId: 'current-draft' }) as any).excerpts[0].text, 'Authoritative unsaved version.');
  assert.equal((await session.call('references_list', { query: 'main.tex' }) as any).files.length, 1);
  assert.equal(await fs.readFile(f.file, 'utf8'), 'Disk version.');
  await f.refs.finish(session, true);
  assert.equal((await f.refs.history(f.paper.id)).items[0].sources.length, 6);
});

test('folder opt-out persists per paper while the whole current draft remains readable without attachments', async t => {
  const f = await fixture(t); await fs.writeFile(path.join(f.folder, 'notes.txt'), 'Private to the folder.');
  await f.refs.setProjectFolder(f.paper.id, false);
  const reopened = new ReferenceService(f.projects, f.directory, f.attachments);
  assert.equal((await reopened.state(f.paper.id)).projectFolder?.enabled, false);
  const text = 'a'.repeat(125000) + '\nLater equation label: flow-s.';
  const session = await reopened.begin(f.paper.id, text, 'reply', () => {});
  assert.deepEqual((await session.call('references_list', {}) as any).files.map((f: any) => f.id), ['current-draft']);
  assert.equal((await session.call('references_read', { fileId: 'current-draft', lines: '2' }) as any).excerpts[0].text, 'Later equation label: flow-s.');
  await reopened.finish(session, true);
  const otherFile = path.join(f.folder, 'other.tex'); await fs.writeFile(otherFile, 'Another paper.');
  const other = await f.projects.open(otherFile);
  assert.equal((await reopened.state(other.id)).projectFolder?.enabled, true);
});

test('automatic folder access excludes parent folders, symlinks, hidden state and generated files', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, 'outside.txt'), 'Outside sentinel.');
  await fs.mkdir(path.join(f.root, 'outside-folder')); await fs.writeFile(path.join(f.root, 'outside-folder/notes.tex'), 'External sentinel.');
  await fs.symlink(path.join(f.root, 'outside.txt'), path.join(f.folder, 'linked.txt'));
  await fs.symlink(path.join(f.root, 'outside-folder'), path.join(f.folder, 'linked-folder'));
  for (const dir of ['.modern-editor', 'node_modules', 'build']) {
    await fs.mkdir(path.join(f.folder, dir), { recursive: true }); await fs.writeFile(path.join(f.folder, dir, 'ignored.tex'), 'Not reference content.');
  }
  await fs.writeFile(path.join(f.folder, '.env'), 'Hidden sentinel.');
  const session = await f.refs.begin(f.paper.id, 'Current.', 'review', () => {}), list = await session.call('references_list', {}) as any;
  assert.deepEqual(list.files.map((f: any) => f.id), ['current-draft']);
  assert(list.notices.length);
  await assert.rejects(session.call('references_read', { fileId: '../outside.txt' }), /file ID/);
  await assert.rejects(session.call('references_read', { fileId: 'current-draft', path: path.join(f.root, 'outside.txt') }), /Invalid reference/);
  await f.refs.finish(session, true);
});

test('turning folder access off revokes an in-flight read; already returned source records stay intact', async t => {
  const f = await fixture(t); await fs.writeFile(path.join(f.folder, 'notes.txt'), 'Allowed while enabled.');
  const session = await f.refs.begin(f.paper.id, 'Current.', 'reply', () => {}), list = await session.call('references_list', {}) as any;
  const id = list.files.find((f: any) => f.name.endsWith('notes.txt')).id;
  await session.call('references_read', { fileId: id });
  await f.refs.setProjectFolder(f.paper.id, false);
  await assert.rejects(session.call('references_read', { fileId: id }), /cancelled|changed/);
  await f.refs.finish(session, false);
  assert.equal((await f.refs.history(f.paper.id)).items[0].sources.length, 1);
  const next = await f.refs.begin(f.paper.id, 'New draft.', 'reply', () => {});
  assert.deepEqual((await next.call('references_list', {}) as any).files.map((f: any) => f.id), ['current-draft']);
  await f.refs.finish(next, true);
});

test('legacy preferences default on; corrupt preferences fail closed for folders and preserve current-draft access', async t => {
  const f = await fixture(t); await fs.mkdir(f.directory, { recursive: true });
  const file = path.join(f.directory, digest(f.file) + '.json');
  await fs.writeFile(file, JSON.stringify({ version: 1, paper: f.file, roots: [] }));
  assert.equal((await f.refs.state(f.paper.id)).projectFolder?.enabled, true);
  await fs.writeFile(file, 'broken preferences');
  const state = await f.refs.state(f.paper.id); assert.equal(state.projectFolder?.enabled, false); assert(state.notices.length);
  const session = await f.refs.begin(f.paper.id, 'Current.', 'reply', () => {});
  assert.deepEqual((await session.call('references_list', {}) as any).files.map((f: any) => f.id), ['current-draft']);
  await assert.rejects(f.refs.setProjectFolder(f.paper.id, true), /could not be read/);
  assert.equal(await fs.readFile(file, 'utf8'), 'broken preferences');
  await f.refs.finish(session, false);
});

test('folder setting and saved reference writes are serialized without losing either choice', async t => {
  const f = await fixture(t), file = path.join(f.root, 'attached.txt'); await fs.writeFile(file, 'Explicit reference.');
  await Promise.all([f.refs.setProjectFolder(f.paper.id, false), f.refs.add(f.paper.id, [file])]);
  const state = await f.refs.state(f.paper.id); assert.equal(state.projectFolder?.enabled, false); assert.equal(state.roots.length, 1);
  const session = await f.refs.begin(f.paper.id, 'Current.', 'reply', () => {}), list = await session.call('references_list', {}) as any;
  assert(list.files.some((f: any) => f.name === 'attached.txt')); await f.refs.finish(session, true);
});

test('ordinary reviews and discussions get current draft/folder tools; quick actions stay local to the supplied passage', async t => {
  const f = await fixture(t), service = new CodexService(f.projects, path.join(f.root, 'codex'), f.attachments, f.refs);
  let kind = 'review';
  service.client.run = async (prompt, _schema, _progress, _effort, _fast, reader) => {
    const context = JSON.parse(prompt);
    if (kind === 'quick') { assert(reader); assert.deepEqual(context.availableReferences.foldersAndFiles, []); assert(!reader.tools.some(t => t.name === 'review_history')); }
    else {
      assert(reader); assert.equal(context.availableReferences.currentDraft.name, 'main.tex');
      assert.equal(context.availableReferences.currentDraft.includesUnsavedEdits, true);
      const draft = await reader.call('references_read', { fileId: 'current-draft' }) as any; assert.equal(draft.excerpts[0].text, 'Unsaved draft.');
    }
    return kind === 'review' ? { comments: [] } : { reply: 'Explanation.', replacement: null, packages: [] };
  };
  await service.review({ projectId: f.paper.id, text: 'Unsaved draft.', from: 0, to: 14, instructions: '' }, () => {});
  const comment = commentSchema.parse({ id: 'one', title: 'A question', explanation: 'Explain.', original: 'Unsaved', replacement: null, from: 0, to: 7, validity: 'current', decision: 'open' });
  kind = 'reply'; await service.reply({ projectId: f.paper.id, text: 'Unsaved draft.', comment, message: 'What is this?' }, () => {});
  kind = 'quick'; await service.reply({ projectId: f.paper.id, text: 'Unsaved draft.', comment, message: '', action: 'quick' }, () => {});
});
