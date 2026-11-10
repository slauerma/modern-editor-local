import type { SectionProgress } from '../shared/section-review.ts';
import { InfoHint } from './CommentDetails.tsx';
import { CommentUpdates } from './CommentUpdates.tsx';

export function ReviewProgress({ section, pause, resume, stop, autoAdd, onAutoAdd }: {
  autoAdd: boolean; onAutoAdd(value: boolean): void;
  section: SectionProgress | null; pause(): void; resume(): void; stop(): void;
}) {
  const phase = section?.phase ?? 'running';
  const title = phase === 'paused' ? 'Section review paused' : phase === 'pausing' ? 'Finishing this section…'
    : phase === 'discussion_queued' ? 'Your question is queued'
    : phase === 'discussing' ? 'Codex is answering your question…'
    : phase === 'stopping' ? 'Stopping review…' : 'Codex is preparing comments…';
  return <details className="review-progress-menu" aria-label="Codex review progress">
    <summary title={title} aria-label="Review progress and controls"><span className={`review-activity-indicator${phase === 'paused' ? ' paused' : ''}`} aria-hidden="true" /><span role="status">{phase === 'paused' ? 'Paused' : phase === 'stopping' ? 'Stopping…' : 'Reviewing…'}</span></summary>
    <div className="review-progress-popover">
    <div>
      <div className="review-activity-heading">{title}<InfoHint label="review progress">{phase === 'paused' ? 'Continue when ready. Your completed comments are kept.' : 'You can keep writing. Codex can deliver complete batches while continuing to review. Stop cancels remaining work and keeps comments already received.'}</InfoHint></div>
      {section && <p className="review-section-label">{section.label} · {section.completed} of {section.total} sections completed</p>}
    </div>
    <CommentUpdates enabled={autoAdd} onChange={onAutoAdd} />
    <div className="review-activity-actions">
      {section && (['paused', 'pausing', 'discussion_queued', 'discussing'].includes(phase)
        ? <button disabled={phase === 'discussing' || phase === 'discussion_queued'} onClick={resume}>Resume sections</button>
        : <button disabled={phase === 'stopping'} onClick={pause}>Pause after section</button>)}
      <button disabled={phase === 'stopping'} onClick={stop}>Stop review</button>
    </div>
    </div>
  </details>;
}
