import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProjectService } from '../src/main/project-service.ts';
import { documentStatePath, prepareDocumentState } from '../src/main/document-state.ts';
import { atomicWrite, digest } from '../src/main/files.ts';
import { inspectSourceRecovery } from '../src/main/source-export.ts';

async function fixture() {
  const root = path.resolve('.test-runs', 'document-state-' + randomUUID());
  await fs.mkdir(root, { recursive: true });
  const a = path.join(root, 'first.tex'), b = path.join(root, 'first-renamed.tex');
  await fs.writeFile(a, 'First source\n'); await fs.writeFile(b, 'Second source\n');
  const service = new ProjectService(path.join(root, 'cache'));
  const p = await service.open(a);
  return { root, a, b, service, p };
}
test('two roots in one folder retain separate comments, drafts, settings, baselines and source backups', async () => {
  const f = await fixture();
  await f.service.setEngine(f.p.id, 'lualatex'); await f.service.setEffort(f.p.id, 'high');
  await f.service.pinBaseline(f.p.id, 'First original', f.p.text);
  await f.service.persist({ projectId: f.p.id, text: 'First unsaved', review: { ...f.p.review, activeId: 'first-review' } });
  const second = await f.service.open(f.b);
  assert.equal(second.engine, 'pdflatex'); assert.equal(second.effort, 'medium'); assert.equal(second.baseline, null); assert.equal(second.review.activeId, null);
  await f.service.pinBaseline(second.id, 'Second original', second.text);
  await f.service.setEffort(second.id, 'low');
  await f.service.save({ projectId: second.id, text: 'Second saved', review: { ...second.review, activeId: 'second-review' } });
  const first = await f.service.open(f.a);
  assert.equal(first.text, 'First unsaved'); assert.equal(first.review.activeId, 'first-review');
  assert.equal(first.engine, 'lualatex'); assert.equal(first.effort, 'high'); assert.equal(first.baseline?.name, 'First original');
  assert.equal(await fs.readFile(f.a, 'utf8'), 'First source\n');
  const reopened = await f.service.open(f.b);
  assert.equal(reopened.text, 'Second saved'); assert.equal(reopened.effort, 'low'); assert.equal(reopened.review.activeId, 'second-review'); assert.equal(reopened.baseline?.text, 'Second source\n');
  assert.equal((await fs.readdir(path.join(documentStatePath(f.b), 'backups'))).length, 2);
  await assert.rejects(fs.stat(path.join(documentStatePath(f.a), 'backups')), { code: 'ENOENT' });
});
test('legacy records migrate only to their owner, remain byte-exact, and never replay over newer work', async () => {
  const f = await fixture(), legacy = path.join(f.root, '.modern-editor');
  await fs.mkdir(path.join(legacy, 'recovery'), { recursive: true });
  const files = {
    'review.json': JSON.stringify(f.p.review),
    'settings.json': JSON.stringify({ rootFile: f.p.name, engine: 'xelatex' }),
    'recovery/session.json': JSON.stringify({ schemaVersion: 1, revision: 4, baseDiskHash: f.p.diskHash, text: 'Recovered first draft', review: f.p.review })
  };
  for (const [name, text] of Object.entries(files)) await fs.writeFile(path.join(legacy, name), text);
  const sibling = await f.service.open(f.b); assert.equal(sibling.text, 'Second source\n');
  await f.service.persist({ projectId: sibling.id, text: 'Sibling draft', review: sibling.review });
  const migrated = await f.service.open(f.a);
  assert.equal(migrated.text, 'Recovered first draft'); assert.equal(migrated.engine, 'xelatex');
  await f.service.persist({ projectId: migrated.id, text: 'Newer first draft', review: migrated.review });
  assert.equal((await f.service.open(f.a)).text, 'Newer first draft');
  for (const [name, text] of Object.entries(files)) assert.equal(await fs.readFile(path.join(legacy, name), 'utf8'), text);
  const recovery = await inspectSourceRecovery(f.a);
  assert(recovery.choices.some(c => c.text === 'Newer first draft')); assert(recovery.choices.some(c => c.text === 'Recovered first draft'));
  assert.equal((await f.service.open(f.b)).text, 'Sibling draft');
});
test('a stopped migration publishes no partial state; retry copies all records and keeps the abandoned staging data', async () => {
  const f = await fixture(), legacy = path.join(f.root, '.modern-editor');
  await fs.mkdir(legacy); await fs.writeFile(path.join(legacy, 'review.json'), JSON.stringify(f.p.review));
  await assert.rejects(prepareDocumentState(f.a, true, [], async (file, content) => {
    if (file.endsWith('document.json')) throw new Error('Injected full disk');
    await atomicWrite(file, content);
  }), /full disk/);
  await assert.rejects(fs.stat(documentStatePath(f.a)), { code: 'ENOENT' });
  const reopened = await f.service.open(f.a); assert.equal(reopened.review.rootFile, f.p.name);
  assert((await fs.readdir(path.dirname(documentStatePath(f.a)))).some(n => n.startsWith('.migrate-')));
  assert.equal(await fs.readFile(f.a, 'utf8'), 'First source\n');
});
test('corrupt or unrelated legacy data cannot block a sibling; corrupt owned state is preserved and cannot affect the other root', async () => {
  const f = await fixture(), legacy = path.join(f.root, '.modern-editor');
  await fs.mkdir(legacy); const raw = '{unreadable legacy review'; await fs.writeFile(path.join(legacy, 'review.json'), raw);
  const second = await f.service.open(f.b); assert.equal(second.review.comments.length, 0); assert(second.notices.some(n => n.includes('could not be associated')));
  const secondHome = await f.service.stateDirectory(second.id); await fs.writeFile(path.join(secondHome, 'review.json'), 'invalid');
  await assert.rejects(f.service.open(f.b));
  const first = await f.service.open(f.a); assert.equal(first.text, 'First source\n');
  assert.equal(await fs.readFile(path.join(legacy, 'review.json'), 'utf8'), raw);
  assert.equal(await fs.readFile(path.join(secondHome, 'review.json'), 'utf8'), 'invalid');
});
test('a linked document state or its parent cannot redirect recovery writes', async () => {
  const f = await fixture(), target = path.join(f.root, 'elsewhere'); await fs.mkdir(target);
  const legacy = path.join(f.root, '.modern-editor'); await fs.mkdir(legacy);
  await fs.symlink(target, path.join(legacy, 'documents'));
  await assert.rejects(f.service.persist({ projectId: f.p.id, text: 'Draft', review: f.p.review }), /regular directory/);
  assert.deepEqual(await fs.readdir(target), []);
});
test('an older-file baseline retains exact UTF-8 contents and remains fixed through Save, file replacement and reopen', async () => {
  const f = await fixture(), old = '\uFEFFOriginal θ\r\n\\alpha_1\r\n'; await fs.writeFile(f.b, old);
  const pinned = await f.service.baselineFromFile(f.p.id, f.b);
  assert.equal(pinned.text, old); assert.equal(pinned.sourceHash, digest(old));
  await fs.writeFile(f.b, 'The old file changed'); await fs.rename(f.b, f.b + '.moved');
  await f.service.save({ projectId: f.p.id, text: 'Revised current', review: f.p.review });
  const reopened = await f.service.open(f.a); assert.deepEqual(reopened.baseline, pinned);
  await f.service.pinBaseline(reopened.id, 'New chosen version', reopened.text);
  const archive = path.join(documentStatePath(f.a), 'comparison-versions');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(archive, (await fs.readdir(archive))[0]), 'utf8')), pinned);
  assert.equal(await fs.readFile(f.a, 'utf8'), 'Revised current');
});
test('a baseline write failure preserves the pinned original and the draft; invalid or oversized inputs cannot replace it', async () => {
  const f = await fixture(); const baseline = await f.service.pinBaseline(f.p.id, 'Original', f.p.text);
  await f.service.persist({ projectId: f.p.id, text: 'Unsaved work', review: f.p.review });
  const broken = new ProjectService(path.join(f.root, 'cache'), async (file, bytes, guard) => {
    if (file.endsWith('/baseline.json')) throw new Error('Injected baseline write failure');
    await atomicWrite(file, bytes, guard);
  });
  const p = await broken.open(f.a);
  await assert.rejects(broken.pinBaseline(p.id, 'Later', 'Later text'), /Injected/);
  await assert.rejects(f.service.pinBaseline(f.p.id, '', 'Text'));
  await assert.rejects(f.service.pinBaseline(f.p.id, 'Oversized', 'θ'.repeat(1100000)), /2 MB/);
  const reopened = await f.service.open(f.a); assert.deepEqual(reopened.baseline, baseline); assert.equal(reopened.text, 'Unsaved work');
  assert.equal(await fs.readFile(f.a, 'utf8'), 'First source\n');
});
