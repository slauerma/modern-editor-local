import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CleanupMode, CleanupPapers, CleanupPreview, CleanupResult } from '../shared/project-cleanup.ts';
import { useDialogFocus } from './use-dialog-focus.ts';
import { CleanupFileList, cleanupSize } from './CleanupFileList.tsx';
import './project-cleanup.css';

export function DataCleanupPanel({ list, close }: { list(mode: CleanupMode, days: number): Promise<CleanupPapers>; close(): Promise<void> }) {
  const panel = useRef<HTMLDivElement>(null), working = useRef(false);
  const [mode, setMode] = useState<CleanupMode>('temporary'), [days, setDays] = useState(7);
  const [data, setData] = useState<CleanupPapers | null>(null), [selected, setSelected] = useState<string[]>([]);
  const [plan, setPlan] = useState<CleanupPreview | null>(null), [checked, setChecked] = useState(false), [result, setResult] = useState<CleanupResult | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [progress, setProgress] = useState('');
  async function run(action: () => Promise<void>, message = 'Inspecting files…') {
    if (working.current) return; working.current = true; setBusy(true); setError(''); setProgress(message);
    try { await action(); } catch (e) { setError(String(e)); } finally { working.current = false; setBusy(false); }
  }
  function refresh(next = mode, age = days) { return run(async () => { setMode(next); setDays(age); setPlan(null); setChecked(false); setSelected([]); setData(null); setData(await list(next, age)); }); }
  useEffect(() => { void refresh(); }, []);
  useDialogFocus(panel, () => { void run(close); }, { canClose: !busy });
  const eligible = data?.papers.filter(p => !p.current && !p.problem && p.bytes > 0) ?? [];
  return createPortal(<div className="cleanup-backdrop"><div className="cleanup-dialog" ref={panel} role="dialog" aria-modal="true" aria-label="Data & cleanup" tabIndex={-1}>
    <header><h2>Data &amp; cleanup</h2><button aria-label="Close data cleanup" disabled={busy} onClick={() => void run(close)}>×</button></header>
    {result ? <>
      <p role="status">{result.warning ?? `Cleared ${result.removed} files${result.reset ? ` and reset ${result.reset} paper identities` : ''}.`}</p>
      <p>Recovery archive <code className="cleanup-path">{result.archivePath}</code></p>
      <p>Source documents, figures, exported PDFs and global settings were kept.</p>
      <footer><button disabled={busy} onClick={() => void run(async () => { await window.editor.openCleanupArchive(); })}>Show recovery archive</button><button disabled={busy} onClick={() => void run(close)}>Done</button></footer>
    </> : <>
      <div className="cleanup-options"><button disabled={busy || !!plan} aria-pressed={mode === 'temporary'} onClick={() => void refresh('temporary')}>Clean temporary data</button><button disabled={busy || !!plan} aria-pressed={mode === 'forget'} onClick={() => void refresh('forget')}>Forget selected papers</button></div>
      <p>{mode === 'temporary' ? 'Clear old compilation copies, cached PDFs and build logs. Keep comments, chats and editing history.' : 'Clear comments, chats, saved context, rejection memory and recovery for selected papers. Source files, figures and exported PDFs stay.'} A dated, verified recovery archive comes first.</p>
      {plan ? <>
        <details><summary>Selected papers ({plan.papers?.length})</summary>{plan.papers?.map(p => <code className="cleanup-path" key={p}>{p}</code>)}</details>
        <CleanupFileList plan={plan} />
        <label className="cleanup-confirm"><input type="checkbox" checked={checked} disabled={busy} onChange={e => setChecked(e.target.checked)} />I reviewed the locations and dates and want to clear these {plan.files.length} files after archiving them.</label>
      </> : <>
        {mode === 'temporary' && <label>Builds older than<select aria-label="Temporary data age" value={days} disabled={busy} onChange={e => void refresh(mode, Number(e.target.value))}>{[7,30,90].map(n => <option key={n} value={n}>{n} days</option>)}</select></label>}
        <p className="cleanup-count">Known papers from ME records. The open paper is protected. Storage below is the amount eligible for this action.</p>
        <div className="cleanup-files cleanup-papers" tabIndex={0}><table><thead><tr><th>Paper / location</th><th title="Latest recorded opening, source modification or inspected data modification">Last activity found</th><th>Storage</th></tr></thead><tbody>{data?.papers.map(p => <tr key={p.id}><td><label><input type="checkbox" aria-label={`Select ${p.path}`} disabled={busy || p.current || !!p.problem || !p.bytes} checked={selected.includes(p.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, p.id] : ids.filter(id => id !== p.id))} />{p.name}</label><code>{p.path}</code>{p.problem && <span>{p.problem}</span>}</td><td>{p.lastActivity ? new Date(p.lastActivity).toLocaleString() : 'Unavailable'}</td><td>{p.problem ? 'Not inspected' : cleanupSize(p.bytes)}</td></tr>)}</tbody></table></div>
        {data && !data.papers.length && <p>No papers found in accessible ME records. Choose a source file to inspect its editing data.</p>}
        {!!data?.notices.length && <details><summary>Inspection notices ({data.notices.length})</summary><ul>{data.notices.map((n,i) => <li key={i}>{n}</li>)}</ul></details>}
      </>}
      <footer>
        <button disabled={busy} onClick={() => void run(close)}>Cancel</button>
        {plan ? <><button disabled={busy} onClick={() => void refresh()}>Back to papers</button><button disabled={busy || !checked || !plan.files.length} onClick={() => void run(async () => { setChecked(false); const id = plan.id; setPlan(null); setResult(await window.editor.confirmDataCleanup(id)); }, 'Verifying recovery archive and clearing selected files…')}>Archive and clear</button></> : <>
          <button disabled={busy} onClick={() => void refresh()}>Refresh</button>
          <button disabled={busy} onClick={() => void run(async () => { const value = await window.editor.chooseCleanupPaper({ mode, days }); if (value) { setData(value); setSelected([]); } })}>Choose paper…</button>
          <button disabled={busy || !eligible.length} onClick={() => setSelected(selected.length ? [] : eligible.map(p => p.id))}>{selected.length ? 'Clear selection' : 'Select all eligible'}</button>
          <button disabled={busy || !selected.length} onClick={() => void run(async () => { setChecked(false); setPlan(await window.editor.previewDataCleanup({ ids: selected, mode, days })); })}>Review files ({selected.length})</button>
        </>}
      </footer>
    </>}
    {busy && <p role="status">{progress}</p>}
    {error && <p role="alert" className="error">{error}</p>}
  </div></div>, document.body);
}
