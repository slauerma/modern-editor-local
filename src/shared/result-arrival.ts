import { commentsSchema, type Comment, type WaitingResult } from './contracts.ts';
import { adoptComment, locate, replyFields } from './review.ts';

// Replayed answers must preserve existing decisions, manual drafts and message IDs.
export function mergeResult(text: string, existing: Comment[], result: WaitingResult, sameSource: boolean): Comment[] {
  if (result.kind === 'review') {
    const ids = new Set(existing.map(c => c.id));
    const incoming = result.comments.filter(c => !ids.has(c.id)).map(c => ({ ...c, reviewedSourceHash: result.sourceHash, reviewedAt: result.createdAt }));
    const placed = incoming.map(c => sameSource ? locate(text, c, true) : c.validity === 'current' ? adoptComment(text, c) : locate(text, c));
    return commentsSchema.parse([...existing, ...placed]);
  }
  const target = existing.find(c => c.id === result.commentId);
  if (!target || target.original !== result.original) throw new Error('The original comment is no longer available. This answer remains in waiting results.');
  if (target.messages.some(m => m.resultId === result.id)) return existing;
  const fields = replyFields(target, result.answer);
  const messages = fields.messages!.map((m, index, all) => index === all.length - 1 ? { ...m, resultId: result.id, createdAt: result.createdAt } : m);
  return commentsSchema.parse(existing.map(c => c.id === target.id ? { ...c, messages } : c));
}

export async function sourceHash(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
