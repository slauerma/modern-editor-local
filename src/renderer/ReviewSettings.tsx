import { useEffect, useState } from 'react';
import { defaultPaperReviewSettings, type PaperReviewSettings } from '../shared/contracts.ts';
import { defaultChangesEvery } from '../shared/changes-agent.ts';
import { SettingsChanges } from './SettingsChanges.tsx';

type Controls = { disabled: boolean; changesOnly: boolean; onCount(count: number): void; onBusy(busy: boolean): void };
export type PaperSettings = { id: string; name: string; settings: PaperReviewSettings; save(settings: PaperReviewSettings): Promise<void> };
const labels: Record<keyof PaperReviewSettings, string> = { engine: 'LaTeX engine', effort: 'Review effort', fastMode: 'Fast mode', localEditsOnly: 'Smallest local edits only', preserveVoice: 'Preserve my voice' };
const valueLabels: Record<string, string> = { pdflatex: 'pdfLaTeX', lualatex: 'LuaLaTeX', xelatex: 'XeLaTeX', medium: 'Standard', low: 'Quick', high: 'Deep', max: 'Max' };
const format = (value: string | boolean) => typeof value === 'boolean' ? value ? 'On' : 'Off' : valueLabels[value] ?? value;
const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);

export function PaperReviewSettingsPanel({ paper, disabled, changesOnly, onCount, onBusy }: Controls & { paper: PaperSettings }) {
  const [saved, setSaved] = useState(paper.settings), [draft, setDraft] = useState(paper.settings), [undo, setUndo] = useState<PaperReviewSettings | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('');
  const defaults = defaultPaperReviewSettings(), keys = Object.keys(defaults) as (keyof PaperReviewSettings)[];
  const changes = keys.filter(key => draft[key] !== defaults[key]).map(key => ({ id: key, label: labels[key], current: format(draft[key]), defaultValue: format(defaults[key]) }));
  const dirty = keys.some(key => draft[key] !== saved[key]);
  useEffect(() => onCount(changes.length), [changes.length, onCount]);
  return <details className="settings-storage" open={changesOnly && (!!changes.length || dirty || !!undo) || undefined}><summary>Paper review · {paper.name}{changes.length ? ` · ${changes.length} changed` : ''}</summary>
    <p className="settings-hint">Review preferences for this paper. Resets are staged until Save; paper instructions, text, comments and reading position are kept.</p>
    <SettingsChanges scope="Paper review" changes={changes} disabled={disabled || busy} reset={id => {
      setUndo({ ...draft }); setDraft(id ? { ...draft, [id]: defaults[id as keyof PaperReviewSettings] } : { ...defaults }); setStatus('Reset staged. Save to apply.'); setError('');
    }} undo={undo ? () => { setDraft(undo); setUndo(null); setStatus('Previous values restored. Save to apply.'); setError(''); } : undefined} />
    <div className="settings-actions"><button disabled={disabled || busy || !dirty} onClick={async () => {
      setBusy(true); onBusy(true); setError(''); setStatus('');
      try { await paper.save(draft); setSaved({ ...draft }); setStatus('Paper review settings saved.'); }
      catch (e) { setError(errorText(e)); } finally { setBusy(false); onBusy(false); }
    }}>Save paper review settings</button>{dirty && <><button disabled={disabled || busy} onClick={() => { setDraft(saved); setUndo(null); setStatus(''); setError(''); }}>Discard changes</button><span className="settings-hint">Unsaved</span></>}</div>
    {status && <p role="status" className="settings-status">{status}</p>}{error && <p role="alert" className="error">{error}</p>}
  </details>;
}

export function ChangesUpdateSettings({ disabled, changesOnly, onCount, onBusy }: Controls) {
  const [saved, setSaved] = useState<number | null>(null), [draft, setDraft] = useState(defaultChangesEvery), [undo, setUndo] = useState<number | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('');
  useEffect(() => { let live = true; void window.editor.changesSettings().then(s => { if (live) { setSaved(s.every); setDraft(s.every); } }).catch(e => { if (live) setError(errorText(e)); }); return () => { live = false; }; }, []);
  const changes = saved !== null && draft !== defaultChangesEvery ? [{ id: 'every', label: 'Accepted changes per update', current: String(draft), defaultValue: String(defaultChangesEvery) }] : [];
  useEffect(() => onCount(changes.length), [changes.length, onCount]);
  const locked = disabled || busy || saved === null;
  return <details className="settings-storage" open={changesOnly && (!!changes.length || saved !== null && draft !== saved || undo !== null) || undefined}><summary>Changes PDF · application{changes.length ? ' · 1 changed' : ''}</summary>
    {saved !== null && <><p className="settings-hint">Update after this many accepted changes, and on Save or Refresh. The Changes PDF view must have been requested first.</p>
      {!changesOnly && <label>Accepted changes per update <select aria-label="Changes PDF update interval" value={draft} disabled={locked} onChange={e => { setDraft(Number(e.target.value)); setUndo(null); setStatus(''); }}>
        {[...new Set([1, 3, 5, 10, 20, 50, draft])].sort((a,b) => a-b).map(n => <option key={n} value={n}>{n}</option>)}
      </select></label>}
      <SettingsChanges scope="Changes PDF" changes={changes} disabled={locked} reset={() => { setUndo(draft); setDraft(defaultChangesEvery); setStatus('Reset staged. Save to apply.'); }} undo={undo !== null ? () => { setDraft(undo); setUndo(null); setStatus('Previous value restored. Save to apply.'); } : undefined} />
      <div className="settings-actions"><button disabled={locked || draft === saved} onClick={async () => {
        setBusy(true); onBusy(true); setError(''); setStatus('');
        try { const next = await window.editor.changesSettings(draft); setSaved(next.every); setDraft(next.every); window.dispatchEvent(new CustomEvent('changes-settings-updated', { detail: next.every })); setStatus('Changes PDF settings saved.'); }
        catch (e) { setError(errorText(e)); } finally { setBusy(false); onBusy(false); }
      }}>Save Changes PDF settings</button>{draft !== saved && <button disabled={locked} onClick={() => { setDraft(saved); setUndo(null); setStatus(''); }}>Discard changes</button>}</div>
    </>}
    {status && <p role="status" className="settings-status">{status}</p>}{error && <p role="alert" className="error">{error}</p>}
  </details>;
}
