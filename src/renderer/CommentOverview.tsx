import { useState } from 'react';
import type { Comment } from '../shared/contracts.ts';
export function CommentOverview({ comments, activeId, onChoose }: { comments: Comment[]; activeId: string | null; onChoose(comment: Comment): void }) {
  const [filter, setFilter] = useState('open'), [category, setCategory] = useState('all'), [query, setQuery] = useState('');
  const matches = comments.filter(c => matchesComment(c, query));
  const visible = matches.filter(c => (filter === 'later' ? c.decision === 'open' && c.later : filter === 'all' || filter === 'placement' ? filter === 'all' || c.decision === 'open' && c.validity !== 'current' : c.decision === filter) && (category === 'all' || c.category === category));
  return <section className="comment-overview" aria-label="Comment overview"><div>
    <input type="search" aria-label="Search comments" placeholder="Search comments…" value={query} onChange={e => setQuery(e.target.value)} />
    <select aria-label="Comment status filter" value={filter} onChange={e => setFilter(e.target.value)}><option value="open">Open</option><option value="later">Later</option><option value="placement">Needs placement</option><option value="applied">Applied</option><option value="resolved">Resolved</option><option value="dismissed">Rejected</option><option value="all">All</option></select>
    <select aria-label="Comment category filter" value={category} onChange={e => setCategory(e.target.value)}><option value="all">All categories</option>{[...new Set(comments.map(c => c.category))].sort().map(c => <option key={c}>{c}</option>)}</select></div>
    {query.trim() && matches.length > visible.length && <p>{matches.length - visible.length} matching comments hidden by filters. <button className="text-button" onClick={() => { setFilter('all'); setCategory('all'); }}>Show all matches</button></p>}
    <div className="overview-items">{visible.map(c => <button key={c.id} aria-current={activeId === c.id ? 'true' : undefined} onClick={() => onChoose(c)}><span>{c.title}</span><small>{c.category} · {c.decision === 'dismissed' ? 'Rejected' : c.decision}{c.later && c.decision === 'open' ? ' · Later' : ''}{c.validity !== 'current' ? ` · ${c.validity}` : ''}</small></button>)}{!visible.length && <p>No matching comments.</p>}</div>
  </section>;
}

export function matchesComment(c: Comment, query: string): boolean {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const text = [c.title, c.explanation, c.original, c.replacement, c.draft, c.rejectionReason, c.replyDraft,
    ...c.messages.flatMap(m => [m.text, m.proposalOriginal, m.proposal?.replacement]),
    ...(c.alternatives ?? []).flatMap(a => [a.label, a.reason, a.original, a.replacement, a.draft])].filter(Boolean).join('\n').toLocaleLowerCase();
  return words.every(word => text.includes(word));
}
