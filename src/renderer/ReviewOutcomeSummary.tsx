import { useEffect, useRef, useState } from 'react';
import type { Comment } from '../shared/contracts.ts';
import { summarizeReviewResults, type ReviewOutcome, type ReviewRequestResults } from '../shared/review-outcome.ts';

type Props = { projectId: string; requestIds: string[]; outcome: ReviewOutcome; comments: Comment[]; revision?: unknown; busy?: boolean; compact?: boolean; onWaiting(ids: string[]): void; onDismiss?(): void };
export function ReviewOutcomeSummary({ projectId, requestIds, outcome, comments, revision, busy, compact, onWaiting, onDismiss }: Props) {
  const [report, setReport] = useState<ReviewRequestResults>(), [error, setError] = useState('');
  const root = useRef<HTMLDetailsElement>(null);
  const key = requestIds.join(',');
  useEffect(() => {
    if (busy) return;
    let live = true;
    void window.editor.reviewRequestResults(projectId, key.split(',')).then(value => { if (live) { setReport(value); setError(''); } })
      .catch(e => { if (live) { setReport(undefined); setError(e instanceof Error ? e.message : String(e)); } });
    return () => { live = false; };
  }, [projectId, key, revision, busy]);
  const counts = report && summarizeReviewResults(report, comments);
  const label = outcome === 'complete' ? 'Review complete' : outcome === 'stopped' ? 'Review stopped' : 'Review failed';
  const summary = counts ? ' · ' + counts.saved + (report!.notices.length ? ' confirmed saved · ' : ' saved · ') + counts.inComments + ' in Comments · ' + counts.waiting + ' waiting' + (counts.outside ? ' · ' + counts.outside + ' retained outside Comments' : '') + (report!.notices.length ? ' · check details' : '') : error ? ' · summary unavailable' : ' · checking saved results…';
  return <details ref={root} className={'review-outcome' + (compact ? ' compact' : '')} onKeyDown={e => { if (compact && e.key === 'Escape' && root.current?.open) { e.stopPropagation(); root.current.open = false; root.current.querySelector('summary')?.focus(); } }}>
    <summary>{label}{summary}</summary>
    <div className="review-outcome-detail">
      <p>Saved means retained suggestions, not a saved manuscript. In Comments includes History. Accepted edits are kept. Waiting results can be added again locally without another Codex request.</p>
      {error && <p role="alert">Could not confirm saved results: {error}</p>}
      {report?.notices.map((notice, i) => <p key={i} role="status">{notice}</p>)}
      {!!counts?.outside && <p>Retained outside Comments includes results you dismissed, withheld repeats, or comments removed by Undo.</p>}
      {!!counts?.waitingResults && <button disabled={busy} onClick={() => { if (root.current) root.current.open = false; onWaiting(requestIds); }}>Show waiting results ({counts.waitingResults})</button>}
      {report && <details><summary>Saved suggestions ({counts!.saved})</summary>{report.items.flatMap(({ result }) => result.comments).filter((c, i, all) => all.findIndex(other => other.id === c.id) === i).map(c => <details key={c.id}><summary>{c.title}</summary><p>{c.explanation}</p>{c.original && <pre>{c.original}</pre>}{c.replacement !== null && <pre>{c.replacement}</pre>}</details>)}</details>}
      {onDismiss && <button className="text-button" onClick={onDismiss}>Dismiss summary</button>}
    </div>
  </details>;
}
