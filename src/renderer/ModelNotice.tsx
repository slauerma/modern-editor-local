import type { CodexModel } from '../shared/codex-models.ts';

// Catalog recommendations are informational. Changing a saved choice always
// requires an explicit click through the same control as ordinary selection.
export function ModelNotice({ selected, models, disabled, onSelect }: {
  selected: string | null; models: CodexModel[] | null; disabled: boolean; onSelect(id: string): void;
}) {
  if (!models) return null;
  const model = models.find(m => selected ? m.id === selected : m.isDefault);
  if (!model) return selected ? <p className="model-notice" role="status">{selected} is not in the current catalog. Refresh or choose an available model.</p> : null;
  const upgrade = model.upgrade && model.upgrade !== model.id ? model.upgrade : null;
  if (!upgrade && !model.hidden) return null;
  const replacement = models.find(m => m.id === upgrade && !m.hidden);
  const retirement = model.retirementAt != null ? new Date(model.retirementAt * 1000).toLocaleDateString() : null;
  return <p className="model-notice" role="status">
    {model.hidden ? `${model.name} is hidden from the current model picker. ` : ''}
    {upgrade ? `Codex recommends ${replacement?.name ?? upgrade} instead of ${model.name}. ` : ''}
    {retirement ? `Retirement date: ${retirement}. ` : ''}
    {replacement && <button className="text-button" disabled={disabled} onClick={() => onSelect(replacement.id)}>Choose {replacement.name}</button>}
    {upgrade && !replacement && 'The recommended replacement is not available in this catalog.'}
  </p>;
}
