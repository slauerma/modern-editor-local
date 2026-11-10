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
export function proposalContext(text: string, c: Pick<Comment, 'original' | 'from' | 'to' | 'validity' | 'decision'>, expanded = false) {
  const empty = { before: '', after: '', contextual: false, hasMore: false, omittedBefore: false, omittedAfter: false };
  if (c.decision !== 'open' || c.validity !== 'current' || !c.original || c.from < 0 || c.to > text.length || text.slice(c.from, c.to) !== c.original) return empty;
  const separators = /\r?\n[\t ]*\r?\n|^[\t ]*\\(?:begin|end|section|subsection|subsubsection|paragraph|chapter)\b[^\r\n]*(?:\r?\n|$)/gm;
  let start = 0, end = text.length;
  for (const match of text.matchAll(separators)) {
    const stop = match.index! + match[0].length;
    if (stop <= c.from) start = stop;
    else if (match.index! >= c.to) { end = match.index!; break; }
  }
  // Sentence selection is display-only. Never clip any part of the edit itself.
  const fullStart = Math.max(start, c.from - 4000), fullEnd = Math.min(end, c.to + 4000);
  const block = text.slice(fullStart, fullEnd);
  const sentences = [...new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(block)];
  const first = sentences.findIndex(s => fullStart + s.index + s.segment.length > c.from);
  const last = sentences.findIndex(s => fullStart + s.index + s.segment.length >= c.to);
  let compactStart = fullStart + (sentences[Math.max(0, first - 1)]?.index ?? 0);
  const tail = sentences[Math.min(sentences.length - 1, last + 1)];
  let compactEnd = tail ? fullStart + tail.index + tail.segment.length : fullEnd;
  // Unpunctuated text may be one enormous sentence. Limit only its context.
  compactStart = Math.max(compactStart, c.from - 600);
  compactEnd = Math.min(compactEnd, c.to + 600);
  if (compactStart > fullStart && /\S/.test(text[compactStart - 1])) {
    const space = text.slice(compactStart, c.from).search(/\s/);
    compactStart = space < 0 ? c.from : compactStart + space + 1;
  }
  if (compactEnd < fullEnd && /\S/.test(text[compactEnd])) {
    const head = text.slice(c.to, compactEnd), space = head.search(/\s\S*$/);
    compactEnd = space < 0 ? c.to : c.to + space;
  }
  const from = expanded ? fullStart : compactStart, to = expanded ? fullEnd : compactEnd;
  return { before: text.slice(from, c.from), after: text.slice(c.to, to), contextual: true,
    hasMore: compactStart > fullStart || compactEnd < fullEnd, omittedBefore: from > start, omittedAfter: to < end };
}
