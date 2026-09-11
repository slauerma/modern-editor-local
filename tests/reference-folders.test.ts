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
import { digest, readRegularFile } from '../src/main/files.ts';

const pdfModulePath = fileURLToPath(new URL('../node_modules/pdfjs-dist/legacy/build/pdf.mjs', import.meta.url));
async function fixture() {
  const root = path.resolve('.test-runs', 'reference-folders-' + randomUUID());
  const paper = path.join(root, 'paper'); await fs.mkdir(paper, { recursive: true });
  const file = path.join(paper, 'main.tex'); await fs.writeFile(file, 'Original disk draft.');
  const projects = new ProjectService(path.join(root, 'runtime')), p = await projects.open(file);
  const attachments = new AttachmentService({ pdfModulePath });
  const directory = path.join(root, 'runtime', 'references');
  const service = new ReferenceService(projects, directory, attachments);
  return { root, paper, file, projects, p, attachments, directory, service };
}
async function request(f: Awaited<ReturnType<typeof fixture>>, text = 'Unsaved authoritative draft.') {
  const session = await f.service.begin(f.p.id, text, 'review', () => {}); assert(session); return session;
}

test('native-picker reference grants persist per paper; disabled/removed roots never read; sidecars cannot grant access', async () => {
  const f = await fixture(), folder = path.join(f.root, 'references'); await fs.mkdir(folder);
  await fs.writeFile(path.join(folder, 'earlier.tex'), 'Earlier reference version.');
  const state = await f.service.add(f.p.id, [folder]);
  assert.equal(state.roots[0].enabled, true); assert.equal(state.roots[0].available, true);
  assert(!JSON.stringify(state).includes(f.root));
  const reopened = new ReferenceService(f.projects, f.directory, f.attachments);
  assert.deepEqual(await reopened.state(f.p.id), state);
  const other = path.join(f.paper, 'other.tex'); await fs.writeFile(other, 'Another draft.');
  const p2 = await f.projects.open(other);
  assert.deepEqual((await reopened.state(p2.id)).roots, []);
  await fs.writeFile(path.join(f.paper, 'references.json'), JSON.stringify({ path: folder }));
  assert.equal(await reopened.begin(p2.id, 'Another draft.', 'review', () => {}), undefined);
  const p1 = await f.projects.open(f.file);
  await reopened.change(p1.id, state.roots[0].id, false);
  assert.equal(await reopened.begin(p1.id, 'draft', 'review', () => {}), undefined);
  await reopened.change(p1.id, state.roots[0].id, null);
  assert.deepEqual((await reopened.state(p1.id)).roots, []);
  assert.equal(await fs.readFile(path.join(folder, 'earlier.tex'), 'utf8'), 'Earlier reference version.');
});

test('list/search/read stay inside attached scope, current-draft uses unsaved buffer, and source receipts survive reopening', async () => {
  const f = await fixture(); await fs.writeFile(path.join(f.paper, 'reference.txt'), 'First line\nA finite capacity assumption.\nLast line');
  await fs.writeFile(path.join(f.paper, '.hidden.txt'), 'hidden sentinel');
  await fs.writeFile(path.join(f.root, 'outside.txt'), 'outside sentinel');
  await fs.symlink(path.join(f.root, 'outside.txt'), path.join(f.paper, 'linked.txt'));
  await f.service.add(f.p.id, [f.paper]); const session = await request(f);
  const list = await session.call('references_list', {}) as any;
  assert.equal(list.files.filter((x: any) => x.name.includes('main.tex')).length, 1);
  assert(!JSON.stringify(list.files).includes('hidden')); assert(!JSON.stringify(list.files).includes('linked'));
  const reference = list.files.find((x: any) => x.name.endsWith('reference.txt'));
  const draft = await session.call('references_read', { fileId: 'current-draft' }) as any;
  assert.equal(draft.excerpts[0].text, 'Unsaved authoritative draft.');
  const search = await session.call('references_search', { query: 'FINITE CAPACITY', fileId: reference.id }) as any;
  assert.match(search.results[0].excerpts[0].text, /finite capacity/);
  const read = await session.call('references_read', { fileId: reference.id, lines: '2' }) as any;
  assert.equal(read.excerpts[0].text, 'A finite capacity assumption.');
  await assert.rejects(session.call('references_read', { fileId: '../outside.txt' }), /file ID/);
  await assert.rejects(session.call('references_read', { fileId: reference.id, path: f.file }), /Invalid reference arguments/);
  await f.service.finish(session, true);
  const history = await new ReferenceService(f.projects, f.directory, f.attachments).history(f.p.id);
  assert.equal(history.items[0].sources.length, 3); assert.equal(history.items[0].status, 'complete');
  assert(!JSON.stringify(history).includes(f.root)); assert.equal(history.items[0].sources[2].hash, digest(await fs.readFile(path.join(f.paper, 'reference.txt'))));
  assert.equal(await fs.readFile(f.file, 'utf8'), 'Original disk draft.');
});

test('changed file bytes cannot be mixed during one request; fresh requests read updated text', async () => {
  const f = await fixture(), file = path.join(f.root, 'notes.md'); await fs.writeFile(file, 'First version.'); await f.service.add(f.p.id, [file]);
  const session = await request(f), list = await session.call('references_list', {}) as any, id = list.files.find((v: any) => v.name === 'notes.md').id;
  await session.call('references_read', { fileId: id }); await fs.writeFile(file, 'Second version.');
  await assert.rejects(session.call('references_read', { fileId: id }), /changed during this request/);
  await f.service.finish(session, false);
  const next = await request(f), nextList = await next.call('references_list', {}) as any;
  assert.equal((await next.call('references_read', { fileId: nextList.files.find((v: any) => v.name === 'notes.md').id }) as any).excerpts[0].text, 'Second version.');
  await f.service.finish(next, true);
});

test('folder replacement, symlink substitution and revocation stop later reads', async () => {
  for (const mode of ['link', 'replace', 'disable', 'cancel']) {
    const f = await fixture(), folder = path.join(f.root, 'references'); await fs.mkdir(folder); await fs.writeFile(path.join(folder, 'notes.md'), 'Allowed text.');
    const state = await f.service.add(f.p.id, [folder]); const session = await request(f);
    const list = await session.call('references_list', {}) as any, id = list.files.find((v: any) => v.name.endsWith('notes.md')).id;
    if (mode === 'link') { await fs.rename(folder, folder + '-old'); await fs.symlink(folder + '-old', folder); }
    if (mode === 'replace') { await fs.rename(folder, folder + '-old'); await fs.mkdir(folder); await fs.writeFile(path.join(folder, 'notes.md'), 'Other folder.'); }
    if (mode === 'disable') await f.service.change(f.p.id, state.roots[0].id, false);
    if (mode === 'cancel') await session.cancel();
    await assert.rejects(session.call('references_read', { fileId: id }), /changed|cancelled/);
    await f.service.finish(session, false);
  }
});

test('opened-file identity is checked on the descriptor, not merely around a pathname read', async () => {
  const f = await fixture(), stat = await fs.stat(f.file);
  await assert.rejects(readRegularFile(f.file, 100, { dev: stat.dev, ino: stat.ino + 1 }), /changed before/);
  assert.equal((await readRegularFile(f.file, 100, stat)).toString(), 'Original disk draft.');
});

test('late reference read after cancellation returns no excerpt and creates no new source-use entry', async () => {
  const f = await fixture(), file = path.join(f.root, 'notes.txt'); await fs.writeFile(file, 'Allowed.'); await f.service.add(f.p.id, [file]);
  const session = await request(f), list = await session.call('references_list', {}) as any, id = list.files.find((v: any) => v.name === 'notes.txt').id;
  let release!: () => void, started!: () => void;
  const waiting = new Promise<void>(resolve => { started = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  const reader = (session as any).reader, original = reader.readReference.bind(reader);
  reader.readReference = async (...args: any[]) => { const value = await original(...args); started(); await held; return value; };
  const rejected = assert.rejects(session.call('references_read', { fileId: id }), /cancelled/);
  await waiting; await session.cancel(); release(); await rejected;
  await f.service.finish(session, false);
  assert.equal((await f.service.history(f.p.id)).items[0].sources.length, 0);
});

test('review and discussion get bounded reading tools; preamble/feedback do not; actual read receipt retained', async () => {
  const f = await fixture(), file = path.join(f.root, 'reference.txt'); await fs.writeFile(file, 'Reference hypothesis.'); await f.service.add(f.p.id, [file]);
  const service = new CodexService(f.projects, path.join(f.root, 'codex'), f.attachments, f.service);
  let called = 0;
  service.client.run = async (prompt, _schema, _progress, _effort, _fast, reader) => {
    called++; assert(reader); assert(JSON.parse(prompt).availableReferences); assert(!prompt.includes(f.root));
    const files = await reader.call('references_list', {}) as any;
    await reader.call('references_read', { fileId: files.files.find((v: any) => v.name === 'reference.txt').id });
    return { comments: [] };
  };
  await service.review({ projectId: f.p.id, text: 'Current buffer.', from: 0, to: 15, instructions: '' }, () => {});
  assert.equal(called, 1); assert.equal((await f.service.history(f.p.id)).items[0].sources[0].excerpts[0].text, 'Reference hypothesis.');
  service.client.run = async (_p, _s, _pr, _e, _f, reader) => { assert.equal(reader, undefined); return { explanation: '', preamble: '', ending: '', needsInput: null }; };
  await service.preamble({ projectId: f.p.id, text: 'Current buffer.', engine: 'pdflatex' }, () => {});
});

test('missing saved reference is disclosed without preventing a paper save or remaining attached reads', async () => {
  const f = await fixture(), missing = path.join(f.root, 'missing.txt'), good = path.join(f.root, 'good.txt');
  await fs.writeFile(missing, 'Missing later.'); await fs.writeFile(good, 'Good reference.'); await f.service.add(f.p.id, [missing, good]); await fs.unlink(missing);
  const state = await f.service.state(f.p.id); assert.equal(state.roots.filter(r => r.available).length, 1);
  const session = await request(f), list = await session.call('references_list', {}) as any;
  assert(list.notices.some((n: string) => n.includes('unavailable')));
  const id = list.files.find((f: any) => f.name === 'good.txt').id;
  assert.equal((await session.call('references_read', { fileId: id }) as any).excerpts[0].text, 'Good reference.');
  await f.service.finish(session, true);
  await f.projects.save({ projectId: f.p.id, text: 'Saved safely.', review: f.p.review });
  assert.equal(await fs.readFile(f.file, 'utf8'), 'Saved safely.');
});
