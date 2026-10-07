import { useMemo, useRef, useState } from 'react';
import { documentOutline, filterOutline, type OutlineEntry } from '../shared/document-outline.ts';
import { useDialogFocus } from './use-dialog-focus.ts';
import './navigation.css';

export function OutlineDialog({ text, onChoose, onClose }: { text: string; onChoose(entry: OutlineEntry): void; onClose(): void }) {
  const dialog = useRef<HTMLElement>(null), input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const entries = useMemo(() => documentOutline(text), [text]);
  const shown = useMemo(() => filterOutline(entries, query), [entries, query]);
  const [selected, setSelected] = useState(0);
  useDialogFocus(dialog, onClose, { initialFocus: input });
  function move(index: number) {
    const next = Math.max(0, Math.min(shown.length - 1, index)); setSelected(next);
    const entry = dialog.current?.querySelectorAll<HTMLButtonElement>('.outline-entry')[next];
    entry?.scrollIntoView({ block: 'nearest' });
    if (document.activeElement?.classList.contains('outline-entry')) entry?.focus({ preventScroll: true });
  }
  return <section ref={dialog} className="navigation-dialog outline-dialog" role="dialog" aria-modal="true" aria-label="Document outline" onKeyDown={e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); move(selected + (e.key === 'ArrowDown' ? 1 : -1)); }
  }}>
    <header><span>Outline</span><button aria-label="Close outline" onClick={onClose}>×</button></header>
    <form onSubmit={e => { e.preventDefault(); if (shown[selected]) onChoose(shown[selected]); }}>
      <input ref={input} aria-label="Search outline" placeholder="Sections, titles or labels…" value={query} onChange={e => { setQuery(e.target.value); setSelected(0); }} />
    </form>
    <nav aria-label="Outline entries">
      {shown.map((entry, i) => <button key={entry.from} className={'outline-entry' + (selected === i ? ' selected' : '')}
        style={{ paddingLeft: 12 + entry.level * 12 }} aria-current={selected === i ? 'location' : undefined}
        onFocus={() => setSelected(i)} onClick={() => onChoose(entry)} title={entry.kind + ' · line ' + entry.line}>
        <span>{entry.title}{entry.label && <small>{entry.label}</small>}</span><small>{entry.line}</small>
      </button>)}
      {!shown.length && <p>{entries.length ? 'No matching headings or labels.' : 'No LaTeX headings or labels in this source.'}</p>}
    </nav>
  </section>;
}
