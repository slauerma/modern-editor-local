import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

// An overlay: opening details must not move the comment or the paper.
export function CommentDetails({ children, infoLabel }: { children: ReactNode; infoLabel?: string }) {
  const id = useId(), root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false), pinned = useRef(false), timer = useRef<ReturnType<typeof setTimeout>>();
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' });
  const clear = () => clearTimeout(timer.current);
  const close = () => { clear(); pinned.current = false; setOpen(false); };
  useEffect(() => () => clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    if (!open || !infoLabel || !trigger.current || !popup.current) return;
    const anchor = trigger.current.getBoundingClientRect(), box = popup.current.getBoundingClientRect();
    setPosition({
      left: Math.max(12, Math.min(anchor.right - box.width, window.innerWidth - box.width - 12)),
      top: anchor.bottom + 6 + box.height <= window.innerHeight - 12 ? anchor.bottom + 6 : Math.max(12, anchor.top - box.height - 6)
    });
    // A fixed hint must not become detached from a scrolled or resized control.
    document.addEventListener('scroll', close, true); window.addEventListener('resize', close);
    return () => { document.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
  }, [open, infoLabel]);
  useEffect(() => {
    if (!open) return;
    const pointer = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close(); trigger.current?.focus({ preventScroll: true }); } };
    document.addEventListener('pointerdown', pointer); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', pointer); document.removeEventListener('keydown', key); };
  }, [open]);
  return <div className={infoLabel ? 'comment-details info-hint' : 'comment-details'} ref={root}
    onPointerEnter={e => { if (e.pointerType === 'mouse') { clear(); timer.current = setTimeout(() => setOpen(true), 180); } }}
    onPointerLeave={() => { clear(); timer.current = setTimeout(() => { if (!pinned.current && !root.current?.contains(document.activeElement)) setOpen(false); }, 160); }}
    onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) close(); }}>
    <button className="text-button" ref={trigger} aria-label={infoLabel ? `About ${infoLabel}` : undefined} aria-expanded={open} aria-controls={id} title={infoLabel ? undefined : 'Comment controls and details'} onClick={() => { clear(); pinned.current = !pinned.current; setOpen(pinned.current); }}>{infoLabel ? <span aria-hidden="true">i</span> : 'Details'}</button>
    {open && <div className={infoLabel ? 'comment-details-popover info-popover' : 'comment-details-popover'} ref={popup} style={infoLabel ? position : undefined} role={infoLabel ? 'note' : undefined} id={id} aria-label={infoLabel || 'Comment details'} onClick={e => { if ((e.target as HTMLElement).closest('button')) close(); }}>{children}</div>}
  </div>;
}

export function InfoHint({ label, children }: { label: string; children: ReactNode }) {
  return <CommentDetails infoLabel={label}>{children}</CommentDetails>;
}
