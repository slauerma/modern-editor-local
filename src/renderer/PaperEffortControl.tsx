import { useEffect, useState } from 'react';
import { codexEfforts, effortOptions, type CodexEffort } from '../shared/codex-options.ts';
import type { CodexModel } from '../shared/codex-models.ts';

type Props = {
  value: CodexEffort; disabled: boolean; onChange(value: CodexEffort): void;
};

// Opening unrelated Actions must not start Codex setup or reserve its worker.
export function PaperEffortControl(props: Props) {
  const [open, setOpen] = useState(false);
  return <details onToggle={e => setOpen(e.currentTarget.open)}>
    <summary>Codex effort · {effortOptions[props.value].label}</summary>
    {open && <EffortChoices {...props} />}
  </details>;
}

// Catalog lookup sends no manuscript or model turn.
function EffortChoices({ value, disabled, onChange }: Props) {
  const [model, setModel] = useState<CodexModel>();
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  useEffect(() => {
    if (disabled) return;
    let current = true;
    setLoading(true); setError(''); setModel(undefined);
    void (async () => {
      try {
        const setup = await window.editor.getSetup();
        const models = await window.editor.listCodexModels(setup.settings);
        const selected = models.find(m => setup.settings.codexModel ? m.id === setup.settings.codexModel : m.isDefault);
        if (!selected) throw new Error('Choose an available Codex model in Settings.');
        if (current) setModel(selected);
      } catch (e) { if (current) setError(e instanceof Error ? e.message : String(e)); }
      finally { if (current) setLoading(false); }
    })();
    return () => { current = false; };
  }, [disabled]);
  const choices = codexEfforts.filter(e => model?.efforts.includes(e));
  return <label title={error || (loading ? 'Checking supported effort; no paper text is sent.' : model?.name)}>
    Codex effort
    <select aria-label="Codex effort" value={value} disabled={disabled || loading || !model} onChange={e => onChange(e.target.value as CodexEffort)}>
      {!choices.includes(value) && <option value={value} disabled>{effortOptions[value].label}{model ? ' · unavailable' : ''}</option>}
      {choices.map(e => <option key={e} value={e}>{effortOptions[e].label}</option>)}
    </select>
    {error && <small role="status">{error}</small>}
  </label>;
}
