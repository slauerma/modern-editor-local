import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProjectService } from '../src/main/project-service.ts';
import { CompileService } from '../src/main/compile-service.ts';
import { ChangesPdfService } from '../src/main/changes-pdf.ts';
import { restorePdf } from '../src/main/pdf-workspace-cache.ts';
import { commentSchema } from '../src/shared/contracts.ts';
import { proposalPreview } from '../src/shared/proposal-preview.ts';

test('real ordinary prose in labelled theorem/proof and beside unchanged math compiles without duplicated structure', { timeout: 90000 }, async t => {
  const root = path.resolve('.test-runs', 'changes-prose-' + randomUUID()); await fs.mkdir(path.join(root, 'paper'), { recursive: true });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const before = String.raw`\documentclass{article}
\usepackage{amsmath,amssymb,amsthm}
\newtheorem{proposition}{Proposition}
\newcommand{\allocation}{x}
\begin{document}
\section{Allocation}
The allocation $\allocation(\theta)=\theta$ are monotone and the reasoning is complete.

The values $x\in[0,1)$ are bounded.\label{halfopen}

The values $x\in(0,1]$ are bounded.\label{halfclosed}

\begin{proposition}\label{prop:allocation} The allocation are monotone for all positive types.\end{proposition}
\begin{proof}
\[\allocation(\theta')-\allocation(\theta)=\theta'-\theta>0.\label{eq:difference}\]
The preceding identity imply the claim for positive types.
\end{proof}
\end{document}
`;
  const after = before.replaceAll(' are monotone', ' is monotone').replaceAll(' are bounded', ' remain bounded').replace('identity imply', 'identity implies');
  const file = path.join(root, 'paper/paper.tex'); await fs.writeFile(file, before);
  const projects = new ProjectService(path.join(root, 'cache')), p = await projects.open(file), compiler = new CompileService(projects, path.join(root, 'builds'));
  try {
    const artifact = await new ChangesPdfService(projects, compiler).build({ projectId: p.id, before, after, name: 'Session start', engine: 'pdflatex' });
    assert(artifact.build?.success); assert.equal(artifact.changes.length, 5); assert(artifact.changes.every(c => c.layout === 'inline'));
    const generated = await fs.readFile(path.join(root, 'builds', artifact.build.id, 'paper.tex'), 'utf8');
    for (const command of [String.raw`\begin{proposition}`, String.raw`\label{prop:allocation}`, String.raw`\label{eq:difference}`]) assert.equal(generated.split(command).length - 1, 1);
    assert(!artifact.build.diagnostics.some(d => /multiply.defined|duplicate/i.test(d.message)), artifact.build.log);
    assert.equal(await fs.readFile(file, 'utf8'), before);
  } finally { await compiler.stop(); }
});

test('real comparison PDF: wording, paired mathematics, deletion, omitted labels and its own mapping', { timeout: 90000 }, async t => {
  const root = path.resolve('.test-runs', 'changes-compile-' + randomUUID()), paper = path.join(root, 'paper'), builds = path.join(root, 'builds');
  await fs.mkdir(paper, { recursive: true }); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const before = String.raw`\documentclass{article}
\usepackage{amsmath}
\begin{document}

This sentence have a small mistake and otherwise reads well.

The old proof omits the induction step.

\[ x + 1 = 2. \]

This entire paragraph is removed.

\section{Final section}\label{old}
This unchanged text ends the paper.

\end{document}
`;
  const after = before.replace('have', 'has').replace('The old proof omits the induction step.', 'For the induction step, apply the hypothesis to the preceding index. The displayed identity proves the claim at the next index.').replace('x + 1 = 2.', 'x + 2 = 3.').replace('This entire paragraph is removed.\n\n', '').replace('label{old}', 'label{new}');
  const file = path.join(paper, 'paper.tex'); await fs.writeFile(file, before);
  const projects = new ProjectService(path.join(root, 'cache')), p = await projects.open(file), compiler = new CompileService(projects, builds), comparisons = new ChangesPdfService(projects, compiler);
  try {
    const ordinary = await compiler.compile(p.id, before, 'pdflatex'); assert(ordinary.success, ordinary.log);
    const ordinaryBytes = await compiler.pdf(ordinary.id);
    const input = { projectId: p.id, before, after, name: 'Session start', engine: 'pdflatex' as const };
    const comparison = await comparisons.build(input);
    assert(comparison.build);
    assert.equal(comparison.build.purpose, 'comparison'); assert(comparison.build.dependenciesVerified);
    assert(comparison.changes.some(c => c.layout === 'inline'));
    assert(comparison.changes.some(c => c.layout === 'paired'));
    assert(comparison.changes.some(c => c.layout === 'omitted'));
    assert.equal(await compiler.validate(p.id, comparison.build.id, after), false);
    await assert.rejects(restorePdf(builds, file, comparison.build.id));
    for (const c of comparison.changes) {
      const location = await comparisons.locate(p.id, comparison.id, c.id);
      assert.equal(location.kind, 'mapped', JSON.stringify({ id: c.id, location }));
    }
    assert.equal(await fs.readFile(file, 'utf8'), before);
    assert.deepEqual(await compiler.pdf(ordinary.id), ordinaryBytes);
    assert.equal((await restorePdf(builds, file, ordinary.id)).text, before);
    const generated = await fs.readFile(path.join(builds, comparison.build.id, 'paper.tex'), 'utf8');
    assert.equal(await compiler.validate(p.id, comparison.build.id, generated), false, 'Even generated source cannot qualify a comparison for acceptance');
    assert(generated.includes('Change not shown') || generated.includes('not shown.'));
    const clean = await comparisons.present(p.id, comparison.id, 'clean');
    assert.equal(clean.presentation, 'clean'); assert(clean.build?.success);
    assert.deepEqual(clean.changes.map(c => c.id), comparison.changes.map(c => c.id));
    const cleanTex = await fs.readFile(path.join(builds, clean.build.id, 'paper.tex'), 'utf8');
    assert(!cleanTex.includes('This entire paragraph is removed.'));
    assert(!cleanTex.includes('The old proof omits'));
    assert(cleanTex.includes('x + 2 = 3.')); assert(!cleanTex.includes('x + 1 = 2.'));
    assert(cleanTex.includes('not shown.'));
    for (const c of clean.changes) {
      const location = await comparisons.locate(p.id, clean.id, c.id);
      assert.equal(location.kind, 'mapped', JSON.stringify({ presentation: 'clean', id: c.id, location }));
    }
    assert.deepEqual(await compiler.pdf(ordinary.id), ordinaryBytes);
    assert.equal(await fs.readFile(file, 'utf8'), before);
    assert.equal(await compiler.validate(p.id, clean.build.id, after), false);
  } finally { await compiler.stop(); }
});

test('real marked proposal uses exact candidate but never changes its decision or source', { timeout: 60000 }, async t => {
  const root = path.resolve('.test-runs', 'changes-proposal-' + randomUUID()); await fs.mkdir(root, { recursive: true }); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const before = '\\documentclass{article}\n\\begin{document}\n\nA statement is somewhat vague and benefits from further explanation.\n\n\\end{document}\n';
  // Keep runtime output outside the paper inputs, as the desktop app does.
  const paper = path.join(root, 'paper'); await fs.mkdir(paper);
  const file = path.join(paper, 'paper.tex'); await fs.writeFile(file, before);
  const projects = new ProjectService(path.join(root, 'cache')), p = await projects.open(file), compiler = new CompileService(projects, path.join(root, 'builds')), comparisons = new ChangesPdfService(projects, compiler);
  const original = 'somewhat vague', from = before.indexOf(original), c = commentSchema.parse({ id: 'proposal', title: 'Clarify', explanation: 'State the scope.', original, replacement: 'precise', from, to: from + original.length, validity: 'current' });
  await projects.persist({ projectId: p.id, text: before, review: { ...p.review, comments: [c] } });
  const after = proposalPreview(before, c).text;
  try {
    const result = await comparisons.build({ projectId: p.id, before, after, name: 'Current draft', proposalId: c.id, engine: 'pdflatex' });
    assert(result.build?.success); assert.equal(result.changes[0].reasons[0].origin, 'proposal');
    assert.equal(await fs.readFile(file, 'utf8'), before);
    const reopened = await projects.open(file); assert.equal(reopened.text, before); assert.equal(reopened.review.comments[0].decision, 'open');
  } finally { await compiler.stop(); }
});
