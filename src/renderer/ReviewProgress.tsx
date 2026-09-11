import type { SectionProgress } from '../shared/section-review.ts';

export function ReviewProgress({ section, compact, pause, resume, stop }: {
  section: SectionProgress | null; compact: boolean; pause(): void; resume(): void; stop(): void;
}) {
  const phase = section?.phase ?? 'running';
  const title = phase === 'paused' ? 'Section review paused' : phase === 'pausing' ? 'Finishing this section…'
    : phase === 'discussion_queued' ? 'Your question is queued'
    : phase === 'discussing' ? 'Codex is answering your question…'
    : phase === 'stopping' ? 'Stopping review…' : 'Codex is preparing comments…';
  return <section className={`review-activity${compact ? ' compact' : ''}`} aria-label="Codex review progress">
    <div role="status" aria-live="polite">
      <div className="review-activity-heading"><span className={`review-activity-indicator${phase === 'paused' ? ' paused' : ''}`} aria-hidden="true" /><h2>{title}</h2></div>
      {section && <p className="review-section-label">{section.label} · {section.completed} of {section.total} sections completed</p>}
      {!compact && <p className="review-activity-note">{phase === 'paused' ? 'Continue when ready. Your completed comments are kept.' : 'You can keep writing. Comments appear here as each review finishes.'}</p>}
    </div>
    <div className="review-activity-actions">
      {section && (['paused', 'pausing', 'discussion_queued', 'discussing'].includes(phase)
        ? <button disabled={phase === 'discussing' || phase === 'discussion_queued'} onClick={resume}>Continue review</button>
        : <button disabled={phase === 'stopping'} onClick={pause}>Pause after section</button>)}
      <button disabled={phase === 'stopping'} onClick={stop}>Stop review</button>
    </div>
  </section>;
}
