import { useEffect, useRef, useState } from 'react';
import { codexEfforts, effortOptions, type CodexEffort } from '../shared/codex-options.ts';
import type { CodexModel } from '../shared/codex-models.ts';
import { InfoHint } from './CommentDetails.tsx';
import { ModelNotice } from './ModelNotice.tsx';

export function ReviewControls({ effort, fast, disabled, onEffort, onFast, onBusy, onReady, settings }: {
  effort: CodexEffort; fast: boolean; disabled: boolean;
  onEffort(value: CodexEffort): void; onFast(value: boolean): void;
  onBusy(value: boolean): void; onReady(value: boolean): void; settings(): void;
}) {
  const [selected, setSelected] = useState<string | null>(null), [loaded, setLoaded] = useState(false);
  const [models, setModels] = useState<CodexModel[] | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const live = useRef(true), working = useRef(false);
  useEffect(() => {
    live.current = true;
    const refresh = () => { void window.editor.getSetup().then(s => { if (live.current) { setSelected(s.settings.codexModel ?? null); setLoaded(true); } }).catch(e => { if (live.current) setError(String(e)); }); };
    refresh(); window.addEventListener('review-model-changed', refresh);
    return () => { live.current = false; onBusy(false); onReady(true); window.removeEventListener('review-model-changed', refresh); };
  }, [onBusy, onReady]);
  const model = models?.find(m => selected ? m.id === selected : m.isDefault);
  const incompatible = !!models && (!model || !model.efforts.includes(effort) || (fast && !model.fast));
  useEffect(() => { onReady(!incompatible); }, [incompatible, onReady]);
  async function run(action: () => Promise<void>) {
    if (working.current || disabled) return;
    working.current = true; setBusy(true); onBusy(true); setError('');
    try { await action(); } catch (e) { if (live.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { working.current = false; if (live.current) { setBusy(false); onBusy(false); } }
  }
  const loadModels = () => run(async () => {
    const s = await window.editor.getSetup(), available = await window.editor.listCodexModels(s.settings);
    if (live.current) { setSelected(s.settings.codexModel ?? null); setLoaded(true); setModels(available); }
  });
  const chooseModel = (next: string | null) => run(async () => {
    const s = await window.editor.setReviewModel(next);
    if (live.current) { setSelected(s.settings.codexModel ?? null); window.dispatchEvent(new Event('review-model-changed')); }
  });
  const choices = codexEfforts.filter(e => model?.efforts.includes(e));
  return <details className="review-model-controls" onToggle={e => { if (e.currentTarget.open && !models) void loadModels(); }}>
    <summary aria-label="Model, effort and speed" title="Choose the model, reasoning effort and speed for this review">Model: {loaded ? model?.name ?? selected ?? 'Codex default' : 'Loading…'} · {effortOptions[effort].label} effort · {fast ? 'Fast' : 'Standard'}</summary>
    <div className="review-model-fields">
      <label>Model<select aria-label="Review model" value={selected ?? ''} disabled={disabled || busy || !models} onChange={e => void chooseModel(e.target.value || null)}>
        <option value="">Codex default{models?.find(m => m.isDefault) ? ` · ${models.find(m => m.isDefault)!.name}` : ''}</option>
        {selected && !models?.some(m => m.id === selected) && <option value={selected}>{selected}</option>}
        {models?.filter(m => !m.hidden || m.id === selected).map(m => <option value={m.id} key={m.id}>{m.name}</option>)}
      </select></label>
      <label>Effort<select aria-label="Review effort" value={effort} disabled={disabled || busy || !model} onChange={e => onEffort(e.target.value as CodexEffort)}>
        {!choices.includes(effort) && <option value={effort} disabled>{effortOptions[effort].label}{model ? ' · unavailable' : ''}</option>}{choices.map(e => <option key={e} value={e}>{effortOptions[e].label}</option>)}
      </select></label>
      <label>Speed<select aria-label="Review speed" value={fast ? 'fast' : 'standard'} disabled={disabled || busy || !model} onChange={e => onFast(e.target.value === 'fast')}><option value="standard">Standard</option><option value="fast" disabled={!model?.fast}>Fast{model && !model.fast ? ' · unavailable' : ''}</option></select></label>
      <InfoHint label="review model and speed">Model applies to future reviews and ordinary discussions. Effort and speed are saved per paper. Side Chat has separate controls; quick editorial actions use Sol. Loading choices sends no paper text or model request. Fast speed can use more account allowance.</InfoHint>
      <button className="text-button" disabled={disabled || busy} onClick={() => void loadModels()}>Refresh models</button>
      <button className="text-button" aria-label="Choose review model" disabled={disabled || busy} onClick={settings}>Settings…</button>
    </div>
    <ModelNotice selected={selected} models={models} disabled={disabled || busy} onSelect={id => void chooseModel(id)} />
    {busy && <span role="status">Checking settings…</span>}
    {incompatible && <p role="status">Choose an available model, supported effort and speed before reviewing.</p>}
    {error && <p className="error" role="alert">{error} <button disabled={disabled || busy} onClick={() => void loadModels()}>Retry</button></p>}
  </details>;
}
