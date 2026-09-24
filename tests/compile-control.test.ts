import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { ProjectService } from '../src/main/project-service.ts';
import { CompileService } from '../src/main/compile-service.ts';

async function fixture(timeoutMs = 2000) {
  const root = path.resolve('.test-runs', 'compile-control-' + randomUUID()), paper = path.join(root, 'paper');
  await fs.mkdir(paper, { recursive: true }); const file = path.join(paper, 'main.tex');
  await fs.writeFile(file, 'Original manuscript');
  const command = path.join(root, 'test-compiler.mjs'); await fs.copyFile('tests/fixtures/stub-compiler.mjs', command); await fs.chmod(command, 0o700);
  const projects = new ProjectService(path.join(root, 'cache')), project = await projects.open(file);
  return { root, file, project, compiler: new CompileService(projects, path.join(root, 'builds'), command, timeoutMs) };
}
test('split Unicode output is preserved, a timed-out compile stops, and the service remains usable', { timeout: 20000 }, async () => {
  // Allow process startup during the parallel suite; the HANG case must still
  // hit the real watchdog, preserve the previous PDF and permit a later build.
  const f = await fixture(5000);
  try {
    const good = await f.compiler.compile(f.project.id, 'OK', 'pdflatex');
    assert.match(good.log, /Ελληνικά and Hebrew עברית/);
    const stopped = await f.compiler.compile(f.project.id, 'HANG', 'pdflatex');
    assert.equal(stopped.success, false); assert.match(stopped.diagnostics[0].message, /time limit/);
    assert.equal(await fs.readFile(f.file, 'utf8'), 'Original manuscript');
    assert.equal(Buffer.from(await f.compiler.pdf(good.id)).subarray(0, 5).toString(), '%PDF-');
    assert.equal((await f.compiler.compile(f.project.id, 'OK again', 'pdflatex')).success, true);
  } finally { await f.compiler.stop(); }
});
test('Cancel and stop finish a running compiler without leaving the next compilation busy', { timeout: 10000 }, async () => {
  const f = await fixture();
  try {
    const pending = f.compiler.compile(f.project.id, 'HANG', 'pdflatex');
    // Wait for this owned test process to signal readiness, with a bounded deadline.
    const start = Date.now(); let ready = false;
    while (!ready && Date.now() - start < 1500) {
      const dirs = await fs.readdir(path.join(f.root, 'builds')).catch(() => []);
      for (const dir of dirs) ready ||= await fs.access(path.join(f.root, 'builds', dir, 'compiler-ready.txt')).then(() => true, () => false);
      if (!ready) await delay(15);
    }
    assert(ready, 'The test compiler should start');
    await f.compiler.stop(); const result = await pending;
    assert.equal(result.success, false); assert.equal(result.diagnostics[0].message, 'Compilation cancelled.');
    assert.equal((await f.compiler.compile(f.project.id, 'OK', 'pdflatex')).success, true);
  } finally { await f.compiler.stop(); }
});

test('passive validation coalesces, yields to Compile and never reports busy as changed', { timeout: 10000 }, async () => {
  const f = await fixture();
  try {
    const build = await f.compiler.compile(f.project.id, f.project.text, 'pdflatex');
    // The process-control compiler produces only a PDF header. Supply verified
    // record metadata here to exercise coordination, not TeX input verification.
    (f.compiler as any).records.get(build.id).build.dependenciesVerified = true;
    const original = (f.compiler as any).prepareInputs.bind(f.compiler);
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(done => { entered = done; });
    let calls = 0;
    (f.compiler as any).prepareInputs = async (...args: any[]) => {
      calls++;
      if (calls === 1) { entered(); await new Promise<void>(done => { release = done; }); }
      return original(...args);
    };
    const one = f.compiler.inspect(f.project.id, build.id, f.project.text);
    const two = f.compiler.inspect(f.project.id, build.id, f.project.text);
    assert.equal(one, two); await started;
    const compiled = f.compiler.compile(f.project.id, f.project.text, 'pdflatex');
    assert.equal((await f.compiler.inspect(f.project.id, build.id, f.project.text)).status, 'deferred');
    release(); assert.equal((await one).status, 'deferred');
    assert((await compiled).success); assert.equal(calls, 2);
    assert.equal((await f.compiler.inspect(f.project.id, build.id, f.project.text)).status, 'valid');
    assert.equal(await f.compiler.validate(f.project.id, build.id, 'Changed'), false);
  } finally { await f.compiler.stop(); await fs.rm(f.root, { recursive: true, force: true }); }
});
