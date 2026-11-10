import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProjectService } from '../src/main/project-service.ts';
import { ProjectCleanup } from '../src/main/project-cleanup.ts';
import { documentStatePath } from '../src/main/document-state.ts';
import { digest, writeJSON } from '../src/main/files.ts';

async function fixture(t: any, extension = 'txt') {
  const root = path.resolve('.test-runs', 'project-cleanup-' + randomUUID()), paper = path.join(root, 'paper'), runtime = path.join(root, 'runtime');
  await fs.mkdir(paper, { recursive: true }); await fs.mkdir(runtime);
  const file = path.join(paper, 'main.' + extension), text = 'A short synthetic draft.';
  await fs.writeFile(file, text);
  const service = new ProjectService(runtime), project = await service.open(file), home = await service.stateDirectory(project.id);
  await service.persist({ projectId: project.id, text, review: project.review });
  const put = async (name: string, data: unknown) => { await fs.mkdir(path.dirname(name), { recursive: true }); await writeJSON(name, data); };
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, paper, runtime, file, text, service, project, home, put, cleanup: new ProjectCleanup(service, runtime) };
}

test('preview is read-only and complete; archive verified paper data while preserving source, exports, other papers and unknown files', async t => {
  const f = await fixture(t), key = digest(f.file), id = f.project.id;
  const other = path.join(f.paper, 'other.tex'); await fs.writeFile(other, 'Other source');
  await f.put(path.join(documentStatePath(other), 'document.json'), { schemaVersion: 1, rootFile: 'other.tex' });
  await f.put(path.join(documentStatePath(other), 'review.json'), { important: true });
  await fs.writeFile(path.join(f.paper, 'export.pdf'), 'Exported PDF');
  await fs.writeFile(path.join(f.home, 'my-export.pdf'), 'User export in state directory');
  const chat = path.join(f.runtime, 'help-chats', key + '.json'); await f.put(chat, { owner: f.file, turns: ['chat text'] });
  const conversation = randomUUID(), conv = path.join(f.runtime, 'review-conversations', key);
  await f.put(path.join(conv, 'active.json'), { id: conversation });
  await f.put(path.join(conv, conversation, 'conversation.json'), { owner: f.file, id: conversation });
  await f.put(path.join(conv, conversation, `turn-${randomUUID()}.json`), { prompt: 'Review this' });
  const paste = randomUUID(), pasted = path.join(f.runtime, 'reference-folders', `${key}-${paste}.txt`);
  await f.put(path.join(f.runtime, 'reference-folders', key + '.json'), { paper: f.file, roots: [{ id: paste, kind: 'paste', path: pasted }] });
  await fs.writeFile(pasted, 'Pasted context');
  await f.put(path.join(f.runtime, 'reference-folders', key + '-sources.json'), []);
  const build = randomUUID(), buildDir = path.join(f.runtime, 'builds', build);
  await f.put(path.join(buildDir, '.editor-build.json'), { schemaVersion: 1, id: build, owner: f.file });
  await fs.writeFile(path.join(buildDir, 'main.pdf'), 'Temporary PDF');
  const old = randomUUID(), unowned = path.join(f.runtime, 'builds', old);
  await f.put(path.join(unowned, '.editor-build.json'), { schemaVersion: 1, id: old });
  const settings = path.join(f.runtime, 'settings.json'); await f.put(settings, { model: 'keep' });
  const plan = await f.cleanup.preview(id);
  assert(plan.files.length >= 10);
  for (const item of plan.files) { const stat = await fs.stat(item.path); assert.equal(item.bytes, stat.size); assert.equal(item.modifiedAt, new Date(stat.mtimeMs).toISOString()); assert(path.isAbsolute(item.path)); }
  assert(plan.kept.some(item => item.path === unowned)); assert(plan.kept.some(item => item.path.endsWith('my-export.pdf')));
  assert(!plan.files.some(item => item.path === f.file || item.path === settings || item.path.includes('my-export.pdf')));
  await assert.rejects(fs.stat(plan.archivePath), { code: 'ENOENT' });
  const before = await Promise.all(plan.files.map(async item => [item.path, await fs.readFile(item.path)] as const));
  const result = await f.cleanup.confirm(id, plan.id); assert(!result.warning); assert.equal(result.removed + result.reset, plan.files.length);
  const manifest = JSON.parse(await fs.readFile(path.join(result.archivePath, 'manifest.json'), 'utf8'));
  for (const [file, bytes] of before) {
    const entry = manifest.files.find((item: any) => item.path === file);
    assert.deepEqual(await fs.readFile(path.join(result.archivePath, entry.archivedAs)), bytes);
    assert.equal(digest(bytes), entry.hash);
    if (entry.action === 'remove') await assert.rejects(fs.stat(file), { code: 'ENOENT' });
  }
  assert.equal(await fs.readFile(f.file, 'utf8'), f.text);
  assert.equal(await fs.readFile(path.join(f.paper, 'export.pdf'), 'utf8'), 'Exported PDF');
  assert.equal(await fs.readFile(path.join(f.home, 'my-export.pdf'), 'utf8'), 'User export in state directory');
  assert.equal(JSON.parse(await fs.readFile(settings, 'utf8')).model, 'keep');
  assert.equal(JSON.parse(await fs.readFile(path.join(documentStatePath(other), 'review.json'), 'utf8')).important, true);
  assert((await fs.stat(unowned)).isDirectory());
  await assert.rejects(f.cleanup.confirm(id, plan.id), /expired/);
});

for (const change of ['contents', 'new file', 'source', 'same contents replaced', 'parent replaced']) test(`changed ${change} invalidates the inventory before any deletion`, async t => {
  const f = await fixture(t), plan = await f.cleanup.preview(f.project.id), review = path.join(f.home, 'review.json');
  if (change === 'contents') await fs.appendFile(review, ' ');
  if (change === 'new file') await f.put(path.join(f.home, 'recovery/new.json'), { preserved: true });
  if (change === 'source') await fs.writeFile(f.file, 'An externally edited draft.');
  if (change === 'same contents replaced') { const data = await fs.readFile(review); await fs.unlink(review); await fs.writeFile(review, data); }
  if (change === 'parent replaced') { await fs.rename(f.home, f.home + '-previous'); await fs.cp(f.home + '-previous', f.home, { recursive: true }); }
  await assert.rejects(f.cleanup.confirm(f.project.id, plan.id), /No editing files were removed/);
  assert((await fs.stat(review)).isFile()); assert((await fs.stat(path.join(f.home, 'recovery/session.json'))).isFile());
});

test('unsaved recovery and mismatched document or chat owners stop cleanup', async t => {
  const f = await fixture(t), id = f.project.id;
  await f.service.persist({ projectId: id, text: f.text + ' Unsaved.', review: f.project.review });
  await assert.rejects(f.cleanup.preview(id), /Save the current draft/);
  await f.service.persist({ projectId: id, text: f.text, review: f.project.review });
  await f.put(path.join(f.home, 'document.json'), { schemaVersion: 1, rootFile: 'another.txt' });
  await assert.rejects(f.cleanup.preview(id), /Cannot verify/);
  await f.put(path.join(f.home, 'document.json'), { schemaVersion: 1, rootFile: f.project.name });
  await f.put(path.join(f.runtime, 'help-chats', digest(f.file) + '.json'), { owner: '/another/paper.txt' });
  await assert.rejects(f.cleanup.preview(id), /Side Chat ownership/);
});

for (const target of ['file', 'parent', 'hard link']) test(`cleanup refuses a ${target} link and leaves its target alone`, async t => {
  const f = await fixture(t), outside = path.join(f.root, 'outside'); await fs.mkdir(outside);
  const protectedFile = path.join(outside, 'review.json'); await fs.writeFile(protectedFile, 'Precious');
  if (target === 'file' || target === 'hard link') {
    await fs.unlink(path.join(f.home, 'review.json'));
    if (target === 'file') await fs.symlink(protectedFile, path.join(f.home, 'review.json'));
    else await fs.link(protectedFile, path.join(f.home, 'review.json'));
  } else { await fs.rename(f.home, f.home + '-original'); await fs.symlink(f.home + '-original', f.home, 'dir'); }
  await assert.rejects(f.cleanup.preview(f.project.id), /Cleanup stopped/);
  assert.equal(await fs.readFile(protectedFile, 'utf8'), 'Precious');
});

test('archive failure never deletes editing files; cancellation invalidates a prepared plan', async t => {
  const f = await fixture(t), plan = await f.cleanup.preview(f.project.id);
  await fs.mkdir(path.dirname(plan.archivePath)); await fs.mkdir(plan.archivePath);
  await assert.rejects(f.cleanup.confirm(f.project.id, plan.id), /No editing files were removed/);
  for (const item of plan.files) assert((await fs.stat(item.path)).isFile());
  const next = await f.cleanup.preview(f.project.id); f.cleanup.cancel();
  await assert.rejects(f.cleanup.confirm(f.project.id, next.id), /expired/);
});

test('stopping partway preserves the archive, reports partial cleanup and does not delete a newly changed file', async t => {
  const f = await fixture(t), plan = await f.cleanup.preview(f.project.id), unlink = fs.unlink;
  const remove = plan.files.filter(f => f.action === 'remove'); assert(remove.length >= 2);
  let deleted = 0;
  t.mock.method(fs, 'unlink', async (file: any) => {
    if (file === remove[1].path) throw new Error('Synthetic disk failure');
    await unlink(file); deleted++;
  });
  const result = await f.cleanup.confirm(f.project.id, plan.id);
  assert(result.warning?.includes('stopped early')); assert.equal(result.removed, deleted);
  assert((await fs.stat(remove[1].path)).isFile()); assert((await fs.stat(path.join(result.archivePath, 'manifest.json'))).isFile());
});

test('changing a recovery copy during its initial checksum prevents any editing-file removal', async t => {
  const f = await fixture(t), plan = await f.cleanup.preview(f.project.id), open = fs.open;
  let mutated = false;
  t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
    const handle = await open(...args);
    if (String(args[0]).startsWith(plan.archivePath + path.sep) && String(args[0]).endsWith('-review.json') && typeof args[1] === 'number') {
      const read = handle.read.bind(handle);
      (handle as any).read = async (...readArgs: any[]) => {
        const result = await (read as any)(...readArgs);
        if (!result.bytesRead && !mutated) { mutated = true; await fs.appendFile(args[0], ' Changed at verification EOF.'); }
        return result;
      };
    }
    return handle;
  });
  await assert.rejects(f.cleanup.confirm(f.project.id, plan.id), /No editing files were removed/);
  assert(mutated);
  for (const file of plan.files) assert((await fs.stat(file.path)).isFile());
  assert.equal(await fs.readFile(f.file, 'utf8'), f.text);
});

for (const changedFile of ['original', 'archive']) test(`a changed ${changedFile} during the final read stops removal of that file`, async t => {
  const f = await fixture(t), plan = await f.cleanup.preview(f.project.id);
  const target = path.join(f.home, 'review.json'), open = fs.open;
  let reads = 0, mutated = false;
  t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
    const handle = await open(...args);
    if (args[0] === target && typeof args[1] === 'number' && ++reads === 4) {
      // First inventory check, archive copy, second check, then final read.
      const read = handle.read.bind(handle);
      (handle as any).read = async (...readArgs: any[]) => {
        const result = await (read as any)(...readArgs);
        if (!result.bytesRead && !mutated) {
          mutated = true;
          let file = target;
          if (changedFile === 'archive') {
            const manifest = JSON.parse(await fs.readFile(path.join(plan.archivePath, 'manifest.json'), 'utf8'));
            file = path.join(plan.archivePath, manifest.files.find((item: any) => item.path === target).archivedAs);
          }
          await fs.appendFile(file, ' Changed while reading.');
        }
        return result;
      };
    }
    return handle;
  });
  const result = await f.cleanup.confirm(f.project.id, plan.id);
  assert(mutated, 'The concurrent write must occur in the final read window.');
  assert(result.warning?.includes('stopped early'));
  assert((await fs.stat(target)).isFile(), 'Never delete a source whose read or archive changed.');
  if (changedFile === 'original') assert((await fs.readFile(target, 'utf8')).endsWith(' Changed while reading.'));
  assert.equal(await fs.readFile(f.file, 'utf8'), f.text);
});

for (const extension of ['txt', 'tex']) test(`reopening a cleared ${extension} starts without old comments/recovery, even when legacy records remain`, async t => {
  const f = await fixture(t, extension), id = f.project.id;
  await f.put(path.join(f.paper, '.modern-editor/review.json'), { ...f.project.review, comments: [{ id: 'old', title: 'Old comment', explanation: 'Not to be reimported', original: 'short', replacement: 'brief' }] });
  const plan = await f.cleanup.preview(id); await f.cleanup.confirm(id, plan.id); await f.service.close(id);
  const reopened = await f.service.open(f.file);
  assert.equal(reopened.text, f.text); assert.equal(reopened.recovered, false); assert.equal(reopened.review.comments.length, 0);
  assert((await fs.stat(path.join(f.paper, '.modern-editor/review.json'))).isFile());
});
