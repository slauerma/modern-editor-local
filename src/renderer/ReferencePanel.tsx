import { useEffect, useRef, useState } from 'react';
import { PASTED_CONTEXT_BYTES, type ReferenceState, type SourcesHistory, type PastedContext } from '../shared/references.ts';
import { useDialogFocus } from './use-dialog-focus.ts';
import './references.css';

export function ReferencePanel({ projectId, state, disabled, onState, showSources, convert, pasteRequest = 0 }: { projectId: string; state: ReferenceState; disabled: boolean; onState(state: ReferenceState): void; showSources(): void; convert(id: string): void; pasteRequest?: number }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [pasting, setPasting] = useState(false), [name, setName] = useState(''), [text, setText] = useState('');
  const [inspected, setInspected] = useState<(PastedContext & { id: string }) | null>(null), [copied, setCopied] = useState(false);
  const bytes = new TextEncoder().encode(text).length;
  const mounted = useRef(true), working = useRef(false), changed = useRef(onState); changed.current = onState;
  const pasteRevision = useRef(0);
  const draftField = useRef<HTMLTextAreaElement>(null), pasteForm = useRef<HTMLElement>(null);
  const [savedPaste, setSavedPaste] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => { if (pasteRequest) setPasting(true); }, [pasteRequest]);
  useEffect(() => { if (pasting) { pasteForm.current?.scrollIntoView({ block: 'start' }); draftField.current?.focus({ preventScroll: true }); } }, [pasting, pasteRequest]);
  function apply(next: ReferenceState) { if (mounted.current) changed.current(next); }
  useEffect(() => {
    mounted.current = true;
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
      const previousIds = new Set(state.roots.map(root => root.id));
      const next = await window.editor.pasteContext(projectId, { name: name.trim() || 'Pasted material', text });
      // The saved snapshot may finish after the author has started another
      // paste. Only clear the draft that this request actually saved.
      if (mounted.current && pasteRevision.current === revision) {
        const saved = next.roots.find(root => root.kind === 'paste' && !previousIds.has(root.id));
        setSavedPaste(saved ? { id: saved.id, name: saved.name } : null); setName(''); setText(''); setPasting(false);
      }
      return next;
    });
  }
  return <section className="reference-panel" aria-label="Remembered references">
    <div className="attachment-actions"><button disabled={disabled || busy} onClick={() => setPasting(true)}>Paste material (context/comments)…</button><button disabled={disabled || busy} onClick={() => void act(() => window.editor.addReferences(projectId, true))}>Add reference folder…</button><button disabled={disabled || busy} onClick={() => void act(() => window.editor.addReferences(projectId, false))}>Add reference files…</button><button onClick={showSources}>Sources used…</button></div>
    {savedPaste && !pasting && <div className="paste-saved" role="status"><span>Saved “{savedPaste.name}” · available to the next review.</span><button disabled={disabled || busy} onClick={() => convert(savedPaste.id)}>Turn into comments…</button></div>}
    {pasting && <section ref={pasteForm} className="pasted-context" aria-label="Paste context">
      <div className="paste-save-row"><button disabled={disabled || busy || !text.trim() || bytes > PASTED_CONTEXT_BYTES} onClick={() => void savePaste()}>Save and enable for this paper</button><span role="status">{busy ? 'Saving…' : 'Not yet saved'}</span><button onClick={() => setPasting(false)}>Hide draft</button></div>
      <label>Name (optional)<input aria-label="Context name" maxLength={200} value={name} onChange={e => { pasteRevision.current++; setName(e.target.value); }} placeholder="Background notes, external feedback…" /></label>
      <label>Text<textarea ref={draftField} aria-label="Pasted context text" value={text} onChange={e => { pasteRevision.current++; setText(e.target.value); }} onPaste={e => {
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
      <p>{bytes.toLocaleString()} / {PASTED_CONTEXT_BYTES.toLocaleString()} bytes · Saving keeps the full text locally and sends nothing to Codex. Unsaved text stays in this form while you return to Review.</p>
      {bytes > PASTED_CONTEXT_BYTES && <p className="error">This paste exceeds 2 MB. Split it into named documents; your text is still here.</p>}
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
    <details className="attachment-hint"><summary>How this material is used</summary><p>Enabled material is available when you ask Codex; saving alone sends nothing. Codex reads relevant excerpts within each request’s budget. Sources used records coverage. Turn into comments prepares external feedback for conversion into suggestions. Removing a file reference leaves its original intact; removing pasted material deletes its saved copy.</p></details>
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
    {!loading && !history.items.length && <p>No reading-tool records yet. They appear after a review or discussion with file reading enabled.</p>}
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
