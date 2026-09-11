// Bare shifted letters act only in the comment rail, never in typing fields.
export function reviewShortcut(event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey' | 'repeat' | 'isComposing'>, target: EventTarget | null): 'accept' | 'reject' | 'skip' | 'dismiss' | 'previous' | 'later' | 'discuss' | null {
  if (event.repeat || event.isComposing || event.ctrlKey || event.metaKey) return null;
  if ((target as HTMLElement | null)?.closest?.('textarea,input,select,[contenteditable]:not([contenteditable="false"])')) return null;
  if (event.shiftKey && !event.altKey) {
    if (event.key.toLowerCase() === 'a') return 'accept';
    if (event.key.toLowerCase() === 'r') return 'reject';
    if (['s','n'].includes(event.key.toLowerCase())) return 'skip';
    if (event.key.toLowerCase() === 'p') return 'previous';
    if (event.key.toLowerCase() === 'l') return 'later';
    if (event.key.toLowerCase() === 'd') return 'discuss';
  }
  if (event.altKey && !event.shiftKey) {
    if (event.key === 'Enter') return 'accept';
    if (event.key === 'Backspace') return 'dismiss';
    if (event.key === 'ArrowRight') return 'skip';
    if (event.key === 'ArrowLeft') return 'previous';
  }
  return null;
}
