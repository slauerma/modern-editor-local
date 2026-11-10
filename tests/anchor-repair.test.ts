import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Transaction } from '@codemirror/state';
import { undo, redo, isolateHistory } from '@codemirror/commands';
import { commentSchema } from '../src/shared/contracts.ts';
import { adoptComment, proposalChanges } from '../src/shared/review.ts';
import { prepareAnchorRepair, resolveAnchorRepair, anchorRepairPatches, needsAnchorRepair, anchorRepairOutputSchema } from '../src/shared/anchor-repair.ts';
import { initialState, commentsField, loadComments, patchComments } from '../src/renderer/editor-state.ts';
import { CodexService } from '../src/main/codex-service.ts';
import { ProjectService } from '../src/main/project-service.ts';

const oldText = 'We cite Mesatri for this claim.\nThe proof are short.';
const text = 'A new opening. We cite Mesatri for this claim.\nThe proof are short.';
function stale(id = 'name', original = 'Mesatri', replacement = 'Maestri') {
  return { ...adoptComment(oldText, commentSchema.parse({ id, original, replacement, title: 'Correct the name', explanation: 'The bibliography spells it Maestri.' })), validity: 'stale' as const };
}
const selected = (id = 'name', candidateId: number | null = 1) => ({ id, candidateId, reason: 'Same citation and surrounding sentence.' });

test('repair finds exact original wording after offsets/context move, and never changes a proposal', () => {
  const c = stale(), plan = prepareAnchorRepair(text, [c]);
  assert.equal(plan.items.length, 1);
  const prompt = JSON.parse(plan.prompt);
  assert.equal(prompt.comments[0].previous.before, 'We cite ');
  assert.equal(prompt.comments[0].candidates[0].before, 'A new opening. We cite ');
  assert.equal(prompt.comments[0].candidates[0].from, undefined);
  const result = resolveAnchorRepair(plan, { matches: [selected()] });
  const patches = anchorRepairPatches({ projectId: 'p', text, comments: [c] }, text, [c], result);
  const fixed = { ...c, ...patches[0].fields };
  assert.equal(fixed.validity, 'current'); assert.equal(fixed.from, text.indexOf('Mesatri'));
  assert.equal(fixed.original, c.original); assert.equal(fixed.replacement, c.replacement);
  assert.equal(proposalChanges(text, fixed)[0].insert, 'Maestri');
  assert.deepEqual(Object.keys(patches[0].fields).sort(), ['after', 'before', 'from', 'to', 'validity']);
});

test('repeated wording requires a candidate choice; uncertainty and missing words stay unresolved', () => {
  const c = stale(), repeated = text + '\nAnother person named Mesatri writes about art.';
  const plan = prepareAnchorRepair(repeated, [c, stale('missing', 'removed words'), { ...c, id: 'accepted', decision: 'applied' }, { ...c, id: 'rejected', decision: 'dismissed' }, { ...c, id: 'current', validity: 'current' }]);
  assert.equal(plan.items.length, 1); assert.equal(plan.items[0].candidates.length, 2);
  assert.equal(plan.unresolved[0].id, 'missing');
  assert.equal(resolveAnchorRepair(plan, { matches: [selected('name', 2)] }).repairs[0].from, repeated.lastIndexOf('Mesatri'));
  assert.equal(resolveAnchorRepair(plan, { matches: [selected('name', null)] }).repairs.length, 0);
  assert.equal(resolveAnchorRepair(plan, { matches: [selected('name', null)] }).unresolved.length, 2);
  for (const matches of [[selected('unknown')], [selected(), selected()], [selected('name', 42)], []]) {
    assert.throws(() => resolveAnchorRepair(plan, { matches }), /No anchors were changed/);
  }
  assert.throws(() => resolveAnchorRepair(plan, { matches: [{ ...selected(), replacement: 'unrequested edit' }] }));
});

test('source edits invalidate a result; manual reattachment/decisions survive; latest drafts and arrivals survive', () => {
  const c = stale(), snapshot = { projectId: 'p', text, comments: [c] };
  const result = resolveAnchorRepair(prepareAnchorRepair(text, [c]), { matches: [selected()] });
  assert.throws(() => anchorRepairPatches(snapshot, text + '!', [c], result), /source changed/);
  for (const fields of [{ decision: 'dismissed' as const }, { validity: 'current' as const }, { original: 'new quote' }, { before: 'new context' }]) {
    assert.deepEqual(anchorRepairPatches(snapshot, text, [{ ...c, ...fields }], result), []);
  }
  const updated = { ...c, draft: 'My draft', replyDraft: 'Keep my question', later: true };
  const patches = anchorRepairPatches(snapshot, text, [updated, stale('arrived')], result);
  assert.equal(patches.length, 1);
  assert.equal(({ ...updated, ...patches[0].fields }).draft, 'My draft');
  assert.throws(() => anchorRepairPatches(snapshot, text, [c], { repairs: [{ id: c.id, from: 0, to: 7 }], unresolved: [] }), /exact original/);
});

test('repair is one undoable metadata transaction and leaves background arrivals intact', () => {
  const comments = [stale(), stale('proof', 'The proof are short.', 'The proof is short.')];
  const snapshot = { projectId: 'p', text, comments };
  const result = resolveAnchorRepair(prepareAnchorRepair(text, comments), { matches: comments.map(c => selected(c.id)) });
  let state = initialState(text, comments);
  state = state.update({ effects: patchComments.of(anchorRepairPatches(snapshot, text, comments, result)), annotations: isolateHistory.of('full') }).state;
  assert(state.field(commentsField).every(c => c.validity === 'current'));
  const arrival = stale('arrived-later');
  state = state.update({ effects: loadComments.of([...state.field(commentsField), arrival]), annotations: Transaction.addToHistory.of(false) }).state;
  const dispatch = (tr: Transaction) => { state = tr.state; };
  assert(undo({ state, dispatch })); assert.deepEqual(state.field(commentsField), [...comments, arrival]);
  assert(redo({ state, dispatch })); assert(state.field(commentsField).slice(0, 2).every(c => c.validity === 'current'));
  assert.deepEqual(state.field(commentsField)[2], arrival); assert.equal(state.doc.toString(), text);
});

test('small ordinary source edits preserve unrelated current anchors', () => {
  const comments = [adoptComment(oldText, stale()), adoptComment(oldText, stale('proof', 'The proof are short.'))].map(c => ({ ...c, validity: 'current' as const }));
  let state = initialState(oldText, comments);
  state = state.update({ changes: { from: 0, insert: 'New. ' } }).state;
  assert(state.field(commentsField).every(c => c.validity === 'current'));
  state = state.update({ changes: { from: state.field(commentsField)[1].from + 4, insert: 'brief ' } }).state;
  assert.equal(state.field(commentsField)[0].validity, 'current'); assert.equal(state.field(commentsField)[1].validity, 'stale');
});

async function fixture(t: any) {
  const root = path.resolve('.test-runs', 'anchor-repair-' + randomUUID()); await fs.mkdir(root, { recursive: true });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'paper.txt'); await fs.writeFile(file, text);
  const projects = new ProjectService(path.join(root, 'runtime')), p = await projects.open(file);
  return { root, file, p, projects, service: new CodexService(projects, path.join(root, 'codex')) };
}

test('repair uses Sol High Fast, saves/reopens placements and preserves source and paper settings', async t => {
  const f = await fixture(t), c = stale(), request = { projectId: f.p.id, text, comments: [c] };
  await f.projects.setEffort(f.p.id, 'low'); await f.projects.setFastMode(f.p.id, false);
  let call: any;
  f.service.anchorClient.run = async (prompt, schema, _progress, effort, fast, reader, config) => {
    call = { prompt: JSON.parse(prompt), schema, effort, fast, reader, config };
    return { matches: [selected()] };
  };
  const result = await f.service.repairAnchors(request, () => {});
  assert.equal(call.effort, 'high'); assert.equal(call.fast, true); assert.equal(call.config.model, 'gpt-6.1-sol');
  assert.equal(call.config.purpose, 'anchors'); assert.equal(call.reader, undefined); assert.deepEqual(call.schema, anchorRepairOutputSchema);
  assert.equal(f.projects.get(f.p.id).effort, 'low'); assert.equal(f.projects.get(f.p.id).fastMode, false);
  const fixed = { ...c, ...anchorRepairPatches(request, text, [c], result)[0].fields };
  await f.projects.persist({ projectId: f.p.id, text, review: { ...f.p.review, comments: [fixed] } });
  const reopened = await new ProjectService(path.join(f.root, 'reopened')).open(f.file);
  assert.equal(reopened.review.comments[0].validity, 'current'); assert.equal(reopened.review.comments[0].from, fixed.from);
  assert.equal(reopened.text, text); assert.equal(await fs.readFile(f.file, 'utf8'), text);
  assert.deepEqual(await f.service.repairAnchors({ ...request, comments: [{ ...c, original: 'no longer here' }] }, () => {}), { repairs: [], unresolved: [{ id: c.id, reason: 'The original words have changed or are missing. Check this suggestion manually.' }] });
});

test('cancellation discards even a late successful model response', async t => {
  const f = await fixture(t); let release!: () => void;
  f.service.anchorClient.run = async () => { await new Promise<void>(r => { release = r; }); return { matches: [selected()] }; };
  const pending = f.service.repairAnchors({ projectId: f.p.id, text, comments: [stale()] }, () => {});
  await f.service.cancelAnchorRepair(); release();
  await assert.rejects(pending, /cancelled/); await f.service.settle();
});

test('review cancellation leaves parallel repair running, and repair cancellation leaves the review client alone', async t => {
  const f = await fixture(t); let release!: () => void, reviewStops = 0, anchorStops = 0;
  f.service.client.cancel = async () => { reviewStops++; };
  f.service.anchorClient.cancel = async () => { anchorStops++; };
  f.service.anchorClient.run = async () => { await new Promise<void>(r => { release = r; }); return { matches: [selected()] }; };
  const pending = f.service.repairAnchors({ projectId: f.p.id, text, comments: [stale()] }, () => {});
  await f.service.cancel(); release();
  assert.equal((await pending).repairs.length, 1);
  assert.equal(reviewStops, 1); assert.equal(anchorStops, 0);
  await f.service.cancelAnchorRepair();
  assert.equal(reviewStops, 1); assert.equal(anchorStops, 1);
});

test('quick requests are bounded and flag excluded originals instead of guessing', () => {
  const repeated = prepareAnchorRepair('word '.repeat(100), [stale('repeat', 'word')]);
  assert.equal(repeated.items.length, 0); assert.match(repeated.unresolved[0].reason, /Too many/);
  const comments = Array.from({ length: 200 }, (_, i) => stale(String(i)));
  const plan = prepareAnchorRepair(text, comments);
  assert.equal(plan.items.length + plan.unresolved.length, comments.length);
  assert(plan.prompt.length < 120000);
  assert(needsAnchorRepair({ ...stale(), later: true }));
});
