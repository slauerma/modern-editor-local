import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProjectService } from '../src/main/project-service.ts';
import { CompileService } from '../src/main/compile-service.ts';
import { ChangesPdfService } from '../src/main/changes-pdf.ts';

for (const options of ['aspectratio=169', 'aspectratio=43,handout']) test(`Beamer ${options}: compiled inline edits, measured markers, clean view and omissions`, { timeout: 120000 }, async t => {
  const root = path.resolve('.test-runs', 'beamer-' + randomUUID()), file = path.join(root, 'paper/slides.tex');
  await fs.mkdir(path.dirname(file), { recursive: true }); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const before = String.raw`\documentclass[OPTIONS]{beamer}
\usetheme{Frankfurt}
\begin{document}
\begin{frame}{Plain prose}
The result is useful.
\begin{itemize}
\item<1-> The first claim is clear.
\item<2-> The second claim is clear.
\end{itemize}
\end{frame}
\begin{frame}{Columns}
\begin{columns}
\begin{column}{.45\textwidth}
\begin{block}{Claim}
The allocation is feasible.
\end{block}
\end{column}
\begin{column}{.45\textwidth}
For $x>0$, the value is positive.
\end{column}
\end{columns}
\end{frame}
\begin{frame}[fragile]{Code}
\begin{verbatim}
x = 1
\end{verbatim}
The example is useful.
\end{frame}
\end{document}`.replace('OPTIONS', options);
  const after = before.replaceAll('useful', 'helpful').replaceAll('is clear', 'is immediate').replace('is feasible', 'remains feasible').replace('is positive', 'is strictly positive').replace('x = 1', 'x = 2');
  await fs.writeFile(file, before);
  const projects = new ProjectService(path.join(root, 'runtime')), p = await projects.open(file), compiler = new CompileService(projects, path.join(root, 'builds'));
  const service = new ChangesPdfService(projects, compiler);
  try {
    const original = await compiler.compile(p.id, before, 'pdflatex'); assert(original.success, original.log);
    const bytes = await compiler.pdf(original.id);
    const input = { projectId: p.id, before, after, name: 'Original slides', engine: 'pdflatex' as const, interactive: true };
    const marked = await service.build(input);
    assert(marked.build?.success, marked.build?.log);
    const clean = await service.present(p.id, marked.id, 'clean');
    for (const artifact of [marked, clean]) {
      assert(artifact.build?.success && artifact.build.dependenciesVerified, artifact.build?.log);
      assert.equal(artifact.changes.filter(c => c.layout !== 'omitted').length, 6);
      assert.equal(artifact.changes.filter(c => c.layout === 'omitted').length, 1);
      for (const c of artifact.changes) {
        const location = await service.locate(p.id, artifact.id, c.id);
        assert.equal(location.kind, 'mapped', JSON.stringify({ c, location }));
      }
      const generated = service.exportSource(p.id, artifact.id).text;
      assert(!generated.includes('\\marginpar'));
      assert(generated.includes('\\item<2->')); assert(generated.includes('x = 2'));
      assert(!artifact.notice?.includes('overflow'));
    }
    const again = await service.build(input); assert.equal(again.build?.id, marked.build.id); assert.equal(again.reused, true);
    assert.equal(await fs.readFile(file, 'utf8'), before); assert.deepEqual(await compiler.pdf(original.id), bytes);
  } finally { service.cancel(); await service.settle(); await compiler.stop(); await projects.close(p.id); }
});

test('Beamer overflow remains visible as a warning; no automatic shrinking or manuscript repair', { timeout: 90000 }, async t => {
  const root = path.resolve('.test-runs', 'beamer-overflow-' + randomUUID()), file = path.join(root, 'paper/slides.tex');
  await fs.mkdir(path.dirname(file), { recursive: true }); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const before = '\\documentclass{beamer}\n\\begin{document}\n\\begin{frame}{Crowded}\nShort sentence.\n\\vspace{15cm}\n\\end{frame}\n\\end{document}', after = before.replace('Short', 'Longer');
  await fs.writeFile(file, before);
  const projects = new ProjectService(path.join(root, 'runtime')), p = await projects.open(file), compiler = new CompileService(projects, path.join(root, 'builds'));
  const service = new ChangesPdfService(projects, compiler);
  try {
    const artifact = await service.build({ projectId: p.id, before, after, name: 'Original', engine: 'pdflatex' });
    assert(artifact.build?.success); assert.match(artifact.notice ?? '', /overflowing/);
    assert(!service.exportSource(p.id, artifact.id).text.includes('[shrink'));
    assert.equal(await fs.readFile(file, 'utf8'), before);
  } finally { service.cancel(); await service.settle(); await compiler.stop(); await projects.close(p.id); }
});
