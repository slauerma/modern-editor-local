import { useDialogFocus } from './use-dialog-focus.ts';
import { useEffect, useRef, useState } from 'react';
import type { Comment } from '../shared/contracts.ts';
import { feedbackComments, type FeedbackRecord } from '../shared/feedback.ts';
import { FEEDBACK_BYTES, nextFeedbackBatch, type PrepareFeedback } from '../shared/feedback-batches.ts';
import type { ReferenceState } from '../shared/references.ts';
import { ReadableArea } from './ReadableArea.tsx';
import './feedback.css';

type Props = { autoAdd: boolean; onAutoAdd(value: boolean): void; projectId: string; open: boolean; text: string; comments: Comment[]; disabled: boolean; contextId?: string; onClose(): void;
  onPrepare(input: Omit<PrepareFeedback, 'projectId' | 'text'>): Promise<FeedbackRecord>;
  onConvert(record: FeedbackRecord, all: boolean): Promise<FeedbackRecord>; onPause(): Promise<void>;
  onAdopt(comments: Comment[], text: string): Promise<void>; onPreview(record: FeedbackRecord): void };
export function FeedbackPanel({ autoAdd, onAutoAdd, projectId, open, text, comments, disabled, contextId, onClose, onPrepare, onConvert, onPause, onAdopt, onPreview }: Props) {
  const [label, setLabel] = useState('Outside feedback'), [raw, setRaw] = useState('');
  const [contexts, setContexts] = useState<ReferenceState['roots']>([]), [context, setContext] = useState(contextId ?? '');
  const [records, setRecords] = useState<FeedbackRecord[]>([]), [active, setActive] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]), [busy, setBusy] = useState(false), [converting, setConverting] = useState(false), [error, setError] = useState(''), [notices, setNotices] = useState<string[]>([]);
  const working = useRef(false), mounted = useRef(true), panel = useRef<HTMLElement>(null);
  useDialogFocus(panel, onClose, { open });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function refresh() {
    const [saved, references] = await Promise.all([window.editor.savedFeedback(projectId), window.editor.referenceState(projectId)]);
    if (mounted.current) { setRecords(saved.items); setNotices(saved.notices); setContexts(references.roots.filter(root => root.kind === 'paste')); }
  }
  useEffect(() => { if (open) {
    setContext(contextId ?? '');
    // An explicit "Turn into comments" starts preparation for that context,
    // rather than leaving the previous report's conversion button in front.
    if (contextId) { setActive(null); setSelected([]); setError(''); }
    void refresh().catch(e => setError(String(e)));
  } }, [open, contextId]);
  const record = records.find(r => r.id === active), available = record ? feedbackComments(record, text, comments) : [];
  const pending = record?.plan?.items.filter(item => !item.complete).length ?? 0, bytes = new TextEncoder().encode(raw).length;
  async function act(action: () => Promise<void>) {
    if (working.current || disabled) return;
    working.current = true; setBusy(true); setError('');
    try { await action(); }
    catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { working.current = false; if (mounted.current) { setBusy(false); setConverting(false); await refresh().catch(e => setError(String(e))); } }
  }
  function keep(saved: FeedbackRecord) {
    if (!mounted.current) return;
    setRecords(prior => [saved, ...prior.filter(r => r.id !== saved.id)]); setActive(saved.id); setSelected([]);
  }
  function convert(all: boolean) { if (record) void act(async () => { setConverting(true); keep(await onConvert(record, all)); }); }
  return <div className="feedback-overlay" hidden={!open}><section ref={panel} tabIndex={-1} className="feedback-panel" role="dialog" aria-modal="true" aria-label="Import outside feedback">
    <div className="recovery-heading"><h2>Outside feedback</h2><button aria-label="Close outside feedback" onClick={onClose}>×</button></div>
    <p>Prepare a numbered Markdown review or JSON comments locally, then convert it with Codex in saved batches. There is no 30-comment total limit. Your manuscript stays unchanged until you accept an imported suggestion.</p>
    <details open={!record}><summary>Prepare a review</summary>
      <label>Review source<select aria-label="Feedback context" value={context} disabled={busy} onChange={e => setContext(e.target.value)}>
        <option value="">Paste feedback</option>{contexts.map(root => <option value={root.id} key={root.id}>{root.name}{root.enabled ? '' : ' · context disabled'}</option>)}
      </select></label>
      {!context && <><label>Source label<input aria-label="Feedback source label" maxLength={200} value={label} onChange={e => setLabel(e.target.value)} disabled={busy} /></label>
        <label>Feedback<textarea aria-label="Outside feedback text" value={raw} disabled={busy} onChange={e => setRaw(e.target.value)} onPaste={e => {
          const pasted = e.clipboardData.getData('text/plain'), field = e.currentTarget;
          if (pasted) { e.preventDefault(); setRaw(field.value.slice(0, field.selectionStart) + pasted + field.value.slice(field.selectionEnd)); }
        }} placeholder="1. Location, passage, concern and optional replacement…" /></label>
        <small>{bytes.toLocaleString()} / {FEEDBACK_BYTES.toLocaleString()} bytes</small>
      </>}
      <p>Prepare saves the original text, numbered items, draft snapshot and current saved paper instructions. It sends nothing. Conversion sends each batch and the captured draft to Codex, including when you choose disabled context explicitly.</p>
      <button disabled={disabled || busy || (!context && (!raw.trim() || !label.trim() || bytes > FEEDBACK_BYTES))} onClick={() => void act(async () => keep(await onPrepare(context ? { contextId: context } : { label, feedback: raw })))}>Prepare items</button>
    </details>
    <label>Saved feedback<select aria-label="Saved outside feedback" disabled={busy} value={active ?? ''} onChange={e => { setActive(e.target.value || null); setSelected([]); setError(''); }}><option value="">Choose saved feedback…</option>{records.map(r => <option key={r.id} value={r.id}>{r.label} · {new Date(r.createdAt).toLocaleString()} · {r.status}</option>)}</select></label>
    {notices.map((n,i) => <p key={i}>{n}</p>)}
    {record && <>
      {record.plan && <><p role="status">{record.plan.items.length - pending} / {record.plan.items.length} review items converted · {record.comments.length} comments saved · {pending} pending</p>
        <label><input type="checkbox" checked={autoAdd} onChange={e => onAutoAdd(e.target.checked)} /> Add comments when ready</label>
        <div className="feedback-actions">
          <button className="primary" disabled={disabled || busy || !pending} onClick={() => convert(true)}>Convert remaining with Codex</button>
          <button disabled={disabled || busy || !pending} onClick={() => convert(false)}>Next batch ({nextFeedbackBatch(record).length})</button>
          <button disabled={busy || !pending} onClick={() => onPreview(record)}>Preview next request</button>
          {converting && <button onClick={() => void onPause().catch(e => setError(String(e)))}>Pause conversion</button>}
        </div>
        {converting && <p role="status">Converting… Each completed batch is saved. Pause stops the current request; earlier batches remain available.</p>}
        <details><summary>Review items and coverage</summary><ol className="feedback-items">{record.plan.items.map(item => <li key={item.id}><details><summary>Item {item.number} · {item.complete ? item.commentIds.length + ' comment(s) saved' : 'pending'}</summary><pre>{item.text}</pre></details></li>)}</ol></details>
      </>}
      <details><summary>Original feedback · {record.label}</summary><ReadableArea label="saved feedback" resetKey={record.id}><pre>{record.feedback}</pre></ReadableArea></details>
      {!record.plan && record.status !== 'complete' && <button disabled={busy || disabled} onClick={() => { setContext(''); setLabel(record.label); setRaw(record.feedback); setActive(null); }}>Prepare this older feedback again</button>}
      {record.error && <p className="stale-notice">{record.error}</p>}
      {record.source !== text && <p className="stale-notice">The draft has changed. Resuming uses the captured draft and saved guidance. Imported quotations require confirmation in the current source before applying replacements.</p>}
      {record.comments.length > 0 && <><p>{available.length ? 'Choose comments to add. Missing or ambiguous quotations remain visible for inspection; they are never guessed.' : 'All these comments are already in the queue. The original review remains here.'}</p>
        <div className="feedback-actions"><button disabled={busy || disabled || !available.length} onClick={() => setSelected(available.map(c => c.id))}>Select all available ({available.length})</button>
          <button className="primary" disabled={disabled || busy || !selected.some(id => available.some(c => c.id === id))} onClick={() => void act(async () => { await onAdopt(available.filter(c => selected.includes(c.id)), text); setSelected([]); })}>Add selected comments</button></div>
        {available.map(c => <article className="feedback-comment" key={c.id}><label><input type="checkbox" disabled={busy} checked={selected.includes(c.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids,c.id] : ids.filter(id => id !== c.id))} /> {c.title}</label><p>{c.explanation}</p><small>{c.validity === 'current' ? 'Located in this draft' : c.original ? 'Needs source confirmation · ' + c.validity : 'Discussion · no local quotation'}</small>{c.original && <details><summary>Original and suggestion</summary><pre>{c.original}</pre><pre>{c.replacement ?? 'Discussion only; no replacement.'}</pre></details>}</article>)}
      </>}
    </>}
    {error && <p role="alert" className="error">{error}</p>}
  </section></div>;
}
