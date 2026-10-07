import type { Comment } from '../shared/contracts.ts';
import { inlineEdits, type ComparisonChange } from '../shared/changes-pdf.ts';
import { bulkAcceptancePlan } from '../shared/acceptance.ts';
import { controls } from '../shared/tex-structure.ts';
import { applyProposals, commentsField, initialState } from './editor-state.ts';

export type PdfReviewSession = { id: string; original: string; comments: Comment[] };
export type ReviewScope = { id: string; label: string; from: number; to: number; level: number };

// Scope membership is frozen with the original manuscript, not inferred from
// changed page numbers. Nested headings form nested, explicit bulk scopes.
export function pdfReviewScopes(text: string): ReviewScope[] {
  const levels: Record<string, number> = { chapter: 1, section: 2, subsection: 3, subsubsection: 4 };
  const headings = controls(text).filter(c => levels[c.name]).flatMap(c => {
    const tail = text.slice(c.from + c.name.length + 1);
    const match = /^\*?\s*(?:\[[^\]\n]*\]\s*)?\{/.exec(tail);
    if (!match) return [];
    const start = c.from + c.name.length + 1 + match[0].length;
    let end = start, depth = 1;
    for (; end < text.length && depth; end++) {
      if (text[end] === '\\') { end++; continue; }
      if (text[end] === '{') depth++;
      if (text[end] === '}') depth--;
    }
    if (depth) return [];
    return [{ id: 'heading-' + c.from, label: text.slice(start, end - 1).replace(/\s+/g, ' ').trim() || 'Untitled', from: c.from, level: levels[c.name] }];
  });
  return [{ id: 'all', label: 'Whole paper', from: 0, to: text.length, level: 0 },
    ...headings.map((h, i) => ({ ...h, to: headings.slice(i + 1).find(next => next.level <= h.level)?.from ?? text.length }))];
}

export function pdfReviewPlan(session: PdfReviewSession, text: string, comments: Comment[]) {
  const ids = new Set(session.comments.map(c => c.id));
  const members = comments.filter(c => ids.has(c.id));
  const applicable = bulkAcceptancePlan(text, members);
  const state = initialState(text, comments);
  const candidate = applicable.ids.length ? state.update(applyProposals(state, applicable.ids)).state : state;
  return { text: candidate.doc.toString(), comments: candidate.field(commentsField), members, applicable: applicable.ids,
    excluded: members.filter(c => c.decision === 'open' && c.replacement !== null && !applicable.ids.includes(c.id)) };
}
export type PdfReviewPlan = ReturnType<typeof pdfReviewPlan>;
export function pdfReviewRegion(change: ComparisonChange, index: number): ComparisonChange {
  const edit = inlineEdits(change.oldText, change.newText)?.[index];
  return edit ? { ...change, fromA: change.fromA + edit.fromA, toA: change.fromA + edit.toA,
    fromB: change.fromB + edit.fromB, toB: change.fromB + edit.toB } : change;
}
export function pdfReviewTentative(changes: ComparisonChange[], session: PdfReviewSession, plan: PdfReviewPlan) {
  return changes.flatMap(c => (inlineEdits(c.oldText, c.newText) ?? []).flatMap((_, i) =>
    pdfReviewChangeState(pdfReviewRegion(c, i), session, plan) === 'Tentative' ? [c.id + ':' + i] : []));
}
export function pdfReviewScopeIds(session: PdfReviewSession, scope: ReviewScope) {
  return session.comments.filter(c => c.from >= scope.from && c.to <= scope.to).map(c => c.id);
}
const overlaps = (from: number, to: number, a: number, b: number) =>
  from === to ? from >= a && from <= b : a === b ? a >= from && a <= to : from < b && a < to;
export function pdfReviewOwners(change: ComparisonChange, session: PdfReviewSession, plan: PdfReviewPlan) {
  const shown = new Set([...plan.applicable, ...plan.members.filter(c => c.decision === 'applied').map(c => c.id)]);
  return session.comments.filter(c => {
    if (!shown.has(c.id) || plan.members.find(item => item.id === c.id)?.replacement == null) return false;
    const after = plan.comments.find(item => item.id === c.id);
    return overlaps(c.from, c.to, change.fromA, change.toA) || !!after && overlaps(after.from, after.to, change.fromB, change.toB);
  }).map(c => c.id);
}

// Passage overlap is useful for finding a related comment, but is not proof
// that it caused a manual edit. State cues require matching exact edit ranges.
export function pdfReviewChangeState(change: ComparisonChange, session: PdfReviewSession, plan: PdfReviewPlan) {
  const related = pdfReviewOwners(change, session, plan);
  const exact = related.filter(id => {
    const before = session.comments.find(c => c.id === id)!, after = plan.comments.find(c => c.id === id);
    if (!after || after.appliedText === undefined || session.original.slice(before.from, before.to) !== before.original ||
      plan.text.slice(after.from, after.to) !== after.appliedText) return false;
    return (inlineEdits(before.original, after.appliedText) ?? []).some(edit =>
      change.fromA === before.from + edit.fromA && change.toA === before.from + edit.toA &&
      change.fromB === after.from + edit.fromB && change.toB === after.from + edit.toB);
  });
  if (!exact.length) return related.length ? 'Related suggestion' : 'Manual/unlinked change';
  const pending = exact.filter(id => plan.members.find(c => c.id === id)?.decision === 'open').length;
  return !pending ? 'Accepted' : pending === exact.length ? 'Tentative' : 'Mixed';
}
