import { useEffect, useRef, useState } from 'react';
import type { ReferenceState, SourcesHistory } from '../shared/references.ts';
import { useDialogFocus } from './use-dialog-focus.ts';
import './references.css';

export function ReferencePanel({ projectId, disabled, onState, showSources }: { projectId: string; disabled: boolean; onState(state: ReferenceState): void; showSources(): void }) {
  const [state, setState] = useState<ReferenceState>({ roots: [], notices: [] });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const mounted = useRef(true), working = useRef(false), changed = useRef(onState); changed.current = onState;
  function apply(next: ReferenceState) { if (mounted.current) { setState(next); changed.current(next); } }
  useEffect(() => {
    mounted.current = true;
    void window.editor.referenceState(projectId).then(apply).catch(e => { if (mounted.current) setError(String(e)); });
    return () => { mounted.current = false; };
  }, [projectId]);
  async function act(action: () => Promise<ReferenceState | null>) {
    if (working.current || disabled) return;
    working.current = true; setBusy(true); setError('');
    try { const next = await action(); if (next) apply(next); }
    catch (e) { if (mounted.current) setError((e as Error).message); }
    finally { working.current = false; if (mounted.current) setBusy(false); }
  }
  return <section className="reference-panel" aria-label="Remembered references">
    <p>Attach once for this paper. When you ask, Codex can find and read relevant material here. Read-only excerpts are sent to your configured Codex service; the draft in the editor remains authoritative.</p>
    <div className="attachment-actions"><button disabled={disabled || busy} onClick={() => void act(() => window.editor.addReferences(projectId, true))}>Add reference folder…</button><button disabled={disabled || busy} onClick={() => void act(() => window.editor.addReferences(projectId, false))}>Add reference files…</button><button onClick={showSources}>Sources used…</button></div>
    {state.roots.length > 0 && <ul className="reference-roots">{state.roots.map(root => <li key={root.id}>
      <label><input type="checkbox" checked={root.enabled} disabled={disabled || busy} onChange={e => void act(() => window.editor.changeReference(projectId, root.id, e.target.checked))} /><span>{root.name}<small>{root.kind === 'folder' ? 'Folder' : 'File'}{!root.available ? ' · unavailable — reattach if needed' : root.enabled ? ' · available to Codex' : ' · disabled'}</small></span></label>
      <button disabled={disabled || busy} aria-label={`Remove reference ${root.name}`} onClick={() => void act(() => window.editor.changeReference(projectId, root.id, null))}>Remove</button>
    </li>)}</ul>}
    {busy && <p role="status">Saving reference choices…</p>}
    {state.notices.map((notice, i) => <p className="attachment-hint" key={i}>{notice}</p>)}
    {error && <p role="alert" className="error">{error}</p>}
    <p className="attachment-hint">No file-by-file selection or preview is required. Removing a reference leaves its files intact. For a specific page or passage, use the optional excerpt controls below.</p>
  </section>;
}

export function SourcesUsedPanel({ projectId, close }: { projectId: string; close(): void }) {
  const [history, setHistory] = useState<SourcesHistory>({ items: [], notices: [] });
  const [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const dialog = useRef<HTMLDivElement>(null); useDialogFocus(dialog, close);
  useEffect(() => {
    let live = true;
    void window.editor.sourcesUsed(projectId).then(value => { if (live) setHistory(value); }).catch(e => { if (live) setError(String(e)); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [projectId]);
  return <div className="workspace-panel-backdrop"><div ref={dialog} className="workspace-panel sources-panel" role="dialog" aria-modal="true" aria-label="Sources used" tabIndex={-1}>
    <div className="recovery-heading"><h2>Sources used</h2><button aria-label="Close sources used" onClick={close}>×</button></div>
    <p>Recorded by the editor from reference-tool results. Search entries show returned matches and coverage; they do not mean Codex read every word of the file. Older requests retain the excerpts they used.</p>
    {loading && <p role="status">Loading source records…</p>}{error && <p role="alert" className="error">{error}</p>}
    {history.notices.map((notice, i) => <p key={i} role="status">{notice}</p>)}
    {!loading && !history.items.length && <p>No reference-tool records yet. They appear after a review or discussion that has attached references.</p>}
    {history.items.map((item, i) => <details key={item.id} open={i === 0} className="source-request"><summary>{item.kind === 'review' ? 'Review' : 'Discussion'} · {new Date(item.createdAt).toLocaleString()} · {item.status === 'complete' ? 'completed' : 'stopped or failed'} · {item.sources.length} reads/searches</summary>
      {!item.sources.length && <p>No reference excerpts were returned by reading tools in this request.</p>}
      {item.notices.map((notice, j) => <p key={j} className="attachment-hint">{notice}</p>)}
      {item.sources.map((source, j) => <details key={j} className="source-use"><summary>{source.action === 'read' ? 'Read' : 'Searched'}: {source.name} · {source.location}</summary>
        {source.notices.map((notice, k) => <p key={k} className="attachment-hint">{notice}</p>)}
        {!source.excerpts.length && <p>No matching excerpt returned.</p>}
        {source.excerpts.map((excerpt, k) => <article key={k}><strong>{excerpt.location}</strong><pre tabIndex={0}>{excerpt.text}</pre></article>)}
      </details>)}
    </details>)}
  </div></div>;
}
