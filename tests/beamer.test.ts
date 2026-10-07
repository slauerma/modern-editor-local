import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beamerFrames, isBeamer } from '../src/shared/beamer.ts';
import { comparisonPlan, applyArrangement } from '../src/shared/changes-pdf.ts';
import { renderComparison } from '../src/main/changes-pdf.ts';
import { documentOutline, filterOutline } from '../src/shared/document-outline.ts';
import { layoutPdfPages, pdfPositionAtScroll } from '../src/renderer/pdf-reader.ts';
import { defaultWorkspace, workspaceSchema } from '../src/shared/contracts.ts';

export const slides = String.raw`\documentclass[aspectratio=169]{beamer}
\begin{document}
\section{Choice}
\begin{frame}[t]{Choices}
Ordinary prose is useful.
\begin{itemize}
\item<1-> The first result is useful.
\item<2->[B] The second result is useful.
\end{itemize}
\end{frame}
\begin{frame}<1->[t]
\frametitle[Short]{Two columns}
\begin{columns}[T]
\begin{column}{.45\textwidth}
\begin{block}{Claim}
The allocation is feasible.
\end{block}
\end{column}
\begin{column}{.45\textwidth}
The value $x^2$ is positive.
\end{column}
\end{columns}
\end{frame}
\begin{frame}[fragile]{Code}
\begin{verbatim}
\frametitle{Not a slide}
x = 1
\end{verbatim}
The code is illustrative.
\end{frame}
\end{document}`;

test('Beamer structure exposes literal frame titles, not comments or verbatim examples', () => {
  assert(isBeamer(slides)); assert(!isBeamer('% \\documentclass{beamer}\n\\documentclass{article}'));
  assert(isBeamer('\\documentclass% note\n[handout]{beamer}'));
  assert.deepEqual(beamerFrames(slides).map(f => f.title), ['Choices', 'Two columns', 'Code']);
  const outline = documentOutline(slides), frames = outline.filter(e => e.kind === 'frame');
  assert.deepEqual(frames.map(e => e.title), ['Choices', 'Two columns', 'Code']);
  assert.equal(filterOutline(outline, 'columns')[0].from, slides.indexOf('\\begin{frame}<1->'));
});

test('Beamer edits keep frame, item, column and block structure exactly once', () => {
  const after = slides.replaceAll('useful', 'helpful').replace('is feasible', 'remains feasible').replace('is positive', 'is strictly positive').replace('is illustrative', 'is only illustrative');
  const plan = comparisonPlan(slides, after);
  assert.equal(plan.documentKind, 'beamer'); assert.equal(plan.changes.length, 6);
  assert(plan.changes.every(c => c.layout === 'inline' && c.inline && !c.paired && c.frame));
  let reconstructed = slides;
  for (const c of [...plan.changes].reverse()) reconstructed = reconstructed.slice(0, c.fromA) + c.newText + reconstructed.slice(c.toA);
  assert.equal(reconstructed, after);
  assert.throws(() => applyArrangement(plan, { groups: plan.changes.map(c => ({ ids: [c.id], layout: 'paired', summary: '' })) }), /unsupported layout/);
  for (const presentation of ['markup', 'clean'] as const) {
    const rendered = renderComparison(slides, after, plan, 'Start', false, presentation, true);
    assert(!rendered.text.includes('\\marginpar'));
    for (const token of ['\\begin{frame}', '\\begin{column}', '\\begin{block}', '\\item<2->[B]']) assert.equal(rendered.text.split(token).length, after.split(token).length);
    assert(rendered.text.includes('\\begin{verbatim}\n\\frametitle{Not a slide}\nx = 1\n\\end{verbatim}'));
    assert.equal(Object.keys(rendered.ranges).length, 6);
  }
});

test('Beamer unsupported content stays explicit and omissions use separate notes frames', () => {
  const after = slides.replace('Ordinary prose is useful.', 'Ordinary prose is helpful.').replace('x = 1', 'x = 2').replace('{Choices}', '{Options}');
  const plan = comparisonPlan(slides, after), rendered = renderComparison(slides, after, plan, 'Start');
  assert.equal(plan.changes.filter(c => c.layout === 'omitted').length, 2);
  assert.equal((rendered.text.match(/noframenumbering/g) ?? []).length, 2);
  assert(rendered.text.includes('x = 2')); assert(!rendered.text.includes('MECompareAdd{2}'));
  const article = slides.replace('{beamer}', '{article}');
  assert(comparisonPlan(article, article.replace('useful', 'helpful')).changes.every(c => c.layout === 'omitted'), 'Beamer support does not weaken article environment guards');
});

test('Beamer dense prose remains inline and changed formulas have clean-only support', () => {
  const before = '\\documentclass{beamer}\n\\begin{document}\n\\begin{frame}{Test}\nThe original conclusion is sufficiently short.\n\\[x^2\\]\n\\end{frame}\n\\end{document}';
  const after = before.replace('The original conclusion is sufficiently short.', 'A considerably longer revised explanation states the main conclusion with further detail about its application.').replace('x^2', 'x^3');
  const plan = comparisonPlan(before, after);
  assert(plan.changes.every(c => !c.paired));
  const markup = renderComparison(before, after, plan, 'Start');
  assert(!markup.text.includes('\\MECompareMathDel{x^2}'));
  assert(markup.changes.some(c => c.layout === 'omitted'));
  const clean = renderComparison(before, after, plan, 'Start', false, 'clean');
  assert(clean.changes.some(c => c.layout !== 'omitted'));
});

test('Fit page fits both slide dimensions and preserves the reading preference', () => {
  const pages = layoutPdfPages([{ width: 160, height: 90 }, { width: 120, height: 90 }], 800, 1, 360);
  assert.deepEqual(pages.map(p => [p.width, p.height]), [[640, 360], [480, 360]]);
  assert.deepEqual(layoutPdfPages([{ width: 160, height: 90 }], 320, 1, 600).map(p => p.height), [180]);
  const position = pdfPositionAtScroll(pages, pages[1].top, 0, 0, 1, 'page');
  assert.equal(position.page, 2); assert.equal(position.fit, 'page');
  assert.equal(workspaceSchema.parse({ ...defaultWorkspace(), pdf: position }).pdf.fit, 'page');
});

test('whole-frame deletion cannot insert deleted prose into a surviving repeated or untitled frame', () => {
  for (const title of ['{Repeated title}', '']) {
    const frames = ['First slide.', 'Deleted slide.', 'Third slide.'].map(s => '\\begin{frame}' + title + '\n' + s + '\n\\end{frame}\n');
    const wrap = (body: string) => '\\documentclass{beamer}\n\\begin{document}\n' + body + '\\end{document}';
    const before = wrap(frames.join('')), after = wrap(frames[0] + frames[2]);
    const plan = comparisonPlan(before, after);
    assert(plan.changes.length > 0); assert(plan.changes.every(c => c.layout === 'omitted'));
    assert(!renderComparison(before, after, plan, 'Start').text.includes('MECompareDel{Deleted slide.}'));
    assert(comparisonPlan(after, before).changes.every(c => c.layout === 'omitted'));
  }
});
