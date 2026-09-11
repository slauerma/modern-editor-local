import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
export function ActionMenu({ children, label = 'Actions ▾', menuLabel = 'Editor actions' }: { children: ReactNode; label?: string; menuLabel?: string }) {
  const id = useId();
  const [open, setOpen] = useState(false), root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const pointer = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', pointer); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', pointer); document.removeEventListener('keydown', key); };
  }, [open]);
  return <div className="actions-menu" ref={root}><button ref={trigger} aria-expanded={open} aria-controls={id} onClick={() => setOpen(v => !v)}>{label}</button>{open && <div id={id} className="actions-popover" aria-label={menuLabel} onClick={e => { if ((e.target as HTMLElement).closest('button')) setOpen(false); }}>{children}</div>}</div>;
}
