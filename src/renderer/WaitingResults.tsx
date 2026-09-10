import type { WaitingResult } from '../shared/contracts.ts';

export function WaitingResults({ items, notices, busy, onHandle, onRefresh, onClose }: { items: WaitingResult[]; notices: string[]; busy: boolean; onHandle(id: string, action: 'adopted' | 'dismissed'): void; onRefresh(): void; onClose(): void }) {
  return <section className="waiting-results" aria-label="Waiting Codex results">
    <div className="recovery-heading"><strong>Waiting Codex results</strong><button className="icon" aria-label="Close waiting results" onClick={onClose}>×</button></div>
    <p>These answers were saved before delivery. Inspect results from earlier drafts before adding them. Uncertain passages still require confirmation; your source and edited proposals stay unchanged.</p>
    {notices.map((notice, i) => <p className="error" key={i}>{notice}</p>)}
    {!items.length && <p>No results waiting.</p>}
    {items.map(item => <details key={item.id}><summary>{item.kind === 'review' ? `${item.comments.length} review comments` : 'Discussion answer'} · {new Date(item.createdAt).toLocaleString()}</summary>
      {item.kind === 'review' ? item.comments.map(c => <div key={c.id}><strong>{c.title}</strong><p>{c.explanation}</p><small>Original</small><pre>{c.original}</pre>{c.replacement !== null && <><small>Proposed replacement</small><pre>{c.replacement}</pre></>}</div>) : <><pre>{item.original}</pre><p>{item.answer.reply}</p>{item.answer.replacement !== null && <pre>{item.answer.replacement}</pre>}</>}
      <button disabled={busy} onClick={() => onHandle(item.id, 'adopted')}>{item.kind === 'review' ? 'Add these comments' : 'Attach answer to comment'}</button>{' '}
      <button disabled={busy} onClick={() => onHandle(item.id, 'dismissed')}>Dismiss result</button>
    </details>)}
    <button disabled={busy} onClick={onRefresh}>Refresh results</button>
  </section>;
}
