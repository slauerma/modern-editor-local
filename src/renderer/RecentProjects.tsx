import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { RecentProjects as RecentState } from '../shared/recent-projects.ts';
import { useDialogFocus } from './use-dialog-focus.ts';
import './recent-projects.css';

export function RecentProjects({ current, open, close, browse }: { current?: string; open(id: string): void; close(): void; browse(): void }) {
  const panel = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<RecentState | null>(null), [error, setError] = useState(''), [query, setQuery] = useState('');
  useDialogFocus(panel, close);
  useEffect(() => { let live = true; void window.editor.recentProjects().then(value => { if (live) setState(value); }).catch(e => { if (live) setError(String(e)); }); return () => { live = false; }; }, []);
  const items = state?.items.filter(item => `${item.name} ${item.path}`.toLowerCase().includes(query.toLowerCase())) ?? [];
  return createPortal(<div className="recent-projects-backdrop"><div className="recent-projects-dialog" role="dialog" aria-modal="true" aria-label="Continue a project" tabIndex={-1} ref={panel}>
    <header><h2>Continue a project</h2><button aria-label="Close recent projects" onClick={close}>×</button></header>
    <p>Reopen a paper with its saved comments, chat and recovery.</p>
    <input type="search" aria-label="Find recent project" value={query} onChange={e => setQuery(e.target.value)} placeholder="Find by name or folder" />
    {error && <p role="alert">{error}</p>}{!state && !error && <p role="status">Loading recent projects…</p>}
    {state && !items.length && <p>{query ? 'No matching recent projects.' : 'No recent projects recorded yet. Open a file once to add it here.'}</p>}
    <ul>{items.map(item => <li key={item.id}><button disabled={!item.available || item.path === current} onClick={() => open(item.id)}><strong>{item.name}{item.path === current ? ' · current' : ''}</strong><span>{item.path}</span><small>{item.available ? 'Last opened' : 'Unavailable — use Open paper to locate it'} · {new Date(item.openedAt).toLocaleString()}</small></button></li>)}</ul>
    <footer><button onClick={browse}>Open another file…</button><button onClick={close}>Done</button></footer>
  </div></div>, document.body);
}
