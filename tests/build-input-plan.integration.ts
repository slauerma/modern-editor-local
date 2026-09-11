import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ProjectService } from '../src/main/project-service.ts';
import { CompileService } from '../src/main/compile-service.ts';

async function fixture() {
  await fs.mkdir('.test-runs', { recursive: true });
  const root = await fs.mkdtemp(path.resolve('.test-runs/build-scope-integration-')), paper = path.join(root, 'paper');
  await fs.mkdir(paper);
  const text = '\\documentclass{article}\n\\begin{document}\n\\input{part}\n\\end{document}\n';
  await fs.writeFile(path.join(paper, 'main.tex'), text);
  await fs.writeFile(path.join(paper, 'part.tex'), 'A synthetic bounded paper.');
  await fs.writeFile(path.join(paper, 'unrelated.pdf'), '');
  await fs.truncate(path.join(paper, 'unrelated.pdf'), 60_000_000);
  const projects = new ProjectService(path.join(root, 'runtime')), project = await projects.open(path.join(paper, 'main.tex'));
  const compiler = new CompileService(projects, path.join(root, 'builds'));
  return { root, paper, text, project, compiler, remove: async () => { await compiler.stop(); await fs.rm(root, { recursive: true, force: true }); } };
}
test('actual LaTeX compiles a small literal dependency set inside an oversized folder and validates only that set', { timeout: 60_000 }, async () => {
  const f = await fixture();
  try {
    const frozen = f.text.replace('\\input{part}', 'Frozen source. \\input{part}');
    const plan = await f.compiler.planInputs(f.project.id, frozen);
    assert.equal(plan.status, 'ready', JSON.stringify(plan)); if (plan.status !== 'ready') return;
    assert.equal(plan.mode, 'dependencies'); assert.deepEqual(plan.files.map(file => file.relative), ['main.tex', 'part.tex']);
    const build = await f.compiler.compile(f.project.id, frozen, 'pdflatex');
    assert.equal(build.success, true, build.log); assert.equal(build.clean, true, JSON.stringify(build.diagnostics));
    assert.equal(build.inputSelection?.mode, 'dependencies'); assert.equal(build.inputSelection?.fileCount, 2);
    assert.equal(await fs.readFile(path.join(f.root, 'builds', build.id, 'main.tex'), 'utf8'), frozen);
    await assert.rejects(fs.stat(path.join(f.root, 'builds', build.id, 'unrelated.pdf')), { code: 'ENOENT' });
    assert.equal(await f.compiler.validate(f.project.id, build.id, frozen), true);
    await fs.writeFile(path.join(f.paper, 'other-unrelated.tex'), 'Unrelated file does not change the dependency closure.');
    assert.equal(await f.compiler.validate(f.project.id, build.id, frozen), true);
    await fs.appendFile(path.join(f.paper, 'part.tex'), ' Changed dependency.');
    assert.equal(await f.compiler.validate(f.project.id, build.id, frozen), false);
    assert.equal(await fs.readFile(path.join(f.paper, 'main.tex'), 'utf8'), f.text);
  } finally { await f.remove(); }
});
test('computed dependencies require an explicit unverified preview, and preparation failure preserves the previous PDF', { timeout: 60_000 }, async () => {
  const f = await fixture();
  try {
    const computed = f.text.replace('\\input{part}', '\\def\\chosenfile{part}\\input{\\chosenfile}');
    const blocked = await f.compiler.compile(f.project.id, computed, 'pdflatex');
    assert.equal(blocked.success, false); assert.equal(blocked.inputPreparation?.status, 'needs-selection');
    await assert.rejects(fs.stat(path.join(f.root, 'builds')), { code: 'ENOENT' });
    const preview = await f.compiler.compile(f.project.id, computed, 'pdflatex', ['main.tex', 'part.tex']);
    assert.equal(preview.success, true, preview.log); assert.equal(preview.clean, false); assert.equal(preview.dependenciesVerified, false);
    assert.equal(preview.inputSelection?.mode, 'explicit'); assert(preview.inputSelection?.unresolvedIssues?.length);
    assert.equal(await f.compiler.validate(f.project.id, preview.id, computed), false);
    const saved = Buffer.from(await f.compiler.pdf(preview.id));
    const missing = await f.compiler.compile(f.project.id, f.text.replace('{part}', '{not-there}'), 'pdflatex', ['main.tex', 'part.tex']);
    assert.equal(missing.success, false); assert(missing.inputPreparation?.issues.some(issue => issue.includes('Unresolved dependency')));
    assert.deepEqual(Buffer.from(await f.compiler.pdf(preview.id)), saved);
    await fs.truncate(path.join(f.paper, 'unrelated.pdf'), 210_000_000);
    const oversized = await f.compiler.compile(f.project.id, f.text.replace('\\input{part}', '\\includegraphics{unrelated.pdf}'), 'pdflatex');
    assert.equal(oversized.success, false); assert.equal(oversized.inputPreparation?.requiredFiles, 2);
    assert((oversized.inputPreparation?.requiredBytes ?? 0) > 210_000_000);
  } finally { await f.remove(); }
});
test('local planning reserves the compilation lifecycle and cancel releases it for the next build', { timeout: 30_000 }, async () => {
  const f = await fixture();
  try {
    const pending = f.compiler.planInputs(f.project.id, f.text);
    assert.equal(f.compiler.isBusy, true);
    await assert.rejects(f.compiler.compile(f.project.id, f.text, 'pdflatex'), /already running/);
    const cancelled = assert.rejects(pending, /Compilation cancelled/);
    await f.compiler.stop(); await cancelled;
    assert.equal(f.compiler.isBusy, false);
    const plan = await f.compiler.planInputs(f.project.id, f.text);
    assert.equal(plan.status, 'ready'); assert.equal(f.compiler.isBusy, false);
  } finally { await f.remove(); }
});
