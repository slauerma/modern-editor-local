import { useRef, useState } from 'react';
import type { Baseline, ComparisonVersion } from '../shared/contracts.ts';
import { VersionHistoryPanel } from './VersionHistoryPanel.tsx';
import { useDialogFocus } from './use-dialog-focus.ts';

type Props = {
  projectId: string; baseline: Baseline | null; session: Baseline | null;
  versions: ComparisonVersion[]; busy: boolean;
  onRefresh(): Promise<void>; onSelect(id: string): Promise<boolean>;
  onSession(): Promise<boolean>; onChoose(): Promise<boolean>; onKeep(name: string): Promise<boolean>;
  onSavedVersion(id: string): Promise<void>;
};
export function ComparisonPicker(props: Props) {
  const [open, setOpen] = useState(false), [history, setHistory] = useState(false), [name, setName] = useState('');
  const panel = useRef<HTMLDivElement>(null);
  useDialogFocus(panel, () => setOpen(false), { open, canClose: !props.busy });
  const current = props.baseline ?? props.session;
  const reviews = props.versions.filter(v => v.kind === 'review'), latest = reviews.at(-1)?.id;
  async function choose(action: () => Promise<boolean>) { if (await action()) setOpen(false); }
  return <div className="comparison-picker">
    <button className="comparison-picker-button" aria-label="Choose comparison version" aria-expanded={open}
      disabled={props.busy} title={current ? `${current.name} · ${new Date(current.createdAt).toLocaleString()}` : 'Choose comparison version'}
      onClick={() => { setOpen(!open); if (!open) void props.onRefresh(); }}>
      <span>{current?.name ?? 'Choose version'}</span><span aria-hidden="true">▾</span>
    </button>
    {open && <div ref={panel} className="comparison-choices" role="dialog" aria-label="Comparison versions" aria-modal="true" tabIndex={-1}>
      <div className="comparison-choices-heading"><span>Compare with current draft</span><button aria-label="Close comparison versions" disabled={props.busy} onClick={() => setOpen(false)}>×</button></div>
      <div className="comparison-version-list">
        {props.versions.slice().reverse().map(v => <button key={v.id} disabled={props.busy}
          className="comparison-version" aria-pressed={current?.sourceHash === v.sourceHash && current?.createdAt === v.createdAt && current?.name === v.name}
          onClick={() => void choose(() => props.onSelect(v.id))}>
          <span>{v.name}{v.id === latest && reviews.length > 1 ? ' · latest' : ''}</span>
          <small>{new Date(v.createdAt).toLocaleString()} · {v.characters.toLocaleString()} characters</small>
          <span className="comparison-excerpt">{v.preview || '(Empty document)'}</span>
        </button>)}
        {props.session && <button className="comparison-version" disabled={props.busy} onClick={() => void choose(props.onSession)}>
          <span>When opened</span><small>{new Date(props.session.createdAt).toLocaleString()}</small>
          <span className="comparison-excerpt">{props.session.text.replace(/\s+/g, ' ').trim().slice(0, 180) || '(Empty document)'}</span>
        </button>}
      </div>
      <form className="comparison-keep" onSubmit={e => { e.preventDefault(); if (name.trim()) void choose(() => props.onKeep(name.trim())); }}>
        <input aria-label="Comparison version name" placeholder="Name this draft…" maxLength={200} value={name} onChange={e => setName(e.target.value)} disabled={props.busy} />
        <button disabled={props.busy || !name.trim()}>Keep this version</button>
      </form>
      <div className="comparison-other"><button disabled={props.busy} onClick={() => void choose(props.onChoose)}>Choose older file…</button>
        <button disabled={props.busy} aria-expanded={history} onClick={() => setHistory(!history)}>Saved versions…</button></div>
      {history && <VersionHistoryPanel projectId={props.projectId} onCompare={async id => { await props.onSavedVersion(id); setOpen(false); }} />}
    </div>}
  </div>;
}
