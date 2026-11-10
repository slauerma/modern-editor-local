import { useEffect, useMemo, useRef, useState } from 'react';
import { summarizeUsage, type AccountLimits, type UsageState } from '../shared/usage.ts';
import { effortOptions } from '../shared/codex-options.ts';
import { InfoHint } from './CommentDetails.tsx';
import { useDialogFocus } from './use-dialog-focus.ts';

const duration = (ms: number | null) => ms === null ? '—' : ms < 1000 ? '<1s' : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);
export function UsagePanel({ close, disabled }: { close(): void; disabled: boolean }) {
  const [state, setState] = useState<UsageState>();
  const [filter, setFilter] = useState('today'), [busy, setBusy] = useState(''), [error, setError] = useState('');
  const [limits, setLimits] = useState<AccountLimits>();
  const panel = useRef<HTMLElement>(null), live = useRef(true);
  useDialogFocus(panel, close, { canClose: !busy });
  useEffect(() => {
    live.current = true;
    void window.editor.usageState().then(value => { if (live.current) setState(value); }).catch(e => { if (live.current) setError(errorText(e)); });
    return () => { live.current = false; };
  }, []);
  async function run(label: string, action: () => Promise<void>) {
    if (busy) return;
    setBusy(label); setError('');
    try { await action(); } catch (e) { if (live.current) setError(errorText(e)); }
    finally { if (live.current) setBusy(''); }
  }
  const entries = useMemo(() => (state?.entries ?? []).filter(r => filter === 'paper' ? !!state?.currentScope && r.scope === state.currentScope : filter === 'today' ? new Date(r.createdAt).toDateString() === new Date().toDateString() : true), [state, filter]);
  const summary = summarizeUsage(entries);
  return <div className="settings-overlay"><section className="settings-panel usage-panel" ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Usage & speed">
    <header><h2>Usage &amp; speed</h2><button disabled={!!busy} onClick={close}>Close</button></header>
    <div className="usage-controls"><select aria-label="Usage range" value={filter} onChange={e => setFilter(e.target.value)}><option value="today">Today</option><option value="paper" disabled={!state?.currentScope}>This paper</option><option value="recent">Recent history</option></select>
      <button disabled={!!busy} onClick={() => void run('Refreshing…', async () => { const s = await window.editor.usageState(); if (live.current) setState(s); })}>Refresh</button>
      <InfoHint label="usage history">Local metadata for the most recent 1,000 Codex requests, recorded from this update onward. No prompts, replies or document text. This paper means the paper open when a request started. First usable measures when a new edit or question is in Comments, recovery is saved, and its Accept or discussion controls are available. Manual additions include your waiting time and are not comparable to automatic delivery. Rejected repeats and uncertain replacements do not count. Model response describes the model call. Review results separately reports whether ME validated and retained the answer; delivery to Comments is reported in the review summary. No comments means a validated completed review saved none; a dash means unmeasured, including older requests or delivery after restarting the editor. First batch measures when the first complete batch was saved; First answer measures the start of the response. Both and total time include connection and setup. A dash means unavailable. Fresh and Continue label the review conversation used. Continued requests report only newly used tokens when cumulative totals are available; a dash is never treated as zero. Existing debug records are separate.</InfoHint>
    </div>
    {state && <label className="usage-recording"><input type="checkbox" checked={state.enabled} disabled={!!busy} onChange={e => { const enabled = e.target.checked; void run('Saving…', async () => { const s = await window.editor.configureUsage(enabled); if (live.current) setState(s); }); }} />Record local usage metadata</label>}
    <p className="usage-summary">{summary.requests} model requests · {summary.complete} completed · {summary.errors} failed · {summary.cancelled} cancelled<br />Median total {duration(summary.medianMs)} · {summary.totalTokens === null ? 'Tokens unavailable' : `${summary.totalTokens.toLocaleString()} reported tokens (${summary.tokenReports}/${summary.requests} requests)`}</p>
    <div className="usage-table-wrap"><table className="usage-table"><caption>Recent requests{entries.length > 50 ? ' · showing latest 50' : ''}</caption><thead><tr><th>When / task</th><th>Model / effort / speed</th><th>First usable</th><th>First batch</th><th>First answer</th><th>Total</th><th>Tokens</th><th>Model response</th><th>Review results</th></tr></thead><tbody>
      {entries.slice(0, 50).map(r => <tr key={r.id}><td>{new Date(r.createdAt).toLocaleString()}<br />{r.purpose}{r.reviewMode ? ` · ${r.reviewMode === 'continue' ? 'Continue' : 'Fresh'}` : ''}</td><td>{r.model ?? 'Unavailable'}<br />{effortOptions[r.effort].label} · {r.fastMode ? 'Fast' : 'Standard'}</td><td>{r.firstUsableMs != null ? <>{duration(r.firstUsableMs)}{r.firstUsableDelivery === 'manual' && <small> · manual Add</small>}</> : r.commentCount === 0 && r.reviewOutcome === 'complete' ? 'No comments' : r.commentCount !== undefined ? 'None yet' : '—'}</td><td>{duration(r.firstBatchMs ?? null)}</td><td>{duration(r.firstAnswerMs)}</td><td title={`Connection ${duration(r.connectMs)} · setup ${duration(r.setupMs)}`}>{duration(r.elapsedMs)}</td><td title={r.tokens ? `Input ${r.tokens.inputTokens} (cached ${r.tokens.cachedInputTokens}); output ${r.tokens.outputTokens} (reasoning ${r.tokens.reasoningOutputTokens}). Subsets are not added twice.` : 'Not reported by Codex'}>{r.tokens?.totalTokens.toLocaleString() ?? '—'}</td><td>{r.outcome}</td><td>{r.reviewOutcome === 'complete' ? 'Saved' : r.reviewOutcome ?? '—'}</td></tr>)}
    </tbody></table></div>
    {state && !entries.length && <p>No recorded requests in this range.</p>}
    <section className="usage-account"><h3>Account limits <InfoHint label="account limits">Shared across your Codex account, including use outside this editor. Refreshed only on request. This reads available limits without starting a model response or sending paper text. Token counts above do not determine these percentages.</InfoHint></h3>
      <button disabled={!!busy || disabled} onClick={() => void run('Reading account limits…', async () => { const l = await window.editor.accountLimits(); if (live.current) setLimits(l); })}>Refresh account limits</button>
      {limits && <><p>Checked {new Date(limits.checkedAt).toLocaleString()}</p>{limits.windows.length ? <ul>{limits.windows.map((w, i) => <li key={i}>{w.name}{w.minutes !== null ? ` · ${w.minutes >= 60 ? `${w.minutes / 60}h` : `${w.minutes}min`}` : ''}: {w.usedPercent === null ? 'unavailable' : `${100 - w.usedPercent}% remaining`}{w.resetsAt !== null ? ` · resets ${new Date(w.resetsAt * 1000).toLocaleString()}` : ''}</li>)}</ul> : <p>No account limits reported.</p>}</>}
    </section>
    {busy && <p role="status">{busy}</p>}{state?.notice && <p role="status">{state.notice}</p>}{error && <p className="error" role="alert">{error}</p>}
  </section></div>;
}
