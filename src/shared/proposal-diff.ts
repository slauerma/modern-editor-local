import { presentableDiff } from '@codemirror/merge';
import type { Comment } from './contracts.ts';

export type DiffPart = { kind: 'same' | 'removed' | 'added'; text: string };

// Word-aligned, bounded comparison also handles ordinary paragraph rewrites
// that exceeded the old quadratic token-table cutoff.
export function tokenDiff(original: string, proposed: string): DiffPart[] {
  const result: DiffPart[] = [];
  const push = (kind: DiffPart['kind'], text: string) => { if (text) result.push({ kind, text }); };
  let from = 0;
  for (const change of presentableDiff(original, proposed, { scanLimit: 2000 })) {
    push('same', original.slice(from, change.fromA));
    push('removed', original.slice(change.fromA, change.toA));
    push('added', proposed.slice(change.fromB, change.toB));
    from = change.toA;
  }
  push('same', original.slice(from));
  return result;
}

// Context is display-only. Acceptance and editing still use the exact comment
// span. Never attach a stale/history quotation to a guessed place in the draft.
export function proposalContext(text: string, c: Pick<Comment, 'original' | 'from' | 'to' | 'validity' | 'decision'>) {
  const empty = { before: '', after: '', contextual: false };
  if (c.decision !== 'open' || c.validity !== 'current' || !c.original || c.from < 0 || c.to > text.length || text.slice(c.from, c.to) !== c.original) return empty;
  const separators = /\r?\n[\t ]*\r?\n|^[\t ]*\\(?:begin|end|section|subsection|subsubsection|paragraph|chapter)\b[^\r\n]*(?:\r?\n|$)/gm;
  let start = 0, end = text.length;
  for (const match of text.matchAll(separators)) {
    const stop = match.index! + match[0].length;
    if (stop <= c.from) start = stop;
    else if (match.index! >= c.to) { end = match.index!; break; }
  }
  // Very long blocks use nearby context. The actual proposal is never shortened.
  return { before: text.slice(Math.max(start, c.from - 4000), c.from), after: text.slice(c.to, Math.min(end, c.to + 4000)), contextual: true };
}
