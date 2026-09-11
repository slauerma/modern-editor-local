import type { Build, Comment } from './contracts.ts';
import { proposalChanges } from './review.ts';

export function acceptanceWarning(build: Build): string {
  const reasons: string[] = [];
  if (build.dependenciesVerified !== true) reasons.push('unverified compilation inputs');
  const text = build.diagnostics.map(d => d.message).join('\n').replace(/\s+/g, '');
  if (/undefinedcitations|Citation.*?undefined/i.test(text)) reasons.push('undefined citations');
  if (/undefinedreferences|Reference.*?undefined/i.test(text)) reasons.push('undefined references');
  if (/multiplydefined/i.test(text)) reasons.push('duplicate labels');
  if (/Missingcharacter:/i.test(text)) reasons.push('missing characters');
  if (/completecompilerlogcouldnotbechecked/i.test(text)) reasons.push('an incomplete compiler log');
  return `PDF generated, but acceptance paused because of ${reasons.length ? reasons.join(', ') : 'compiler warnings'}.`;
}

// Plan from the current buffer. Leave every member of an overlapping group for
// individual review; never choose one competing proposal on the author's behalf.
export function bulkAcceptancePlan(text: string, comments: readonly Comment[]) {
  const pending = comments.filter(c => c.decision === 'open' && !c.later);
  const eligible: { comment: Comment; changes: ReturnType<typeof proposalChanges> }[] = [];
  for (const c of pending) {
    if (c.replacement === null) continue;
    try { eligible.push({ comment: c, changes: proposalChanges(text, c) }); } catch { /* Leave stale or incomplete proposals pending. */ }
  }
  eligible.sort((a, b) => a.comment.from - b.comment.from);
  const conflicts = new Set<string>();
  for (let i = 0; i < eligible.length; i++) for (let j = i + 1; j < eligible.length; j++) {
    const a = eligible[i], b = eligible[j];
    const overlap = a.changes.some(x => b.changes.some(y => {
      if (x.from === x.to && y.from === y.to) return false; // Package additions are deduplicated when applied.
      if (x.from === x.to) return x.from >= y.from && x.from < y.to;
      if (y.from === y.to) return y.from >= x.from && y.from < x.to;
      return x.from < y.to && y.from < x.to;
    }));
    if (overlap) { conflicts.add(a.comment.id); conflicts.add(b.comment.id); }
  }
  const ids = eligible.filter(c => !conflicts.has(c.comment.id)).map(c => c.comment.id);
  return { ids, leftPending: pending.length - ids.length, overlapping: conflicts.size };
}
