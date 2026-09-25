import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { comparisonPlan, exactChanges, applyArrangement } from '../src/shared/changes-pdf.ts';
import { renderComparison, ChangesPdfService } from '../src/main/changes-pdf.ts';
import { ChangeJournal } from '../src/main/change-journal.ts';
import { ProjectService } from '../src/main/project-service.ts';
import { commentSchema } from '../src/shared/contracts.ts';
import { digest } from '../src/main/files.ts';
import { proposalPreview } from '../src/shared/proposal-preview.ts';
import { documentBody } from '../src/shared/document-mode.ts';

const document = (body: string) => '\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}\n\n' + body + '\n\n\\end{document}\n';
function coverage(a: string, b: string) {
  const plan = comparisonPlan(a, b);
  let oldAt = 0, newAt = 0;
  for (const c of plan.changes) {
    assert(c.fromA >= oldAt && c.fromB >= newAt, 'ordered disjoint blocks');
    assert.equal(a.slice(oldAt, c.fromA), b.slice(newAt, c.fromB), 'unmarked intervening source is identical');
    oldAt = c.toA; newAt = c.toB;
  }
  assert.equal(a.slice(oldAt), b.slice(newAt));
  let result = a;
  for (const c of [...plan.changes].reverse()) result = result.slice(0, c.fromA) + c.newText + result.slice(c.toA);
  assert.equal(result, b, 'Every byte of the net comparison is represented');
  return plan;
}
test('small wording, whole paragraphs and unnumbered formulas use distinct exact layouts', () => {
  const a = document('This sentence have a small mistake and otherwise reads well.\n\nThe old argument is short.\n\n\\[ x + 1 = 2. \\]');
  const b = document('This sentence has a small mistake and otherwise reads well.\n\nThe revised argument explains each induction step in detail and states the conclusion.\n\n\\[ x + 2 = 3. \\]');
  const plan = coverage(a, b);
  assert.deepEqual(plan.changes.map(c => c.layout), ['inline', 'paired', 'paired']);
  const marked = renderComparison(a, b, plan, 'Session start');
  assert(marked.text.includes('\\MECompareDel{have}\\MECompareSep{}\\MECompareAdd{has}'));
  assert(marked.text.includes('\\MECompareMathDel{ x + 1 = 2. }'));
  assert(marked.text.includes('\\MECompareMathAdd{ x + 2 = 3. }'));
  assert(!marked.text.includes('MECompareNew'), 'Revision markup does not introduce New/Old panels');
  assert(marked.text.includes('\\MECompareDel{The old argument is short.}'));
  assert(marked.text.includes('\\MECompareAdd{The revised argument explains each induction step in detail and states the conclusion.}'));
  assert.equal(Object.keys(marked.ranges).length, 3);
});
test('additions, removals, whitespace and paragraph splits retain exact coverage', () => {
  const base = 'One paragraph.\n\nTwo paragraphs.\n\nThree paragraphs.';
  for (const revised of [
    'One paragraph.\n\nA new paragraph.\n\nTwo paragraphs.\n\nThree paragraphs.',
    'One paragraph.\n\nThree paragraphs.',
    base.replace('Two paragraphs.', 'Two\n\nparagraphs.'),
    base.replace('One paragraph.', 'One  paragraph.'),
    '', base + '\n\nAnother ending.', 'New beginning.\n\n' + base
  ]) coverage(document(base), document(revised));
});
test('preamble, labels, numbered math and unknown commands are explicitly omitted', () => {
  const a = document('A plain paragraph.\n\n\\begin{equation} x=1 \\end{equation}\n\nA \\custom{word}.');
  const b = a.replace('article', 'report').replace('x=1', 'x=2').replace('word', 'phrase');
  const plan = coverage(a, b), generated = renderComparison(a, b, plan, 'Old source');
  assert.equal(plan.changes.length, 3); assert(plan.changes.every(c => c.layout === 'omitted'));
  assert(generated.text.includes('Changes not shown'));
  for (let i = 1; i <= 3; i++) assert(generated.text.includes('Change ' + i + ' not shown.'));
  assert(generated.text.includes('x=2')); assert(!generated.text.includes('x=1'));
  assert.match(plan.changes[2].omission!, /custom is not supported/, 'Omission identifies the unsupported command');
  const labelled = comparisonPlan(document('Text \\label{x}.'), document('New text \\label{x}.'));
  assert.equal(labelled.changes[0].layout, 'inline');
  assert.equal(labelled.changes[0].paired, false, 'An unchanged label must never be repeated as old text');
});
test('source comments and whitespace changes receive explicit omission notices', () => {
  for (const [a, b] of [['Text. % old comment', 'Text. % new comment'], ['One paragraph.', 'One  paragraph.'], ['First line.\nSecond line.', 'First line. Second line.'], [String.raw`\[x+1=2\]`, String.raw`\[x + 1 = 2\]`]]) {
    const before = document(a), after = document(b), plan = coverage(before, after);
    assert(plan.changes.every(c => c.layout === 'omitted'));
    assert(renderComparison(before, after, plan, 'Test').text.includes('Change 1 not shown.'));
  }
  assert.equal(comparisonPlan(document('Rate \\% is small.'), document('Rate \\% is large.')).changes[0].layout, 'inline', 'Unchanged escaped percent stays in place');
});
test('changed source notes are isolated without hiding prose corrections on either side', () => {
  const a = document('This sentence have a mistake. % old note with \\unknown{syntax}\nThe conclusion remain valid.');
  const b = a.replace('have', 'has').replace('old note', 'new note').replace('remain valid', 'remains valid');
  const plan = coverage(a, b);
  assert.deepEqual(plan.changes.map(c => c.layout), ['inline', 'omitted', 'inline']);
  assert.equal(plan.changes[1].newText, '% new note with \\unknown{syntax}\n');
  assert.match(plan.changes[1].omission!, /source comment changed/);
  const marked = renderComparison(a, b, plan, 'Start');
  assert(marked.text.includes('\\MECompareDel{have}\\MECompareSep{}\\MECompareAdd{has}'));
  assert(marked.text.includes('\\MECompareDel{remain}\\MECompareSep{}\\MECompareAdd{remains}'));
  assert.equal(marked.text.split('% new note with \\unknown{syntax}\n').length - 1, 1);
  assert(marked.text.includes('Change 2 not shown.'));
  assert.equal(Object.keys(marked.ranges).length, 3, 'Every shown and unshown change remains navigable');
});
test('eight prose revisions separated by percent comments all receive revision markup', () => {
  const paragraphs = Array.from({ length: 8 }, (_, i) => `% Source note ${i}.\nThe claim ${i} are true. % Keep this explanation ${i}.\nThe proof follows.`);
  const a = document(paragraphs.join('\n\n')), b = a.replaceAll(' are true', ' is true').replaceAll('Keep this explanation', 'Retain this explanation');
  const plan = coverage(a, b), marked = renderComparison(a, b, plan, 'Start');
  assert.equal(plan.changes.length, 16);
  assert.equal(marked.changes.filter(c => c.layout === 'inline').length, 8);
  assert(marked.changes.filter(c => c.layout === 'omitted').every(c => c.oldText.startsWith('%')));
  assert.equal(marked.text.split('\\MECompareDel{are}\\MECompareSep{}\\MECompareAdd{is}').length - 1, 8);
  assert(marked.text.includes('Changes not shown'), 'Changed source notes remain accounted for separately');
});
test('comment boundaries preserve word joining, newlines and paragraph structure', () => {
  for (const newline of ['\n', '\r\n']) {
    const a = document('in% Keep the joined word.' + newline + 'correct. Rate \\% is small.'), b = a.replace('in%', 'un%').replace('small', 'large');
    const plan = coverage(a, b), marked = renderComparison(a, b, plan, 'Start');
    assert(marked.changes.every(c => c.layout === 'inline'));
    assert(marked.text.includes('\\MECompareDel{in}\\MECompareSep{}\\MECompareAdd{un}% Keep the joined word.' + newline + 'correct.'));
    assert(marked.text.includes('Rate \\% is '));
    const clean = renderComparison(a, b, plan, 'Start', false, 'clean');
    assert(clean.text.includes('un% Keep the joined word.' + newline + 'correct.'));
  }
  const a = document('The old explanation is rather vague.% Retain the continuation.\nThe paragraph continues here.');
  const b = a.replace('The old explanation is rather vague.', 'The new explanation establishes the conclusion by applying the induction hypothesis to the previous step.');
  const plan = coverage(a, b);
  assert.equal(plan.changes[0].layout, 'inline');
  assert.equal(plan.changes[0].paired, false, 'A prose fragment must not become a separate paragraph across a percent join');
  assert.throws(() => applyArrangement(plan, { groups: [{ ids: ['change-1'], layout: 'paired', summary: 'Rewrite.' }] }), /unsupported layout/);
});
test('adding or removing a source note retains exact coverage and ordinary prose markup', () => {
  const plain = 'The claim are true.\nThe proof follows.';
  const annotated = 'The claim is true.\n% A source note.\nThe proof follows.';
  for (const [a, b] of [[plain, annotated], [annotated, plain]]) {
    const before = document(a), after = document(b), plan = coverage(before, after);
    const marked = renderComparison(before, after, plan, 'Start');
    assert(marked.changes.some(c => c.layout !== 'omitted'));
    assert.equal(marked.changes.filter(c => c.layout === 'omitted').length, 1);
    assert.match(marked.changes.find(c => c.layout === 'omitted')!.omission!, /source comment changed/);
  }
});
test('percent signs inside arguments, formulas and literal syntax are not split into prose', () => {
  for (const body of [
    String.raw`\textbf% command argument follows
{old}`,
    String.raw`\textbf{A % note inside a group
old phrase}`,
    String.raw`\[x + % mathematical comment
1 = 2\]`,
    String.raw`\verb|old% literal|`,
    String.raw`\begin{verbatim}
old% literal
\end{verbatim}`,
    String.raw`\unknown% opaque command
{old}`
  ]) {
    const a = document(body), b = a.replace('old', 'new').replace('1 = 2', '2 = 3');
    const marked = renderComparison(a, b, coverage(a, b), 'Start');
    assert(marked.changes.length > 0);
    assert(marked.changes.every(c => c.layout === 'omitted'), body);
  }
});
test('ordinary prose next to headings, theorem wrappers, labels and math remains visible', () => {
  const examples = [
    String.raw`\section{Result}
The allocation are monotone and the argument is complete.`,
    String.raw`\begin{proposition}\label{prop:test} The allocation are monotone and the argument is complete.\end{proposition}`,
    String.raw`The allocation $x(\theta)=\custom{\theta}$ are monotone and the argument is complete.`,
    String.raw`The allocation $x\in[0,1)$ are monotone.\label{halfopen}`,
    String.raw`The allocation $x\in(0,1]$ are monotone.\label{halfclosed}`,
    String.raw`\begin{proof}
\[x=1\label{eq:x}\]
The allocation are monotone and the argument is complete.
\end{proof}`,
    'The allocation are monotone. % An unchanged explanatory comment\nThe proof follows.'
  ];
  for (const body of examples) {
    const a = document(body), b = a.replace(' are ', ' is '), plan = coverage(a, b);
    assert.equal(plan.changes.length, 1, body);
    assert.equal(plan.changes[0].layout, 'inline', body);
    const generated = renderComparison(a, b, plan, 'Test').text;
    assert(generated.includes('\\MECompareDel{are}\\MECompareSep{}\\MECompareAdd{is}'), body);
    assert.equal((generated.match(/\\label\{/g) ?? []).length, (a.match(/\\label\{/g) ?? []).length);
    assert.equal((generated.match(/\\begin\{proposition\}/g) ?? []).length, (a.match(/\\begin\{proposition\}/g) ?? []).length);
    if (body.includes('\\]')) assert(generated.indexOf('\\]') < generated.indexOf('\\MECompareDel{are}'));
  }
});
test('unchanged structure is not repeated, and literals or command arguments stay unsupported', () => {
  for (const body of [String.raw`\verb|old|`, String.raw`\lstinline|old|`, String.raw`\section[old]{Title}`, String.raw`\unknown{old}`]) {
    const a = document(body), b = a.replace('old', 'new'), plan = coverage(a, b);
    assert(plan.changes.every(c => c.layout === 'omitted'), body);
  }
  assert.equal(comparisonPlan(document(String.raw`See \cite[old]{reference}.`), document(String.raw`See \cite[new]{reference}.`)).changes[0].inline, false, 'A citation argument cannot receive inline markup');
  const a = document('The allocation are monotone \\label{result} and the proof follows.'), b = a.replace(' are ', ' is '), plan = comparisonPlan(a, b);
  assert.equal(plan.changes[0].layout, 'inline');
  assert.throws(() => applyArrangement(plan, { groups: [{ ids: ['change-1'], layout: 'paired', summary: 'Repeat it' }] }), /unsupported layout/);
  const marked = renderComparison(a, b, plan, 'Test');
  assert.equal(marked.text.slice(marked.ranges['change-1'].from, marked.ranges['change-1'].to).includes('\\par'), false, 'Inline edits preserve paragraph continuity');
});
test('local prose around unchanged display environments remains visible without repeating math or labels', () => {
  for (const formula of [
    String.raw`\begin{equation}\label{eq:test}x^{\prime}=\varnothing\end{equation}`,
    String.raw`\begin{align*}x&=\custom{y}\\ y&=\varnothing\end{align*}`,
    String.raw`\begin{equation}\begin{split}x&=\custom{y}\\y&=0\end{split}\end{equation}`
  ]) {
    const before = document('The argument are direct.\n' + formula + '\nThe conclusion are immediate.');
    const after = before.replaceAll(' are ', ' is '), plan = coverage(before, after);
    assert(plan.changes.every(c => c.inline && !c.paired));
    for (const presentation of ['markup', 'clean'] as const) {
      const rendered = renderComparison(before, after, plan, 'Start', false, presentation);
      assert(rendered.changes.every(c => c.layout === 'inline'));
      assert.equal(rendered.text.split(formula).length - 1, 1, 'The unchanged formula is retained exactly once');
    }
    const changedMath = after.replace('x', 'z');
    assert(comparisonPlan(before, changedMath).changes.some(c => c.layout === 'omitted'), 'Changes inside structured mathematics remain explicit omissions');
  }
});
test('comparison controls do not prepend body text before an ordinary title', () => {
  const a = document('\\maketitle\nA sentence have a mistake.').replace('\\begin{document}', '\\title{A title}\n\\author{A. Writer}\n\\begin{document}');
  const b = a.replace('have', 'has');
  for (const presentation of ['markup', 'clean'] as const) {
    const rendered = renderComparison(a, b, comparisonPlan(a, b), 'Start', false, presentation);
    assert.equal(rendered.text.slice(documentBody(rendered.text)!.from).trimStart().startsWith('\\maketitle'), true);
    assert(!rendered.text.includes('Root source; current project resources.'));
  }
});
test('inserting or deleting prose immediately before math uses a safe boundary, not a formula byte', () => {
  const old = document(String.raw`Suppose $(b,s)$ blocks an outcome.
\begin{equation}\begin{aligned}x&=\varnothing\\y&=x^{\prime}\end{aligned}\end{equation}`);
  const next = old.replace('Suppose $', 'Suppose that $');
  for (const [a, b] of [[old, next], [next, old]]) {
    const plan = coverage(a, b);
    assert.equal(plan.changes[0].layout, 'inline');
    assert.equal(renderComparison(a, b, plan, 'Start').changes[0].layout, 'inline');
  }
  const a = document(String.raw`A \textbf {word}.`), b = a.replace(' {word}', ' new {word}');
  assert.equal(comparisonPlan(a, b).changes[0].inline, false, 'Do not place prose between a command and its required argument');
});
test('arrangement cannot drop, duplicate, reorder or enable unsupported changes', () => {
  const a = document('A sentence is quite clear.\n\n\\section{Old title}'), b = a.replace('is', 'was').replace('Old title', 'New title'), plan = comparisonPlan(a, b);
  const valid = { groups: plan.changes.map(c => ({ ids: [c.id], layout: 'keep', summary: 'A comparison summary.' })) };
  assert.equal(applyArrangement(plan, valid).changes.length, 2);
  assert(!renderComparison(a, b, applyArrangement(plan, valid), 'Test').text.includes('A comparison summary.'), 'Explanations belong in the viewer, never inside the paper');
  assert.throws(() => applyArrangement(plan, { groups: valid.groups.slice(1) }));
  assert.throws(() => applyArrangement(plan, { groups: [...valid.groups].reverse() }));
  assert.throws(() => applyArrangement(plan, { groups: [...valid.groups, valid.groups[0]] }));
  assert.throws(() => applyArrangement(plan, { groups: valid.groups.map(g => ({ ...g, layout: 'inline' })) }));
});
test('unbraced arguments and paragraph-spanning groups cannot absorb comparison markers', () => {
  for (const body of [String.raw`\textbf Old result.`, String.raw`\textbf % keep the argument on the next line
Old result.`, String.raw`\footnote{First paragraph.

Old result.

Final paragraph.}`, String.raw`{First paragraph.

Old result.

Final paragraph.}`]) {
    const a = document(body), b = a.replace('Old result.', 'New result.');
    const plan = coverage(a, b);
    assert(plan.changes.every(c => c.layout === 'omitted'), body);
    assert(plan.changes.every(c => /argument|group/.test(c.omission!)));
    for (const style of ['markup', 'clean'] as const) {
      const rendered = renderComparison(a, b, plan, 'Start', false, style);
      assert(rendered.text.includes(body.replace('Old result.', 'New result.')), 'Unsupported source is left intact');
    }
  }
  const a = document(String.raw`\textbf{Old result.} The conclusion are direct.`), b = a.replace('are', 'is');
  assert.equal(coverage(a, b).changes[0].layout, 'inline', 'A completed braced argument does not hide neighboring prose');
});
test('clean presentation has no markup dependencies and markup respects preloaded ulem', () => {
  const a = document('An old result.'), b = a.replace('old', 'new');
  const clean = renderComparison(a, b, comparisonPlan(a, b), 'Start', false, 'clean').text;
  assert(!clean.includes('ulem')); assert(!clean.includes('xcolor')); assert(!clean.includes('MECompareDel'));
  const markup = renderComparison(a, b, comparisonPlan(a, b), 'Start').text;
  assert(markup.includes('\\@ifpackageloaded{ulem}{}'));
});
test('clean paper keeps revised source once, deletion markers and explicit omitted changes', () => {
  const a = document('A complete old paragraph.\n\nA paragraph to remove.\n\n\\[x+1=2\\]\n\nAn ending.');
  const b = a.replace('old', 'revised').replace('A paragraph to remove.\n\n', '').replace('x+1=2', 'x+2=3');
  const plan = coverage(a, b), clean = renderComparison(a, b, plan, 'Session start', false, 'clean');
  assert.equal(clean.changes.length, plan.changes.length);
  const body = documentBody(b)!;
  const renderedBody = clean.text.slice(documentBody(clean.text)!.from, documentBody(clean.text)!.to)
    .replace(/\\MECompareMark\{\d+\}/g, '').replaceAll('\\mbox{}', '');
  assert.equal(renderedBody, b.slice(body.from, body.to), 'Clean body preserves exact revised bytes apart from its markers');
  assert(!clean.text.includes('A paragraph to remove.'));
  assert(Object.keys(clean.ranges).length === plan.changes.length, 'Entirely deleted paragraphs retain a location');
  const unsupported = comparisonPlan(a, b.replace('article', 'report'));
  assert(renderComparison(a, b.replace('article', 'report'), unsupported, 'Session start', false, 'clean').text.includes('Change 1 not shown.'));
});
test('presentation limits keep every change ID instead of silently hiding unsupported markup', () => {
  const a = document('For $x=1$ the statement holds.'), b = a.replace('x=1', 'x=2');
  const plan = comparisonPlan(a, b), marked = renderComparison(a, b, plan, 'Start'), clean = renderComparison(a, b, plan, 'Start', false, 'clean');
  assert.notEqual(plan.changes[0].layout, 'omitted');
  assert.equal(marked.changes[0].layout, 'omitted');
  assert.match(marked.changes[0].omission!, /Clean paper shows the revised passage/);
  assert(marked.text.includes('Change 1 not shown.'));
  assert.notEqual(clean.changes[0].layout, 'omitted');
  assert.deepEqual(marked.changes.map(c => c.id), clean.changes.map(c => c.id));
  assert(clean.text.includes('For $x=2$ the statement holds.'));
});
test('no wrapper, macro collision and excessive changed blocks stop without a fallback', () => {
  assert.throws(() => comparisonPlan('old', 'new'), /Preview not possible/);
  const a = document('A word.'), b = document('A MECompare word.');
  assert.throws(() => renderComparison(a, b, comparisonPlan(a, b), 'Test'), /macro conflict/);
  const many = Array.from({ length: 101 }, (_, i) => 'Paragraph ' + i + ' old.').join('\n\n');
  assert.throws(() => comparisonPlan(document(many), document(many.replaceAll('old', 'new'))), /100 (changed|paragraphs)/);
});
async function scratch(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = path.resolve('.test-runs', 'changes-' + randomUUID()); await fs.mkdir(dir, { recursive: true });
  t.after(() => fs.rm(dir, { recursive: true, force: true })); return dir;
}
test('journal records actual edited acceptance, rebases later typing, survives reopen and Undo', async t => {
  const dir = await scratch(t), a = document('The allocation are monotone.'), b = a.replace('are', 'is'), c = b.replace('monotone', 'weakly monotone');
  const from = a.indexOf('The allocation'), original = 'The allocation are monotone.';
  const open = commentSchema.parse({ id: 'c', title: 'Grammar', explanation: 'Use the singular verb.', original, replacement: 'The allocation is strictly monotone.', draft: 'The allocation is monotone.', from, to: from + original.length, validity: 'current' });
  const applied = { ...open, decision: 'applied' as const, appliedText: 'The allocation is monotone.' };
  const journal = new ChangeJournal(); await journal.open(dir, a, [open]); await journal.record(b, [applied]); await journal.record(c, [applied]);
  const reasons = journal.explain(a, c, comparisonPlan(a, c)).changes[0].reasons;
  assert.equal(reasons.length, 1); assert.equal(reasons[0].text, open.explanation); assert(reasons[0].edited);
  await journal.record(a, [open]); assert.equal(journal.explain(a, a, comparisonPlan(a, a)).changes.length, 0);
  await journal.record(b, [applied]);
  const reopened = new ChangeJournal(); await reopened.open(dir, b, [applied]);
  assert.equal(reopened.explain(a, b, comparisonPlan(a, b)).changes[0].reasons.length, 1);
  assert.deepEqual(reopened.explain(document('Different baseline.'), b, comparisonPlan(document('Different baseline.'), b)).changes[0].reasons, []);
});
test('invalid or oversized journals never block recovery or overwrite their bytes', async t => {
  const dir = await scratch(t), a = document('Old paragraph.'), b = document('New paragraph.');
  const file = path.join(dir, 'change-journal.json'); await fs.writeFile(file, 'invalid');
  const journal = new ChangeJournal(); await journal.open(dir, a, []); await journal.record(b, []);
  assert(journal.notice); assert.equal(await fs.readFile(file, 'utf8'), 'invalid');
  const original = 'New paragraph.', from = b.indexOf(original), comment = commentSchema.parse({ id: 'c', title: 'Revise', explanation: 'Be specific.', original, replacement: 'Precise paragraph.', from, to: from + original.length, validity: 'current' });
  await journal.record(b, [comment]);
  assert.equal(journal.proposal(b, proposalPreview(b, comment).text, comment.id)?.origin, 'proposal', 'A paused journal still validates the live proposal');
  const projectFile = path.join(dir, 'paper.tex'); await fs.writeFile(projectFile, a);
  const projects = new ProjectService(path.join(dir, 'cache')), p = await projects.open(projectFile), state = await projects.stateDirectory(p.id);
  await fs.writeFile(path.join(state, 'change-journal.json'), 'x'.repeat(8_000_001));
  const reopened = await projects.open(projectFile);
  await projects.persist({ projectId: reopened.id, text: b, review: reopened.review });
  await projects.save({ projectId: reopened.id, text: b, review: reopened.review });
  assert.equal(await fs.readFile(projectFile, 'utf8'), b);
  assert.equal((await fs.stat(path.join(state, 'change-journal.json'))).size, 8_000_001);
});
test('Undo removes an acceptance reason even after earlier and later manual edits', async t => {
  const dir = await scratch(t), a = document('The cat are fast.'), b = document('The cat are swift.'), c = document('The cat is swift.'), d = document('The cat are very swift.');
  const original = 'The cat are swift.', from = b.indexOf(original), open = commentSchema.parse({ id: 'grammar', title: 'Grammar', explanation: 'Use singular is, not are.', original, replacement: 'The cat is swift.', from, to: from + original.length, validity: 'current' });
  const applied = { ...open, decision: 'applied' as const, appliedText: open.replacement! };
  const journal = new ChangeJournal(); await journal.open(dir, a, []);
  await journal.record(b, [open]); await journal.record(c, [applied]); await journal.record(b, [open]); await journal.record(d, [open]);
  assert.deepEqual(journal.explain(a, d, comparisonPlan(a, d)).changes[0].reasons, []);
  // Typing the formerly accepted wording later is still a manual edit.
  await journal.record(c, [open]);
  assert.deepEqual(journal.explain(a, c, comparisonPlan(a, c)).changes[0].reasons, []);
  await journal.record(b, [open]); await journal.record(c, [applied]);
  assert.equal(journal.explain(a, c, comparisonPlan(a, c)).changes[0].reasons[0].text, open.explanation);
});
test('comparison service cancels late builds and only sends a prepared, source-bound model request', async t => {
  const dir = await scratch(t), a = document('This argument is clear.'), b = a.replace('clear', 'precise');
  const file = path.join(dir, 'paper.tex'); await fs.writeFile(file, a);
  const projects = new ProjectService(path.join(dir, 'cache')), p = await projects.open(file);
  let release!: () => void, called = 0;
  const compiler = { inspect: async () => ({status: 'valid'}), compile: async (...args: unknown[]) => {
    assert.equal(args[5], 'comparison'); await new Promise<void>(r => { release = r; });
    return { id: randomUUID(), success: true, clean: true, dependenciesVerified: true, purpose: 'comparison', sourceHash: digest(String(args[1])), diagnostics: [], log: '', elapsedMs: 1, engine: 'pdflatex' };
  } };
  const codex = { arrangeChanges: async () => { called++; return { groups: [{ ids: ['change-1'], layout: 'keep', summary: 'Clearer wording.' }] }; } };
  const service = new ChangesPdfService(projects, compiler as any, codex as any);
  const input = { projectId: p.id, before: a, after: b, engine: 'pdflatex' as const, name: 'Session start' };
  const preview = service.prepare(input); assert.equal(called, 0); assert(preview.prompt.includes('precise'));
  await assert.rejects(service.arrange({ ...input, after: a }, preview.id, () => {}), /current arrangement/);
  const arranged = await service.arrange(input, preview.id, () => {}); assert(arranged.id); assert.equal(called, 1);
  const pending = service.build(input); service.cancel(); release(); await assert.rejects(pending, /cancelled/);
  assert.equal(await fs.readFile(file, 'utf8'), a);
});
test('empty and entirely unsupported comparisons do not compile an unmarked paper', async t => {
  const dir = await scratch(t), a = document('An unchanged paragraph.');
  const file = path.join(dir, 'paper.tex'); await fs.writeFile(file, a);
  const projects = new ProjectService(path.join(dir, 'cache')), p = await projects.open(file);
  const compiler = { compile: async () => { assert.fail('An empty or fully unsupported comparison must not compile'); } };
  const service = new ChangesPdfService(projects, compiler as any);
  const input = { projectId: p.id, before: a, after: a, name: 'Session start', engine: 'pdflatex' as const };
  const empty = await service.build(input); assert.equal(empty.build, null); assert.equal(empty.changes.length, 0);
  const unavailable = await service.build({ ...input, after: a.replace('article', 'report') });
  assert.equal(unavailable.build, null); assert.equal(unavailable.changes[0].layout, 'omitted');
  assert.equal(await fs.readFile(file, 'utf8'), a);
});
test('local presentation switches retain immutable source, do not call Sol, and reject stale resources', async t => {
  const dir = await scratch(t), a = document('The argument is clear.'), b = a.replace('clear', 'precise');
  const file = path.join(dir, 'paper.tex'); await fs.writeFile(file, a);
  const projects = new ProjectService(path.join(dir, 'cache')), p = await projects.open(file);
  const compiled: string[] = []; let valid = true, modelCalls = 0;
  const compiler = {
    inspect: async () => ({ status: valid ? 'valid' : 'changed' }),
    compile: async (...args: unknown[]) => { compiled.push(String(args[1])); return { id: randomUUID(), success: true, dependenciesVerified: true, purpose: 'comparison', diagnostics: [] }; }
  };
  const codex = { planChanges: async () => { modelCalls++; return { inspect: [], groups: [{ ids: ['change-1'], layout: 'keep', summary: 'Wording clarification.' }] }; } };
  const service = new ChangesPdfService(projects, compiler as any, codex as any);
  const input = { projectId: p.id, before: a, after: b, name: 'Session start', engine: 'pdflatex' as const };
  const arrangement = await service.smartPlan(input, () => {});
  const marked = await service.build({ ...input, arrangementId: arrangement.id });
  const clean = await service.present(p.id, marked.id, 'clean');
  assert.equal(marked.presentation, 'markup'); assert.equal(clean.presentation, 'clean');
  assert.equal(modelCalls, 1); assert.equal(compiled.length, 2);
  assert(compiled[0].includes('\\MECompareDel{clear}')); assert(compiled[1].includes('precise'));
  assert(!compiled[1].includes('\\MECompareDel{clear}'));
  assert.equal(clean.visual, undefined, 'Do not reuse a visual verdict from another presentation');
  assert.deepEqual(clean.changes, marked.changes);
  assert.equal(await fs.readFile(file, 'utf8'), a);
  valid = false;
  await assert.rejects(service.present(p.id, clean.id, 'markup'), /inputs changed/);
  assert.equal(compiled.length, 2);
  await assert.rejects(service.present(p.id, randomUUID(), 'clean'), /no longer available/);
});
test('comparison navigation caches exact PDF markers and never substitutes an approximate source position', async () => {
  const before = document('The argument is clear.'), after = before.replace('clear', 'precise');
  const projects = { get() {}, changeJournal: { explain(_: string, __: string, plan: unknown) { return plan; } } };
  let reads = 0, valid = true;
  const compiler = { compile: async () => ({ id: 'build', success: true, dependenciesVerified: true }),
    inspect: async () => ({ status: valid ? 'valid' : 'changed' }), pdf: async () => new Uint8Array(),
    locatePdf: async () => { assert.fail('Approximate navigation must not be used.'); } };
  const service = new ChangesPdfService(projects as any, compiler as any, undefined, async () => { reads++; return { 'change-1': { page: 4, x: 20, y: 10, width: 18, height: 12 } }; });
  const artifact = await service.build({ projectId: 'paper', before, after, name: 'Start', engine: 'pdflatex' });
  for (let i = 0; i < 2; i++) assert.deepEqual(await service.locate('paper', artifact.id, 'change-1'), { kind: 'mapped', buildId: 'build', page: 4, x: 20, y: 10, width: 18, height: 12 });
  assert.equal(reads, 1);
  assert.equal((await service.locate('paper', artifact.id, 'change-2')).kind, 'unavailable');
  valid = false;
  assert.equal((await service.locate('paper', artifact.id, 'change-1')).kind, 'unavailable');
});
test('cancelling exact PDF marker parsing cannot publish a late location', async () => {
  const before = document('The argument is clear.'), after = before.replace('clear', 'precise');
  const projects = { get() {}, changeJournal: { explain(_: string, __: string, plan: unknown) { return plan; } } };
  const compiler = { compile: async () => ({ id: 'build', success: true, dependenciesVerified: true }), inspect: async () => ({ status: 'valid' }), pdf: async () => new Uint8Array() };
  let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
  const service = new ChangesPdfService(projects as any, compiler as any, undefined, async (_, __, signal) => {
    started(); await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
    return { 'change-1': { page: 4, x: 20, y: 10, width: 18, height: 12 } };
  });
  const artifact = await service.build({ projectId: 'paper', before, after, name: 'Start', engine: 'pdflatex' });
  const location = service.locate('paper', artifact.id, 'change-1'); await ready; service.cancel();
  assert.equal((await location).kind, 'unavailable'); await service.settle();
});
