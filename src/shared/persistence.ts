// JSON readers and writers share a byte limit, including escaping/indentation.
// TextEncoder also works in the renderer and matches Node's UTF-8 encoding.
export const JSON_FILE_LIMIT = 32_000_000;
export function serializeJSON(value: unknown, limit = JSON_FILE_LIMIT): string {
  const content = JSON.stringify(value, null, 2);
  if (content === undefined) throw new Error('Expected a JSON value.');
  if (new TextEncoder().encode(content).byteLength > limit) {
    throw new Error(`The complete JSON record exceeds ${limit} UTF-8 bytes. Reduce the review or discussion data before saving; existing saved files were preserved.`);
  }
  return content;
}

// Admission checks reserve a full revision counter, refreshed metadata and the
// longest selection (including null). Changing the selection must still save.
// The actual records are checked again before any file changes.
export function assertRecoveryFits(text: string, review: Review) {
  let activeId = review.activeId, activeBytes = new TextEncoder().encode(JSON.stringify(activeId)).byteLength;
  if (activeBytes < 4) { activeId = null; activeBytes = 4; }
  for (const comment of review.comments) {
    const bytes = new TextEncoder().encode(JSON.stringify(comment.id)).byteLength;
    if (bytes > activeBytes) { activeId = comment.id; activeBytes = bytes; }
  }
  const record = {
    schemaVersion: 1, baseDiskHash: '0'.repeat(64), text,
    review: { ...review, activeId, sourceHash: '0'.repeat(64), updatedAt: '2000-01-01T00:00:00.000Z' },
    revision: Number.MAX_SAFE_INTEGER
  };
  serializeJSON(record);
  // Reopen refreshes matching trusted anchors and may relocate other comments.
  // Bound that representation without searching the source for every quotation:
  // context changes only for current, matching offsets; all other changes are
  // bounded source positions and validity labels. This projection is not saved.
  const digits = String(text.length).length;
  const comments = review.comments.map(comment => {
    const quote = comment.decision === 'applied' ? (comment.appliedText ?? comment.replacement ?? '') : comment.original;
    const refresh = comment.validity === 'current' && comment.from <= comment.to && comment.to <= text.length &&
      comment.to - comment.from === quote.length && text.slice(comment.from, comment.to) === quote;
    return { ...comment,
      ...(refresh ? { before: text.slice(Math.max(0, comment.from - 80), comment.from), after: text.slice(comment.to, comment.to + 80) } : {}),
      from: String(comment.from).length < digits ? text.length : comment.from,
      to: String(comment.to).length < digits ? text.length : comment.to,
      validity: 'unconfirmed'
    };
  });
  serializeJSON({ ...record, review: { ...record.review, comments } });
}
import type { Review } from './contracts.ts';
