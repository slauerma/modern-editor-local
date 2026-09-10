import { EditorState, StateEffect, StateField, Transaction } from '@codemirror/state';
import { history, invertedEffects, isolateHistory } from '@codemirror/commands';
import { bufferSchema, commentsSchema, type BufferInput, type Comment } from '../shared/contracts.ts';
import { proposalChanges } from '../shared/review.ts';

type Patch = { id: string; fields: Partial<Comment> };
export const loadComments = StateEffect.define<Comment[]>();
export const patchComments = StateEffect.define<Patch[]>({ map(values, changes) {
  return values.map(p => ({ ...p, fields: { ...p.fields,
    ...(p.fields.from === undefined ? {} : { from: changes.mapPos(p.fields.from, 1) }),
    ...(p.fields.to === undefined ? {} : { to: changes.mapPos(p.fields.to, -1) }) } }));
} });
export const commentsField = StateField.define<Comment[]>({
  create: () => [], update(items, tr) {
    if (!tr.docChanged && !tr.effects.some(e => e.is(loadComments) || e.is(patchComments))) return items;
    let next = items.map(c => {
      if (!tr.docChanged || c.validity === 'missing' || c.validity === 'ambiguous') return c;
      const from = tr.changes.mapPos(c.from, 1), to = Math.max(from, tr.changes.mapPos(c.to, -1));
      const expected = c.decision === 'applied' ? c.appliedText : c.original;
      return { ...c, from, to, validity: c.validity === 'unconfirmed' || c.validity === 'stale' ? c.validity : tr.newDoc.sliceString(from, to) === expected ? 'current' as const : 'stale' as const };
    });
    for (const effect of tr.effects) {
      if (effect.is(loadComments)) next = effect.value;
      if (effect.is(patchComments)) {
        const patches = new Map(effect.value.map(p => [p.id, p.fields]));
        next = next.map(c => ({ ...c, ...(patches.get(c.id) ?? {}) }));
      }
    }
    // A renderer transaction must satisfy the same comment limits as persistence.
    return commentsSchema.parse(next);
  }
});
export const reviewHistory = invertedEffects.of(tr => {
  const inverse = new Map<string, Partial<Comment>>();
  for (const c of tr.startState.field(commentsField)) {
    if (tr.docChanged) inverse.set(c.id, { from: c.from, to: c.to, validity: c.validity });
    for (const effect of tr.effects) if (effect.is(patchComments)) {
      const patch = effect.value.find(p => p.id === c.id);
      if (patch) {
        const fields: Partial<Comment> = { ...inverse.get(c.id) };
        for (const key of Object.keys(patch.fields) as (keyof Comment)[]) Object.assign(fields, { [key]: c[key] });
        inverse.set(c.id, fields);
      }
    }
  }
  return inverse.size ? [patchComments.of([...inverse].map(([id, fields]) => ({ id, fields })))] : [];
});
export function validateReviewTransaction(tr: Transaction, current: BufferInput) {
  bufferSchema.parse({ ...current, text: tr.newDoc.toString(), review: { ...current.review, comments: tr.state.field(commentsField) } });
}
export function initialState(text: string, comments: Comment[], onSourceLimit: () => void = () => {}) {
  let state = EditorState.create({ doc: text, extensions: [commentsField, history(), reviewHistory, EditorState.transactionFilter.of(tr => {
    if (tr.newDoc.length <= 2000000) return tr;
    onSourceLimit(); return [];
  })] });
  return state.update({ effects: loadComments.of(comments), annotations: Transaction.addToHistory.of(false) }).state;
}
export function applyProposal(state: EditorState, id: string) {
  const c = state.field(commentsField).find(c => c.id === id);
  if (!c) throw new Error('Comment no longer exists');
  const changes = proposalChanges(state.doc.toString(), c);
  const mapped = state.changes(changes);
  const from = mapped.mapPos(c.from, -1), replacement = c.draft === undefined ? c.replacement! : c.draft!;
  return { changes, effects: patchComments.of([{ id, fields: { decision: 'applied', validity: 'current', appliedText: replacement, from, to: from + replacement.length } }]), annotations: isolateHistory.of('full') };
}
