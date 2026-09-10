import { documentStatePath } from '../src/main/document-state.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { ProjectService } from '../src/main/project-service.ts';
import { atomicWrite, digest } from '../src/main/files.ts';

const original = '\uFEFFOriginal manuscript\r\n', next = 'Revised manuscript α\n', nextBytes = '\uFEFFRevised manuscript α\r\n';
async function fixture(writer = atomicWrite) {
  const root = path.resolve('.test-runs', 'save-safety-' + randomUUID()), file = path.join(root, 'paper.tex');
  await fs.mkdir(root, { recursive: true }); await fs.writeFile(file, original);
  const service = new ProjectService(path.join(root, 'cache'), writer), project = await service.open(file);
  return { root, file, service, project, input: { projectId: project.id, text: next, review: { ...project.review, activeId: 'remember-review-position' } } };
}
test('every saved source version is retained byte-for-byte, including the pre-edit original', async () => {
  const f = await fixture(); await f.service.save(f.input);
  await f.service.save({ ...f.input, text: 'Third version\n' });
  const backups = path.join(documentStatePath(f.file), 'backups');
  for (const bytes of [original, nextBytes, '\uFEFFThird version\r\n']) assert.equal(await fs.readFile(path.join(backups, `source-${digest(bytes)}.tex`), 'utf8'), bytes);
  assert.equal((await fs.readdir(backups)).length, 3);
});

for (const stage of ['journal', 'backup', 'before-source', 'after-source', 'review', 'session']) {
  test(`injected ${stage} failure preserves a complete source and recoverable saved state`, async () => {
    let file = '';
    const writer: typeof atomicWrite = async (target, bytes, guard) => {
      const match = stage === 'journal' ? target.endsWith('/save.json') : stage === 'backup' ? target.includes('/backups/') : ['before-source', 'after-source'].includes(stage) ? target === file : target.endsWith(`/${stage === 'review' ? 'review' : 'session'}.json`);
      if (match && stage !== 'after-source') throw Object.assign(new Error(`Injected ${stage} storage failure`), { code: 'ENOSPC' });
      await atomicWrite(target, bytes, guard);
      if (match) throw new Error('Injected interruption after the source was atomically replaced');
    };
    const f = await fixture(writer); file = f.file;
    await assert.rejects(f.service.save(f.input), /Injected/);
    const stored = await fs.readFile(f.file, 'utf8');
    const committed = ['after-source', 'review', 'session'].includes(stage);
    assert.equal(stored, committed ? nextBytes : original);
    const reopened = await new ProjectService(path.join(f.root, 'cache')).open(file);
    if (stage === 'journal') assert.equal(reopened.text, 'Original manuscript\n');
    else { assert.equal(reopened.text, next); assert.equal(reopened.review.activeId, 'remember-review-position'); }
    if (committed) {
      for (const bytes of [original, nextBytes]) assert.equal(await fs.readFile(path.join(documentStatePath(f.file), 'backups', `source-${digest(bytes)}.tex`), 'utf8'), bytes);
    }
  });
}
test('an external edit arriving after temporary-file creation is refused at the final save check', async () => {
  let file = '';
  const writer: typeof atomicWrite = (target, bytes, guard) => atomicWrite(target, bytes, target === file ? async () => { await fs.writeFile(file, 'External collaborator version\n'); await guard?.(); } : guard);
  const f = await fixture(writer); file = f.file;
  await assert.rejects(f.service.save(f.input), /another editor/);
  assert.equal(await fs.readFile(file, 'utf8'), 'External collaborator version\n');
  const journal = JSON.parse(await fs.readFile(path.join(documentStatePath(f.file), 'recovery/save.json'), 'utf8'));
  assert.equal(journal.text, next);
  const reopened = await new ProjectService(path.join(f.root, 'cache')).open(file);
  assert.equal(reopened.text, 'External collaborator version\n'); assert(reopened.notices.some(n => n.includes('conflicts')));
});
test('an inconsistent existing source backup stops Save instead of being silently replaced', async () => {
  const f = await fixture(); await f.service.save(f.input);
  const backup = path.join(documentStatePath(f.file), 'backups', `source-${digest(nextBytes)}.tex`);
  await fs.writeFile(backup, 'Damaged backup fixture');
  await assert.rejects(f.service.save({ ...f.input, text: 'Another version\n' }), /backup is inconsistent/);
  assert.equal(await fs.readFile(f.file, 'utf8'), nextBytes);
  assert.equal(await fs.readFile(backup, 'utf8'), 'Damaged backup fixture');
});
test('a read-only manuscript is not replaced even when its parent folder is writable', async () => {
  const f = await fixture(); await fs.chmod(f.file, 0o400);
  await assert.rejects(f.service.save(f.input), /read-only/);
  assert.equal(await fs.readFile(f.file, 'utf8'), original);
  await fs.chmod(f.file, 0o600);
});
test('a Unicode draft exceeding the reopen byte limit stays recoverable without replacing the source', async () => {
  const f = await fixture(), large = 'α'.repeat(1100000);
  await assert.rejects(f.service.save({ ...f.input, text: large }), /2 MB file limit/);
  assert.equal(await fs.readFile(f.file, 'utf8'), original);
  const reopened = await new ProjectService(path.join(f.root, 'cache')).open(f.file);
  assert.equal(reopened.text, large); assert.equal(reopened.recovered, true);
});

for (const stage of ['before-source', 'after-source', 'oversized-Unicode']) {
  for (const change of ['typing', 'review-only']) {
    test(`newer ${change} after a ${stage} Save failure survives flush and repeated reopen`, async () => {
      let file = '';
      const writer: typeof atomicWrite = async (target, bytes, guard) => {
        if (target === file && stage === 'before-source') throw new Error('Injected before-source failure');
        await atomicWrite(target, bytes, guard);
        if (target === file && stage === 'after-source') throw new Error('Injected after-source failure');
      };
      const f = await fixture(writer); file = f.file;
      await f.service.persist({ ...f.input, text: f.project.text, review: f.project.review });
      const attempted = stage === 'oversized-Unicode' ? 'α'.repeat(1100000) : next;
      await assert.rejects(f.service.save({ ...f.input, text: attempted }), /Injected|2 MB file limit/);
      const latest = change === 'typing' ? 'Newer work after Save failed\n' : attempted;
      await f.service.persist({ ...f.input, text: latest, review: { ...f.input.review, activeId: 'newer-review-after-failure' } });
      const sessionFile = path.join(documentStatePath(f.file), 'recovery/session.json');
      assert.equal(JSON.parse(await fs.readFile(sessionFile, 'utf8')).text, latest);
      for (let count = 0; count < 2; count++) {
        const reopened = await new ProjectService(path.join(f.root, 'cache')).open(file);
        assert.equal(reopened.text, latest);
        assert.equal(reopened.review.activeId, 'newer-review-after-failure');
        assert.equal(JSON.parse(await fs.readFile(sessionFile, 'utf8')).text, latest);
        assert.equal(await fs.readFile(file, 'utf8'), stage === 'after-source' ? nextBytes : original);
      }
    });
  }
}

test('legacy recovery with ambiguous ordering retains both drafts and their reviews', async () => {
  const f = await fixture();
  await f.service.persist(f.input);
  const recoveryDir = path.join(documentStatePath(f.file), 'recovery');
  const legacy = { schemaVersion: 1, baseDiskHash: f.project.diskHash, text: 'Other legacy draft\n', review: { ...f.input.review, activeId: 'other-legacy-review' } };
  const session = { ...legacy, text: next, review: f.input.review };
  await fs.writeFile(path.join(recoveryDir, 'session.json'), JSON.stringify(session));
  await fs.writeFile(path.join(recoveryDir, 'save.json'), JSON.stringify(legacy));
  await new ProjectService(path.join(f.root, 'cache')).open(f.file);
  const records = await Promise.all((await fs.readdir(recoveryDir)).filter(n => n.endsWith('.json')).map(async n => JSON.parse(await fs.readFile(path.join(recoveryDir, n), 'utf8'))));
  assert(records.some(r => r.text === next && r.review.activeId === f.input.review.activeId));
  assert(records.some(r => r.text === legacy.text && r.review.activeId === legacy.review.activeId));
  assert.equal(await fs.readFile(f.file, 'utf8'), original);
});

test('another Save attempt retains the previous interrupted draft before replacing its journal', async () => {
  const writer: typeof atomicWrite = async (target, bytes, guard) => {
    if (target.includes('/backups/')) throw new Error('Injected backup failure');
    await atomicWrite(target, bytes, guard);
  };
  const f = await fixture(writer);
  await assert.rejects(f.service.save(f.input), /Injected/);
  await assert.rejects(f.service.save({ ...f.input, text: 'Later Save attempt\n', review: { ...f.input.review, activeId: 'later-attempt' } }), /Injected/);
  const recoveryDir = path.join(documentStatePath(f.file), 'recovery');
  const records = await Promise.all((await fs.readdir(recoveryDir)).filter(n => n.endsWith('.json')).map(async n => JSON.parse(await fs.readFile(path.join(recoveryDir, n), 'utf8'))));
  assert(records.some(r => r.text === next && r.review.activeId === f.input.review.activeId));
  assert(records.some(r => r.text === 'Later Save attempt\n' && r.review.activeId === 'later-attempt'));
  assert.equal(await fs.readFile(f.file, 'utf8'), original);
});

for (const stage of ['journal', 'source']) {
  test(`a real child-process SIGKILL after ${stage} writing recovers without truncating the manuscript`, { timeout: 15000 }, async () => {
    const root = path.resolve('.test-runs', 'abrupt-' + randomUUID()), file = path.join(root, 'paper.tex');
    await fs.mkdir(root, { recursive: true }); await fs.writeFile(file, original);
    const child = spawn(process.execPath, ['--experimental-strip-types', 'tests/fixtures/crash-save.ts', root, stage], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stderr.on('data', bytes => output += bytes.toString());
    const exit = await new Promise<{code: number | null; signal: NodeJS.Signals | null}>((resolve, reject) => {
      const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
    });
    assert.equal(exit.signal, 'SIGKILL', output);
    const draft = '\uFEFFAbrupt-exit draft α\r\n';
    assert.equal(await fs.readFile(file, 'utf8'), stage === 'source' ? draft : original);
    const reopened = await new ProjectService(path.join(root, 'cache')).open(file);
    assert.equal(reopened.text, 'Abrupt-exit draft α\n');
    assert.equal(reopened.review.activeId, 'crash-review-position');
    if (stage === 'source') assert.equal(await fs.readFile(path.join(documentStatePath(file), 'backups', `source-${digest(original)}.tex`), 'utf8'), original);
  });
}
