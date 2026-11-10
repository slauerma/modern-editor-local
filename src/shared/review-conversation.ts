import { z } from 'zod';
import type { Comment } from './contracts.ts';

export const reviewModeSchema = z.enum(['continue', 'fresh']);
export type ReviewMode = z.infer<typeof reviewModeSchema>;
export type ReviewConversationInfo = { id: string; label: string; createdAt: string; updatedAt: string; requests: number; hasThread: boolean };
export type ReviewConversationState = { active: ReviewConversationInfo | null; conversations: ReviewConversationInfo[] };
export type ReviewTurnInfo = { id: string; createdAt: string; kind: 'review' | 'discussion' | 'paper-chat'; instruction: string; sourceHash: string; status: 'pending' | 'complete' | 'failed' | 'stopped' };
export type ReviewConversationHistory = { items: ReviewTurnInfo[]; nextOffset: number | null };
export type SavedSuggestion = { title: string; explanation: string; original: string; replacement: string | null };
export type ReviewExchange = ReviewTurnInfo & { originRequestId?: string; answer: string; suggestions: SavedSuggestion[]; error?: string };

/** A readable view of an existing exchange; raw prompts stay in Technical details. */
export function readableExchange(turn: ReviewTurnInfo & { originRequestId?: string; response?: unknown; error?: string }): ReviewExchange {
  const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const text = (value: unknown) => typeof value === 'string' ? value : '';
  const response = object(turn.response);
  const comments = Array.isArray(response.comments) ? response.comments : Array.isArray(response.suggestions) ? response.suggestions : [];
  const suggestions = comments.map(value => { const c = object(value); return { title: text(c.title), explanation: text(c.explanation), original: text(c.original), replacement: typeof c.replacement === 'string' ? c.replacement : null }; });
  if (typeof response.replacement === 'string') suggestions.push({ title: 'Proposed replacement', explanation: '', original: '', replacement: response.replacement });
  if (Array.isArray(response.alternatives)) for (const value of response.alternatives) {
    const a = object(value);
    suggestions.push({ title: text(a.label) || text(a.title), explanation: text(a.reason) || text(a.explanation), original: '', replacement: typeof a.replacement === 'string' ? a.replacement : null });
  }
  const { id, createdAt, kind, instruction, sourceHash, status, originRequestId, error } = turn;
  const readableError = error && (/^[\[{]/.test(error.trim()) || error.length > 600 ? 'This request did not finish successfully. Open Technical details for the recorded error.' : error);
  return { id, createdAt, kind, instruction, sourceHash, status, originRequestId, error: readableError, suggestions,
    answer: text(response.reply) || text(turn.response) || (turn.response === undefined ? 'No final answer recorded.' : suggestions.length ? '' : comments.length === 0 && Array.isArray(response.comments) ? 'No suggestions returned.' : 'This saved answer is available in Technical details.') };
}

// Current decisions override anything the model remembers from an older turn.
// A rejection alone records no reason; never substitute the model's rationale.
export function reviewDecisions(comments: readonly Comment[]) {
  const items: { id: string; title: string; decision: Comment['decision']; original: string; wording: string | null; authorReason?: string }[] = [];
  let characters = 0;
  for (const c of [...comments].reverse()) {
    const item = { id: c.id, title: c.title, decision: c.decision, original: c.original.slice(0, 1500), wording: (c.appliedText ?? c.draft ?? c.replacement)?.slice(0, 1500) ?? null,
      ...(c.decision === 'dismissed' && c.rejectionReason ? { authorReason: c.rejectionReason } : {}) };
    const size = JSON.stringify(item).length;
    if (characters + size > 20000 || items.length >= 60) continue;
    characters += size; items.push(item);
  }
  return { instruction: 'These are the current comment states. Earlier proposals are not acceptances. Current states override earlier conversation, including after Undo or reopening. A rejected edit without authorReason has no stated author reason. Do not infer a broader preference.', total: comments.length, included: items.length, items };
}
