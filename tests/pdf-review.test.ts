import { test } from 'node:test';
import assert from 'node:assert/strict';
import { undo } from '@codemirror/commands';
import type { Transaction } from '@codemirror/state';
import { commentSchema } from '../src/shared/contracts.ts';
import { adoptComment } from '../src/shared/review.ts';
import { comparisonPlan } from '../src/shared/changes-pdf.ts';
import { useDiscussionWording } from '../src/shared/alternatives.ts';
import { applyProposals, initialState, commentsField, patchComments } from '../src/renderer/editor-state.ts';
import { pdfReviewPlan, pdfReviewScopes, pdfReviewScopeIds, pdfReviewOwners, pdfReviewTentative, type PdfReviewSession } from '../src/renderer/pdf-review-plan.ts';

const source = '\\documentclass{article}\n\\begin{document}\n\\section{Setup}\nAlpha. Beta.\n\n\\subsection{Details}\nGamma.\n\n\\section{Result}\nDelta.\n\\end{document}\n';
const comment = (id: string, original: string, replacement: string | null) => adoptComment(source, commentSchema.parse({ id, title: id, explanation: 'Synthetic reason.', original, replacement }));
const comments = [comment('a', 'Alpha.', 'A.'), comment('b', 'Beta.', 'B.'), comment('g', 'Gamma.', 'G.'), comment('d', 'Delta.', 'D.'), comment('q', 'Delta.', null)];
const session: PdfReviewSession = { id: 'session', original: source, comments };
test('whole proposed revision uses the acceptance planner without changing source or decisions', () => {
  const before = structuredClone(comments), plan = pdfReviewPlan(session, source, comments);
  assert.match(plan.text, /A\. B\./); assert.match(plan.text, /G\./); assert.match(plan.text, /D\./);
  assert.equal(plan.applicable.length, 4); assert.deepEqual(comments, before); assert.equal(session.original, source);
  assert.equal(plan.comments.find(c => c.id === 'q')!.decision, 'open');
});
test('acceptance leaves candidate bytes unchanged; rejection removes only that pending edit; Undo restores it', () => {
  const first = pdfReviewPlan(session, source, comments);
  let state = initialState(source, comments); const dispatch = (tr: Transaction) => { state = tr.state; };
  state = state.update(applyProposals(state, ['a'])).state;
  assert.equal(pdfReviewPlan(session, state.doc.toString(), state.field(commentsField)).text, first.text);
  state = state.update({ effects: patchComments.of([{ id: 'b', fields: { decision: 'dismissed' } }]) }).state;
  const rejected = pdfReviewPlan(session, state.doc.toString(), state.field(commentsField));
  assert.match(rejected.text, /A\. Beta\./);
  assert.equal(rejected.members.find(c => c.id === 'b')!.decision, 'dismissed');
  assert(undo({ state, dispatch }));
  assert.equal(pdfReviewPlan(session, state.doc.toString(), state.field(commentsField)).text, first.text);
});
test('nested scopes contain subsections and leave a boundary-crossing suggestion out of the subsection', () => {
  const scopes = pdfReviewScopes(source), setup = scopes.find(s => s.label === 'Setup')!, detail = scopes.find(s => s.label === 'Details')!;
  assert.deepEqual(pdfReviewScopeIds(session, setup), ['a', 'b', 'g']);
  assert.deepEqual(pdfReviewScopeIds(session, detail), ['g']);
  const crossing = comment('cross', 'Beta.\n\n\\subsection{Details}\nGamma.', 'New block.');
  assert(!pdfReviewScopeIds({ ...session, comments: [...comments, crossing] }, detail).includes('cross'));
});
test('headings in comments, macros and verbatim are not bulk scopes; nested heading titles survive', () => {
  const scopes = pdfReviewScopes('% \\section{Comment}\n\\newcommand{\\hidden}{\\section{Hidden}}\n\\begin{verbatim}\n\\section{Literal}\n\\end{verbatim}\n\\section[Short]{A \\emph{long} title}\n\\subsection*{Details}');
  assert.deepEqual(scopes.map(s => s.label), ['Whole paper', 'A \\emph{long} title', 'Details']);
});
test('new arrivals stay outside the frozen session; alternatives and manual draft changes are used exactly', () => {
  const extra = comment('later-arrival', 'Delta.', 'Unexpected.');
  const limited = { ...session, comments: comments.slice(0, 2) };
  const plan = pdfReviewPlan(limited, source, [...comments.map(c => c.id === 'a' ? { ...c, draft: 'Edited.' } : c), extra]);
  assert.match(plan.text, /Edited\. B\./); assert.match(plan.text, /Delta\./);
  assert.equal(plan.members.length, 2);
});
test('stale, overlapping and Later suggestions remain explicit, not partly applied', () => {
  const items = [comments[0], comment('overlap', 'Alpha. Beta.', 'Merged.'), { ...comments[2], validity: 'stale' as const }, { ...comments[3], later: true }];
  const plan = pdfReviewPlan({ ...session, comments: items }, source, items);
  assert.equal(plan.text, source); assert.equal(plan.excluded.length, 4);
});
test('a shared paragraph marker retains every owning suggestion, including accepted edits and deletions', () => {
  const items = [comments[0], { ...comments[1], replacement: '' }];
  const s = { ...session, comments: items }, plan = pdfReviewPlan(s, source, items);
  const changes = comparisonPlan(source, plan.text).changes;
  const owners = [...new Set(changes.flatMap(c => pdfReviewOwners(c, s, plan)))];
  assert.deepEqual(owners.sort(), ['a', 'b']);
  const state = initialState(source, items).update(applyProposals(initialState(source, items), ['a'])).state;
  const accepted = pdfReviewPlan(s, state.doc.toString(), state.field(commentsField));
  assert.deepEqual([...new Set(changes.flatMap(c => pdfReviewOwners(c, s, accepted)))].sort(), ['a', 'b']);
});
test('combined package requests are deduplicated using the ordinary acceptance implementation', () => {
  const items = comments.slice(0, 2).map(c => ({ ...c, packages: ['amsmath'] }));
  const plan = pdfReviewPlan({ ...session, comments: items }, source, items);
  assert.equal((plan.text.match(/\\usepackage\{amsmath\}/g) ?? []).length, 1);
});
test('a question converted to a proposal keeps its owner and tentative state, then loses only the tentative cue on acceptance', () => {
  const question = comment('question', 'Alpha.', null), captured = { ...session, comments: [question] };
  const proposal = { ...question, ...useDiscussionWording(question, 'A.', []) };
  const plan = pdfReviewPlan(captured, source, [proposal]);
  const changes = comparisonPlan(source, plan.text).changes;
  assert.deepEqual(changes.flatMap(c => pdfReviewOwners(c, captured, plan)), ['question']);
  assert(pdfReviewTentative(changes, captured, plan).length > 0);
  const state = initialState(source, [proposal]);
  const accepted = state.update(applyProposals(state, ['question'])).state;
  const next = pdfReviewPlan(captured, accepted.doc.toString(), accepted.field(commentsField));
  assert.equal(next.text, plan.text);
  assert.deepEqual(changes.flatMap(c => pdfReviewOwners(c, captured, next)), ['question']);
  assert.deepEqual(pdfReviewTentative(changes, captured, next), []);
});
