import type { WaitingResult } from '../shared/contracts.ts';

export function WaitingResults({ items, notices, busy, onHandle, onAddAll, onRefresh, onClose, scope, onShowAll }: { scope?: boolean; onShowAll?(): void; items: WaitingResult[]; notices: string[]; busy: boolean; onHandle(id: string, action: 'adopted' | 'dismissed'): void; onAddAll(): void; onRefresh(): void; onClose(): void }) {
  const reviews = items.filter(item => item.kind === 'review');
  const commentCount = reviews.reduce((count, item) => count + item.comments.length, 0);
  return <section className="waiting-results" aria-label="Waiting Codex results">
    <div className="recovery-heading"><strong>Waiting Codex results</strong><button className="icon" aria-label="Close waiting results" onClick={onClose}>×</button></div>
    <div className="waiting-actions">{scope && <><span>This review</span><button onClick={onShowAll}>Show all requests</button></>}<button disabled={busy || !reviews.length} onClick={onAddAll}>Add all comments ({commentCount})</button><button disabled={busy} onClick={onRefresh}>Refresh results</button></div>
    <p>Add to the review queue. Your text and current selection stay unchanged; uncertain passages remain flagged.</p>
    {notices.map((notice, i) => <p className="error" key={i}>{notice}</p>)}
    {!items.length && <p>No results waiting.</p>}
    {items.map(item => <div className="waiting-result" key={item.id}><details><summary>{item.kind === 'review' ? `${item.comments.length} review comments` : 'Discussion answer'} · {new Date(item.createdAt).toLocaleString()}</summary>
      {item.kind === 'review' ? item.comments.map(c => <div key={c.id}><strong>{c.title}</strong><p>{c.explanation}</p><small>Original</small><pre>{c.original}</pre>{c.replacement !== null && <><small>Proposed replacement</small><pre>{c.replacement}</pre></>}</div>) : <><pre>{item.original}</pre><p>{item.answer.reply}</p>{item.answer.replacement !== null && <pre>{item.answer.replacement}</pre>}{item.answer.alternatives?.map((a, i) => <div key={i}><strong>{a.label}</strong><p>{a.reason}</p><pre>{a.replacement}</pre></div>)}</>}
      <button disabled={busy} onClick={() => onHandle(item.id, 'dismissed')}>Dismiss result</button>
    </details><button className="waiting-add" disabled={busy} onClick={() => onHandle(item.id, 'adopted')}>{item.kind === 'review' ? 'Add' : 'Attach answer'}</button></div>)}
  </section>;
}
