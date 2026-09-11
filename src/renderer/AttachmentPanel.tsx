import { useEffect, useRef, useState } from 'react';
import { ATTACHMENT_LIMITS, attachmentPromptContext, type AttachmentInventory, type AttachmentPreview, type AttachmentSelection } from '../shared/attachments.ts';
import './attachments.css';

export type AttachmentPanelAPI = {
  inventory(): Promise<AttachmentInventory>;
  chooseFiles(): Promise<AttachmentInventory | null>;
  chooseFolder(): Promise<AttachmentInventory | null>;
  preview(selections: AttachmentSelection[]): Promise<AttachmentPreview>;
  remove(id: string): Promise<AttachmentInventory>;
  clear(): Promise<void>;
};
type Props = { api: AttachmentPanelAPI; preview: AttachmentPreview | null; onPreview(value: AttachmentPreview | null): void; disabled?: boolean; onBusyChange?(busy: boolean): void; onPendingChange?(pending: boolean): void };
const describeBytes = (bytes: number) => bytes < 1_000_000 ? `${Math.ceil(bytes / 1000)} kB` : `${(bytes / 1_000_000).toFixed(1)} MB`;

export function AttachmentPanel({ api, preview, onPreview, disabled = false, onBusyChange, onPendingChange }: Props) {
  const [inventory, setInventory] = useState<AttachmentInventory>({ items: [], notices: [] });
  const [selection, setSelection] = useState<AttachmentSelection[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const mounted = useRef(true), revision = useRef(0), working = useRef(false), apiRef = useRef(api); apiRef.current = api;
  // Callers key this panel by project id. Native grants are scoped to that paper.
  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    const initialRevision = revision.current;
    void apiRef.current.inventory().then(value => {
      if (cancelled || !mounted.current || revision.current !== initialRevision) return;
      setInventory(value);
      const available = new Set(value.items.map(item => item.id));
      setSelection(preview?.selections.filter(item => available.has(item.id)) ?? []);
    }).catch(cause => { if (!cancelled && mounted.current && revision.current === initialRevision) setError(String(cause instanceof Error ? cause.message : cause)); });
    return () => { cancelled = true; mounted.current = false; };
  }, []);
  useEffect(() => { onPendingChange?.(selection.length > 0 && (!preview || busy)); }, [selection.length, preview, busy, onPendingChange]);
  const locked = disabled || busy;
  const change = (next: AttachmentSelection[]) => { revision.current++; setSelection(next); onPreview(null); setError(''); };
  async function act(action: () => Promise<void>) {
    if (locked || working.current) return;
    working.current = true; revision.current++;
    setBusy(true); onBusyChange?.(true); setError('');
    try { await action(); }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { working.current = false; if (mounted.current) { setBusy(false); onBusyChange?.(false); } }
  }
  async function choose(kind: 'files' | 'folder') {
    const next = await (kind === 'files' ? api.chooseFiles() : api.chooseFolder());
    if (!next || !mounted.current) return;
    const existing = new Set(inventory.items.map(item => item.id));
    const additions = kind === 'files' ? next.items.filter(item => !existing.has(item.id)).map(item => ({ id: item.id })) : [];
    const chosen = [...selection, ...additions];
    setInventory(next); change(chosen.slice(0, ATTACHMENT_LIMITS.files));
    if (chosen.length > ATTACHMENT_LIMITS.files) setError(`Choose up to ${ATTACHMENT_LIMITS.files} files for one request. Extra files are listed but unchecked.`);
  }
  const outgoing = attachmentPromptContext(preview);
  return <section className="attachment-panel" aria-label="Local reference context">
    <p>Select local papers or notes for this review or discussion. Selecting files makes no Codex request. When you ask Codex, the previewed text is sent to your configured Codex service.</p>
    <div className="attachment-actions">
      <button disabled={locked} onClick={() => void act(() => choose('files'))}>Choose files…</button>
      <button disabled={locked} onClick={() => void act(() => choose('folder'))}>Choose folder…</button>
      <button disabled={locked || !inventory.items.length} onClick={() => void act(async () => { await api.clear(); if (!mounted.current) return; setInventory({ items: [], notices: [] }); change([]); })}>Remove all</button>
    </div>
    {!inventory.items.length && <p className="attachment-hint">PDF, LaTeX, Markdown and UTF-8 text. Folders provide a file list; choose the files you need.</p>}
    {!!inventory.items.length && <p className="attachment-hint">{selection.length} of {ATTACHMENT_LIMITS.files} references selected. PDF pages default to 1–8; text starts at line 1. Narrow a range for more detail.</p>}
    <ul className="attachment-files">
      {inventory.items.map(item => {
        const selected = selection.find(value => value.id === item.id);
        return <li key={item.id}>
          <label className="attachment-file-label"><input type="checkbox" checked={!!selected} disabled={locked} onChange={event => {
            if (!event.target.checked) return change(selection.filter(value => value.id !== item.id));
            if (selection.length >= ATTACHMENT_LIMITS.files) { setError(`Choose at most ${ATTACHMENT_LIMITS.files} references.`); return; }
            change([...selection, { id: item.id }]);
          }} /><span>{item.name}<small>{item.kind === 'pdf' ? 'PDF' : 'Text'} · {describeBytes(item.bytes)}</small></span></label>
          <label className="attachment-range">{item.kind === 'pdf' ? 'Pages' : 'Lines'}<input aria-label={`${item.kind === 'pdf' ? 'Pages' : 'Lines'} from ${item.name}`} type="text" maxLength={item.kind === 'pdf' ? 160 : 80} placeholder={item.kind === 'pdf' ? '1-3, 7' : '20-80'} value={(item.kind === 'pdf' ? selected?.pages : selected?.lines) ?? ''} disabled={locked || !selected} onChange={event => change(selection.map(value => value.id === item.id ? { id: item.id, [item.kind === 'pdf' ? 'pages' : 'lines']: event.target.value } : value))} /></label>
          <button className="attachment-remove" disabled={locked} aria-label={`Remove ${item.name}`} onClick={() => void act(async () => { const next = await api.remove(item.id); if (!mounted.current) return; setInventory(next); change(selection.filter(value => value.id !== item.id)); })}>Remove</button>
        </li>;
      })}
    </ul>
    {inventory.notices.map((notice, index) => <p key={index} className="attachment-hint">{notice}</p>)}
    {!!inventory.items.length && <div className="attachment-actions"><button disabled={locked || !selection.length} onClick={() => void act(async () => {
      onPreview(null);
      const value = await api.preview(selection);
      if (mounted.current) onPreview(value);
    })}>{busy ? 'Reading local references…' : 'Preview selected context'}</button><span className="attachment-hint">Only previewed excerpts are included. No OCR or image interpretation.</span></div>}
    {!!selection.length && !preview && !busy && <p className="attachment-hint">Preview these references before asking Codex.</p>}
    {error && <p role="alert" className="error">{error}</p>}
    {outgoing && <section className="attachment-preview" aria-label="Reference text Codex will receive">
      <h3>Reference text Codex will receive <span>{preview!.characters.toLocaleString()} characters</span></h3>
      {outgoing.notices.map((notice, index) => <p key={index} className="attachment-hint">{notice}</p>)}
      {outgoing.sources.map((source, index) => <article key={index}><h4>{source.name} · {source.location}</h4><pre tabIndex={0} aria-label={`${source.name}, ${source.location}`}>{source.text}</pre></article>)}
      <p className="attachment-hint">Excerpts remain fixed for this request. If a file changes, create a new preview. Removing a reference does not delete its local file.</p>
    </section>}
  </section>;
}
