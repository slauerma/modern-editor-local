import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProjectService } from '../src/main/project-service.ts';
import { CompileService } from '../src/main/compile-service.ts';
import { restorePdf } from '../src/main/pdf-workspace-cache.ts';
import { commentSchema } from '../src/shared/contracts.ts';
import { proposalPreview } from '../src/shared/proposal-preview.ts';

test('real mathematical preview with a package addition has its own PDF mapping and cannot replace the paper PDF', { timeout: 45000 }, async t => {
  const root = path.resolve('.test-runs', 'viewer-compile-' + randomUUID()), paper = path.join(root, 'paper'), builds = path.join(root, 'builds');
  await fs.mkdir(paper, { recursive: true });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = '\\documentclass{article}\n\\begin{document}\nA norm is nonnegative.\n\\end{document}\n';
  const file = path.join(paper, 'note.txt');
  await fs.writeFile(file, source);
  const projects = new ProjectService(path.join(root, 'cache')), p = await projects.open(file), compiler = new CompileService(projects, builds);
  try {
    const ordinary = await compiler.compile(p.id, source, 'pdflatex');
    assert(ordinary.success && ordinary.dependenciesVerified, ordinary.log);
    const pdf = await compiler.pdf(ordinary.id);
    const original = 'A norm is nonnegative.', from = source.indexOf(original);
    const comment = commentSchema.parse({ id: 'norm', title: 'State the inequality', explanation: 'Show the notation.', original, from, to: from + original.length, replacement: 'For every vector $x$,\n\\[\\lVert x\\rVert \\geq 0.\\]', packages: ['amsmath'], validity: 'current' });
    const candidate = proposalPreview(source, comment);
    const result = await compiler.compile(p.id, candidate.text, 'pdflatex', undefined, undefined, 'proposal');
    assert(result.success && result.dependenciesVerified, result.log);
    assert.equal(result.purpose, 'proposal');
    assert(await compiler.validate(p.id, result.id, candidate.text));
    const location = await compiler.locatePdf({ projectId: p.id, buildId: result.id, text: candidate.text, from: candidate.from, to: candidate.to });
    assert.equal(location.kind, 'mapped');
    if (location.kind === 'mapped') assert.equal(location.page, 1);
    assert.equal(await fs.readFile(file, 'utf8'), source);
    assert.deepEqual(await compiler.pdf(ordinary.id), pdf);
    assert.equal((await restorePdf(builds, file, ordinary.id)).text, source);
    await assert.rejects(restorePdf(builds, file, result.id));
  } finally { await compiler.stop(); }
});
