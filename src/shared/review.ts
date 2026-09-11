import { commentSchema, commentsSchema, type Comment, type Review, type CodexReply } from './contracts.ts';

export function discussionMessage(c: Comment): string {
  const message = c.replyDraft.trim();
  if (!message || message.length > 10000) throw new Error('Use a reply of 1–10,000 characters. Your draft was kept; you can shorten it or save it as a note.');
  if (c.messages.length > 498) throw new Error('This discussion is full. Your draft was kept; start a fresh comment for further discussion.');
  return message;
}

export function commentVisible(c: Comment, includeHistory: boolean, laterOnly = false) {
  return includeHistory || (c.decision === 'open' && !!c.later === laterOnly);
}
export function nextCommentId(comments: readonly Comment[], activeId: string | null, direction: number, includeHistory = false, laterOnly = false): string | null {
  const step = direction < 0 ? -1 : 1;
  const found = comments.findIndex(c => c.id === activeId), start = found >= 0 ? found : step > 0 ? -1 : 0;
  for (let offset = 1; offset <= comments.length; offset++) {
    const c = comments[(start + step * offset + comments.length * 2) % comments.length];
    if (commentVisible(c, includeHistory, laterOnly)) return c.id;
  }
  return null;
}

export function captureContext(text: string, c: Comment): Comment {
  return { ...c, before: text.slice(Math.max(0, c.from - 80), c.from), after: text.slice(c.to, c.to + 80) };
}
export function locate(text: string, c: Comment, trustOffsets = false, adopting = false): Comment {
  const quote = c.decision === 'applied' ? (c.appliedText ?? c.replacement ?? '') : c.original;
  // Once placement needs confirmation, only deliberate attachment clears it.
  // Keep that requirement even while the quote is absent or has several matches.
  const validity = (found: Comment['validity']) => c.validity === 'unconfirmed' || c.validity === 'stale' ? 'unconfirmed' : found;
  if (trustOffsets && c.validity === 'current' && c.from <= c.to && c.to <= text.length && text.slice(c.from, c.to) === quote)
    return captureContext(text, c);
  if (!quote) return { ...c, from: 0, to: 0, validity: validity('missing') };
  const exact: number[] = [], contextual: number[] = [];
  let pos = 0;
  while ((pos = text.indexOf(quote, pos)) >= 0) {
    exact.push(pos);
    if ((!c.before || text.slice(0, pos).endsWith(c.before)) && (!c.after || text.slice(pos + quote.length).startsWith(c.after))) contextual.push(pos);
    pos += 1;
  }
  const matches = contextual.length ? contextual : exact;
  if (matches.length !== 1) return { ...c, from: 0, to: 0, validity: validity(matches.length ? 'ambiguous' : 'missing') };
  const placed = { ...c, from: matches[0], to: matches[0] + quote.length, validity: validity(adopting && (!(c.before || c.after) || contextual.length) ? 'current' : 'unconfirmed') };
  return placed.validity === 'current' ? captureContext(text, placed) : placed;
}
// Only initial adoption may establish a new anchor from a unique quotation.
// Reopening an existing review uses locate() with revision-verified offsets.
export function adoptComment(text: string, c: Comment) { return locate(text, c, false, true); }
export function reattachComment(text: string, c: Comment, from: number, to: number): Comment {
  if (c.decision !== 'open' || !c.original || from < 0 || to > text.length || text.slice(from, to) !== c.original)
    throw new Error('Select the exact original words in the source before confirming this passage.');
  return captureContext(text, { ...c, from, to, validity: 'current' });
}
export function linkQuestionToSelection(text: string, c: Comment, from: number, to: number): Comment {
  if (c.decision !== 'open' || c.replacement !== null || c.draft !== undefined) throw new Error('Only a question without a replacement can be linked to changed wording.');
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > text.length || to <= from || to - from > 100000 || !text.slice(from, to).trim()) throw new Error('Select the current passage for this question (at most 100,000 characters).');
  // Earlier alternatives remain readable in the discussion, but cannot become
  // replacements for a newly linked passage without a fresh Codex proposal.
  const messages = c.messages.map(message => message.proposal && message.proposalOriginal === undefined ? { ...message, proposalOriginal: c.original } : message);
  return captureContext(text, commentSchema.parse({ ...c, original: text.slice(from, to), questionOriginal: c.questionOriginal ?? c.original, messages, from, to, validity: 'current' }));
}
export function anchorReview(text: string, review: Review, trustOffsets = false): Review {
  return { ...review, comments: review.comments.map(c => locate(text, c, trustOffsets)) };
}
export function proposalChanges(text: string, c: Comment): { from: number; to: number; insert: string }[] {
  if (c.decision !== 'open' || c.validity !== 'current' || !c.original || text.slice(c.from, c.to) !== c.original) throw new Error('The source passage changed. Refresh this suggestion before applying it.');
  const replacement = c.draft === undefined ? c.replacement : c.draft;
  if (replacement === null) throw new Error('This comment is a question without a replacement.');
  const changes = [{ from: c.from, to: c.to, insert: replacement }];
  const marker = '\\begin{document}';
  const preambleEnd = text.indexOf(marker);
  const prefix = preambleEnd >= 0 ? text.slice(0, preambleEnd).replace(/(?<!\\)%[^\n]*/g, '') : '';
  const loaded = new Set([...prefix.matchAll(/\\(?:usepackage|RequirePackage)(?:\[[^\]]*\])?\{([^}]+)\}/g)].flatMap(m => m[1].split(',').map(s => s.trim())));
  const missing = [...new Set(c.packages)].filter(p => !loaded.has(p));
  if (missing.length) {
    if (preambleEnd < 0 || text.indexOf(marker, preambleEnd + marker.length) >= 0) throw new Error('Choose a complete root document before adding a package.');
    if (c.from < preambleEnd) throw new Error('Review this preamble change manually; automatic package insertion would overlap it.');
    changes.push({ from: preambleEnd, to: preambleEnd, insert: missing.map(p => `\\usepackage{${p}}\n`).join('') });
  }
  return changes.sort((a, b) => a.from - b.from);
}
export function changedText(text: string, changes: { from: number; to: number; insert: string }[]) {
  return [...changes].sort((a, b) => b.from - a.from).reduce((s, c) => s.slice(0, c.from) + c.insert + s.slice(c.to), text);
}

export function mergeComments(existing: readonly Comment[], incoming: readonly Comment[]): Comment[] {
  const ids = new Set(existing.map(c => c.id));
  const added = incoming.map(c => {
    let id = c.id;
    while (ids.has(id)) id = crypto.randomUUID();
    ids.add(id); return { ...c, id };
  });
  return commentsSchema.parse([...existing, ...added]);
}
export function replyFields(c: Comment, answer: CodexReply): Pick<Comment, 'messages'> {
  // A delayed model answer is an alternative, never a replacement for the author's draft.
  return { messages: commentSchema.parse({ ...c, messages: [...c.messages, { role: 'assistant', text: answer.reply, createdAt: new Date().toISOString(), ...(answer.replacement === null ? {} : { proposal: { replacement: answer.replacement, packages: answer.packages } }) }] }).messages };
}
export function visibleCommentId(comments: readonly Comment[], id: string | null, includeHistory: boolean, laterOnly = false): string | null {
  const visible = comments.filter(c => commentVisible(c, includeHistory, laterOnly));
  return visible.some(c => c.id === id) ? id : visible[0]?.id ?? null;
}
export function historyCommentId(before: readonly Comment[], after: readonly Comment[], activeId: string | null): string | null {
  const old = new Map(before.map(c => [c.id, c]));
  const restored = after.find(c => !old.has(c.id));
  if (restored) return restored.id;
  const affected = after.filter(c => { const p = old.get(c.id); return p && (p.later !== c.later || p.decision !== c.decision || p.validity !== c.validity || p.original !== c.original || p.questionOriginal !== c.questionOriginal || p.draft !== c.draft || p.replacement !== c.replacement || JSON.stringify(p.packages) !== JSON.stringify(c.packages)); });
  return affected.find(c => c.id === activeId)?.id ?? affected[0]?.id ?? activeId;
}
