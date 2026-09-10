import { test } from 'node:test';
import assert from 'node:assert/strict';
import { undo, redo, isolateHistory } from '@codemirror/commands';
import { Transaction } from '@codemirror/state';
import type { EditorState } from '@codemirror/state';
import { commentSchema } from '../src/shared/contracts.ts';
import { adoptComment, locate, changedText, nextCommentId, proposalChanges, reattachComment } from '../src/shared/review.ts';
import { initialState, commentsField, applyProposal, patchComments, loadComments } from '../src/renderer/editor-state.ts';

const original = 'The allocation is monotone.';
const item = (text: string, replacement: string | null = 'The allocation increases weakly.') => adoptComment(text, commentSchema.parse({ id: 'c1', title: 'Clarity', explanation: '', original, replacement }));
const setup = (text = 'Before\n' + original + '\nAfter') => initialState(text, [item(text)]);
function history(command: typeof undo, state: EditorState) { let next = state; assert(command({ state, dispatch: tr => { next = tr.state; } })); return next; }

test('next follows the review order after acceptance, wraps, and finishes after the last open comment', () => {
  const comments = ['a', 'b', 'c'].map(id => ({ ...item(original), id }));
  comments[1].decision = 'applied';
  assert.equal(nextCommentId(comments, 'b', 1), 'c');
  assert.equal(nextCommentId(comments, 'b', -1), 'a');
  assert.equal(nextCommentId(comments, 'c', 1), 'a');
  comments.forEach(c => c.decision = 'applied');
  assert.equal(nextCommentId(comments, 'c', 1), null);
  assert.equal(nextCommentId(comments, 'c', 1, true), 'a');
});

test('anchors move past Unicode and edits before the target', () => {
  let state = setup(); state = state.update({ changes: { from: 0, insert: 'α 😀\n' } }).state;
  const c = state.field(commentsField)[0]; assert.equal(state.doc.sliceString(c.from, c.to), original); assert.equal(c.validity, 'current');
});
test('editing inside a target blocks apply and undo restores it', () => {
  let state = setup(); const c = state.field(commentsField)[0];
  state = state.update({ changes: { from: c.from + 4, insert: 'changed ' } }).state;
  assert.equal(state.field(commentsField)[0].validity, 'stale'); assert.throws(() => applyProposal(state, 'c1'));
  state = history(undo, state); assert.equal(state.field(commentsField)[0].validity, 'current');
});
test('repeated passages need context or revision-verified offsets', () => {
  const text = 'First: ' + original + '\nSecond: ' + original, c = item(text);
  assert.equal(c.validity, 'ambiguous');
  assert.equal(locate(text, { ...c, before: 'Second: ' }).from, text.lastIndexOf(original));
});
test('a surviving quote with lost context requires placement confirmation', () => {
  const c = { ...item('First: ' + original), before: 'First: ' };
  const relocated = locate('Other result: ' + original, c);
  assert.equal(relocated.validity, 'unconfirmed');
  assert.throws(() => proposalChanges('Other result: ' + original, relocated));
});
test('unconfirmed placement stays blocked through unrelated typing and recovery anchoring', () => {
  const text = 'Other result: ' + original;
  let state = initialState(text, [locate(text, { ...item(text), before: 'Deleted result: ' })]);
  state = state.update({ changes: { from: 0, insert: 'A new heading\n' } }).state;
  const c = state.field(commentsField)[0];
  assert.equal(c.validity, 'unconfirmed');
  assert.equal(locate(state.doc.toString(), c, true).validity, 'unconfirmed');
  assert.throws(() => applyProposal(state, c.id));
});
test('placement confirmation survives relocation, disappearance, ambiguity and JSON round trips', () => {
  let c = locate('Other result: ' + original, { ...item(original), before: 'First: ' });
  for (const text of ['Heading\nFirst: ' + original, 'The passage was removed.', original + '\n' + original, 'First: ' + original]) {
    c = locate(text, commentSchema.parse(JSON.parse(JSON.stringify(c))), true);
    assert.equal(c.validity, 'unconfirmed');
    assert.throws(() => proposalChanges(text, c));
  }
  const text = 'First: ' + original;
  c = reattachComment(text, c, 7, text.length);
  assert.equal(locate(text, c, true).validity, 'current');
  assert.equal(changedText(text, proposalChanges(text, c)), 'First: ' + c.replacement);
});
test('manual attachment targets the selected duplicate and retains the discussion', () => {
  const text = original + '\nOther result: ' + original;
  const c = { ...item(text), replyDraft: 'Keep this unsent note', messages: [{ role: 'user' as const, text: 'About the second result', createdAt: '2026-09-07' }] };
  const from = text.lastIndexOf(original), attached = reattachComment(text, c, from, from + original.length);
  assert.equal(attached.validity, 'current'); assert.equal(attached.replyDraft, c.replyDraft); assert.deepEqual(attached.messages, c.messages);
  const state = initialState(text, [attached]);
  assert.equal(state.update(applyProposal(state, attached.id)).newDoc.toString(), original + '\nOther result: ' + attached.replacement);
  assert.throws(() => reattachComment(text, c, 0, 2), /exact original words/);
});
test('question and empty replacement have different behavior', () => {
  assert.throws(() => proposalChanges(original, item(original, null)));
  assert.equal(changedText(original, proposalChanges(original, item(original, ''))), '');
});
test('accept, final-item undo and redo preserve the review decision', () => {
  let state = setup(), initial = state.doc.toString();
  state = state.update(applyProposal(state, 'c1')).state; assert.equal(state.field(commentsField)[0].decision, 'applied');
  state = history(undo, state); assert.equal(state.doc.toString(), initial); assert.equal(state.field(commentsField)[0].decision, 'open');
  state = history(redo, state); assert.equal(state.field(commentsField)[0].decision, 'applied');
});
test('undo of a source edit preserves later notes on that comment', () => {
  let state = setup(); state = state.update(applyProposal(state, 'c1')).state;
  state = state.update({ effects: patchComments.of([{ id: 'c1', fields: { replyDraft: 'Keep this later note' } }]), annotations: Transaction.addToHistory.of(false) }).state;
  state = history(undo, state); assert.equal(state.field(commentsField)[0].replyDraft, 'Keep this later note');
});
test('undo retains newly imported comments and maps their source positions', () => {
  let state = setup(); state = state.update({ changes: { from: 0, insert: 'New\n' }, annotations: isolateHistory.of('full') }).state;
  const second = { ...item(state.doc.toString()), id: 'later' };
  state = state.update({ effects: loadComments.of([...state.field(commentsField), second]), annotations: Transaction.addToHistory.of(false) }).state;
  state = history(undo, state); const c = state.field(commentsField).find(c => c.id === 'later')!;
  assert.equal(state.doc.sliceString(c.from, c.to), original); assert.equal(c.validity, 'current');
});
test('undo restores a proposal overlapped by a larger accepted edit', () => {
  const large = item(original), small = commentSchema.parse({ id: 'c2', title: 'Term', explanation: '', original: 'allocation', replacement: 'assignment', from: 4, to: 14, validity: 'current' });
  let state = initialState(original, [large, small]); state = state.update(applyProposal(state, 'c1')).state;
  assert.equal(state.field(commentsField)[1].validity, 'stale');
  state = history(undo, state); assert.equal(state.field(commentsField)[1].validity, 'current'); assert.equal(state.field(commentsField)[1].from, 4);
});
test('preamble and body edits apply and undo as one source transaction', () => {
  const text = '\\documentclass{article}\n\\begin{document}\n' + original + '\n\\end{document}';
  let state = initialState(text, [{ ...item(text), packages: ['mathtools'] }]);
  state = state.update(applyProposal(state, 'c1')).state;
  assert(state.doc.toString().includes('\\usepackage{mathtools}'));
  assert(state.doc.toString().includes('increases weakly'));
  const c = state.field(commentsField)[0]; assert.equal(state.doc.sliceString(c.from, c.to), c.appliedText);
  state = history(undo, state); assert.equal(state.doc.toString(), text);
});
test('existing grouped package support is not duplicated', () => {
  const text = '\\documentclass{article}\n\\usepackage{amsmath, mathtools}\n\\begin{document}\n' + original;
  const result = changedText(text, proposalChanges(text, { ...item(text), packages: ['mathtools'] }));
  assert.equal(result.match(/mathtools/g)?.length, 1);
});
