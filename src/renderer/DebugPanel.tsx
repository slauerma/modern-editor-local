import { useEffect, useState } from 'react';
import type { DebugState, DebugSettings } from '../shared/debugging.ts';

export function DebugPanel() {
  const [state, setState] = useState<DebugState | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [confirm, setConfirm] = useState(false);
  useEffect(() => { let live = true; void window.editor.debugState().then(s => { if (live) setState(s); }).catch(e => { if (live) setError(String(e)); }); return () => { live = false; }; }, []);
  async function run(action: () => Promise<DebugState>) { setBusy(true); setError(''); try { setState(await action()); setConfirm(false); } catch (e) { setError(String(e)); } finally { setBusy(false); } }
  const configure = (patch: Partial<DebugSettings>) => state && void run(() => window.editor.configureDebug({ ...state.settings, ...patch }));
  return <details className="settings-storage"><summary>Debugging{state?.settings.enabled ? ' · recording locally' : ' · off'}</summary>
    <p>Optional private records for troubleshooting. These can contain your paper, prompts and screenshots. They are never read as context by the editor or sent automatically to anyone. Off by default.</p>
    {state && <>
      <label><input type="checkbox" checked={state.settings.enabled} disabled={busy} onChange={e => configure({ enabled: e.target.checked })} /> Save detailed debugging records</label>
      <label><input type="checkbox" checked={state.settings.screenshots} disabled={busy} onChange={e => configure({ screenshots: e.target.checked })} /> Include a screenshot of the visible editor every {state.settings.screenshotSeconds} seconds while recording</label>
      <p>Codex prompts, replies, request errors and supplied images are recorded when enabled. Periodic screenshots capture this editor only. Recording stops at {Math.round(state.limitBytes / 1_000_000)} MB or 500 records.</p>
      <code>{state.directory}</code>
      <p>{state.entries.length} records · {(state.bytes / 1_000_000).toFixed(1)} MB. The folder's register.json lists every saved record.</p>
      {state.notice && <p role="status">{state.notice}</p>}
      <div className="settings-actions"><button disabled={busy} onClick={() => void run(() => window.editor.debugState())}>Refresh register</button>
        <button disabled={busy || (!state.settings.enabled && !state.entries.length)} onClick={() => void window.editor.openDebugFolder().catch(e => setError(String(e)))}>Open debug folder</button>
        <button disabled={busy || !state.entries.length} onClick={() => setConfirm(true)}>Delete all debug records…</button></div>
      {confirm && <p>Switch logging off and delete all {state.entries.length} debug records permanently? Your paper and saved versions are unaffected. <button disabled={busy} onClick={() => void run(() => window.editor.deleteDebug('all'))}>Delete records</button><button onClick={() => setConfirm(false)}>Cancel</button></p>}
      <div style={{ maxHeight: 220, overflow: 'auto' }}>{state.entries.map(entry => <p key={entry.id}><time>{new Date(entry.createdAt).toLocaleString()}</time> · {entry.label} · {Math.ceil(entry.bytes / 1000)} KB <button disabled={busy} aria-label={`Delete debug record ${entry.id}`} onClick={() => void run(() => window.editor.deleteDebug([entry.id]))}>Delete</button></p>)}</div>
    </>}
    {error && <p role="alert" className="error">{error}</p>}
  </details>;
}
