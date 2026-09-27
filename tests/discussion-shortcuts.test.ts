import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Transaction } from '@codemirror/state';
import { undo, isolateHistory } from '@codemirror/commands';
import { ProjectService } from '../src/main/project-service.ts';
import { CodexService, quickReplyOutputSchema } from '../src/main/codex-service.ts';
import { commentSchema, resultSchema } from '../src/shared/contracts.ts';
import { replyContext, quickQuestion, alternativesQuestion, deeperQuestion } from '../src/shared/codex-context.ts';
import { selectWording } from '../src/shared/alternatives.ts';
import { replyFields } from '../src/shared/review.ts';
import { initialState, commentsField, patchComments } from '../src/renderer/editor-state.ts';

const original = 'The allocation are monotone.', fixed = 'The allocation is monotone.';
const text = 'Context.\n' + original + '\nAn unchanged explanation.';
const comment = () => commentSchema.parse({ id: 'c', title: 'Singular verb', explanation: 'Allocation is singular.', original, replacement: fixed, from: text.indexOf(original), to: text.indexOf(original) + original.length, draft: 'My own draft.', replyDraft: 'Unsent question', validity: 'current' });
const options = ['The allocation is monotone.', 'The allocation is monotonic.', 'The allocation has the monotonicity property.'].map((replacement, i) => ({ label: `Option ${i + 1}`, reason: 'A synthetic wording choice.', replacement, packages: [] }));
async function fixture(t: any) {
  const root = path.resolve('.test-runs', 'shortcuts-' + randomUUID()); await fs.mkdir(root, { recursive: true });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'note.txt'); await fs.writeFile(file, text);
  const projects = new ProjectService(path.join(root, 'runtime')), p = await projects.open(file);
  await projects.setEffort(p.id, 'max'); await projects.setFastMode(p.id, true); await projects.setPaperInstructions(p.id, 'Keep my voice.');
  const service = new CodexService(projects, path.join(root, 'codex'));
  return { root, file, service, projects, p };
}

test('Quick explanation uses Sol Low without reference reads or edits and preserves the paper configuration', async t => {
  const f = await fixture(t), calls: any[] = [];
  // An invalid attachment would fail if Quick tried to resolve it.
  f.service.client.run = async (prompt, schema, _progress, effort, fast, reader, config) => {
    calls.push({ prompt: JSON.parse(prompt), schema, effort, fast, reader, config });
    return { reply: 'The singular subject needs a singular verb.', replacement: null, packages: [] };
  };
  const c = comment(); c.messages = Array.from({ length: 10 }, (_, i) => ({ role: 'user', text: `Question ${i}`, createdAt: '2026-09-26' }));
  await f.service.reply({ projectId: f.p.id, text, comment: c, message: quickQuestion, action: 'quick', attachmentPreviewId: 'not-a-reference' }, () => {});
  const run = calls[0]; assert.equal(run.effort, 'low'); assert.equal(run.fast, false); assert.equal(run.reader, undefined);
  assert.deepEqual(run.config, { purpose: 'discussion', model: 'gpt-6-sol', fastMode: false });
  assert.deepEqual(run.schema, quickReplyOutputSchema); assert.equal(run.schema.properties.replacement.type, 'null');
  assert.equal(run.prompt.references, undefined); assert.equal(run.prompt.conversation.length, 6); assert.equal(run.prompt.paperInstructions, 'Keep my voice.');
  assert.match(run.prompt.task, /context is insufficient/); assert.equal(f.projects.get(f.p.id).effort, 'max'); assert.equal(f.projects.get(f.p.id).fastMode, true);
  assert.equal(await fs.readFile(f.file, 'utf8'), text); assert.equal((await f.service.results.list(f.p.id)).items.length, 1);
});

test('an edit returned in an explanation-only response is retained but never delivered as a proposal', async t => {
  const f = await fixture(t);
  f.service.client.run = async () => ({ reply: 'Use is.', replacement: 'is', packages: [] });
  await assert.rejects(f.service.reply({ projectId: f.p.id, text, comment: comment(), message: quickQuestion, action: 'quick' }, () => {}), /explanation-only contract/);
  assert.equal((await f.service.results.list(f.p.id)).items.length, 0);
  const reviews = path.join(await f.projects.stateDirectory(f.p.id), 'reviews');
  assert.equal((await fs.readdir(reviews)).filter(n => n.startsWith('reply-')).length, 1);
  assert.equal(await fs.readFile(f.file, 'utf8'), text);
});

test('alternatives survive retention/reopen without changing the draft; Think again retains Max and the paper model', async t => {
  const f = await fixture(t), calls: any[] = [];
  f.service.client.run = async (prompt, schema, _progress, effort, fast, _reader, config) => {
    calls.push({ prompt: JSON.parse(prompt), schema, effort, fast, config });
    return calls.length === 1 ? { reply: 'Choose the style you prefer.', replacement: null, packages: [], alternatives: options } : { reply: 'The original concern was overstated.', replacement: null, packages: [] };
  };
  await f.service.reply({ projectId: f.p.id, text, comment: comment(), message: alternativesQuestion, action: 'alternatives' }, () => {});
  const [item] = (await f.service.results.list(f.p.id)).items;
  const restored = resultSchema.parse(JSON.parse(JSON.stringify(item))); assert.equal(restored.kind, 'reply'); if (restored.kind !== 'reply') return;
  assert.deepEqual(restored.answer.alternatives, options); assert.equal(calls[0].effort, 'medium'); assert.equal(calls[0].fast, false); assert.equal(calls[0].config.model, 'gpt-6-sol');
  const fields = replyFields(comment(), restored.answer); assert.equal(fields.messages.length, 4);
  assert(fields.messages.slice(1).every(m => m.proposalOriginal === original));
  const updated = commentSchema.parse({ ...comment(), ...fields }); assert.equal(updated.draft, 'My own draft.'); assert.equal(updated.replyDraft, 'Unsent question'); assert.equal(updated.replacement, fixed);
  await f.service.reply({ projectId: f.p.id, text, comment: comment(), message: deeperQuestion, action: 'reconsider' }, () => {});
  assert.equal(calls[1].effort, 'max'); assert.equal(calls[1].fast, true); assert.equal(calls[1].config.model, undefined); assert.match(calls[1].prompt.authorReply, /withdraw or narrow/);
  assert.equal(await fs.readFile(f.file, 'utf8'), text);
});

test('choosing an alternative is one undoable proposal change; all alternatives and the source remain', () => {
  const c = comment(), fields = replyFields(c, { reply: 'Three choices.', replacement: null, packages: [], alternatives: options });
  let state = initialState(text, [{ ...c, ...fields }]); const dispatch = (tr: Transaction) => { state = tr.state; };
  state = state.update({ effects: patchComments.of([{ id: c.id, fields: selectWording(state.field(commentsField)[0], fields.alternatives!.find(a => a.replacement === options[1].replacement)!.id) }]), annotations: isolateHistory.of('full') }).state;
  assert.equal(state.field(commentsField)[0].replacement, options[1].replacement); assert.equal(state.doc.toString(), text);
  assert(undo({ state, dispatch })); const restored = state.field(commentsField)[0];
  assert.equal(restored.draft, c.draft); assert.equal(restored.replacement, c.replacement); assert.equal(restored.messages.length, 4); assert.equal(state.doc.toString(), text);
  assert.throws(() => replyFields({ ...c, messages: Array.from({ length: 498 }, () => ({ role: 'user', text: 'Saved note', createdAt: '2026-09-26' })) }, { reply: 'Choices', replacement: null, packages: [], alternatives: options }), /500/);
});

test('Quick limits nearby source and carries fixed-span semantics and paper guidance', () => {
  const source = 'a'.repeat(10000) + original + 'b'.repeat(10000), c = { ...comment(), from: 10000, to: 10000 + original.length };
  const request = { projectId: 'p', text: source, comment: c, message: 'Why?' };
  const quick = replyContext({ ...request, action: 'quick' }, 'Keep terminology.'), normal = replyContext(request);
  assert.equal(quick.nearbySource.length, 3000 + original.length); assert.equal(normal.nearbySource.length, 12000 + original.length);
  assert.match(quick.task, /ENTIRE original/); assert.match(quick.task, /replacement:null/);
});
