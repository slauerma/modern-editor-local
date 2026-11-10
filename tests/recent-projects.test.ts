import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { RecentProjectStore } from '../src/main/recent-projects.ts';
import { ProjectService } from '../src/main/project-service.ts';
import { commentSchema } from '../src/shared/contracts.ts';

async function fixture(t: TestContext) {
  const root = path.resolve('.test-runs', 'recent-projects-' + randomUUID());
  await fs.mkdir(root, { recursive: true }); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const runtime = path.join(root, 'runtime'); await fs.mkdir(runtime);
  return { root, runtime, store: new RecentProjectStore(runtime) };
}
test('recent projects are bounded, deduplicated and ordered by most recent opening', async t => {
  const f = await fixture(t);
  await Promise.all(Array.from({ length: 34 }, (_, n) => f.store.record(path.join(f.root, `${n}.txt`))));
  let state = await f.store.list(); assert.equal(state.items.length, 30); assert.equal(state.items[0].name, '33.txt');
  await f.store.record(path.join(f.root, '12.txt')); state = await f.store.list();
  assert.equal(state.items.length, 30); assert.equal(state.items[0].name, '12.txt'); assert.equal(state.items.filter(i => i.name === '12.txt').length, 1);
});
test('closing and continuing a project restores recovery and rejected reasons without saving source', async t => {
  const f = await fixture(t), file = path.join(f.root, 'paper.txt'); await fs.writeFile(file, 'The proof are short.');
  const service = new ProjectService(f.runtime), project = await service.open(file);
  const review = { ...project.review, comments: [commentSchema.parse({ id: 'reason', title: 'Wording', original: 'proof are', replacement: 'proof is', explanation: 'Agreement', decision: 'dismissed', rejectionReason: 'Intentional quotation.' })] };
  await service.persist({ projectId: project.id, text: 'Unsaved addition. ' + project.text, review }); await service.close(project.id);
  assert.equal(await service.resume(), null);
  const recent = (await new RecentProjectStore(f.runtime).list()).items[0]; assert.equal(recent.path, file); assert(recent.available);
  const reopened = await new ProjectService(f.runtime).open(await f.store.resolve(recent.id));
  assert.match(reopened.text, /^Unsaved addition/); assert.equal(reopened.review.comments[0].rejectionReason, 'Intentional quotation.');
  assert.equal(await fs.readFile(file, 'utf8'), 'The proof are short.');
});
test('missing and linked projects stay listed but cannot be opened through their recent entry', async t => {
  const f = await fixture(t), file = path.join(f.root, 'paper.txt'), other = path.join(f.root, 'other.txt');
  await fs.writeFile(file, 'Original'); await f.store.record(file); const id = (await f.store.list()).items[0].id;
  await fs.rename(file, other); assert.equal((await f.store.list()).items[0].available, false); await assert.rejects(f.store.resolve(id), /unavailable/);
  await fs.symlink(other, file); assert.equal((await f.store.list()).items[0].available, false); await assert.rejects(f.store.resolve(id), /unavailable/);
  await assert.rejects(f.store.resolve('unregistered'), /unavailable/);
});
test('a corrupt recent list is preserved and does not prevent opening a paper', async t => {
  const f = await fixture(t), file = path.join(f.root, 'paper.txt'), registry = path.join(f.runtime, 'recent-projects.json');
  await fs.writeFile(file, 'Original'); await fs.writeFile(registry, '{broken');
  await assert.rejects(f.store.list(), /could not be read/);
  const opened = await new ProjectService(f.runtime).open(file); assert.match(opened.notices.join(' '), /recent-project list/);
  assert.equal(await fs.readFile(registry, 'utf8'), '{broken');
});
test('the previous single resume record is available without scanning source directories', async t => {
  const f = await fixture(t), file = path.join(f.root, 'old.txt'); await fs.writeFile(file, 'Previous work');
  await fs.writeFile(path.join(f.runtime, 'last-project.json'), JSON.stringify({ path: file }));
  const items = (await f.store.list()).items; assert.equal(items.length, 1); assert.equal(await f.store.resolve(items[0].id), file);
});
