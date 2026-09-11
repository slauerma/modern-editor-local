import { useEffect, useRef, type RefObject } from 'react';

const dialogs: HTMLElement[] = [];
type Options = { open?: boolean; canClose?: boolean; initialFocus?: RefObject<HTMLElement> };
function focusable(dialog: HTMLElement) {
  return [...dialog.querySelectorAll<HTMLElement>('button,input,textarea,select,a[href],summary,[tabindex],[contenteditable="true"]')].filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && !element.closest('[hidden],[inert],[aria-hidden="true"]') && element.getClientRects().length > 0);
}

// A dialog may remain mounted while hidden (outside feedback does). Restrict
// focus only while open, and let a later dialog temporarily take the focus.
export function useDialogFocus<T extends HTMLElement>(container: RefObject<T>, onClose: () => void, options: Options = {}) {
  const latest = useRef({ onClose, canClose: options.canClose !== false, initialFocus: options.initialFocus });
  latest.current = { onClose, canClose: options.canClose !== false, initialFocus: options.initialFocus };
  const open = options.open !== false;
  useEffect(() => {
    const panel = container.current;
    if (!open || !panel) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogs.push(panel);
    const top = () => dialogs.at(-1) === panel;
    const first = () => {
      const preferred = latest.current.initialFocus?.current;
      return preferred && panel.contains(preferred) && !preferred.matches(':disabled') ? preferred : focusable(panel)[0] ?? panel;
    };
    first().focus();
    const keydown = (event: KeyboardEvent) => {
      if (!top()) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation();
        if (latest.current.canClose) latest.current.onClose();
        return;
      }
      if (event.key === 'Tab') {
        const choices = focusable(panel), current = document.activeElement;
        if (!choices.length) { event.preventDefault(); event.stopImmediatePropagation(); panel.focus(); return; }
        if (!panel.contains(current) || current === panel || event.shiftKey && current === choices[0] || !event.shiftKey && current === choices.at(-1)) {
          event.preventDefault(); event.stopImmediatePropagation(); (event.shiftKey ? choices.at(-1)! : choices[0]).focus();
        }
      } else if (!panel.contains(event.target as Node | null)) {
        // Do not let an old source focus receive typing behind the dialog.
        event.preventDefault(); event.stopImmediatePropagation(); first().focus();
      }
    };
    const refocus = (event: FocusEvent) => { if (top() && !panel.contains(event.target as Node | null)) first().focus(); };
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('focusin', refocus, true);
    return () => {
      document.removeEventListener('keydown', keydown, true);
      document.removeEventListener('focusin', refocus, true);
      const index = dialogs.lastIndexOf(panel); if (index >= 0) dialogs.splice(index, 1);
      if (previous?.isConnected) previous.focus();
    };
  }, [container, open]);
}
