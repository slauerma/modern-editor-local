import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProjectService } from '../src/main/project-service.ts';
import { CompileService } from '../src/main/compile-service.ts';

for (const [index, key] of ['SmithSynthetic2026MissingCitationRecordKey', 'a-very-long-missing-citation-key-'.repeat(8)].entries()) {
  test(`wrapped natbib citation ${index + 1} produces a usable PDF but blocks checked acceptance`, { timeout: 30000 }, async () => {
    const root = path.resolve('.test-runs', 'review-citation-' + randomUUID()), paper = path.join(root, 'paper');
    await fs.mkdir(paper, { recursive: true });
    const source = '\\documentclass{article}\n\\usepackage{natbib}\n\\begin{document}\nA citation \\citep{' + key + '}.\n\\end{document}\n';
    const file = path.join(paper, 'main.tex'); await fs.writeFile(file, source);
    const projects = new ProjectService(path.join(root, 'cache')), p = await projects.open(file), compiler = new CompileService(projects, path.join(root, 'builds'));
    try {
      const result = await compiler.compile(p.id, source, 'pdflatex');
      await fs.mkdir('test-evidence/review-batch-1', { recursive: true });
      const name = `test-evidence/review-batch-1/citation-${index + 1}-clean-${result.clean}`;
      await fs.writeFile(name + '.json', JSON.stringify(result, null, 2));
      if (result.success) await fs.writeFile(name + '.pdf', await compiler.pdf(result.id));
      assert.equal(result.success, true, result.log);
      assert.equal(result.clean, false);
      assert(result.diagnostics.some(d => /undefined/i.test(d.message)));
      assert.equal(await fs.readFile(file, 'utf8'), source);
    } finally { await compiler.stop(); }
  });
}

test('local TikZ and PGF inputs compile in the snapshot and their edits invalidate its PDF', { timeout: 30000 }, async () => {
  const root = path.resolve('.test-runs', 'review-batch-2-graphics-' + randomUUID()), paper = path.join(root, 'paper');
  await fs.mkdir(paper, { recursive: true });
  const source = '\\documentclass{article}\n\\usepackage{tikz}\n\\begin{document}\nA technical figure.\\input{figure.tikz}\\input{label.pgf}\n\\end{document}\n';
  const file = path.join(paper, 'main.tex'); await fs.writeFile(file, source);
  await fs.writeFile(path.join(paper, 'figure.tikz'), '\\begin{tikzpicture}\\draw[->] (0,0)--(2,1);\\end{tikzpicture}\n');
  await fs.writeFile(path.join(paper, 'label.pgf'), 'Figure input preserved.\n');
  const projects = new ProjectService(path.join(root, 'cache')), p = await projects.open(file), compiler = new CompileService(projects, path.join(root, 'builds'));
  try {
    const result = await compiler.compile(p.id, source, 'pdflatex');
    assert.equal(result.clean, true, result.log); assert.equal(await compiler.validate(p.id, result.id, source), true);
    await fs.mkdir('test-evidence/review-batch-2', { recursive: true });
    await fs.writeFile('test-evidence/review-batch-2/tikz-pgf.pdf', await compiler.pdf(result.id));
    await fs.writeFile('test-evidence/review-batch-2/tikz-pgf-build.json', JSON.stringify(result, null, 2));
    await fs.appendFile(path.join(paper, 'figure.tikz'), '% author changed the figure\n');
    assert.equal(await compiler.validate(p.id, result.id, source), false);
    assert.equal(await fs.readFile(file, 'utf8'), source);
  } finally { await compiler.stop(); }
});

test('bundled TCI support compiles an SWP root without changing its paper folder and tracks fallback identity', { timeout: 30000 }, async () => {
  const root = path.resolve('.test-runs', 'tci-fallback-' + randomUUID()), paper = path.join(root, 'paper');
  await fs.mkdir(paper, { recursive: true });
  const support = path.join(root, 'bundled-tcilatex.tex');
  const bundled = await fs.readFile('resources/tex-support/tcilatex.tex');
  await fs.writeFile(support, bundled);
  const source = '\\documentclass{article}\n\\input{tcilatex}\n\\begin{document}\nSWP support: $x=0\\text{ for every unmatched type.}$\n\\end{document}\n';
  const file = path.join(paper, 'main.tex'); await fs.writeFile(file, source);
  const projects = new ProjectService(path.join(root, 'cache')), p = await projects.open(file);
  const compiler = new CompileService(projects, path.join(root, 'builds'), undefined, undefined, support);
  try {
    const result = await compiler.compile(p.id, p.text, 'pdflatex');
    assert.equal(result.clean, true, result.log);
    assert.match(result.log, /TCILATEX Macros/);
    assert.equal(await compiler.validate(p.id, result.id, p.text), true);
    assert.equal(await fs.readFile(file, 'utf8'), source);
    assert.deepEqual(await fs.readdir(paper), ['main.tex']);
    await fs.appendFile(support, '\n% new bundled revision\n');
    assert.equal(await compiler.validate(p.id, result.id, p.text), false);
    await fs.writeFile(support, bundled);
    assert.equal(await compiler.validate(p.id, result.id, p.text), true);
    await fs.writeFile(path.join(paper, 'tcilatex.tex'), bundled);
    assert.equal(await compiler.validate(p.id, result.id, p.text), false);
  } finally { await compiler.stop(); }
});

test('a paper-local TCI case variant takes precedence even when the bundled path is unavailable', { timeout: 30000 }, async () => {
  const root = path.resolve('.test-runs', 'tci-local-' + randomUUID()), paper = path.join(root, 'paper');
  await fs.mkdir(paper, { recursive: true });
  const source = '\\documentclass{article}\n\\input{TCILATEX.TEX}\n\\begin{document}\n\\PaperLocalTCI\n\\end{document}\n';
  const local = '\\newcommand{\\PaperLocalTCI}{The paper local support file wins.}\n';
  const file = path.join(paper, 'main.tex'); await fs.writeFile(file, source);
  await fs.writeFile(path.join(paper, 'TCILATEX.TEX'), local);
  const projects = new ProjectService(path.join(root, 'cache')), p = await projects.open(file);
  const compiler = new CompileService(projects, path.join(root, 'builds'), undefined, undefined, path.join(root, 'missing-bundle.tex'));
  try {
    const result = await compiler.compile(p.id, p.text, 'pdflatex');
    assert.equal(result.clean, true, result.log);
    assert.equal(await compiler.validate(p.id, result.id, p.text), true);
    assert.equal(await fs.readFile(file, 'utf8'), source);
    assert.equal(await fs.readFile(path.join(paper, 'TCILATEX.TEX'), 'utf8'), local);
  } finally { await compiler.stop(); }
});
