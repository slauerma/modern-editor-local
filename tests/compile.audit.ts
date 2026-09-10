import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProjectService } from '../src/main/project-service.ts';
import { CompileService } from '../src/main/compile-service.ts';

async function fixture(multi = false) {
  const root = path.resolve('.test-runs', 'audit-' + randomUUID()), paper = path.join(root, 'paper with spaces');
  await fs.mkdir(paper, { recursive: true });
  if (multi) await fs.cp('fixtures/audit-paper', paper, { recursive: true });
  else await fs.writeFile(path.join(paper, 'main.tex'), '\\documentclass{article}\n\\begin{document}\nAn allocation rule.\n\\end{document}\n');
  const projects = new ProjectService(path.join(root, 'cache')), project = await projects.open(path.join(paper, 'main.tex'));
  return { root, paper, project, compiler: new CompileService(projects, path.join(root, 'builds')) };
}
test('relative included source, local figure and BibTeX build into a clean two-page paper', { timeout: 60000 }, async () => {
  const f = await fixture(true), build = await f.compiler.compile(f.project.id, f.project.text, 'pdflatex');
  assert.equal(build.clean, true, build.log);
  assert.match(build.log, /AUDIT_LAST_PAGE=2/);
  const dir = path.join(f.root, 'builds', build.id);
  assert.match(await fs.readFile(path.join(dir, 'main.bbl'), 'utf8'), /audit-fixture/);
  const records = await fs.readFile(path.join(dir, 'main.fls'), 'utf8');
  assert.match(records, /sections\/appendix\.tex/); assert.match(records, /figures\/allocation\.pdf/);
  await fs.mkdir('test-evidence/audit', { recursive: true });
  await fs.writeFile('test-evidence/audit/multifile-paper.pdf', await f.compiler.pdf(build.id));
  await fs.writeFile('test-evidence/audit/multifile-build.json', JSON.stringify({ passed: true, build, fixture: 'fixtures/audit-paper' }, null, 2));
});
test('a newly added local input invalidates an older candidate snapshot', { timeout: 30000 }, async () => {
  const f = await fixture(), build = await f.compiler.compile(f.project.id, f.project.text, 'pdflatex');
  assert.equal(await f.compiler.validate(f.project.id, build.id, f.project.text), true);
  await fs.writeFile(path.join(f.paper, 'new-local-package.sty'), '\\ProvidesPackage{new-local-package}\n');
  assert.equal(await f.compiler.validate(f.project.id, build.id, f.project.text), false, 'An added input must invalidate the earlier input inventory.');
});
test('a successful PDF with an unresolved citation remains current but is not clean enough for checked acceptance', { timeout: 30000 }, async () => {
  const f = await fixture(), text = f.project.text.replace('An allocation rule.', 'An allocation rule~\\cite{missing-audit-key}.');
  const build = await f.compiler.compile(f.project.id, text, 'pdflatex');
  assert.equal(build.success, true, build.log); assert.equal(build.clean, false);
  assert(build.diagnostics.some(d => d.message.includes('undefined')));
  assert.equal(await f.compiler.validate(f.project.id, build.id, text), true, 'Reference warnings do not mean the PDF came from an older source.');
});
