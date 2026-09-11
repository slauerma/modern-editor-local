import { useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import './readable-area.css';

// Preserve the actual editor/preview node while expanding; its value, caret and
// scroll position are never replaced with a shortened copy.
export function ReadableArea({ children, label, resetKey }: { children: ReactElement; label: string; resetKey: string }) {
  const root = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflow, setOverflow] = useState({ any: false, below: false, above: false });
  useLayoutEffect(() => setExpanded(false), [resetKey]);
  useLayoutEffect(() => {
    const node = root.current?.firstElementChild as HTMLElement | null;
    if (!node) return;
    let frame = 0;
    const measure = () => {
      const next = { any: node.scrollHeight > node.clientHeight + 2,
        below: node.scrollHeight - node.clientHeight - node.scrollTop > 2, above: node.scrollTop > 2 };
      setOverflow(old => old.any === next.any && old.below === next.below && old.above === next.above ? old : next);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const size = new ResizeObserver(schedule), content = new MutationObserver(schedule);
    size.observe(node); content.observe(node, { childList: true, subtree: true, characterData: true });
    node.addEventListener('scroll', schedule); node.addEventListener('input', schedule); measure();
    return () => { cancelAnimationFrame(frame); size.disconnect(); content.disconnect(); node.removeEventListener('scroll', schedule); node.removeEventListener('input', schedule); };
  }, [children, expanded, resetKey]);
  return <div ref={root} className={`readable-area${expanded ? ' expanded' : ''}`}>
    {children}
    {(expanded || overflow.any) && <div className="readable-controls">
      <span role="status">{expanded ? 'Full text shown' : overflow.below ? 'More below ↓' : overflow.above ? 'More above ↑' : ''}</span>
      <button type="button" className="text-button" aria-label={`${expanded ? 'Collapse' : 'Expand'} ${label}`} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Collapse' : 'Show full text'}</button>
    </div>}
  </div>;
}
