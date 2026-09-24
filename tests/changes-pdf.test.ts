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
  assert(marked.text.includes('\\MECompareDel{have}\\MECompareAdd{has}'));
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
    assert(generated.includes('\\MECompareDel{are}\\MECompareAdd{is}'), body);
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
test('clean paper keeps revised source once, deletion markers and explicit omitted changes', () => {
  const a = document('A complete old paragraph.\n\nA paragraph to remove.\n\n\\[x+1=2\\]\n\nAn ending.');
  const b = a.replace('old', 'revised').replace('A paragraph to remove.\n\n', '').replace('x+1=2', 'x+2=3');
  const plan = coverage(a, b), clean = renderComparison(a, b, plan, 'Session start', false, 'clean');
  assert.equal(clean.changes.length, plan.changes.length);
  const body = documentBody(b)!;
  const renderedBody = clean.text.split('\\par\\medskip\n')[1].slice(0, -b.slice(body.to).length)
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
