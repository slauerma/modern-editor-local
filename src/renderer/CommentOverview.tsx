import { useState } from 'react';
import type { Comment } from '../shared/contracts.ts';
export function CommentOverview({ comments, activeId, onChoose }: { comments: Comment[]; activeId: string | null; onChoose(comment: Comment): void }) {
  const [filter, setFilter] = useState('open'), [category, setCategory] = useState('all');
  const visible = comments.filter(c => (filter === 'later' ? c.decision === 'open' && c.later : filter === 'all' || filter === 'placement' ? filter === 'all' || c.decision === 'open' && c.validity !== 'current' : c.decision === filter) && (category === 'all' || c.category === category));
  return <section className="comment-overview" aria-label="Comment overview"><div>
    <select aria-label="Comment status filter" value={filter} onChange={e => setFilter(e.target.value)}><option value="open">Open</option><option value="later">Later</option><option value="placement">Needs placement</option><option value="applied">Applied</option><option value="resolved">Resolved</option><option value="dismissed">Dismissed</option><option value="all">All</option></select>
    <select aria-label="Comment category filter" value={category} onChange={e => setCategory(e.target.value)}><option value="all">All categories</option>{[...new Set(comments.map(c => c.category))].sort().map(c => <option key={c}>{c}</option>)}</select></div>
    <div className="overview-items">{visible.map(c => <button key={c.id} aria-current={activeId === c.id ? 'true' : undefined} onClick={() => onChoose(c)}><span>{c.title}</span><small>{c.category} · {c.decision}{c.later && c.decision === 'open' ? ' · Later' : ''}{c.validity !== 'current' ? ` · ${c.validity}` : ''}</small></button>)}{!visible.length && <p>No matching comments.</p>}</div>
  </section>;
}
