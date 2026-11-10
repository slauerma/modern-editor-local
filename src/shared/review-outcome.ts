import type { Comment, WaitingResult } from './contracts.ts';

export type ReviewResultReceipt = { result: Extract<WaitingResult, { kind: 'review' }>; receipt: 'adopted' | 'dismissed' | null };
export type ReviewRequestResults = { items: ReviewResultReceipt[]; notices: string[] };
export type ReviewOutcome = 'complete' | 'failed' | 'stopped';

/** Count only retained, request-attributed results. A visible comment alone
 * does not prove that recovery/acknowledgement succeeded. */
export function summarizeReviewResults(report: ReviewRequestResults, comments: readonly Comment[]) {
  const current = new Set(comments.map(c => c.id));
  const saved = new Map<string, { adopted: boolean; waiting: boolean }>();
  for (const { result, receipt } of report.items) for (const c of result.comments) {
    const prior = saved.get(c.id);
    saved.set(c.id, { adopted: prior?.adopted || receipt === 'adopted', waiting: prior?.waiting || receipt === null });
  }
  let inComments = 0, waiting = 0, outside = 0;
  for (const [id, value] of saved) {
    if (value.adopted && current.has(id)) inComments++;
    else if (value.waiting) waiting++;
    else outside++;
  }
  return { saved: saved.size, inComments, waiting, outside, waitingResults: report.items.filter(item => item.receipt === null).length };
}
