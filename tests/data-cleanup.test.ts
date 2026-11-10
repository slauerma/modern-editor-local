import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProjectService } from '../src/main/project-service.ts';
import { ProjectCleanup } from '../src/main/project-cleanup.ts';
import { DataCleanup } from '../src/main/data-cleanup.ts';
import { digest, writeJSON } from '../src/main/files.ts';
import { documentStatePath } from '../src/main/document-state.ts';

async function setup(t: any) {
  const root = path.resolve('.test-runs', 'data-cleanup-' + randomUUID()), runtime = path.join(root, 'runtime');
  await fs.mkdir(runtime, { recursive: true });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const service = new ProjectService(runtime), cleanup = new ProjectCleanup(service, runtime), data = new DataCleanup(service, runtime, cleanup);
  const papers: string[] = [];
  for (const name of ['first.txt', 'second.tex']) {
    const file = path.join(root, name); await fs.writeFile(file, 'Synthetic source.');
    const p = await service.open(file); await service.persist({ projectId: p.id, text: p.text, review: p.review });
    await service.close(p.id); papers.push(file);
  }
  const put = async (file: string, value: unknown) => { await fs.mkdir(path.dirname(file), { recursive: true }); await writeJSON(file, value); };
  const build = async (owner: string, old: boolean) => {
    const id = randomUUID(), dir = path.join(runtime, 'builds', id);
    await put(path.join(dir, '.editor-build.json'), { schemaVersion: 1, id, owner });
    await fs.writeFile(path.join(dir, 'main.log'), 'Synthetic build log');
    if (old) for (const name of await fs.readdir(dir)) await fs.utimes(path.join(dir, name), 1, 1);
    return dir;
  };
  return { root, runtime, service, cleanup, data, papers, put, build };
}

test('known papers are inspected without opening or migrating; open work is excluded', async t => {
  const f = await setup(t), p = await f.service.open(f.papers[0]);
  const before = await fs.readFile(path.join(documentStatePath(f.papers[1]), 'review.json'));
  const list = await f.data.list('forget', 7);
  assert.equal(f.service.current?.id, p.id); assert.equal(list.papers.length, 2);
  assert(list.papers.find(i => i.path === p.path)?.current);
  assert(list.papers.find(i => i.path === f.papers[1])!.bytes > 0);
  await assert.rejects(f.data.preview([digest(p.path)], 'forget', 7), /open paper is protected/);
  assert.deepEqual(await fs.readFile(path.join(documentStatePath(f.papers[1]), 'review.json')), before);
});

test('selected papers share one verified archive and keep sources, global settings and other records', async t => {
  const f = await setup(t); await f.put(path.join(f.runtime, 'settings.json'), { model: 'keep' });
  await f.put(path.join(f.runtime, 'usage/requests.json'), { usage: 'keep' });
  await f.data.list('forget', 7);
  const plan = await f.data.preview(f.papers.map(digest), 'forget', 7);
  assert.equal(plan.papers?.length, 2);
  assert(plan.files.some(f => f.path.includes(digest('first.txt')))); assert(plan.files.some(f => f.path.includes(digest('second.tex'))));
  const result = await f.cleanup.confirm('selected-papers', plan.id); assert(!result.warning); assert.equal(result.reset, 2);
  assert.equal((await fs.readdir(path.dirname(plan.archivePath))).length, 1);
  const manifest = JSON.parse(await fs.readFile(path.join(plan.archivePath, 'manifest.json'), 'utf8'));
  for (const file of manifest.files) assert.equal(digest(await fs.readFile(path.join(plan.archivePath, file.archivedAs))), file.hash);
  for (const file of f.papers) { assert.equal(await fs.readFile(file, 'utf8'), 'Synthetic source.'); const p = await f.service.open(file); assert.equal(p.review.comments.length, 0); await f.service.close(p.id); }
  assert.equal(JSON.parse(await fs.readFile(path.join(f.runtime, 'settings.json'), 'utf8')).model, 'keep');
  assert.equal(JSON.parse(await fs.readFile(path.join(f.runtime, 'usage/requests.json'), 'utf8')).usage, 'keep');
});

test('temporary cleanup clears only old complete builds, preserving history and recent logs', async t => {
  const f = await setup(t), old = await f.build(f.papers[0], true), recent = await f.build(f.papers[0], false), other = await f.build(f.papers[1], true);
  const sourceState = path.join(documentStatePath(f.papers[0]), 'review.json'), original = await fs.readFile(sourceState);
  await f.data.list('temporary', 7);
  const plan = await f.data.preview([digest(f.papers[0])], 'temporary', 7);
  assert.equal(plan.files.length, 2); assert(plan.files.every(i => i.path.startsWith(old + '/')));
  const result = await f.cleanup.confirm('selected-papers', plan.id); assert(!result.warning); assert.equal(result.reset, 0);
  await assert.rejects(fs.stat(old), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(recent, 'main.log'), 'utf8'), 'Synthetic build log');
  assert((await fs.stat(other)).isDirectory()); assert.deepEqual(await fs.readFile(sourceState), original);
});

test('a changed paper blocks the entire batch before any removal', async t => {
  const f = await setup(t); await f.data.list('forget', 7);
  const plan = await f.data.preview(f.papers.map(digest), 'forget', 7);
  await fs.appendFile(f.papers[1], ' External change.');
  await assert.rejects(f.cleanup.confirm('selected-papers', plan.id), /No editing files were removed/);
  for (const file of f.papers) assert((await fs.stat(path.join(documentStatePath(file), 'review.json'))).isFile());
});

test('unsaved recovery blocks forgetting but remains intact when clearing old build logs', async t => {
  const f = await setup(t), p = await f.service.open(f.papers[0]);
  await f.service.persist({ projectId: p.id, text: 'Unsaved writing.', review: p.review }); await f.service.close(p.id);
  const recovery = path.join(documentStatePath(p.path), 'recovery/session.json'), bytes = await fs.readFile(recovery);
  const list = await f.data.list('forget', 7); assert.match(list.papers.find(i => i.path === p.path)!.problem!, /Save the current draft/);
  await assert.rejects(f.data.preview([digest(p.path)], 'forget', 7), /Save the current draft/);
  await f.build(p.path, true); const plan = await f.data.preview([digest(p.path)], 'temporary', 7);
  await f.cleanup.confirm('selected-papers', plan.id); assert.deepEqual(await fs.readFile(recovery), bytes);
});

test('linked or mismatched records are never cleared and unknown selections are rejected', async t => {
  const f = await setup(t), chat = path.join(f.runtime, 'help-chats', digest(f.papers[0]) + '.json');
  await f.put(chat, { owner: f.papers[1], messages: ['wrong owner'] });
  const list = await f.data.list('forget', 7); assert.match(list.papers.find(p => p.path === f.papers[0])!.problem!, /ownership/);
  await assert.rejects(f.data.preview([digest('not-known')], 'forget', 7), /Refresh the paper list/);
  await assert.rejects(f.data.preview([digest(f.papers[0])], 'forget', 7), /ownership/);
  assert((await fs.stat(chat)).isFile());
});
