import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Transaction } from '@codemirror/state';
import { isolateHistory, undo, redo } from '@codemirror/commands';
import { commentSchema, reviewSchema, defaultWorkspace, workspaceSchema } from '../src/shared/contracts.ts';
import { addWordings, selectWording, wordingChoices, wordingReason } from '../src/shared/alternatives.ts';
import { mergeResult } from '../src/shared/result-arrival.ts';
import { replyFields, linkQuestionToSelection, proposalChanges } from '../src/shared/review.ts';
import { quickAlternativeQuestion, replyContext } from '../src/shared/codex-context.ts';
import { initialState, commentsField, loadComments, patchComments, applyProposal } from '../src/renderer/editor-state.ts';
import { ProjectService } from '../src/main/project-service.ts';
import { CodexService, quickAlternativeOutputSchema } from '../src/main/codex-service.ts';
import { digest } from '../src/main/files.ts';

const source = 'The allocation are monotone.\nThe proof follows.';
const original = 'The allocation are monotone.';
const c = () => commentSchema.parse({ id: 'c', title: 'Grammar', explanation: 'Use a singular verb.', original, replacement: 'The allocation is monotone.', from: 0, to: original.length, validity: 'current', draft: 'My wording.', replyDraft: 'My unsent question.' });
const option = { label: 'Shorter', reason: 'States the same property directly.', replacement: 'Allocation is monotone.', packages: [] };
async function fixture(t: any) {
  const root = path.resolve('.test-runs', 'saved-choices-' + randomUUID()); await fs.mkdir(root, { recursive: true });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'paper.txt'); await fs.writeFile(file, source);
  const projects = new ProjectService(path.join(root, 'runtime')), p = await projects.open(file);
  return { root, file, projects, p, service: new CodexService(projects, path.join(root, 'codex')) };
}

test('JSON imports preserve several wordings, deletion, packages and per-choice edits across recovery/reopen', async t => {
  const f = await fixture(t), file = path.join(f.root, 'comments.json');
  await fs.writeFile(file, JSON.stringify([{ id: 'c', title: 'Choose style', explanation: 'Two ways to express this.', original,
    replacement: 'The allocation is monotone.', alternatives: [option, { label: 'Delete', reason: 'Redundant here.', replacement: '', packages: ['xcolor'] }] }]));
  const review = await f.projects.import(file, f.p.id, source);
  assert.equal(review.schemaVersion, 2); assert.equal(review.comments[0].alternatives?.length, 2);
  let current = { ...review.comments[0], draft: 'My starting draft.' };
  const shorter = current.alternatives![0].id, deletion = current.alternatives![1].id;
  current = { ...current, ...selectWording(current, shorter), draft: 'My shorter draft.' } as typeof current;
  current = { ...current, ...selectWording(current, deletion) } as typeof current;
  assert.equal(current.replacement, ''); assert.deepEqual(current.packages, ['xcolor']);
  current = { ...current, ...selectWording(current, shorter) } as typeof current;
  assert.equal(current.draft, 'My shorter draft.'); assert.deepEqual(current.packages, []);
  const primary = wordingChoices(current).alternatives.find(a => a.label === 'Original suggestion')!;
  current = { ...current, ...selectWording(current, primary.id) } as typeof current;
  assert.equal(current.draft, 'My starting draft.');
  await f.projects.persist({ projectId: f.p.id, text: source, review: { ...review, comments: [current] } });
  const reopened = await new ProjectService(path.join(f.root, 'new-runtime')).open(f.file);
  assert.equal(reopened.review.schemaVersion, 2); assert.equal(reopened.review.comments[0].alternatives?.length, 3);
  assert.equal(reopened.review.comments[0].draft, 'My starting draft.'); assert.equal(reopened.text, source);
  assert.equal(await fs.readFile(f.file, 'utf8'), source);
  assert.throws(() => commentSchema.parse({ ...current, selectedAlternativeId: 'missing' }), /selected wording/);
  assert.throws(() => commentSchema.parse({ ...current, alternatives: [current.alternatives![0], current.alternatives![0]] }), /IDs must be unique/);
});

test('alternative-only imports require deliberate selection; old files keep version 1; unsupported versions leave source intact', async t => {
  const f = await fixture(t), file = path.join(f.root, 'comments.json');
  await fs.writeFile(file, JSON.stringify({ schemaVersion: 2, comments: [{ original, alternatives: [option] }] }));
  const review = await f.projects.import(file, f.p.id, source), imported = review.comments[0];
  assert.equal(imported.replacement, null);
  assert.throws(() => proposalChanges(source, imported), /question without a replacement/);
  const selected = { ...imported, ...selectWording(imported, imported.alternatives![0].id) };
  assert.equal(proposalChanges(source, selected)[0].insert, option.replacement);
  assert.equal(reviewSchema.parse(f.p.review).schemaVersion, 1);
  await fs.writeFile(file, JSON.stringify({ schemaVersion: 3, comments: [] }));
  await assert.rejects(f.projects.import(file, f.p.id, source), /Unsupported/);
  assert.equal(await fs.readFile(f.file, 'utf8'), source);
});

test('Undo/Redo selection never erases a later background option; acceptance applies only the chosen draft', () => {
  const start = { ...c(), ...addWordings(c(), [option]) };
  let state = initialState(source, [start]);
  const read = () => state.field(commentsField)[0], dispatch = (tr: Transaction) => { state = tr.state; };
  const chosen = start.alternatives!.find(a => a.label === option.label)!;
  state = state.update({ effects: patchComments.of([{ id: 'c', fields: selectWording(read(), chosen.id) }]), annotations: isolateHistory.of('full') }).state;
  const result = { schemaVersion: 1 as const, id: randomUUID(), kind: 'reply' as const, rootFile: 'paper.txt', sourceHash: digest(source), createdAt: new Date().toISOString(), commentId: 'c', original,
    answer: { reply: 'Another possibility.', replacement: null, packages: [], alternatives: [{ ...option, label: 'Another', replacement: 'The allocation has monotonicity.' }] } };
  const arrived = mergeResult(source, state.field(commentsField), result, true);
  state = state.update({ effects: loadComments.of(arrived), annotations: Transaction.addToHistory.of(false) }).state;
  assert(undo({ state, dispatch })); assert.equal(read().draft, 'My wording.'); assert.equal(read().alternatives!.length, 3);
  assert(redo({ state, dispatch })); assert.equal(read().replacement, option.replacement); assert.equal(read().alternatives!.length, 3);
  assert.equal(state.doc.toString(), source); assert.equal(read().replyDraft, 'My unsent question.');
  state = state.update(applyProposal(state, 'c')).state;
  assert.equal(state.doc.toString(), option.replacement + '\nThe proof follows.');
  assert.equal(wordingReason(read()), option.reason);
  assert(undo({ state, dispatch })); assert.equal(state.doc.toString(), source); assert.equal(read().alternatives!.length, 3);
});

for (const background of [false, true]) test('Undo keeps the departing option’s newly typed draft, background arrival: ' + background, () => {
  const start = { ...c(), ...addWordings(c(), [option]) };
  let state = initialState(source, [start]);
  const read = () => state.field(commentsField)[0], dispatch = (tr: Transaction) => { state = tr.state; };
  const chosen = start.alternatives!.find(a => a.label === option.label)!;
  const select = () => { state = state.update({ effects: patchComments.of([{ id: 'c', fields: selectWording(read(), chosen.id) }]), annotations: isolateHistory.of('full') }).state; };
  select();
  state = state.update({ effects: patchComments.of([{ id: 'c', fields: { draft: 'My newly edited alternative.' } }]), annotations: Transaction.addToHistory.of(false) }).state;
  if (background) state = state.update({ effects: loadComments.of([{ ...read(), ...addWordings(read(), [{ ...option, label: 'Later', replacement: 'Later alternative.' }]) }]), annotations: Transaction.addToHistory.of(false) }).state;
  assert(undo({ state, dispatch })); assert.equal(read().draft, 'My wording.');
  assert.equal(read().alternatives!.find(a => a.id === chosen.id)!.draft, 'My newly edited alternative.');
  assert.equal(read().alternatives!.length, background ? 3 : 2);
  assert(redo({ state, dispatch })); assert.equal(read().draft, 'My newly edited alternative.');
  assert(undo({ state, dispatch })); select(); assert.equal(read().draft, 'My newly edited alternative.');
  // A deliberate draft edit such as Use original still has its own Undo.
  state = state.update({ effects: patchComments.of([{ id: 'c', fields: { draft: original } }]), annotations: isolateHistory.of('full') }).state;
  assert.equal(read().draft, original); assert(undo({ state, dispatch })); assert.equal(read().draft, 'My newly edited alternative.');
  state = state.update(applyProposal(state, 'c')).state;
  assert.equal(state.doc.toString(), 'My newly edited alternative.\nThe proof follows.');
});

test('late alternatives retain custom drafts and receipts, deduplicate identical choices, and cannot follow a relinked question', () => {
  const base = c(), added = { ...base, ...replyFields(base, { reply: 'Option', replacement: null, packages: [], alternatives: [option, option] }) };
  assert.equal(added.alternatives?.length, 2); assert.equal(added.draft, base.draft);
  const q = commentSchema.parse({ ...base, replacement: null, draft: undefined, alternatives: [{ ...option, id: 'earlier' }] });
  const linked = linkQuestionToSelection('A different passage.', q, 0, 20);
  assert.throws(() => selectWording(linked, 'earlier'), /earlier passage/);
  assert.equal(linked.alternatives![0].original, original);
});

test('Quick alternative uses Sol Low and one-option output without reference tools or altering paper settings', async t => {
  const f = await fixture(t); await f.projects.setEffort(f.p.id, 'max'); await f.projects.setFastMode(f.p.id, true);
  let call: any;
  f.service.client.run = async (prompt, schema, _progress, effort, fast, reader, config) => {
    call = { prompt: JSON.parse(prompt), schema, effort, fast, reader, config };
    return { reply: 'One concise wording.', replacement: null, packages: [], alternatives: [option] };
  };
  const request = { projectId: f.p.id, text: source, comment: c(), message: quickAlternativeQuestion, action: 'quick-alternative' as const, attachmentPreviewId: 'must-not-be-read' };
  await f.service.reply(request, () => {});
  assert.equal(call.effort, 'low'); assert.equal(call.fast, false); assert.equal(call.reader, undefined);
  assert.equal(call.config.model, 'gpt-6-sol'); assert.deepEqual(call.schema, quickAlternativeOutputSchema);
  assert.equal(call.schema.properties.alternatives.maxItems, 1); assert.equal(call.prompt.references, undefined);
  assert.match(call.prompt.task, /at most ONE/); assert.match(call.prompt.task, /ENTIRE original/);
  assert.equal(f.projects.get(f.p.id).effort, 'max'); assert.equal(f.projects.get(f.p.id).fastMode, true);
  const waiting = (await f.service.results.list(f.p.id)).items;
  assert.equal(waiting.length, 1); assert.equal(waiting[0].schemaVersion, 2);
  assert.equal(waiting[0].kind === 'reply' && waiting[0].answer.alternatives?.[0].replacement, option.replacement);
  const reopenedProjects = new ProjectService(path.join(f.root, 'waiting-runtime')), reopened = await reopenedProjects.open(f.file);
  const reopenedService = new CodexService(reopenedProjects, path.join(f.root, 'codex'));
  assert.equal((await reopenedService.results.list(reopened.id)).items[0].schemaVersion, 2);
  f.service.client.run = async () => ({ reply: 'Too many.', replacement: null, packages: [], alternatives: [option, option] });
  await assert.rejects(f.service.reply(request, () => {}), /more than one/);
  assert.equal((await f.service.results.list(f.p.id)).items.length, 1);
  f.service.client.run = async () => ({ reply: 'No better alternative is needed.', replacement: null, packages: [], alternatives: [] });
  await f.service.reply(request, () => {});
  const noOptions = (await f.service.results.list(f.p.id)).items.find(item => item.kind === 'reply' && !item.answer.alternatives?.length);
  assert.equal(noOptions?.schemaVersion, 1);
  assert.equal(await fs.readFile(f.file, 'utf8'), source);
  const context = replyContext({ ...request, text: 'a'.repeat(10000) + source, comment: { ...c(), from: 10000, to: 10000 + original.length } });
  assert(context.nearbySource.length <= original.length + 3000);
});

test('automatic arrival preference is paper-specific and defaults on for older workspace files', () => {
  const saved = defaultWorkspace(); assert.equal(saved.autoAddComments, true);
  assert.equal(workspaceSchema.parse({ ...saved, autoAddComments: false }).autoAddComments, false);
  const { autoAddComments: _ignored, ...legacy } = saved;
  assert.equal(workspaceSchema.parse(legacy).autoAddComments, true);
});
