import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { ProjectService } from '../src/main/project-service.ts';
import { CompileService } from '../src/main/compile-service.ts';

const exec = promisify(execFile), root = path.resolve('.test-runs', 'texpile-' + randomUUID());
async function fixture(name: string, source: string, withFont = false) {
  const paper = path.join(root, name, 'paper with spaces α'); await fs.mkdir(paper, { recursive: true });
  await fs.copyFile('fixtures/texpile/allocation.jpg', path.join(paper, 'allocation.jpg'));
  if (withFont) {
    const font = (await exec('/Library/TeX/texbin/kpsewhich', ['FreeSerif.otf'])).stdout.trim();
    assert(font, 'The installed TeX FreeSerif fixture font is needed for this test.');
    await fs.mkdir(path.join(paper, 'fonts')); await fs.copyFile(font, path.join(paper, 'fonts/FreeSerif.otf'));
  }
  const file = path.join(paper, 'paper α.tex'); await fs.writeFile(file, source);
  const projects = new ProjectService(path.join(root, name, 'cache')), p = await projects.open(file);
  return { paper, file, p, compiler: new CompileService(projects, path.join(root, 'builds')) };
}
for (const engine of ['pdflatex', 'lualatex', 'xelatex'] as const) {
  test(`${engine}: JPEG and Unicode paths compile; Unicode engines also render Greek/Hebrew with a local font`, { timeout: 180000 }, async () => {
    const unicode = engine !== 'pdflatex';
    const source = '\\documentclass{article}\n\\usepackage{graphicx}\n' + (unicode ? '\\usepackage{fontspec}\n\\usepackage[bidi=default]{babel}\n\\babelprovide[import,main]{english}\n\\babelprovide[import]{greek}\n\\babelprovide[import]{hebrew}\n\\babelfont{rm}[Path=fonts/]{FreeSerif.otf}\n' : '') +
      '\\begin{document}\nJPEG figure and mathematical notation $\\alpha+\\beta=\\gamma$.\n' +
      (unicode ? '\\par Greek: \\foreignlanguage{greek}{Ελληνικά}. Hebrew: \\foreignlanguage{hebrew}{עברית}.\n' : '') +
      '\\par\\includegraphics[width=0.5\\textwidth]{allocation.jpg}\n\\end{document}\n';
    const f = await fixture(engine, source, unicode);
    try {
      const build = await f.compiler.compile(f.p.id, source, engine);
      assert.equal(build.clean, true, build.log); assert.equal(build.engine, engine);
      const texLog = await fs.readFile(path.join(root, 'builds', build.id, 'paper α.log'), 'utf8');
      assert.doesNotMatch(texLog, /Missing character:/);
      assert.equal(await fs.readFile(f.file, 'utf8'), source);
      await fs.mkdir('test-evidence/texpile', { recursive: true });
      await fs.writeFile(`test-evidence/texpile/${engine}.pdf`, await f.compiler.pdf(build.id));
      await fs.writeFile(`test-evidence/texpile/${engine}-build.json`, JSON.stringify({ build, paper: f.paper }, null, 2));
    } finally { await f.compiler.stop(); }
  });
}
test('a successful PDF with a missing glyph cannot approve a suggestion; invalid graphics preserve the good PDF', { timeout: 60000 }, async () => {
  const source = '\\documentclass{article}\n\\usepackage{graphicx}\n\\begin{document}\nVisible text.\\includegraphics[width=2cm]{allocation.jpg}\n\\end{document}\n';
  const f = await fixture('failure-preservation', source);
  try {
    const good = await f.compiler.compile(f.p.id, source, 'pdflatex'), pdf = await f.compiler.pdf(good.id);
    assert.equal(good.clean, true, good.log);
    const missing = await f.compiler.compile(f.p.id, source.replace('Visible text.', '{\\font\\testfont=cmr10\\testfont\\char200}'), 'pdflatex');
    assert.equal(missing.success, true, missing.log); assert.equal(missing.clean, false);
    assert(missing.diagnostics.some(d => d.message.includes('Missing character:')));
    const broken = await f.compiler.compile(f.p.id, source.replace('width=2cm', 'unknown-image-option=2cm'), 'pdflatex');
    assert.equal(broken.success, false); assert.deepEqual(await f.compiler.pdf(good.id), pdf);
    assert.equal(await fs.readFile(f.file, 'utf8'), source);
  } finally { await f.compiler.stop(); }
});
