import { useEffect, useState } from 'react';
import type { ReviewConversationState, ReviewConversationHistory, ReviewExchange } from '../shared/review-conversation.ts';
import type { Comment } from '../shared/contracts.ts';
import { ReviewOutcomeSummary } from './ReviewOutcomeSummary.tsx';

export function ReviewConversationControl({ projectId, onActiveChange, onReuse, comments, onWaiting, disabled }: { projectId: string; onActiveChange(active: boolean): void; onReuse(instruction: string): void; comments: Comment[]; onWaiting(ids: string[]): void; disabled: boolean }) {
  const [state, setState] = useState<ReviewConversationState>(), [error, setError] = useState('');
  const [selected, setSelected] = useState(''), [history, setHistory] = useState<ReviewConversationHistory>(), [exchange, setExchange] = useState<ReviewExchange>(), [technical, setTechnical] = useState('');
  const [reused, setReused] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { let live = true; onActiveChange(false); void window.editor.reviewConversation(projectId).then(value => {
    if (live) { setState(value); setSelected(value.active?.id ?? ''); onActiveChange(!!value.active); }
  }).catch(e => { if (live) setError(e instanceof Error ? e.message : String(e)); }); return () => { live = false; }; }, [projectId, onActiveChange]);
  async function load(id = selected, offset = 0) {
    if (!id || busy) return;
    setBusy(true); setError(''); setExchange(undefined); setTechnical(''); setReused(false); setSelected(id);
    try { const value = await window.editor.reviewConversationHistory(projectId, id, offset); setHistory(old => offset && old ? { ...value, items: [...old.items, ...value.items] } : value); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return <div className="review-conversation">
    {!!state?.conversations.length && <details className="review-conversation-history" onToggle={e => { if (e.currentTarget.open && !history) void load(); }}><summary>Review history</summary>
      {state.conversations.length > 1 && <select aria-label="Saved review conversation" value={selected} disabled={busy} onChange={e => void load(e.target.value)}>{state.conversations.map(c => <option key={c.id} value={c.id}>{c.id === state.active?.id ? 'Current · ' : ''}{new Date(c.createdAt).toLocaleString()} · {c.label}</option>)}</select>}
      {history?.items.map(t => <div key={t.id} className="review-history-row"><button className="text-button" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { setExchange(await window.editor.reviewConversationExchange(projectId, selected, t.id)); setTechnical(''); setReused(false); } catch (e) { setError(String(e)); } finally { setBusy(false); } }}>{t.instruction || t.kind}</button><span>{new Date(t.createdAt).toLocaleString()} · {t.status === 'pending' ? 'No final outcome recorded' : t.status}</span></div>)}
      {history?.nextOffset !== null && history?.nextOffset !== undefined && <button disabled={busy} onClick={() => void load(selected, history.nextOffset!)}>Earlier requests</button>}
      {exchange && <article key={exchange.id} className="review-history-exchange" aria-label="Saved review exchange">
        <p>{new Date(exchange.createdAt).toLocaleString()} · {exchange.kind} · {exchange.status === 'pending' ? 'No final outcome recorded' : exchange.status}</p>
        <strong>Your instructions</strong><p className="review-history-prose">{exchange.instruction || 'No additional instructions.'}</p>
        {exchange.kind === 'review' && <button disabled={disabled || busy || !exchange.instruction.trim()} onClick={() => { onReuse(exchange.instruction); setReused(true); }}>Use these instructions again</button>}
        {reused && <p role="status">Instructions copied to the review form. Check the scope and model before starting.</p>}
        {exchange.answer && <p className="review-history-prose">{exchange.answer}</p>}
        {!!exchange.suggestions.length && <details><summary>Returned suggestions ({exchange.suggestions.length})</summary>{exchange.suggestions.map((c, i) => <details key={i}><summary>{c.title || 'Suggestion ' + (i + 1)}</summary><p className="review-history-prose">{c.explanation}</p>{c.original && <><small>Original</small><pre>{c.original}</pre></>}{c.replacement !== null ? <><small>Proposed replacement</small><pre>{c.replacement}</pre></> : <p>Discussion only.</p>}</details>)}</details>}
        {exchange.error && <p className="review-history-prose">{exchange.error}</p>}
        {exchange.originRequestId && exchange.kind === 'review' && exchange.status !== 'pending' && <ReviewOutcomeSummary key={exchange.id} projectId={projectId} requestIds={[exchange.originRequestId]} outcome={exchange.status} comments={comments} onWaiting={onWaiting} />}
        <details onToggle={e => { if (e.currentTarget.open && !technical && !busy) { setBusy(true); void window.editor.reviewConversationTurn(projectId, selected, exchange.id).then(setTechnical).catch(e => setError(String(e))).finally(() => setBusy(false)); } }}><summary>Technical details</summary>{technical && <pre className="review-history-text" tabIndex={0}>{technical}</pre>}</details>
      </article>}
    </details>}
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}
