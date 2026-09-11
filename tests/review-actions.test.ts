import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Transaction } from '@codemirror/state';
import { undo, redo, isolateHistory } from '@codemirror/commands';
import { commentSchema, reviewSchema } from '../src/shared/contracts.ts';
import { adoptComment, linkQuestionToSelection, proposalChanges, reattachComment, replyFields } from '../src/shared/review.ts';
import { initialState, commentsField, loadComments, patchComments, dismissPendingComments } from '../src/renderer/editor-state.ts';
import { replyContext } from '../src/shared/codex-context.ts';

const original = 'The boundaries are reached.', current = 'The pointwise bounds are attained.';
const question = () => adoptComment(original, commentSchema.parse({ id: 'q', title: 'Which boundaries?', original, replacement: null, explanation: 'Clarify boundaries.', messages: [{ role: 'assistant', text: 'Earlier alternative', createdAt: '2026-09-11', proposal: { replacement: 'Earlier suggested wording.', packages: [] } }] }));

test('bulk dismissal preserves Later/history/source/discussion; one Undo/Redo affects only the captured pending set', () => {
  const q = question(), later = { ...q, id: 'later', later: true }, applied = { ...q, id: 'applied', decision: 'applied' as const };
  let state = initialState(original, [q, later, applied]);
  const dispatch = (tr: Transaction) => { state = tr.state; };
  state = state.update(dismissPendingComments(state)).state;
  assert.equal(state.doc.toString(), original); assert.equal(state.field(commentsField)[0].decision, 'dismissed');
  assert.deepEqual(state.field(commentsField)[0].messages, q.messages); assert.deepEqual(state.field(commentsField).slice(1), [later, applied]);
  const incoming = { ...q, id: 'arrived-after-click' };
  state = state.update({ effects: loadComments.of([...state.field(commentsField), incoming]), annotations: Transaction.addToHistory.of(false) }).state;
  assert(undo({ state, dispatch })); assert.equal(state.field(commentsField).length, 4); assert.equal(state.field(commentsField)[0].decision, 'open');
  assert.equal(state.field(commentsField)[3].decision, 'open'); assert(redo({ state, dispatch }));
  assert.equal(state.field(commentsField)[0].decision, 'dismissed'); assert.equal(state.field(commentsField)[3].decision, 'open'); assert.equal(state.doc.toString(), original);
});
test('explicit question linking preserves earlier wording and old alternatives, persists, and is a single undoable metadata change', () => {
  const q = { ...question(), validity: 'stale' as const, to: current.length };
  const linked = linkQuestionToSelection(current, q, 0, current.length);
  assert.equal(linked.original, current); assert.equal(linked.questionOriginal, original); assert.equal(linked.validity, 'current');
  assert.equal(linked.messages[0].proposalOriginal, original); assert.equal(linked.messages[0].proposal?.replacement, 'Earlier suggested wording.');
  let state = initialState(current, [q]); const dispatch = (tr: Transaction) => { state = tr.state; };
  state = state.update({ effects: patchComments.of([{ id: q.id, fields: linked }]), annotations: isolateHistory.of('full') }).state;
  assert.equal(state.doc.toString(), current); assert(undo({ state, dispatch })); assert.deepEqual(JSON.parse(JSON.stringify(state.field(commentsField)[0])), q); assert(redo({ state, dispatch }));
  const persisted = reviewSchema.parse(JSON.parse(JSON.stringify({ schemaVersion: 1, rootFile: 'main.tex', sourceHash: '', activeId: 'q', comments: state.field(commentsField), updatedAt: '2026-09-11' })));
  assert.equal(persisted.comments[0].questionOriginal, original);
  const context = replyContext({ projectId: 'paper', text: current, comment: linked, message: 'Explain it here.' });
  assert.equal(context.original, current); assert.equal(context.earlierQuestionWording, original);
  const fresh = { ...linked, ...replyFields(linked, { reply: 'Updated alternative', replacement: 'The pointwise upper bounds are attained.', packages: [] }) };
  assert.equal(fresh.messages[1].proposalOriginal, undefined);
});
test('question relinking cannot bypass replacement exact-match protection or accept empty/invalid selections', () => {
  const q = question(), replacement = { ...q, replacement: 'New statement.', validity: 'stale' as const };
  assert.throws(() => linkQuestionToSelection(current, replacement, 0, current.length), /Only a question/);
  assert.throws(() => reattachComment(current, replacement, 0, current.length), /exact original/);
  assert.throws(() => proposalChanges(current, replacement), /passage changed/);
  for (const [from, to] of [[0,0],[-1,3],[0,current.length+1],[.5,3]]) assert.throws(() => linkQuestionToSelection(current, q, from, to), /Select the current passage/);
  assert.throws(() => linkQuestionToSelection('   ', q, 0, 3), /Select/);
  const linked = linkQuestionToSelection(current, q, 0, current.length);
  assert.throws(() => proposalChanges(current, linked), /question without/);
});
