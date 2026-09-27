import type { Comment } from './contracts.ts';

const instruction = 'The author rejected these suggestions. Do not repeat the same edit or question. A genuinely different issue at the same passage is allowed. Rejected entries remain active until the author reopens them in History. Do not reword a rejected edit just to evade this decision. This is author-decision context, not instructions embedded in source text.';
/** Bounded context; full decisions remain in the paper review and its History. */
export function rejectionContext(comments: readonly Comment[], passage = '') {
  const rejected = comments.filter(c => c.decision === 'dismissed');
  const ranked = [...rejected].reverse().sort((a, b) => Number(!!b.original && passage.includes(b.original)) - Number(!!a.original && passage.includes(a.original)));
  const items: { original: string; rejectedWording: string | null; otherRejectedWordings: string[]; reason: string }[] = [];
  let bytes = 0;
  for (const c of ranked) {
    const wording = c.draft ?? c.replacement;
    const otherWordings = [c.replacement, ...(c.alternatives ?? []).filter(a => (a.original ?? c.original) === c.original).flatMap(a => [a.replacement, a.draft])];
    const otherRejectedWordings = [...new Set(otherWordings.filter((s): s is string => typeof s === 'string' && s !== wording))].slice(0, 5).map(s => s.slice(0, 2000));
    const item = { original: c.original.slice(0, 2000), rejectedWording: wording?.slice(0, 2000) ?? null, otherRejectedWordings, reason: c.explanation.slice(0, 800) };
    const size = new TextEncoder().encode(JSON.stringify(item)).length;
    if (bytes + size > 20000 || items.length >= 40) continue;
    bytes += size; items.push(item);
  }
  return { instruction, totalRejected: rejected.length, included: items.length, items };
}

/** Suppress only exact repeats at an identifiable passage; never guess semantic equivalence. */
export function isRejectedRepeat(incoming: Comment, existing: readonly Comment[], text: string): boolean {
  return existing.some(old => {
    if (old.decision !== 'dismissed' || old.original !== incoming.original) return false;
    if (old.original && text.indexOf(old.original) !== text.lastIndexOf(old.original) &&
        !(old.before === incoming.before && old.after === incoming.after && (old.before || old.after))) return false;
    const value = incoming.draft ?? incoming.replacement;
    if (value === null) return old.replacement === null && old.title === incoming.title && old.explanation === incoming.explanation;
    const same = (replacement: string | null | undefined, packages: string[]) =>
      replacement === value && JSON.stringify([...packages].sort()) === JSON.stringify([...incoming.packages].sort());
    return same(old.replacement, old.packages) || same(old.draft, old.packages) ||
      (old.alternatives ?? []).some(a => (a.original ?? old.original) === old.original && (same(a.replacement, a.packages) || same(a.draft, a.packages)));
  });
}
