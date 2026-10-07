import { useLayoutEffect, useRef, useState } from 'react';
import { useDialogFocus } from './use-dialog-focus.ts';
import './navigation.css';

export type SourcePeekValue = { text: string; from: number; to: number; title: string; current: boolean };
// In PDF mode source navigation is an overlay. Opening it never resizes PDFs.
export function SourcePeek({ value, onClose, onEdit }: { value: SourcePeekValue; onClose(): void; onEdit?: () => void }) {
  const dialog = useRef<HTMLElement>(null), line = useRef<HTMLDivElement>(null), [expanded, setExpanded] = useState(false);
  useDialogFocus(dialog, onClose);
  const lines = value.text.split('\n'), at = value.text.slice(0, value.from).split('\n').length;
  const start = Math.max(0, at - (expanded ? 40 : 9)), end = Math.min(lines.length, at + (expanded ? 60 : 12));
  useLayoutEffect(() => { line.current?.scrollIntoView({ block: 'center' }); }, [value, expanded]);
  return <section ref={dialog} className={'navigation-dialog source-peek' + (expanded ? ' expanded' : '')} role="dialog" aria-modal="true" aria-label="LaTeX passage">
    <header><span>{value.title} · line {at}</span><button aria-label={expanded ? 'Shrink source passage' : 'Expand source passage'} onClick={() => setExpanded(v => !v)}>{expanded ? 'Shrink' : 'Expand'}</button><button aria-label="Close source passage" onClick={onClose}>×</button></header>
    <div className="source-peek-lines" tabIndex={0}>{lines.slice(start, end).map((text, i) => <div key={i + start} ref={i + start + 1 === at ? line : undefined} className={i + start + 1 === at ? 'source-jump-line' : ''}><small>{i + start + 1}</small><code>{text || ' '}</code></div>)}</div>
    {onEdit && <footer><button onClick={onEdit}>Open in source editor</button></footer>}
  </section>;
}
