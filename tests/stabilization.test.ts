import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { digest, privateDirectory, readRegularFile, readJSON } from '../src/main/files.ts';
import { inspectSourceRecovery } from '../src/main/source-export.ts';
import { ProjectService } from '../src/main/project-service.ts';
import { compilerEnvironment, recordedInputs } from '../src/main/compile-inputs.ts';
import { CompileService } from '../src/main/compile-service.ts';

async function fixture() {
  const root = path.resolve('.test-runs', 'stabilization-' + randomUUID());
  const paper = path.join(root, 'paper'); await fs.mkdir(paper, { recursive: true });
  const file = path.join(paper, 'main.tex'); await fs.writeFile(file, 'Original source');
  const projects = new ProjectService(path.join(root, 'runtime')), project = await projects.open(file);
  return { root, paper, file, projects, project };
}
test('recovery exposes archived conflicts and verified backups, deduplicates source, and changes no files', async () => {
  const f = await fixture(), home = await f.projects.stateDirectory(f.project.id);
  await f.projects.persist({ projectId: f.project.id, text: 'Active unsaved', review: f.project.review });
  const archived = { schemaVersion: 1, baseDiskHash: f.project.diskHash, text: 'Archived unsaved θ', review: f.project.review, revision: 2 };
  const archivePath = path.join(home, 'recovery', `conflict-${randomUUID()}-session.json`);
  await fs.writeFile(archivePath, JSON.stringify(archived));
  const backups = await privateDirectory(home, 'backups'), old = '\uFEFFEarlier saved\r\n';
  const backup = path.join(backups, `source-${digest(old)}.tex`); await fs.writeFile(backup, old);
  await fs.writeFile(path.join(backups, `source-${digest('Original source')}.tex`), 'Original source');
  const before = await fs.readFile(archivePath);
  const found = await inspectSourceRecovery(f.file);
  assert.deepEqual(new Set(found.choices.map(c => c.text)), new Set(['Original source', 'Active unsaved', archived.text, old]));
  assert(found.choices.some(c => c.label.includes('archived recovery')));
  assert(found.choices.some(c => c.label.includes('source backup')));
  assert.deepEqual(await fs.readFile(archivePath), before); assert.equal(await fs.readFile(backup, 'utf8'), old);
  assert.equal(await fs.readFile(f.file, 'utf8'), 'Original source');
});
test('bounded readers reject oversized regular files and symlinks; private directories use private modes', async () => {
  const f = await fixture(), big = path.join(f.root, 'oversized.json');
  await fs.writeFile(big, 'x'.repeat(100));
  await assert.rejects(readRegularFile(big, 50), /at most/);
  const link = path.join(f.root, 'linked.json'); await fs.symlink(big, link);
  await assert.rejects(readJSON(link));
  const dir = await privateDirectory(f.root, 'private');
  assert.equal((await fs.stat(dir)).mode & 0o777, 0o700);
});
test('compiler environment passes deliberate tool paths, not inherited credentials or TeX overrides', () => {
  process.env.EDITOR_TEST_SECRET = 'private-canary'; process.env.TEXINPUTS = 'outside-override';
  try { const env = compilerEnvironment('/Library/TeX/texbin/latexmk', '/build-cache');
    assert.equal(env.EDITOR_TEST_SECRET, undefined); assert.equal(env.TEXINPUTS, undefined);
    assert.equal(env.HOME, '/build-cache/home'); assert.match(env.PATH!, /TeX/);
  } finally { delete process.env.EDITOR_TEST_SECRET; delete process.env.TEXINPUTS; }
});
test('bounded reader rejects a FIFO promptly without a writer', async () => {
  const f = await fixture(), fifo = path.join(f.root, 'pipe');
  await new Promise<void>((resolve, reject) => { const p = spawn('mkfifo', [fifo]); p.once('error', reject); p.once('exit', code => code === 0 ? resolve() : reject(new Error(`mkfifo: ${code}`))); });
  // A child keeps a regression from stranding the test runner's fs thread.
  const child = spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', `import { readRegularFile } from './src/main/files.ts'; try { await readRegularFile(process.argv[1], 100); process.exitCode=2; } catch(e) { if (!e.message.includes('regular file')) throw e; }`, fifo], { stdio: 'pipe' });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 3000);
  const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }).finally(() => clearTimeout(timer));
  assert.equal(timedOut, false, 'FIFO open must not block'); assert.equal(code, 0);
});
test('input records distinguish toolchain files, outside manuscripts, BibTeX inputs and escaped symlinks', async () => {
  const f = await fixture(), build = path.join(f.root, 'build'), cache = path.join(f.root, 'tex-cache');
  await fs.mkdir(build); await fs.mkdir(cache);
  const outside = path.join(f.root, 'external.tex'), bib = path.join(f.root, 'external.bib');
  await fs.writeFile(outside, 'outside'); await fs.writeFile(bib, 'outside bib');
  await fs.symlink(outside, path.join(build, 'linked.tex'));
  await fs.writeFile(path.join(build, 'main.tex'), 'root');
  await fs.writeFile(path.join(build, 'main.fls'), `PWD ${build}\nINPUT ./main.tex\nINPUT ./linked.tex\n`);
  await fs.writeFile(path.join(build, 'main.fdb_latexmk'), `  "${bib}" 1.1 11 ${'a'.repeat(32)} ""\n`);
  const result = await recordedInputs(build, 'main', { directories: [], files: [] }, cache);
  assert.deepEqual(new Set(result.unsupported), new Set([outside, bib]));
  assert.equal(result.external.length, 0);
});
test('explicit cache cleanup protects displayed and recent builds, skips unknown folders and never touches source', async () => {
  const f = await fixture(), command = path.join(f.root, 'compiler.mjs');
  await fs.copyFile('tests/fixtures/stub-compiler.mjs', command); await fs.chmod(command, 0o700);
  const cache = path.join(f.root, 'builds'), compiler = new CompileService(f.projects, cache, command);
  const builds = [];
  for (let i = 0; i < 8; i++) builds.push(await compiler.compile(f.project.id, 'OK ' + i, 'pdflatex'));
  const unknown = path.join(cache, randomUUID()); await fs.mkdir(unknown); await fs.writeFile(path.join(unknown, 'keep.txt'), 'unowned');
  const result = await compiler.clearOldBuilds([builds[0].id]);
  assert.equal(result.removed, 2);
  assert.equal((await compiler.pdf(builds[0].id)).length > 0, true);
  assert.equal((await compiler.pdf(builds[7].id)).length > 0, true);
  await assert.rejects(compiler.pdf(builds[1].id));
  assert.equal(await fs.readFile(path.join(unknown, 'keep.txt'), 'utf8'), 'unowned');
  assert.equal(await fs.readFile(f.file, 'utf8'), 'Original source');
});
