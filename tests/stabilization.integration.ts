import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProjectService } from '../src/main/project-service.ts';
import { CompileService } from '../src/main/compile-service.ts';

test('real TeX: outside input cannot pass freshness validation, while self-contained input compiles and invalidates correctly', { timeout: 60000 }, async () => {
  const root = path.resolve('.test-runs', 'external-input-' + randomUUID()), paper = path.join(root, 'paper');
  await fs.mkdir(paper, { recursive: true });
  // TeX Live 2025 refuses hidden path components independently of our checks.
  // Use a visible disposable outside resource to exercise an actual outside read.
  const resources = path.resolve('test-evidence/stabilization-2026-09-09', 'outside-' + randomUUID());
  await fs.mkdir(resources, { recursive: true });
  const outside = path.join(resources, 'outside.tex'); await fs.writeFile(outside, 'External version A.');
  const file = path.join(paper, 'main.tex'), source = `\\documentclass{article}\n\\begin{document}\n\\input{${outside}}\n\\end{document}\n`;
  await fs.writeFile(file, source);
  const projects = new ProjectService(path.join(root, 'cache')), p = await projects.open(file);
  const compiler = new CompileService(projects, path.join(root, 'builds'));
  try {
    const external = await compiler.compile(p.id, p.text, 'lualatex');
    assert.equal(external.success, true); assert.equal(external.dependenciesVerified, false); assert.equal(external.clean, false);
    assert(external.diagnostics.some(d => d.message.includes(outside)));
    assert.equal(await compiler.validate(p.id, external.id, p.text), false);
    await fs.writeFile(outside, 'External version B.');
    assert.equal(await compiler.validate(p.id, external.id, p.text), false);
    const local = path.join(paper, 'inside.tex'); await fs.writeFile(local, 'Inside version A.');
    const fixed = p.text.replace(outside, 'inside.tex');
    const compiled = await compiler.compile(p.id, fixed, 'pdflatex');
    assert.equal(compiled.success, true); assert.equal(compiled.clean, true, JSON.stringify(compiled.diagnostics));
    assert.equal(await compiler.validate(p.id, compiled.id, fixed), true);
    await fs.writeFile(local, 'Inside version B.');
    assert.equal(await compiler.validate(p.id, compiled.id, fixed), false);
    assert.equal(await fs.readFile(file, 'utf8'), source);
    await fs.writeFile(path.join(root, 'results.json'), JSON.stringify({ external, compiled, sourceUnchanged: true }, null, 2));
  } finally { await compiler.stop(); }
});
