import { EditorState, StateEffect, StateField, Transaction } from '@codemirror/state';
import { history, invertedEffects, isolateHistory } from '@codemirror/commands';
import { bufferSchema, commentsSchema, type BufferInput, type Comment } from '../shared/contracts.ts';
import { proposalChanges, changedText } from '../shared/review.ts';

type Patch = { id: string; fields: Partial<Comment> };
export const loadComments = StateEffect.define<Comment[]>();
// User imports have their own inverse; background additions must survive Undo.
export const alterComments = StateEffect.define<{ add: Comment[]; remove: string[] }>({ map(value, changes) {
  return { ...value, add: value.add.map(c => ({ ...c, from: changes.mapPos(c.from, 1), to: changes.mapPos(c.to, -1) })) };
} });
export const patchComments = StateEffect.define<Patch[]>({ map(values, changes) {
  return values.map(p => ({ ...p, fields: { ...p.fields,
    ...(p.fields.from === undefined ? {} : { from: changes.mapPos(p.fields.from, 1) }),
    ...(p.fields.to === undefined ? {} : { to: changes.mapPos(p.fields.to, -1) }) } }));
} });
export const commentsField = StateField.define<Comment[]>({
  create: () => [], update(items, tr) {
    if (!tr.docChanged && !tr.effects.some(e => e.is(loadComments) || e.is(patchComments) || e.is(alterComments))) return items;
    let next = items.map(c => {
      if (!tr.docChanged || c.validity === 'missing' || c.validity === 'ambiguous') return c;
      const from = tr.changes.mapPos(c.from, 1), to = Math.max(from, tr.changes.mapPos(c.to, -1));
      const expected = c.decision === 'applied' ? c.appliedText : c.original;
      return { ...c, from, to, validity: c.validity === 'unconfirmed' || c.validity === 'stale' ? c.validity : tr.newDoc.sliceString(from, to) === expected ? 'current' as const : 'stale' as const };
    });
    for (const effect of tr.effects) {
      if (effect.is(loadComments)) next = effect.value;
      if (effect.is(alterComments)) {
        const remove = new Set(effect.value.remove);
        next = next.filter(c => !remove.has(c.id));
        const ids = new Set(next.map(c => c.id));
        for (const c of effect.value.add) if (!ids.has(c.id)) { next.push(c); ids.add(c.id); }
      }
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
  const setInverses = tr.effects.filter(e => e.is(alterComments)).map(effect => {
    const before = tr.startState.field(commentsField), ids = new Set(before.map(c => c.id));
    return alterComments.of({ add: before.filter(c => effect.value.remove.includes(c.id)), remove: effect.value.add.filter(c => !ids.has(c.id)).map(c => c.id) });
  });
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
  return [...setInverses, ...(inverse.size ? [patchComments.of([...inverse].map(([id, fields]) => ({ id, fields })))] : [])];
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
export function dismissPendingComments(state: EditorState) {
  const pending = state.field(commentsField).filter(c => c.decision === 'open' && !c.later);
  return { effects: patchComments.of(pending.map(c => ({ id: c.id, fields: { decision: 'dismissed' as const } }))), annotations: isolateHistory.of('full') };
}
export function applyProposals(state: EditorState, ids: readonly string[]) {
  if (!ids.length || new Set(ids).size !== ids.length) throw new Error('Choose one or more distinct suggestions.');
  let next = state, changes = state.changes([]);
  for (const id of ids) {
    const spec = applyProposal(next, id), expected = changedText(next.doc.toString(), spec.changes);
    if (expected.length > 2000000) throw new Error('The combined suggestions exceed the source size limit. Nothing was applied.');
    const tr = next.update(spec);
    if (tr.newDoc.toString() !== expected || tr.state.field(commentsField).find(c => c.id === id)?.decision !== 'applied') throw new Error('The combined suggestions cannot be applied in the current editor state.');
    changes = changes.compose(tr.changes); next = tr.state;
  }
  const selected = new Set(ids);
  return { changes, effects: patchComments.of(next.field(commentsField).filter(c => selected.has(c.id)).map(c => ({ id: c.id, fields: { decision: c.decision, validity: c.validity, appliedText: c.appliedText, from: c.from, to: c.to } }))), annotations: isolateHistory.of('full') };
}
