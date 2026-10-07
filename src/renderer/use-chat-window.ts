import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

type Bounds = { left: number; top: number; width: number; height: number };
type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
type Action = Edge | 'move';
const storageKey = 'modern-editor.side-chat-window.v1';
const margin = 8, headingHeight = 44, minimumWidth = 360, minimumHeight = 420;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

function storedBounds(): Bounds | null {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    if (value && ['left', 'top', 'width', 'height'].every(key => typeof value[key] === 'number' && Number.isFinite(value[key])) && value.width > 0 && value.height > 0) {
      return { left: value.left, top: value.top, width: value.width, height: value.height };
    }
  } catch { /* Placement is optional; storage failures must not block chat. */ }
  return null;
}
function fit(bounds: Bounds | null, size: ReturnType<typeof viewport>, collapsed: boolean): Bounds {
  const maxWidth = Math.max(1, size.width - 2 * margin), maxHeight = Math.max(1, size.height - 2 * margin);
  const width = clamp(bounds?.width ?? 510, Math.min(minimumWidth, maxWidth), maxWidth);
  const height = clamp(bounds?.height ?? Math.min(720, size.height - 80), Math.min(minimumHeight, maxHeight), maxHeight);
  return {
    width, height,
    left: clamp(bounds?.left ?? size.width - width - 12, margin, size.width - width - margin),
    top: clamp(bounds?.top ?? 66, margin, size.height - (collapsed ? headingHeight : height) - margin)
  };
}

export function useChatWindow(open: boolean) {
  const [saved, setSaved] = useState(storedBounds), [size, setSize] = useState(viewport);
  const [collapsed, setCollapsed] = useState(false), [moving, setMoving] = useState(false);
  const bounds = fit(saved, size, collapsed), current = useRef(bounds);
  current.current = bounds;
  const gesture = useRef<{ pointerId: number; action: Action; x: number; y: number; bounds: Bounds; target: HTMLElement } | null>(null);

  function remember(value: Bounds | null) {
    try {
      if (value) localStorage.setItem(storageKey, JSON.stringify(value));
      else localStorage.removeItem(storageKey);
    } catch { /* Keep the placement for this window when storage is unavailable. */ }
  }
  function finish() {
    const active = gesture.current;
    if (!active) return;
    gesture.current = null;
    if (active.target.hasPointerCapture(active.pointerId)) active.target.releasePointerCapture(active.pointerId);
    remember(current.current); setMoving(false);
  }
  useEffect(() => {
    const resize = () => { finish(); setSize(viewport()); };
    window.addEventListener('resize', resize); window.addEventListener('blur', finish);
    return () => { window.removeEventListener('resize', resize); window.removeEventListener('blur', finish); };
  }, []);
  useEffect(() => { if (!open) finish(); }, [open]);

  function adjust(base: Bounds, action: Action, dx: number, dy: number) {
    const size = viewport(), right = base.left + base.width, bottom = base.top + base.height;
    const next = { ...base };
    if (action === 'move') { next.left += dx; next.top += dy; }
    else {
      const minWidth = Math.min(minimumWidth, size.width - 2 * margin);
      const minHeight = Math.min(minimumHeight, size.height - 2 * margin);
      if (action.includes('e')) next.width = clamp(base.width + dx, minWidth, size.width - margin - base.left);
      if (action.includes('s')) next.height = clamp(base.height + dy, minHeight, size.height - margin - base.top);
      if (action.includes('w')) { next.left = clamp(base.left + dx, margin, right - minWidth); next.width = right - next.left; }
      if (action.includes('n')) { next.top = clamp(base.top + dy, margin, bottom - minHeight); next.height = bottom - next.top; }
    }
    const fitted = fit(next, size, collapsed);
    current.current = fitted; setSaved(fitted);
  }
  function start(event: PointerEvent<HTMLElement>, action: Action) {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    gesture.current = { pointerId: event.pointerId, action, x: event.clientX, y: event.clientY, bounds: current.current, target: event.currentTarget };
    event.currentTarget.setPointerCapture(event.pointerId); setMoving(true);
  }
  function move(event: PointerEvent<HTMLElement>) {
    const active = gesture.current;
    if (active?.pointerId === event.pointerId) adjust(active.bounds, active.action, event.clientX - active.x, event.clientY - active.y);
  }
  function keys(event: KeyboardEvent<HTMLElement>, action: Action) {
    const step = event.shiftKey ? 40 : 10;
    const delta: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (!delta[event.key]) return;
    event.preventDefault(); event.stopPropagation();
    adjust(current.current, action, ...delta[event.key]); remember(current.current);
  }
  return {
    collapsed, moving, edges: ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as Edge[],
    menuAbove: bounds.top + headingHeight + 64 > size.height - margin,
    style: { left: bounds.left, top: bounds.top, width: bounds.width, height: collapsed ? headingHeight : bounds.height },
    toggle: () => { finish(); setCollapsed(value => !value); },
    reset: () => { finish(); setSaved(null); setCollapsed(false); remember(null); },
    handlers: (action: Action) => ({
      onPointerDown: (event: PointerEvent<HTMLElement>) => start(event, action),
      onPointerMove: move, onPointerUp: finish, onPointerCancel: finish, onLostPointerCapture: finish,
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => keys(event, action)
    })
  };
}
