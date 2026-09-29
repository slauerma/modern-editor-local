export type SettingChange = { id: string; label: string; current: string; defaultValue: string };

export function SettingsChanges({ scope, changes, disabled, reset, undo }: {
  scope: string; changes: SettingChange[]; disabled: boolean; reset(id?: string): void; undo?: () => void;
}) {
  return <div className="settings-differences" aria-label={`${scope} differences`}>
    {changes.length ? <table><thead><tr><th>Setting</th><th>Current</th><th>Default</th><th /></tr></thead><tbody>
      {changes.map(row => <tr key={row.id}><th scope="row">{row.label}</th><td>{row.current}</td><td>{row.defaultValue}</td><td><button disabled={disabled} aria-label={`Reset ${row.label}`} onClick={() => reset(row.id)}>Reset</button></td></tr>)}
    </tbody></table> : <p className="settings-hint">Uses defaults.</p>}
    <div className="settings-actions"><button disabled={disabled || !changes.length} onClick={() => reset()}>Reset all {scope.toLowerCase()} defaults</button>
      {undo && <button disabled={disabled} onClick={undo}>Undo reset</button>}
    </div>
  </div>;
}
