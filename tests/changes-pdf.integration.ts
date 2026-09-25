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

test('audit regressions: unbraced arguments, long footnotes and preloaded ulem preserve a usable comparison', { timeout: 90000 }, async t => {
  const root = path.resolve('.test-runs', 'changes-audit-' + randomUUID());
  await fs.mkdir(path.join(root, 'paper'), { recursive: true }); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const before = String.raw`\documentclass{article}
\usepackage{ulem}
\begin{document}
\textbf Old result.

A note\footnote{First paragraph.

The argument are correct.

Final paragraph.}

\noindent This ordinary sentence have a mistake and [old wording].
\emph{Keep the author's emphasis.}
\end{document}`;
  const after = before.replace('Old result.', 'New result.').replace('argument are', 'argument is').replace('have a mistake', 'has a mistake').replace('[old wording]', '[new wording]');
  const file = path.join(root, 'paper/paper.tex'); await fs.writeFile(file, before);
  const projects = new ProjectService(path.join(root, 'cache')), p = await projects.open(file), compiler = new CompileService(projects, path.join(root, 'builds'));
  const service = new ChangesPdfService(projects, compiler);
  try {
    const candidate = await compiler.compile(p.id, after, 'pdflatex'); assert(candidate.success, candidate.log);
    const markup = await service.build({ projectId: p.id, before, after, name: 'Start', engine: 'pdflatex' });
    for (const artifact of [markup, await service.present(p.id, markup.id, 'clean')]) {
      assert(artifact.build?.success && artifact.build.dependenciesVerified, artifact.build?.log);
      assert.equal(artifact.changes.filter(c => c.layout === 'omitted').length, 2);
      assert.equal(artifact.changes.filter(c => c.layout !== 'omitted').length, 1);
      const generated = await fs.readFile(path.join(root, 'builds', artifact.build.id, 'paper.tex'), 'utf8');
      assert(generated.includes('\\textbf New result.'));
      assert(generated.includes('First paragraph.\n\nThe argument is correct.\n\nFinal paragraph.}'));
      assert(generated.includes("\\emph{Keep the author's emphasis.}"));
      assert(!generated.includes('\\normalem'));
      for (const c of artifact.changes) assert.equal((await service.locate(p.id, artifact.id, c.id)).kind, 'mapped');
    }
    assert.equal(await fs.readFile(file, 'utf8'), before);
  } finally { service.cancel(); await service.settle(); await compiler.stop(); }
});

test('article titles stay on page one and exact comparison destinations survive ordinary display math', { timeout: 90000 }, async t => {
  const root = path.resolve('.test-runs', 'changes-destinations-' + randomUUID()), paper = path.join(root, 'paper');
  await fs.mkdir(paper, { recursive: true }); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const before = String.raw`\documentclass{article}
\usepackage{amsmath,amssymb}
\title{An ordinary title}\author{Synthetic test}\date{}
\begin{document}
\maketitle
The conclusion are immediate.
\begin{equation}\label{eq:test}x^{\prime}=\varnothing\end{equation}
The proof are direct.

\newpage
An unchanged final paragraph.
\end{document}`;
  const after = before.replaceAll(' are ', ' is ').replace('\\date{}', '\\date{} % A changed source note.');
  const file = path.join(paper, 'paper.tex'); await fs.writeFile(file, before);
  const projects = new ProjectService(path.join(root, 'cache')), p = await projects.open(file), compiler = new CompileService(projects, path.join(root, 'builds'));
  const comparisons = new ChangesPdfService(projects, compiler);
  try {
    const markup = await comparisons.build({ projectId: p.id, before, after, name: 'Session start', engine: 'pdflatex' });
    for (const artifact of [markup, await comparisons.present(p.id, markup.id, 'clean')]) {
      assert(artifact.build?.success && artifact.build.dependenciesVerified);
      assert.equal(artifact.changes.filter(c => c.layout !== 'omitted').length, 1);
      const shown = artifact.changes.find(c => c.layout !== 'omitted')!, omitted = artifact.changes.find(c => c.layout === 'omitted')!;
      const first = await comparisons.locate(p.id, artifact.id, shown.id), last = await comparisons.locate(p.id, artifact.id, omitted.id);
      assert.equal(first.kind, 'mapped'); if (first.kind === 'mapped') assert.equal(first.page, 1, 'No comparison-only page before maketitle');
      assert.equal(last.kind, 'mapped'); if (last.kind === 'mapped') assert.equal(last.page, 2, 'Omission navigation uses the real summary marker');
      const generated = await fs.readFile(path.join(root, 'builds', artifact.build.id, 'paper.tex'), 'utf8');
      assert.equal(generated.split('\\label{eq:test}').length - 1, 1);
      assert.equal(generated.split('\\begin{equation}').length - 1, 1);
      assert(!artifact.build.diagnostics.some(d => /multiply.defined|duplicate/i.test(d.message)), artifact.build.log);
    }
    assert.equal(await fs.readFile(file, 'utf8'), before);
  } finally { comparisons.cancel(); await comparisons.settle(); await compiler.stop(); }
});

test('real comparison preserves percent comments and line joining while marking nearby prose', { timeout: 90000 }, async t => {
  const root = path.resolve('.test-runs', 'changes-comments-' + randomUUID()), paper = path.join(root, 'paper');
  await fs.mkdir(paper, { recursive: true }); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const before = String.raw`\documentclass{article}
\begin{document}
% A source note before the paragraph.
This sentence have a mistake. % old source note with \unknown{unused syntax}
The conclusion remain valid.

This is in% Keep the joined word.
correct. The rate is 10\% and remains fixed.

The old explanation is vague.% Keep the same paragraph.
The paragraph continues here.
\end{document}
`;
  const after = before.replace('have', 'has').replace('old source note', 'new source note').replace('remain valid', 'remains valid').replace('in%', 'un%')
    .replace('The old explanation is vague.', 'The revised explanation applies the induction hypothesis to the preceding step and establishes the conclusion.');
  const file = path.join(paper, 'paper.tex'); await fs.writeFile(file, before);
  const projects = new ProjectService(path.join(root, 'cache')), p = await projects.open(file), compiler = new CompileService(projects, path.join(root, 'builds'));
  try {
    const ordinary = await compiler.compile(p.id, before, 'pdflatex'); assert(ordinary.success, ordinary.log);
    const bytes = await compiler.pdf(ordinary.id), service = new ChangesPdfService(projects, compiler);
    const markup = await service.build({ projectId: p.id, before, after, name: 'Session start', engine: 'pdflatex' });
    assert(markup.build?.success, markup.build?.log);
    assert(markup.build.dependenciesVerified);
    assert.equal(markup.changes.filter(c => c.layout === 'omitted').length, 1);
    assert.equal(markup.changes.filter(c => c.layout === 'inline').length, 4);
    const clean = await service.present(p.id, markup.id, 'clean'); assert(clean.build?.success, clean.build?.log);
    for (const artifact of [markup, clean]) {
      const generated = await fs.readFile(path.join(root, 'builds', artifact.build!.id, 'paper.tex'), 'utf8');
      assert(generated.includes('% new source note with \\unknown{unused syntax}\n'));
      assert(generated.includes('% Keep the same paragraph.\nThe paragraph continues here.'));
      assert(generated.includes('10\\%'));
      assert(generated.includes('Change 2 not shown.'));
      for (const c of artifact.changes) assert.equal((await service.locate(p.id, artifact.id, c.id)).kind, 'mapped');
      assert.equal(await compiler.validate(p.id, artifact.build!.id, after), false);
    }
    const markedTex = await fs.readFile(path.join(root, 'builds', markup.build.id, 'paper.tex'), 'utf8');
    assert(markedTex.includes('\\MECompareDel{in}\\MECompareSep{}\\MECompareAdd{un}% Keep the joined word.\ncorrect.'));
    const cleanTex = await fs.readFile(path.join(root, 'builds', clean.build.id, 'paper.tex'), 'utf8');
    assert(cleanTex.includes('un% Keep the joined word.\ncorrect.'));
    assert.equal(await fs.readFile(file, 'utf8'), before);
    assert.deepEqual(await compiler.pdf(ordinary.id), bytes);
  } finally { await compiler.stop(); }
});

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
