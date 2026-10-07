import { useEffect, useRef, useState } from 'react';
import { setupOperatingSystem, type SetupCheck, type ToolSettings, type ToolSettingsState } from '../shared/tool-settings.ts';
import { useDialogFocus } from './use-dialog-focus.ts';
import { editorialModelName } from '../shared/codex-options.ts';
import type { CodexModel } from '../shared/codex-models.ts';
import './settings-panel.css';
import { DebugPanel } from './DebugPanel.tsx';
import { editorAuthor, predecessorCredit } from '../shared/editor-credits.ts';
import { SettingsChanges } from './SettingsChanges.tsx';
import { ChangesUpdateSettings, PaperReviewSettingsPanel, type PaperSettings } from './ReviewSettings.tsx';

type Props = { onClose(): void; disabled?: boolean; paper?: PaperSettings };
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export function SettingsPanel({ onClose, disabled = false, paper }: Props) {
  const [state, setState] = useState<ToolSettingsState | null>(null), [draft, setDraft] = useState<ToolSettings>({ codexPath: '', latexmkPath: '' });
  const [result, setResult] = useState<SetupCheck | null>(null), [busy, setBusy] = useState('Loading settings…');
  const [error, setError] = useState(''), [status, setStatus] = useState('');
  const [copiedDetails, setCopiedDetails] = useState('');
  const [models, setModels] = useState<CodexModel[] | null>(null);
  const [changesOnly, setChangesOnly] = useState(false), [resetUndo, setResetUndo] = useState<ToolSettings | null>(null);
  const [paperCount, setPaperCount] = useState(0), [updateCount, setUpdateCount] = useState(0), [debugCount, setDebugCount] = useState(0);
  const [paperBusy, setPaperBusy] = useState(false), [updateBusy, setUpdateBusy] = useState(false), [debugBusy, setDebugBusy] = useState(false);
  const extraBusy = paperBusy || updateBusy || debugBusy;
  const live = useRef(true), working = useRef(true), panel = useRef<HTMLElement>(null);
  useDialogFocus(panel, onClose, { canClose: !busy && !extraBusy });
  useEffect(() => {
    let cancelled = false; live.current = true;
    void window.editor.getSetup().then(value => { if (!cancelled) { setState(value); setDraft(value.settings); } }).catch(cause => { if (!cancelled) setError(message(cause)); }).finally(() => {
      if (!cancelled) { working.current = false; setBusy(''); }
    });
    return () => { cancelled = true; live.current = false; };
  }, []);
  const locked = disabled || !!busy || extraBusy || !state;
  const changed = !!state && (draft.codexSource !== state.settings.codexSource || draft.codexPath !== state.settings.codexPath || draft.latexmkPath !== state.settings.latexmkPath || (draft.codexModel ?? null) !== (state.settings.codexModel ?? null));
  const clearChecks = () => { setResult(null); setError(''); setStatus(''); setCopiedDetails(''); };
  const update = (key: keyof ToolSettings, value: string | null) => {
    setDraft(current => ({ ...current, [key]: value })); setResetUndo(null); clearChecks();
    if (key === 'codexPath' || key === 'codexSource') setModels(null);
  };
  const toolChanges = !state ? [] : [
    ...((draft.codexSource === 'managed' ? 'managed' : draft.codexPath) !== (state.defaults.codexSource === 'managed' ? 'managed' : state.defaults.codexPath) ? [{ id: 'codexPath', label: 'Codex installation', current: draft.codexSource === 'managed' ? 'Editor-managed CLI' : draft.codexPath, defaultValue: 'Editor-managed CLI' }] : []),
    ...(draft.latexmkPath !== state.defaults.latexmkPath ? [{ id: 'latexmkPath', label: 'LaTeX compiler', current: draft.latexmkPath, defaultValue: state.defaults.latexmkPath }] : []),
    ...((draft.codexModel ?? null) !== (state.defaults.codexModel ?? null) ? [{ id: 'codexModel', label: 'Codex model', current: draft.codexModel ?? 'Use Codex default', defaultValue: state.defaults.codexModel ?? 'Use Codex default' }] : [])
  ];
  function resetTools(id?: string) {
    if (!state || locked) return;
    setResetUndo({ ...draft }); clearChecks(); setModels(null);
    setDraft(!id ? { ...state.defaults } : id === 'codexPath' ? { ...draft, codexSource: state.defaults.codexSource, codexPath: state.defaults.codexPath } : { ...draft, [id]: state.defaults[id as keyof ToolSettings] });
    setStatus('Reset staged. Save settings to apply.');
  }
  const selectedModel = models?.find(model => model.id === draft.codexModel);
  async function action(label: string, run: () => Promise<void>) {
    if (locked || working.current) return;
    working.current = true; setBusy(label); setError(''); setStatus('');
    try { await run(); }
    catch (cause) { if (live.current) setError(message(cause)); }
    finally { working.current = false; if (live.current) setBusy(''); }
  }
  return <div className="settings-overlay"><section ref={panel} tabIndex={-1} className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="editor-settings-title" aria-busy={!!busy}>
    <header><h2 id="editor-settings-title">Settings</h2><button onClick={onClose} disabled={!!busy || extraBusy}>Close</button></header>
    {state && <p className="settings-identity">Modern Codex Editor <strong>{state.identity.editorVersion}</strong><span>{setupOperatingSystem(state.identity)}</span></p>}
    <nav className="settings-view" aria-label="Settings view"><button aria-pressed={!changesOnly} onClick={() => setChangesOnly(false)}>All settings</button><button aria-pressed={changesOnly} onClick={() => setChangesOnly(true)}>Changed settings ({toolChanges.length + paperCount + updateCount + debugCount})</button></nav>
    <p className="settings-hint">Reset stages default values for the selected group. Save applies them; Undo reset restores the previous values.</p>
    {!changesOnly && <p>The editor includes a fixed Codex CLI version. Choose your TeX installation below; these settings apply to future reviews and compilations.</p>}
    {disabled && <p className="settings-hint">Finish or cancel the current work before changing or checking setup.</p>}
    <div hidden={changesOnly}><div className="settings-executables">
      <label><span>Codex installation</span><select aria-label="Codex installation" value={draft.codexSource === 'managed' ? 'managed' : 'custom'} disabled={locked} onChange={event => {
        const source = event.target.value === 'managed' ? 'managed' : 'custom';
        update('codexSource', source);
        if (source === 'managed' && state) update('codexPath', state.managedCodex.path);
      }}>
        <option value="managed">Editor-managed CLI{state ? ` · ${state.managedCodex.version}` : ''} (recommended)</option>
        <option value="custom">Custom executable</option>
      </select></label>
      {draft.codexSource === 'managed' && <div className="settings-hint">Installed with the editor's locked dependencies. Desktop Codex updates do not change this copy. Sign in from the editor folder with <code>npm run codex:login</code> if needed.</div>}
      {([{ tool: 'codex', key: 'codexPath', title: 'Codex executable' }, { tool: 'latexmk', key: 'latexmkPath', title: 'LaTeX compiler (latexmk)' }] as const).filter(field => field.tool !== 'codex' || draft.codexSource !== 'managed').map(field => <label key={field.key}>
        <span>{field.title}</span>
        <div><input type="text" spellCheck={false} autoComplete="off" aria-label={field.title} value={draft[field.key]} maxLength={4096} disabled={locked} onChange={event => update(field.key, event.target.value)} />
          <button disabled={locked} aria-label={`Choose ${field.title}`} onClick={() => void action('Choosing executable…', async () => {
            const selected = await window.editor.chooseTool(field.tool);
            if (selected && live.current) update(field.key, selected);
          })}>Choose…</button></div>
      </label>)}
    </div>
    <p className="settings-hint">Use an absolute path. You can configure either tool independently; leave the other path unchanged if it is not installed. The TeX installation should keep its engines, kpsewhich and SyncTeX beside latexmk.</p>
    <div className="settings-model">
      <label htmlFor="codex-model">Codex model</label>
      <div className="settings-actions">
        <select id="codex-model" value={draft.codexModel ?? ''} disabled={locked} onChange={event => update('codexModel', event.target.value || null)}>
          <option value="">Use Codex default</option>
          {draft.codexModel && !selectedModel && <option value={draft.codexModel}>{draft.codexModel} · {models ? 'not in current catalog' : 'saved choice'}</option>}
          {models?.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
        </select>
        <button disabled={locked || !draft.codexPath.trim()} onClick={() => void action('Reading available Codex models…', async () => {
          const available = await window.editor.listCodexModels({ ...draft });
          if (live.current) { setModels(available); setStatus(available.length ? 'Model catalog loaded. Choose a model and save settings.' : 'No models were returned. Check your Codex sign-in and access.'); }
        })}>{models ? 'Refresh models' : 'Load models'}</button>
      </div>
      <p className="settings-hint">Applies to new reviews and discussions. Side Chat follows this only when its Model is Editor default; it has separate model, effort and speed controls. Changes PDF and quick editorial actions use {editorialModelName} separately. Your general Codex settings stay unchanged. Load models checks the selected CLI's catalog without sending paper text or starting an AI response.</p>
      {selectedModel && <p className="settings-hint">Supported effort: {selectedModel.efforts.join(', ')}. {selectedModel.fast ? 'Fast mode available.' : 'Standard speed only.'} {selectedModel.images ? 'Screenshots supported.' : 'Text only.'} Access is checked again when you send a request.</p>}
      {models && draft.codexModel && !selectedModel && <p className="settings-hint">The saved model is not in this catalog. Choose an available model or use the Codex default before reviewing.</p>}
    </div>
    </div>
    {state && <details className="settings-storage" open={changesOnly && (!!toolChanges.length || changed || !!resetUndo) || undefined}><summary>Application setup · {toolChanges.length} changed</summary><SettingsChanges scope="Application setup" changes={toolChanges} disabled={locked} reset={resetTools} undo={resetUndo ? () => { setDraft(resetUndo); setResetUndo(null); clearChecks(); setModels(null); setStatus('Previous values restored. Save settings to apply.'); } : undefined} /></details>}
    <div className="settings-actions" hidden={changesOnly && !changed && !resetUndo}>
      <button hidden={changesOnly} disabled={locked || !draft.codexPath.trim() || !draft.latexmkPath.trim()} onClick={() => void action('Checking local versions…', async () => {
        const checked = await window.editor.checkSetup({ ...draft });
        if (live.current) { setResult(checked); setStatus(checked.ready ? 'Required executable version checks passed.' : 'Some required checks need attention.'); }
      })}>Check setup</button>
      <button className="primary" disabled={locked || !changed || !draft.codexPath.trim() || !draft.latexmkPath.trim()} onClick={() => void action('Saving settings…', async () => {
        const saved = await window.editor.saveSetup({ ...draft });
        if (live.current) { setState(saved); setDraft(saved.settings); setResult(null); setStatus('Settings saved.'); }
      })}>Save settings</button>
      {changed && <button disabled={locked} onClick={() => { setDraft(state!.settings); setResetUndo(null); clearChecks(); setModels(null); }}>Discard setup changes</button>}
      <button hidden={changesOnly} disabled={locked || !draft.codexPath.trim() || !draft.latexmkPath.trim()} onClick={() => void action('Checking and copying setup details…', async () => {
        const copied = await window.editor.copySetupDetails({ ...draft });
        if (live.current) { setResult(copied.check); setCopiedDetails(copied.details); setStatus('Setup details copied.'); }
      })}>Copy setup details</button>
      {changed && <span className="settings-hint">Unsaved settings</span>}
    </div>
    {!changesOnly && <><p className="settings-hint">Check setup reads local version information. Compile a sample to test the paper toolchain; AI review also requires your existing Codex sign-in.</p>
    <p className="settings-hint">Copy setup details checks the selected executables and copies editor, operating system, Codex and TeX versions. Paper text, file paths and account details are excluded.</p></>}
    {(busy || status) && <p className="settings-status" role="status">{busy || status}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {copiedDetails && <details className="settings-copy-preview"><summary>Copied setup details</summary><pre>{copiedDetails}</pre></details>}
    {result && <ul className="settings-results" aria-label="Setup check results">{result.checks.map(check => <li key={check.tool}>
      <details open={!check.ok}>
        <summary><span className={check.ok ? 'settings-pass' : check.required ? 'error' : 'settings-optional'}>{check.ok ? '✓' : '!'} {check.tool}</span><span>{check.version || (check.required ? 'Needs attention' : 'Optional engine unavailable')}</span></summary>
        <p>{check.message}</p><code>{check.path}</code>
      </details>
    </li>)}</ul>}
    {!changesOnly && state && <details className="settings-storage"><summary>Storage and supported Codex version</summary>
      <p>Application data and managed samples:</p><code>{state.runtimePath}</code>
      <p>New papers use the folder you choose. Reviews, recovery, and saved source versions stay beside their paper in its hidden .modern-editor folder.</p>
      <p>Tested Codex CLI: <strong>{state.verifiedCodexVersions.join(', ')}</strong>. The editor checks review restrictions before sending paper text.</p>
    </details>}
    {paper && <PaperReviewSettingsPanel paper={paper} disabled={locked} changesOnly={changesOnly} onCount={setPaperCount} onBusy={setPaperBusy} />}
    <ChangesUpdateSettings disabled={locked} changesOnly={changesOnly} onCount={setUpdateCount} onBusy={setUpdateBusy} />
    <DebugPanel disabled={locked} changesOnly={changesOnly} onCount={setDebugCount} onBusy={setDebugBusy} />
    {state?.notices.map((notice, index) => <p key={index} className="settings-hint">{notice}</p>)}
    <p className="settings-hint">By {editorAuthor}. {predecessorCredit}</p>
  </section></div>;
}
