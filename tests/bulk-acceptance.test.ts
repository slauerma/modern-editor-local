import { test } from 'node:test';
import assert from 'node:assert/strict';
import { undo, redo } from '@codemirror/commands';
import { Transaction } from '@codemirror/state';
import { commentSchema } from '../src/shared/contracts.ts';
import { adoptComment } from '../src/shared/review.ts';
import { acceptanceWarning, bulkAcceptancePlan } from '../src/shared/acceptance.ts';
import { applyProposals, commentsField, initialState } from '../src/renderer/editor-state.ts';
const text = '\\documentclass{article}\n\\begin{document}\nAlpha. Beta. Gamma.\n\\end{document}\n';
const c = (id: string, original: string, replacement: string | null) => adoptComment(text, commentSchema.parse({title:'Synthetic edit',explanation:'Synthetic review.', id, original, replacement }));

test('bulk plan leaves questions, Later, stale proposals and every overlapping alternative for individual review', () => {
  const comments = [c('a','Alpha.','A.'), c('ab','Alpha. Beta.','AB.'), c('b','Beta.','B.'), c('g','Gamma.','G.'), { ...c('l','Gamma.','Later.'), later: true }, c('q','Alpha.',null), { ...c('s','Beta.','Stale.'), validity: 'stale' as const }];
  const plan = bulkAcceptancePlan(text, comments);
  assert.deepEqual(plan.ids, ['g']); assert.equal(plan.overlapping, 3); assert.equal(plan.leftPending, 5);
});
test('combined replacements, deletion and deduplicated package additions apply and undo as one complete transaction', () => {
  const a = { ...c('a','Alpha.','A.'), packages: ['amsmath'] }, b = { ...c('b','Beta.',''), packages: ['amsmath', 'amssymb'] }, q = c('q','Gamma.',null);
  let state = initialState(text, [a,b,q]); const dispatch = (tr: Transaction) => { state = tr.state; };
  state = state.update(applyProposals(state, bulkAcceptancePlan(text, [a,b,q]).ids)).state;
  const changed = state.doc.toString(); assert.match(changed, /A\.  Gamma\./); assert.equal((changed.match(/usepackage\{amsmath\}/g) ?? []).length, 1); assert.equal((changed.match(/usepackage\{amssymb\}/g) ?? []).length, 1);
  for (const item of state.field(commentsField).slice(0,2)) assert.equal(state.doc.sliceString(item.from,item.to), item.appliedText);
  assert.equal(state.field(commentsField)[2].decision, 'open');
  assert(undo({ state, dispatch })); assert.equal(state.doc.toString(), text); assert(state.field(commentsField).every(c => c.decision === 'open'));
  assert(redo({ state, dispatch })); assert.equal(state.doc.toString(), changed);
});
test('adjacent replacements are safe; an edit covering a required package insertion remains a conflict', () => {
  const adjacent = 'Alpha.Beta.', a = adoptComment(adjacent, commentSchema.parse({title:'Synthetic edit',explanation:'Synthetic review.',id:'a',original:'Alpha.',replacement:'A.'})), b = adoptComment(adjacent, commentSchema.parse({title:'Synthetic edit',explanation:'Synthetic review.',id:'b',original:'Beta.',replacement:'B.'}));
  const state = initialState(adjacent, [a,b]); assert.equal(state.update(applyProposals(state, ['a','b'])).newDoc.toString(), 'A.B.');
  const body = { ...c('body','Alpha.','A.'), packages: ['amsmath'] }, marker = c('marker','\\begin{document}','\\begin{document}\n');
  assert.deepEqual(bulkAcceptancePlan(text, [body,marker]).ids, []);
});
test('missing, duplicate, stale or excessive combined proposals cannot partially change the editor', () => {
  const a=c('a','Alpha.','A.'), state=initialState(text,[a]);
  for (const ids of [[],['absent'],['a','a']]) assert.throws(()=>applyProposals(state,ids));
  const changed=state.update({changes:{from:a.from,to:a.to,insert:'Elsewhere.'}}).state; assert.throws(()=>applyProposals(changed,['a']),/passage changed/);
  const long = 'x'.repeat(1_950_000)+'Alpha.', big=adoptComment(long,commentSchema.parse({title:'Synthetic edit',explanation:'Synthetic review.',id:'big',original:'Alpha.',replacement:'y'.repeat(100000)}));
  assert.throws(()=>applyProposals(initialState(long,[big]),['big']),/source size limit/); assert.equal(state.doc.toString(),text);
});
test('warning explanations distinguish references, citations, labels, glyphs and unverified inputs', () => {
  const base:any={success:true,dependenciesVerified:true,diagnostics:[]};
  for (const [message, expected] of [["Citation x undefined",'undefined citations'],['There were undefined references.','undefined references'],['Label x multiply defined.','duplicate labels'],['Missing character: There is no x','missing characters']]) assert(acceptanceWarning({...base,diagnostics:[{message}]}).includes(expected));
  assert.match(acceptanceWarning({...base,dependenciesVerified:false}),/unverified compilation inputs/);
});
