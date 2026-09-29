import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChangesPdfService, renderComparison } from '../src/main/changes-pdf.ts';
import { comparisonPlan, applyArrangement, type ChangesInput } from '../src/shared/changes-pdf.ts';

const doc = (text: string) => '\\documentclass{article}\n\\begin{document}\n\n' + text + '\n\n\\end{document}\n';
const before = doc('The argument are correct.');
const input: ChangesInput = { projectId: 'one', before, after: before.replace('are', 'is'), name: 'Start', engine: 'pdflatex' };
function fixture() {
  let calls = 0, valid = true, pdfAvailable = true, inspect = async () => ({ status: valid ? 'valid' as const : 'changed' as const });
  const projects = { get() { return { name: 'main.tex' }; }, changeJournal: { explain(_: string, __: string, p: unknown) { return p; } } };
  const compiler = {
    latexmk: '/test/latexmk',
    async compile() { return { id: 'build-' + ++calls, purpose: 'comparison', success: true, dependenciesVerified: true }; },
    inspect: (..._args: unknown[]) => inspect(),
    async pdf() { if (!pdfAvailable) throw Error('Deleted cached PDF'); return Buffer.from('%PDF-1.7 synthetic'); }
  };
  const codex = { async planChanges(_: string, prompt: string) { return { groups: JSON.parse(prompt).changes.map((c: { id: string }) => ({ ids: [c.id], layout: 'keep', summary: 'Use a singular verb.' })), inspect: [] }; } };
  const service = new ChangesPdfService(projects as any, compiler as any, codex as any);
  return { service, compiler, projects, count: () => calls, invalidate: () => { valid = false; }, losePdf: () => { pdfAvailable = false; },
    holdValidation() { let release!: () => void; inspect = () => new Promise(resolve => { release = () => resolve({ status: 'valid' }); }); return () => release(); } };
}

test('comparison export returns the exact displayed source in either style without compiling or using a new plan', async () => {
  const f = fixture(), markup = await f.service.build(input);
  const expected = renderComparison(input.before, input.after, comparisonPlan(input.before, input.after), input.name);
  assert.deepEqual(f.service.exportSource('one', markup.id), { name: 'main.tex', text: expected.text });
  const clean = await f.service.present('one', markup.id, 'clean');
  assert.equal(f.service.exportSource('one', clean.id).text, renderComparison(input.before, input.after, comparisonPlan(input.before, input.after), input.name, false, 'clean').text);
  const calls = f.count();
  f.invalidate();
  assert.equal(f.service.exportSource('one', markup.id).text, expected.text, 'Older snapshots remain exact after resources change');
  assert.equal(f.count(), calls, 'Export does not compile');
  assert.throws(() => f.service.exportSource('two', markup.id), /no longer available/);
  assert.throws(() => f.service.exportSource('one', 'missing'), /no longer available/);
  const none = await f.service.build({ ...input, after: input.before });
  assert.throws(() => f.service.exportSource('one', none.id), /no longer available/);
  f.projects.get = () => { throw Error('Paper closed'); };
  assert.throws(() => f.service.exportSource('one', markup.id), /Paper closed/);
});

test('local PDF is reused after Sol adds only explanations; new reasons never borrow a visual verdict', async () => {
  const f = fixture(), local = await f.service.build(input), plan = await f.service.smartPlan(input, () => {});
  const enriched = await f.service.build({ ...input, arrangementId: plan.id });
  assert.equal(enriched.build?.id, local.build?.id); assert.equal(f.count(), 1); assert.equal(enriched.reused, true);
  assert.notEqual(enriched.id, local.id); assert.equal(local.changes[0].summary, undefined);
  assert.equal(enriched.changes[0].summary, 'Use a singular verb.'); assert.equal(enriched.visual?.status, 'not-requested');
  const refresh = await f.service.build(input);
  assert.equal(refresh.build?.id, local.build?.id); assert.equal(refresh.changes[0].summary, undefined); assert.equal(refresh.visual, undefined);
});

test('reusing a source plan still reads current journal reasons and cannot leak old summaries', async () => {
  const f = fixture(); let reason = 'Original acceptance reason.';
  f.projects.changeJournal.explain = (_, __, plan: any) => ({ ...plan, changes: plan.changes.map((c: any) => ({ ...c, reasons: [{ text: reason, origin: 'accepted', edited: false }] })) });
  const first = await f.service.build(input), arranged = await f.service.smartPlan(input, () => {});
  const enriched = await f.service.build({ ...input, arrangementId: arranged.id });
  reason = 'Updated recorded reason.';
  const updated = await f.service.build(input);
  assert.equal(updated.build?.id, first.build?.id); assert.equal(f.count(), 1);
  assert.equal(first.changes[0].reasons[0].text, 'Original acceptance reason.');
  assert.equal(updated.changes[0].reasons[0].text, reason); assert.equal(updated.changes[0].summary, undefined);
  assert(enriched.changes[0].summary); assert.equal(updated.visual, undefined);
});

test('comparison reuse checks engine, project, presentation, source, selection and compiler path', async () => {
  for (const change of [
    { engine: 'lualatex' }, { projectId: 'two' }, { presentation: 'clean' },
    { after: input.after.replace('correct', 'precise') }, { selectedPaths: ['paper.tex'] }
  ]) {
    const f = fixture(), first = await f.service.build(input), next = await f.service.build({ ...input, ...change } as ChangesInput);
    assert.notEqual(first.build?.id, next.build?.id); assert.equal(f.count(), 2); assert.equal(next.reused, false);
  }
  const f = fixture(); await f.service.build(input); f.compiler.latexmk = '/different/latexmk'; await f.service.build(input); assert.equal(f.count(), 2);
});

test('changed resources and removed PDFs trigger real rebuilds, while returning to a cached style reuses it', async () => {
  const f = fixture(), first = await f.service.build(input), clean = await f.service.present('one', first.id, 'clean');
  const again = await f.service.present('one', clean.id, 'markup'); assert.equal(again.build?.id, first.build?.id); assert.equal(f.count(), 2);
  f.losePdf(); await f.service.build(input); assert.equal(f.count(), 3);
  const invalid = fixture(); await invalid.service.build(input); invalid.invalidate();
  await assert.rejects(invalid.service.build(input), /inputs changed during compilation/);
  assert.equal(invalid.count(), 2, 'Invalid input identity cannot return the old cached build');
});

test('cancelling while cache validation is pending cannot publish a reused artifact', async () => {
  const f = fixture(); await f.service.build(input); const release = f.holdValidation();
  const pending = f.service.build(input), rejected = assert.rejects(pending, /cancelled/);
  f.service.cancel(); release(); await rejected; await f.service.settle(); assert.equal(f.count(), 1);
});

test('substantial plain prose gets labelled pairs; local corrections and comment-joined fragments remain inline', () => {
  const a = doc('The distribution of types does not affect this pointwise optimum.\nAn aggregate resource constraint would require a separate argument.');
  const b = a.replace('The distribution of types does not affect this pointwise optimum.', 'The pointwise optimum is independent of the type distribution.');
  const plan = comparisonPlan(a, b), c = plan.changes[0]; assert.equal(c.layout, 'paired'); assert.equal(c.inline, false);
  assert((c.editCount ?? 0) >= 3);
  const generated = renderComparison(a, b, plan, 'Start');
  assert(generated.text.includes('\\sffamily Before}')); assert(generated.text.includes('\\sffamily After}'));
  assert(generated.text.includes('\\MECompareDel{' + c.oldText.trim() + '}'));
  assert(generated.text.includes('\\MECompareAdd{' + c.newText.trim() + '}'));
  assert.throws(() => applyArrangement(plan, { groups: [{ ids: [c.id], layout: 'inline', summary: 'Scatter the fragments.' }] }), /unsupported inline/);
  assert.equal(comparisonPlan(input.before, input.after).changes[0].layout, 'inline');
  for (const verb of ['converge', 'follow', 'exist']) {
    const original = doc('It ' + verb + '.');
    assert.equal(comparisonPlan(original, original.replace(verb, verb + 's')).changes[0].layout, 'inline', 'One-letter corrections stay inline even in short paragraphs');
  }
  const joined = a.replace('optimum.\n', 'optimum.% Keep the paragraph joined.\n');
  const revised = joined.replace('The distribution of types does not affect this pointwise optimum.', 'The pointwise optimum is independent of the type distribution.');
  assert.equal(comparisonPlan(joined, revised).changes[0].layout, 'inline');
});

test('source-only notes are identified without describing preamble, formula or formatting changes as notes', () => {
  const a = doc('% old note\nThe statement is true.\n\n\\[x=1\\]'), b = a.replace('% old note', '% new note');
  assert.equal(comparisonPlan(a, b).changes[0].omissionKind, 'source-only');
  assert.equal(comparisonPlan(a, a.replace('article', 'report')).changes[0].omissionKind, 'unsupported');
  assert.equal(comparisonPlan(a, a.replace('is true', 'is  true')).changes[0].omissionKind, 'unsupported');
  assert.notEqual(comparisonPlan(a, a.replace('x=1', 'x=2')).changes[0].omissionKind, 'source-only');
});
