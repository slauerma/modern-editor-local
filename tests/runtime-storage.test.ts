import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { prepareRuntimeStorage, runtimeLocation, createDraftSource } from '../src/main/runtime-storage.ts';
import { ProjectService } from '../src/main/project-service.ts';

async function fixture() {
  const root = path.resolve('.test-runs', 'runtime-storage-' + randomUUID());
  const old = path.join(root, 'checkout', '.runtime'), current = path.join(root, 'application-support', 'editor-data');
  await fs.mkdir(path.join(old, 'papers', 'draft'), { recursive: true });
  const file = path.join(old, 'papers', 'draft', 'main.tex');
  const source = '\uFEFFOriginal θ manuscript.\r\n'; await fs.writeFile(file, source);
  const projects = new ProjectService(old), project = await projects.open(file);
  await projects.persist({ projectId: project.id, text: 'Unsaved θ revision.\n', review: project.review });
  const id = randomUUID(), build = path.join(old, 'builds', id); await fs.mkdir(build, { recursive: true });
  await fs.writeFile(path.join(build, '.editor-pdf-snapshot.json'), JSON.stringify({ owner: file, schemaVersion: 1 }));
  await fs.writeFile(path.join(build, 'main.pdf'), '%PDF-synthetic migration fixture');
  await fs.mkdir(path.join(old, 'Cache'), { recursive: true }); await fs.writeFile(path.join(old, 'Cache', 'not-persistent'), 'transient Chromium cache');
  return { root, old, current, file, source, id };
}

test('runtime migration copies source, sidecars, recovery and PDF state without moving or editing originals', async () => {
  const f = await fixture(), before = await fs.readFile(path.join(f.old, 'last-project.json'));
  const result = await prepareRuntimeStorage({ directory: f.current, legacyDirectory: f.old });
  const copiedFile = path.join(f.current, 'papers', 'draft', 'main.tex');
  assert.deepEqual(await fs.readFile(f.file), Buffer.from(f.source));
  assert.deepEqual(await fs.readFile(copiedFile), Buffer.from(f.source));
  assert.deepEqual(await fs.readFile(path.join(f.old, 'last-project.json')), before);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.current, 'last-project.json'), 'utf8')).path, copiedFile);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.current, 'builds', f.id, '.editor-pdf-snapshot.json'), 'utf8')).owner, copiedFile);
  const resumed = await new ProjectService(f.current).resume();
  assert.equal(resumed?.text, 'Unsaved θ revision.\n'); assert.equal(resumed?.recovered, true);
  assert.equal(resumed?.path, copiedFile);
  assert.match(result.notices.join(' '), /Originals remain/);
  await assert.rejects(fs.access(path.join(f.current, 'Cache')));
  assert.equal((await prepareRuntimeStorage({ directory: f.current, legacyDirectory: '/does-not-exist' })).notices.length, 0);
});

test('interrupted verified copies can resume, and a completed migration never reimports stale originals', async () => {
  const f = await fixture(); let copied = 0;
  await assert.rejects(prepareRuntimeStorage({ directory: f.current, legacyDirectory: f.old, beforeCopy: async () => { if (++copied === 3) throw new Error('Injected interrupted copy'); } }), /interrupted/);
  await assert.rejects(fs.access(path.join(f.current, '.storage-ready.json')));
  assert.equal(await fs.readFile(f.file, 'utf8'), f.source);
  const result = await prepareRuntimeStorage({ directory: f.current, legacyDirectory: f.old });
  assert.match(result.notices.join(' '), /interrupted/);
  const copiedFile = path.join(f.current, 'papers', 'draft', 'main.tex');
  await fs.writeFile(copiedFile, 'Newer local manuscript');
  await prepareRuntimeStorage({ directory: f.current, legacyDirectory: f.old });
  assert.equal(await fs.readFile(copiedFile, 'utf8'), 'Newer local manuscript');
  assert.equal(await fs.readFile(f.file, 'utf8'), f.source);
});

test('migration destination failure and conflicting files preserve both locations and never publish readiness', async () => {
  const f = await fixture(); await fs.mkdir(path.dirname(f.current), { recursive: true });
  await fs.writeFile(f.current, 'Existing unrelated destination');
  await assert.rejects(prepareRuntimeStorage({ directory: f.current, legacyDirectory: f.old }), /regular storage directory/);
  assert.equal(await fs.readFile(f.current, 'utf8'), 'Existing unrelated destination'); assert.equal(await fs.readFile(f.file, 'utf8'), f.source);
  const second = path.join(f.root, 'other-target');
  await assert.rejects(prepareRuntimeStorage({ directory: second, legacyDirectory: f.old, beforeReady: async () => { throw new Error('Interrupted before publish'); } }), /Interrupted/);
  const target = path.join(second, 'papers', 'draft', 'main.tex'); await fs.writeFile(target, 'Conflicting new manuscript');
  await assert.rejects(prepareRuntimeStorage({ directory: second, legacyDirectory: f.old }), /conflicting destination/);
  assert.equal(await fs.readFile(target, 'utf8'), 'Conflicting new manuscript'); assert.equal(await fs.readFile(f.file, 'utf8'), f.source);
  await assert.rejects(fs.access(path.join(second, '.storage-ready.json')));
});

test('an interrupted partial file stays uncommitted while a fresh verified copy completes on retry', async () => {
  const f = await fixture(); let stopped = false;
  await assert.rejects(prepareRuntimeStorage({ directory: f.current, legacyDirectory: f.old, beforeCopy: async relative => {
    if (!stopped && relative === path.join('papers', 'draft', 'main.tex')) {
      stopped = true;
      await fs.writeFile(path.join(f.current, '.migration-copies', randomUUID() + '.pending'), 'Unfinished copied bytes');
      throw new Error('Simulated process interruption during file copy');
    }
  } }), /interruption/);
  await assert.rejects(fs.access(path.join(f.current, 'papers', 'draft', 'main.tex')));
  const result = await prepareRuntimeStorage({ directory: f.current, legacyDirectory: f.old });
  assert.equal(await fs.readFile(path.join(f.current, 'papers', 'draft', 'main.tex'), 'utf8'), f.source);
  assert.equal(await fs.readFile(f.file, 'utf8'), f.source);
  assert.match(result.notices.join(' '), /uncommitted migration copies/);
});

test('migration refuses a linked resource and detects source or destination changes before completion', async () => {
  const linked = await fixture(); await fs.symlink(linked.file, path.join(linked.old, 'papers', 'linked.tex'));
  await assert.rejects(prepareRuntimeStorage({ directory: linked.current, legacyDirectory: linked.old }), /Linked storage/);
  assert.equal(await fs.readFile(linked.file, 'utf8'), linked.source);
  const changed = await fixture();
  await assert.rejects(prepareRuntimeStorage({ directory: changed.current, legacyDirectory: changed.old, beforeReady: () => fs.writeFile(changed.file, 'External writer change') }), /old editor storage changed/);
  assert.equal(await fs.readFile(changed.file, 'utf8'), 'External writer change');
  await assert.rejects(fs.access(path.join(changed.current, '.storage-ready.json')));
  const target = await fixture();
  await assert.rejects(prepareRuntimeStorage({ directory: target.current, legacyDirectory: target.old, beforeReady: () => fs.writeFile(path.join(target.current, 'papers', 'draft', 'main.tex'), 'Destination changed') }), /new storage changed/);
  assert.equal(await fs.readFile(target.file, 'utf8'), target.source);
});

test('explicit isolated runtime does not inspect or import legacy data', async () => {
  const f = await fixture(), badLegacy = path.join(f.root, 'bad-link');
  await fs.symlink('/does-not-exist', badLegacy);
  await prepareRuntimeStorage({ directory: f.current, legacyDirectory: badLegacy, isolated: true });
  assert.deepEqual((await fs.readdir(f.current)).sort(), ['.runtime-importing.json', '.storage-ready.json']);
  assert.equal(await fs.readFile(f.file, 'utf8'), f.source);
  assert.equal(runtimeLocation('/User/AppSupport'), '/User/AppSupport/editor-data');
  assert.equal(runtimeLocation('/User/AppSupport', '/isolated/test'), '/isolated/test');
  assert.throws(() => runtimeLocation('/User/AppSupport', 'relative'));
});

test('packaged legacy storage can be copied into its separate editor-data child', async () => {
  const f = await fixture(), destination = path.join(f.old, 'editor-data');
  await prepareRuntimeStorage({ directory: destination, legacyDirectory: f.old });
  assert.equal(await fs.readFile(path.join(destination, 'papers', 'draft', 'main.tex'), 'utf8'), f.source);
  assert.equal(await fs.readFile(f.file, 'utf8'), f.source);
});

test('new papers exclusive-create a chosen file outside the checkout and never overwrite source or symlinks', async () => {
  const f = await fixture(), papers = path.join(f.root, 'chosen-papers'); await fs.mkdir(papers);
  const chosen = path.join(papers, 'new.tex');
  assert.equal(await createDraftSource(chosen, path.join(f.root, 'checkout')), chosen);
  assert.equal(await fs.readFile(chosen, 'utf8'), '');
  await fs.writeFile(chosen, 'User paper');
  await assert.rejects(createDraftSource(chosen), /already exists/);
  assert.equal(await fs.readFile(chosen, 'utf8'), 'User paper');
  const linked = path.join(papers, 'linked.tex'); await fs.symlink(f.file, linked);
  await assert.rejects(createDraftSource(linked), /already exists/);
  await assert.rejects(createDraftSource(path.join(f.root, 'checkout', 'new.tex'), path.join(f.root, 'checkout')), /outside the editor installation/);
  assert.equal(await fs.readFile(f.file, 'utf8'), f.source);
});
