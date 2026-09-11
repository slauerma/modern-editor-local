import { useEffect, useRef, useState } from 'react';
import { setupOperatingSystem, type SetupCheck, type ToolSettings, type ToolSettingsState } from '../shared/tool-settings.ts';
import { useDialogFocus } from './use-dialog-focus.ts';
import './settings-panel.css';

type Props = { onClose(): void; disabled?: boolean };
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export function SettingsPanel({ onClose, disabled = false }: Props) {
  const [state, setState] = useState<ToolSettingsState | null>(null), [draft, setDraft] = useState<ToolSettings>({ codexPath: '', latexmkPath: '' });
  const [result, setResult] = useState<SetupCheck | null>(null), [busy, setBusy] = useState('Loading settings…');
  const [error, setError] = useState(''), [status, setStatus] = useState('');
  const [copiedDetails, setCopiedDetails] = useState('');
  const live = useRef(true), working = useRef(true), panel = useRef<HTMLElement>(null);
  useDialogFocus(panel, onClose, { canClose: !busy });
  useEffect(() => {
    let cancelled = false; live.current = true;
    void window.editor.getSetup().then(value => { if (!cancelled) { setState(value); setDraft(value.settings); } }).catch(cause => { if (!cancelled) setError(message(cause)); }).finally(() => {
      if (!cancelled) { working.current = false; setBusy(''); }
    });
    return () => { cancelled = true; live.current = false; };
  }, []);
  const locked = disabled || !!busy || !state;
  const changed = !!state && (draft.codexPath !== state.settings.codexPath || draft.latexmkPath !== state.settings.latexmkPath);
  const update = (key: keyof ToolSettings, value: string) => { setDraft(current => ({ ...current, [key]: value })); setResult(null); setError(''); setStatus(''); setCopiedDetails(''); };
  async function action(label: string, run: () => Promise<void>) {
    if (locked || working.current) return;
    working.current = true; setBusy(label); setError(''); setStatus('');
    try { await run(); }
    catch (cause) { if (live.current) setError(message(cause)); }
    finally { working.current = false; if (live.current) setBusy(''); }
  }
  return <div className="settings-overlay"><section ref={panel} tabIndex={-1} className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="editor-settings-title" aria-busy={!!busy}>
    <header><h2 id="editor-settings-title">Settings</h2><button onClick={onClose} disabled={!!busy}>Close</button></header>
    {state && <p className="settings-identity">Modern Codex Editor <strong>{state.identity.editorVersion}</strong><span>{setupOperatingSystem(state.identity)}</span></p>}
    <p>Choose your installed Codex and TeX executables. These settings apply to future reviews and compilations.</p>
    {disabled && <p className="settings-hint">Finish or cancel the current work before changing or checking setup.</p>}
    <div className="settings-executables">
      {([{ tool: 'codex', key: 'codexPath', title: 'Codex executable' }, { tool: 'latexmk', key: 'latexmkPath', title: 'LaTeX compiler (latexmk)' }] as const).map(field => <label key={field.key}>
        <span>{field.title}</span>
        <div><input type="text" spellCheck={false} autoComplete="off" aria-label={field.title} value={draft[field.key]} maxLength={4096} disabled={locked} onChange={event => update(field.key, event.target.value)} />
          <button disabled={locked} aria-label={`Choose ${field.title}`} onClick={() => void action('Choosing executable…', async () => {
            const selected = await window.editor.chooseTool(field.tool);
            if (selected && live.current) update(field.key, selected);
          })}>Choose…</button></div>
      </label>)}
    </div>
    <p className="settings-hint">Use an absolute path. You can configure either tool independently; leave the other path unchanged if it is not installed. The TeX installation should keep its engines, kpsewhich and SyncTeX beside latexmk.</p>
    <div className="settings-actions">
      <button disabled={locked || !draft.codexPath.trim() || !draft.latexmkPath.trim()} onClick={() => void action('Checking local versions…', async () => {
        const checked = await window.editor.checkSetup({ ...draft });
        if (live.current) { setResult(checked); setStatus(checked.ready ? 'Required executable version checks passed.' : 'Some required checks need attention.'); }
      })}>Check setup</button>
      <button className="primary" disabled={locked || !changed || !draft.codexPath.trim() || !draft.latexmkPath.trim()} onClick={() => void action('Saving settings…', async () => {
        const saved = await window.editor.saveSetup({ ...draft });
        if (live.current) { setState(saved); setDraft(saved.settings); setResult(null); setStatus('Settings saved.'); }
      })}>Save settings</button>
      <button disabled={locked || !draft.codexPath.trim() || !draft.latexmkPath.trim()} onClick={() => void action('Checking and copying setup details…', async () => {
        const copied = await window.editor.copySetupDetails({ ...draft });
        if (live.current) { setResult(copied.check); setCopiedDetails(copied.details); setStatus('Setup details copied.'); }
      })}>Copy setup details</button>
      {changed && <span className="settings-hint">Unsaved settings</span>}
    </div>
    <p className="settings-hint">Check setup reads local version information. Compile a sample to test the paper toolchain; AI review also requires your existing Codex sign-in.</p>
    <p className="settings-hint">Copy setup details checks the selected executables and copies editor, operating system, Codex and TeX versions. Paper text, file paths and account details are excluded.</p>
    {(busy || status) && <p className="settings-status" role="status">{busy || status}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {copiedDetails && <details className="settings-copy-preview"><summary>Copied setup details</summary><pre>{copiedDetails}</pre></details>}
    {result && <ul className="settings-results" aria-label="Setup check results">{result.checks.map(check => <li key={check.tool}>
      <details open={!check.ok}>
        <summary><span className={check.ok ? 'settings-pass' : check.required ? 'error' : 'settings-optional'}>{check.ok ? '✓' : '!'} {check.tool}</span><span>{check.version || (check.required ? 'Needs attention' : 'Optional engine unavailable')}</span></summary>
        <p>{check.message}</p><code>{check.path}</code>
      </details>
    </li>)}</ul>}
    {state && <details className="settings-storage"><summary>Storage and supported Codex version</summary>
      <p>Application data and managed samples:</p><code>{state.runtimePath}</code>
      <p>New papers use the folder you choose. Reviews, recovery, and saved source versions stay beside their paper in its hidden .modern-editor folder.</p>
      <p>Tested Codex CLI: <strong>{state.verifiedCodexVersions.join(', ')}</strong>. The editor checks review restrictions before sending paper text.</p>
    </details>}
    {state?.notices.map((notice, index) => <p key={index} className="settings-hint">{notice}</p>)}
  </section></div>;
}
