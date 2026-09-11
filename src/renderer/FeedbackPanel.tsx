import { useDialogFocus } from './use-dialog-focus.ts';
import { useEffect, useRef, useState } from 'react';
import type { Comment } from '../shared/contracts.ts';
import { feedbackComments, type FeedbackRecord } from '../shared/feedback.ts';
import { ReadableArea } from './ReadableArea.tsx';
import './feedback.css';

type Props = { projectId: string; open: boolean; text: string; comments: Comment[]; disabled: boolean; onClose(): void;
  onConvert(label: string, feedback: string): Promise<FeedbackRecord>; onAdopt(comments: Comment[], text: string): Promise<void>; onPreview(label: string, feedback: string): void };
export function FeedbackPanel({ projectId, open, text, comments, disabled, onClose, onConvert, onAdopt, onPreview }: Props) {
  const [label, setLabel] = useState('Outside feedback'), [raw, setRaw] = useState('');
  const [records, setRecords] = useState<FeedbackRecord[]>([]), [active, setActive] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notices, setNotices] = useState<string[]>([]);
  const working = useRef(false), mounted = useRef(true), panel = useRef<HTMLElement>(null);
  useDialogFocus(panel, onClose, { open });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function refresh() {
    const saved = await window.editor.savedFeedback(projectId);
    if (mounted.current) { setRecords(saved.items); setNotices(saved.notices); }
  }
  useEffect(() => { if (open) void refresh().catch(e => setError(String(e))); }, [open]);
  const record = records.find(r => r.id === active), available = record ? feedbackComments(record, text, comments) : [];
  async function act(action: () => Promise<void>) {
    if (working.current || disabled) return;
    working.current = true; setBusy(true); setError('');
    try { await action(); }
    catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { working.current = false; if (mounted.current) { setBusy(false); await refresh().catch(e => setError(String(e))); } }
  }
  return <div className="feedback-overlay" hidden={!open}><section ref={panel} tabIndex={-1} className="feedback-panel" role="dialog" aria-modal="true" aria-label="Import outside feedback">
    <div className="recovery-heading"><h2>Outside feedback</h2><button aria-label="Close outside feedback" onClick={onClose}>×</button></div>
    <p>Paste referee notes, email comments or an AI review. Codex will propose comments for inspection. The raw feedback is saved before the request; your paper stays unchanged.</p>
    <label>Source label<input aria-label="Feedback source label" maxLength={200} value={label} onChange={e => setLabel(e.target.value)} disabled={busy} /></label>
    <label>Feedback<textarea aria-label="Outside feedback text" maxLength={60000} value={raw} onChange={e => setRaw(e.target.value)} disabled={busy} placeholder="Paste unstructured comments here…" /></label>
    <div className="feedback-actions"><button className="primary" disabled={disabled || busy || !raw.trim() || !label.trim()} onClick={() => void act(async () => {
      const saved = await onConvert(label, raw); if (!mounted.current) return;
      setRecords(prior => [saved, ...prior.filter(r => r.id !== saved.id)]); setActive(saved.id); setSelected([]);
    })}>{busy ? 'Working…' : 'Turn into comments with Codex'}</button><button disabled={busy || !raw.trim()} onClick={() => onPreview(label, raw)}>Preview request</button></div>
    <label>Saved feedback<select aria-label="Saved outside feedback" value={active ?? ''} onChange={e => { setActive(e.target.value || null); setSelected([]); }}><option value="">Choose saved feedback…</option>{records.map(r => <option key={r.id} value={r.id}>{r.label} · {new Date(r.createdAt).toLocaleString()} · {r.status}</option>)}</select></label>
    {notices.map((n,i) => <p key={i}>{n}</p>)}
    {record && <><details><summary>Original feedback · {record.label}</summary><ReadableArea label="saved feedback" resetKey={record.id}><pre>{record.feedback}</pre></ReadableArea></details>
      {record.status !== 'complete' && <p role="status">{record.status === 'saved' ? 'The raw feedback is saved; no completed conversion is available.' : record.error}<button disabled={busy || disabled} onClick={() => { setLabel(record.label); setRaw(record.feedback); }}>Use this feedback again</button></p>}
      {record.source !== text && <p className="stale-notice">The draft has changed since this conversion. Imported quotations must be confirmed in the current source before applying replacements.</p>}
      {record.status === 'complete' && <><p>{available.length ? 'Choose the comments to add. General or unmatched advice remains a question for you.' : 'No new comments to add. The original feedback and converted advice are retained here.'}</p>
        {available.map(c => <article className="feedback-comment" key={c.id}><label><input type="checkbox" checked={selected.includes(c.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids,c.id] : ids.filter(id => id !== c.id))} /> {c.title}</label><p>{c.explanation}</p><small>{c.validity === 'current' ? 'Located in this draft' : c.original ? 'Needs source confirmation' : 'General advice · no local quotation'}</small>{c.original && <details><summary>Original and suggestion</summary><pre>{c.original}</pre><pre>{c.replacement ?? 'Question only; no replacement.'}</pre></details>}</article>)}
        <button className="primary" disabled={disabled || busy || !selected.some(id => available.some(c => c.id === id))} onClick={() => void act(async () => { await onAdopt(available.filter(c => selected.includes(c.id)), text); setSelected([]); })}>Add selected comments</button>
        <details><summary>All converted advice ({record.comments.length})</summary>{record.comments.map(c => <article key={c.id}><strong>{c.title}</strong><p>{c.explanation}</p><pre>{c.replacement ?? c.original}</pre></article>)}</details>
      </>}
    </>}
    {error && <p role="alert" className="error">{error}</p>}
  </section></div>;
}
