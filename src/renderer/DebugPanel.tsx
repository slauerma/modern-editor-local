import { useEffect, useState } from 'react';
import { defaultDebugSettings, type DebugState, type DebugSettings } from '../shared/debugging.ts';
import { SettingsChanges } from './SettingsChanges.tsx';

export function DebugPanel({ disabled = false, changesOnly = false, onCount, onBusy }: { disabled?: boolean; changesOnly?: boolean; onCount(count: number): void; onBusy(busy: boolean): void }) {
  const [state, setState] = useState<DebugState | null>(null), [draft, setDraft] = useState<DebugSettings>({ ...defaultDebugSettings }), [undo, setUndo] = useState<DebugSettings | null>(null);
  const [error, setError] = useState(''), [status, setStatus] = useState(''), [busy, setBusy] = useState(false), [confirm, setConfirm] = useState(false);
  useEffect(() => { let live = true; void window.editor.debugState().then(s => { if (live) { setState(s); setDraft(s.settings); } }).catch(e => { if (live) setError(String(e)); }); return () => { live = false; }; }, []);
  async function run(action: () => Promise<DebugState>, settings = false) {
    if (busy || disabled) return;
    setBusy(true); onBusy(true); setError(''); setStatus('');
    try { const next = await action(); setState(next); if (settings) { setDraft(next.settings); setStatus('Debugging settings saved.'); } setConfirm(false); }
    catch (e) { setError(String(e)); } finally { setBusy(false); onBusy(false); }
  }
  const update = (patch: Partial<DebugSettings>) => { setDraft(value => ({ ...value, ...patch })); setUndo(null); setStatus(''); };
  const names: Record<keyof DebugSettings, string> = { enabled: 'Detailed debugging', screenshots: 'Periodic screenshots', screenshotSeconds: 'Screenshot interval (seconds)' };
  const keys = Object.keys(names) as (keyof DebugSettings)[], format = (value: boolean | number) => typeof value === 'boolean' ? value ? 'On' : 'Off' : String(value);
  const changes = state ? keys.filter(key => draft[key] !== defaultDebugSettings[key]).map(key => ({ id: key, label: names[key], current: format(draft[key]), defaultValue: format(defaultDebugSettings[key]) })) : [];
  useEffect(() => onCount(changes.length), [changes.length, onCount]);
  const dirty = state && keys.some(key => draft[key] !== state.settings[key]), locked = busy || disabled;
  return <details className="settings-storage" open={changesOnly && (!!changes.length || !!dirty || !!undo) || undefined}><summary>Debugging · application{state?.settings.enabled ? ' · recording locally' : ' · off'}{changes.length ? ` · ${changes.length} changed` : ''}</summary>
    <p>Optional private records for troubleshooting. These can contain your paper, prompts and screenshots. They are never read as context by the editor or sent automatically to anyone. Recording is off by default; resetting preferences keeps existing records.</p>
    {state && <>
      {!changesOnly && <div className="debug-preferences">
        <label><input type="checkbox" checked={draft.enabled} disabled={locked} onChange={e => update({ enabled: e.target.checked })} /> Save detailed debugging records</label>
        <label><input type="checkbox" checked={draft.screenshots} disabled={locked} onChange={e => update({ screenshots: e.target.checked })} /> Include periodic screenshots of the visible editor</label>
        <label>Screenshot interval <input type="number" aria-label="Screenshot interval (seconds)" min={30} max={600} step={1} value={draft.screenshotSeconds} disabled={locked} onChange={e => update({ screenshotSeconds: Number(e.target.value) })} /> seconds</label>
      </div>}
      <SettingsChanges scope="Debugging" changes={changes} disabled={locked} reset={id => { setUndo({ ...draft }); setDraft(id ? { ...draft, [id]: defaultDebugSettings[id as keyof DebugSettings] } : { ...defaultDebugSettings }); setStatus('Reset staged. Save to apply; existing records are kept.'); }} undo={undo ? () => { setDraft(undo); setUndo(null); setStatus('Previous values restored. Save to apply.'); } : undefined} />
      <div className="settings-actions"><button disabled={locked || !dirty || !Number.isInteger(draft.screenshotSeconds) || draft.screenshotSeconds < 30 || draft.screenshotSeconds > 600} onClick={() => void run(() => window.editor.configureDebug({ ...draft }), true)}>Save debugging settings</button>
        {dirty && <><button disabled={locked} onClick={() => { setDraft(state.settings); setUndo(null); setStatus(''); }}>Discard changes</button><span className="settings-hint">Unsaved</span></>}</div>
      {!changesOnly && <>
        <p>Meaningful editor actions, operation timings, Codex prompts, replies, request errors and supplied images are recorded when enabled. Actions are grouped in files of up to 100 events; individual keystrokes are not recorded. Periodic screenshots capture this editor only. Recording stops at {Math.round(state.limitBytes / 1_000_000)} MB or 500 records.</p>
        <code>{state.directory}</code>
        <p>{state.entries.length} records · {(state.bytes / 1_000_000).toFixed(1)} MB. The folder's register.json lists every saved record.</p>
        {state.notice && <p role="status">{state.notice}</p>}
        <div className="settings-actions"><button disabled={locked} onClick={() => void run(() => window.editor.debugState())}>Refresh register</button>
          <button disabled={locked || (!state.settings.enabled && !state.entries.length)} onClick={() => void window.editor.openDebugFolder().catch(e => setError(String(e)))}>Open debug folder</button>
          <button disabled={locked || !state.entries.length} onClick={() => setConfirm(true)}>Delete all debug records…</button></div>
        {confirm && <p>Switch logging off and delete all {state.entries.length} debug records permanently? Your paper and saved versions are unaffected. <button disabled={locked} onClick={() => { setUndo(null); void run(() => window.editor.deleteDebug('all'), true); }}>Delete records</button><button onClick={() => setConfirm(false)}>Cancel</button></p>}
        <div style={{ maxHeight: 220, overflow: 'auto' }}>{state.entries.map(entry => <p key={entry.id}><time>{new Date(entry.createdAt).toLocaleString()}</time> · {entry.label} · {Math.ceil(entry.bytes / 1000)} KB <button disabled={locked} aria-label={`Delete debug record ${entry.id}`} onClick={() => void run(() => window.editor.deleteDebug([entry.id]))}>Delete</button></p>)}</div>
      </>}
    </>}
    {status && <p role="status" className="settings-status">{status}</p>}{error && <p role="alert" className="error">{error}</p>}
  </details>;
}
