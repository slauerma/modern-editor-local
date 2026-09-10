import { useRef } from 'react';
export function PaneDivider({ label, onMove, extraClass = '' }: { label: string; onMove(delta: number): void; extraClass?: string }) {
  const last = useRef<number | null>(null);
  return <div className={`pane-divider ${extraClass}`} role="separator" aria-orientation="vertical" aria-label={label} tabIndex={0}
    onPointerDown={e => { e.preventDefault(); last.current = e.clientX; e.currentTarget.setPointerCapture(e.pointerId); }}
    onPointerMove={e => { if (last.current === null) return; const delta = e.clientX - last.current; last.current = e.clientX; onMove(delta); }}
    onPointerUp={e => { last.current = null; e.currentTarget.releasePointerCapture(e.pointerId); }} onLostPointerCapture={() => { last.current = null; }}
    onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); onMove(e.key === 'ArrowLeft' ? -20 : 20); } }} />;
}
