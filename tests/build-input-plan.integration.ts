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
test('SWP support and alternative local graphics compile unchanged with foreign drive fallbacks', { timeout: 60_000, skip: process.platform === 'win32' }, async () => {
  const f = await fixture();
  try {
    await fs.mkdir(path.join(f.paper, 'figures'));
    await fs.copyFile('resources/tex-support/tcilatex.tex', path.join(f.paper, 'tcilatex.tex'));
    await fs.copyFile('fixtures/audit-paper/figures/allocation.pdf', path.join(f.paper, 'figures/plot.pdf'));
    await fs.copyFile('fixtures/texpile/allocation.jpg', path.join(f.paper, 'figures/plot.jpg'));
    const frozen = f.text.replace('\\begin{document}', String.raw`\usepackage{graphicx}
\input{tcilatex}
\graphicspath{{./}{figures/}{X:/old-workstation/figures/}}
\begin{document}
\includegraphics[width=2cm]{plot}`);
    const plan = await f.compiler.planInputs(f.project.id, frozen);
    assert.equal(plan.status, 'ready', JSON.stringify(plan)); if (plan.status !== 'ready') return;
    assert.equal(plan.mode, 'dependencies'); assert.equal(plan.files.length, 5);
    const build = await f.compiler.compile(f.project.id, frozen, 'pdflatex');
    assert.equal(build.success, true, build.log); assert.equal(build.dependenciesVerified, true, JSON.stringify(build.diagnostics));
    assert.equal(await f.compiler.validate(f.project.id, build.id, frozen), true);
    const directory = path.join(f.root, 'builds', build.id);
    const recorded = await fs.readFile(path.join(directory, 'main.fls'), 'utf8');
    assert.match(recorded, /^INPUT .*figures\/plot\.pdf$/m);
    assert.doesNotMatch(recorded, /^INPUT .*figures\/plot\.jpg$/m);
    for (const image of ['plot.pdf', 'plot.jpg']) assert.deepEqual(await fs.readFile(path.join(directory, 'figures', image)), await fs.readFile(path.join(f.paper, 'figures', image)));
    assert.equal(await fs.readFile(path.join(directory, 'main.tex'), 'utf8'), frozen);
    await fs.appendFile(path.join(f.paper, 'tcilatex.tex'), '\n% changed support copy');
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

test('SWP Beamer BMP snapshots compile, restore and validate against original inputs without changing the paper', { timeout: 90_000, skip: process.platform !== 'darwin' }, async () => {
  const f = await fixture();
  try {
    const { sampleBitmap } = await import('./fixtures/sample-bitmap.ts');
    const { restorePdf } = await import('../src/main/pdf-workspace-cache.ts');
    const { digest } = await import('../src/main/files.ts');
    const bitmap = sampleBitmap();
    await fs.mkdir(path.join(f.paper, 'figures'));
    await fs.writeFile(path.join(f.paper, 'figures/picture.bmp'), bitmap);
    const frozen = String.raw`\documentclass{beamer}
\graphicspath{{figures/}{//Mac/Dropbox/lecture/figures/}}
\begin{document}
\begin{frame}{Rational preferences}
The ordering is complete.
\includegraphics[
natheight=1in,
natwidth=2in,
height=1cm,
width=2cm
]%
{picture.bmp}
\end{frame}
\end{document}
`;
    const build = await f.compiler.compile(f.project.id, frozen, 'pdflatex');
    assert.equal(build.success, true, build.log); assert.equal(build.clean, true, JSON.stringify(build.diagnostics));
    assert.equal(build.sourceHash, digest(frozen)); assert.equal(await f.compiler.validate(f.project.id, build.id, frozen), true);
    const directory = path.join(f.root, 'builds', build.id), compiled = await fs.readFile(path.join(directory, 'main.tex'), 'utf8');
    assert.notEqual(compiled, frozen); assert.equal(compiled.split('\n').length, frozen.split('\n').length);
    assert.match(compiled, /height=1cm/); assert.doesNotMatch(compiled, /natheight|natwidth/);
    assert.equal((await restorePdf(path.join(f.root, 'builds'), path.join(f.paper, 'main.tex'), build.id)).text, frozen);
    const location = await f.compiler.locatePdf({ projectId: f.project.id, buildId: build.id, text: frozen, from: frozen.indexOf('The ordering'), to: frozen.indexOf('The ordering') + 20 });
    assert.equal(location.kind, 'mapped', JSON.stringify(location));
    if (location.kind === 'mapped') {
      const request = { projectId: f.project.id, buildId: build.id, text: frozen, page: location.page, x: location.x + location.width / 2, y: location.y + location.height / 2 };
      const back = await f.compiler.locateSource(request); assert.equal(back.kind, 'mapped', JSON.stringify(back));
      // Beamer buffers frame bodies, so SyncTeX may point at the closing frame line.
      if (back.kind === 'mapped') assert(back.from >= frozen.indexOf('\\begin{frame}') && back.to <= frozen.indexOf('\\end{frame}') + '\\end{frame}'.length);
      const reopened = new CompileService(f.compiler.projects, path.join(f.root, 'builds'));
      try { await reopened.restore(f.project.id, build.id); assert.equal((await reopened.locateSource(request)).kind, 'mapped'); } finally { await reopened.stop(); }
    }
    const proposal = frozen.replace('is complete.', 'is complete and transitive.');
    const preview = await f.compiler.compile(f.project.id, proposal, 'pdflatex', undefined, undefined, 'proposal');
    assert.equal(preview.clean, true, JSON.stringify(preview.diagnostics)); assert.equal(await f.compiler.validate(f.project.id, preview.id, proposal), true);
    assert.equal(await fs.readFile(path.join(f.paper, 'main.tex'), 'utf8'), f.text);
    assert.deepEqual(await fs.readFile(path.join(f.paper, 'figures/picture.bmp')), bitmap);
    assert.deepEqual(await fs.readdir(path.join(f.paper, 'figures')), ['picture.bmp']);
    await fs.writeFile(path.join(directory, 'main.tex'), compiled + '% tampered');
    assert.equal(await f.compiler.validate(f.project.id, build.id, frozen), false);
    await assert.rejects(restorePdf(path.join(f.root, 'builds'), path.join(f.paper, 'main.tex'), build.id), /prepared PDF source changed/);
    await fs.writeFile(path.join(directory, 'main.tex'), compiled);
    await fs.appendFile(path.join(f.paper, 'figures/picture.bmp'), 'changed original');
    assert.equal(await f.compiler.validate(f.project.id, preview.id, proposal), false);
    const previous = Buffer.from(await f.compiler.pdf(build.id));
    await fs.writeFile(path.join(f.paper, 'figures/picture.bmp'), 'broken BMP');
    await assert.rejects(f.compiler.compile(f.project.id, frozen, 'pdflatex'), /readable BMP/);
    assert.deepEqual(Buffer.from(await f.compiler.pdf(build.id)), previous);
  } finally { await f.remove(); }
});
