import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './split-button.css';

export type SplitAction = { label: string; action(): void; disabled?: boolean; title?: string };
export function SplitButton(props: { label: string; menuLabel: string; title?: string; shortcut?: string; disabled?: boolean; expanded?: boolean; onClick(): void; actions: SplitAction[] }) {
  const id = useId(), arrow = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false), [position, setPosition] = useState({ left: 0, top: 0 });
  const close = (focus = false) => { setOpen(false); if (focus) arrow.current?.focus(); };
  useLayoutEffect(() => {
    if (!open || !arrow.current || !menu.current) return;
    const button = arrow.current.getBoundingClientRect(), box = menu.current.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(button.right - box.width, window.innerWidth - box.width - 8)), top: Math.max(8, button.bottom + box.height + 8 < window.innerHeight ? button.bottom + 4 : button.top - box.height - 4) });
    menu.current.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node) && !arrow.current?.contains(event.target as Node)) close(); };
    const resize = () => close();
    document.addEventListener('pointerdown', outside); window.addEventListener('resize', resize);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', resize); };
  }, [open]);
  return <div className="split-button">
    <button className="split-main" disabled={props.disabled} title={props.title} aria-label={props.label} aria-keyshortcuts={props.shortcut} aria-expanded={props.expanded} onClick={props.onClick}>{props.label}</button>
    {!!props.actions.length && <button className="split-arrow" ref={arrow} aria-label={props.menuLabel} title={props.menuLabel} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} disabled={props.actions.every(a => a.disabled)} onClick={() => setOpen(v => !v)} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); } }}>▾</button>}
    {open && createPortal(<div ref={menu} id={id} role="menu" aria-label={props.menuLabel} className="split-menu" style={position} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return; }
      if (event.key === 'Tab') { close(true); return; }
      const items = [...menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')], current = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'ArrowDown' ? (current + 1) % items.length : event.key === 'ArrowUp' ? (current - 1 + items.length) % items.length : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : -1;
      if (next >= 0) { event.preventDefault(); items[next]?.focus(); }
    }}>{props.actions.map(item => <button key={item.label} role="menuitem" disabled={item.disabled} title={item.title} onClick={() => { close(true); item.action(); }}>{item.label}</button>)}</div>, document.body)}
  </div>;
}
