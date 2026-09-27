import { useEffect, useRef, useState } from 'react';
import { PASTED_CONTEXT_BYTES, type ReferenceState, type SourcesHistory, type PastedContext } from '../shared/references.ts';
import { useDialogFocus } from './use-dialog-focus.ts';
import './references.css';

export function ReferencePanel({ projectId, disabled, onState, showSources, convert }: { projectId: string; disabled: boolean; onState(state: ReferenceState): void; showSources(): void; convert(id: string): void }) {
  const [state, setState] = useState<ReferenceState>({ roots: [], notices: [] });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [pasting, setPasting] = useState(false), [name, setName] = useState(''), [text, setText] = useState('');
  const [inspected, setInspected] = useState<(PastedContext & { id: string }) | null>(null), [copied, setCopied] = useState(false);
  const bytes = new TextEncoder().encode(text).length;
  const mounted = useRef(true), working = useRef(false), changed = useRef(onState); changed.current = onState;
  const pasteRevision = useRef(0);
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
  async function inspect(id: string) {
    await act(async () => { const value = await window.editor.inspectContext(projectId, id); if (mounted.current) { setInspected({ ...value, id }); setCopied(false); } return null; });
  }
  async function savePaste() {
    const revision = pasteRevision.current;
    await act(async () => {
      const next = await window.editor.pasteContext(projectId, { name, text });
      // The saved snapshot may finish after the author has started another
      // paste. Only clear the draft that this request actually saved.
      if (mounted.current && pasteRevision.current === revision) { setName(''); setText(''); setPasting(false); }
      return next;
    });
  }
  return <section className="reference-panel" aria-label="Remembered references">
    <p>Attach once for this paper. When you ask, Codex can find and read relevant material here. Read-only excerpts are sent to your configured Codex service; the draft in the editor remains authoritative.</p>
    <div className="attachment-actions"><button disabled={disabled || busy} onClick={() => setPasting(true)}>Paste context…</button><button disabled={disabled || busy} onClick={() => void act(() => window.editor.addReferences(projectId, true))}>Add reference folder…</button><button disabled={disabled || busy} onClick={() => void act(() => window.editor.addReferences(projectId, false))}>Add reference files…</button><button onClick={showSources}>Sources used…</button></div>
    {pasting && <section className="pasted-context" aria-label="Paste context">
      <label>Name<input aria-label="Context name" maxLength={200} value={name} onChange={e => { pasteRevision.current++; setName(e.target.value); }} placeholder="Background notes, referee report…" /></label>
      <label>Text<textarea aria-label="Pasted context text" value={text} onChange={e => { pasteRevision.current++; setText(e.target.value); }} onPaste={e => {
        // Insert a large clipboard document in one update. Native editable-text
        // insertion can block Chromium for many thousands of lines. Keep a
        // fresh paste verbatim, including its original line endings.
        const pasted = e.clipboardData.getData('text/plain'), field = e.currentTarget;
        if (!pasted) return;
        e.preventDefault();
        const next = field.value.slice(0, field.selectionStart) + pasted + field.value.slice(field.selectionEnd);
        const caret = field.selectionStart + pasted.replace(/\r\n?/g, '\n').length;
        pasteRevision.current++; setText(next);
        requestAnimationFrame(() => { if (field.isConnected) field.setSelectionRange(caret, caret); });
      }} spellCheck={false} placeholder="Paste plain text or Markdown here" /></label>
      <p>{bytes.toLocaleString()} / {PASTED_CONTEXT_BYTES.toLocaleString()} bytes · Saved verbatim on this computer. Saving sends nothing to Codex. Enabled context is available when you ask; it is reference material, not standing instructions.</p>
      {bytes > PASTED_CONTEXT_BYTES && <p className="error">This paste exceeds 2 MB. Split it into named documents; your text is still here.</p>}
      <button disabled={disabled || busy || !name.trim() || !text.trim() || bytes > PASTED_CONTEXT_BYTES} onClick={() => void savePaste()}>Save and enable for this paper</button>
      <button onClick={() => setPasting(false)}>Hide draft</button>
    </section>}
    {state.roots.length > 0 && <ul className="reference-roots">{state.roots.map(root => <li key={root.id}>
      <label><input type="checkbox" checked={root.enabled} disabled={disabled || busy} onChange={e => void act(() => window.editor.changeReference(projectId, root.id, e.target.checked))} /><span>{root.name}<small>{root.kind === 'paste' ? 'Pasted text' : root.kind === 'folder' ? 'Folder' : 'File'}{root.bytes !== undefined ? ` · ${root.bytes.toLocaleString()} bytes` : ''}{root.createdAt ? ` · ${new Date(root.createdAt).toLocaleDateString()}` : ''}{!root.available ? ' · unavailable — reattach if needed' : root.enabled ? ' · available to Codex' : ' · disabled'}</small></span></label>
      <div className="context-item-actions">{root.kind === 'paste' && <><button disabled={busy} onClick={() => void inspect(root.id)}>Inspect / copy</button><button disabled={disabled || busy} onClick={() => convert(root.id)}>Turn into comments…</button></>}
      <button disabled={disabled || busy} aria-label={`Remove reference ${root.name}`} onClick={() => { if (root.kind === 'paste' && !confirm('Remove this saved pasted context? Earlier request excerpts remain in Sources used.')) return; void act(async () => { const next = await window.editor.changeReference(projectId, root.id, null); if (inspected?.id === root.id) setInspected(null); return next; }); }}>Remove</button></div>
    </li>)}</ul>}
    {busy && <p role="status">Saving reference choices…</p>}
    {state.notices.map((notice, i) => <p className="attachment-hint" key={i}>{notice}</p>)}
    {error && <p role="alert" className="error">{error}</p>}
    {inspected && <section className="pasted-context" aria-label="Saved pasted context">
      <label>Name<input aria-label="Saved context name" maxLength={200} value={inspected.name} onChange={e => setInspected({ ...inspected, name: e.target.value })} /></label>
      <textarea aria-label="Saved context text" readOnly value={inspected.text} spellCheck={false} />
      <button disabled={busy || disabled || !inspected.name.trim()} onClick={() => void act(() => window.editor.renameContext(projectId, inspected.id, inspected.name))}>Save name</button>
      <button disabled={busy} onClick={() => void act(async () => { await window.editor.copyContext(projectId, inspected.id); setCopied(true); return null; })}>{copied ? 'Copied' : 'Copy full text'}</button>
      <button onClick={() => setInspected(null)}>Close inspection</button>
    </section>}
    <p className="attachment-hint">Codex reads relevant excerpts within each request’s budget; a large saved document is not automatically read in full. Sources used records coverage. Removing a file reference leaves the original file intact; removing pasted context deletes its saved copy. Turn into comments prepares a separate, resumable review; it does not edit the paper or send anything until you request conversion.</p>
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
