import { useEffect, useRef, useState } from 'react';
import type { PendingChat, PendingChatReply } from '../shared/help-chat.ts';
import { useDialogFocus } from './use-dialog-focus.ts';

export function PendingChats({ projectId, status }: { projectId: string | null; status: string }) {
  const [items, setItems] = useState<PendingChat[]>([]), [reply, setReply] = useState<PendingChatReply | null>(null);
  const [error, setError] = useState(''), [note, setNote] = useState(''), [busy, setBusy] = useState(false), [confirm, setConfirm] = useState(false);
  const dialog = useRef<HTMLDivElement>(null), epoch = useRef(0);
  useDialogFocus(dialog, () => { if (!busy) setReply(null); }, { open: !!reply, canClose: !busy });
  useEffect(() => {
    let alive = true;
    const refresh = () => { const n = ++epoch.current; void window.editor.pendingChats().then(next => { if (alive && n === epoch.current) setItems(next); }).catch(e => { if (alive && n === epoch.current) setError(String(e)); }); };
    refresh(); window.addEventListener('focus', refresh); window.addEventListener('chat-persistence', refresh);
    return () => { alive = false; window.removeEventListener('focus', refresh); window.removeEventListener('chat-persistence', refresh); };
  }, [projectId, status]);
  async function show(id: string) {
    setError(''); setNote(''); setConfirm(false);
    try { setReply(await window.editor.pendingChat(id)); } catch (e) { setError(String(e)); }
  }
  async function act(action: 'retry' | 'copy' | 'discard') {
    if (!reply || busy) return;
    setBusy(true); setError('');
    try {
      await window.editor.recoverChat({ id: reply.id, action });
      if (action === 'copy') setNote('Copied, including saved context and screenshots. The reply still needs saving or deliberate discard.');
      else { setReply(null); setItems(await window.editor.pendingChats()); window.dispatchEvent(new Event('chat-persistence')); }
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  return <>
    {!!items.length && <div className="pending-chat-warning" role="status"><strong>{items.length === 1 ? `A chat reply for ${items[0].label} needs saving.` : `${items.length} conversations have unsaved replies.`}</strong> <button onClick={() => void show(items[0].id)}>Review unsaved replies</button></div>}
    {error && !reply && <p className="error" role="alert">{error}</p>}
    {reply && <div className="chat-image-backdrop"><div className="pending-chat-dialog" role="dialog" aria-modal="true" aria-label="Unsaved chat replies" ref={dialog} tabIndex={-1}>
      <header><h2>Unsaved chat replies</h2><button disabled={busy} onClick={() => setReply(null)} aria-label="Close unsaved replies">×</button></header>
      <label>Conversation<select disabled={busy} value={reply.id} onChange={e => void show(e.target.value)}>{items.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <div className="pending-chat-content">{reply.turns.map(turn => <article key={turn.id}><strong>You</strong><p>{turn.message}</p>{turn.reply && <><strong>Codex</strong><pre>{turn.reply}</pre></>}{turn.error && <p>{turn.error}</p>}</article>)}</div>
      {note && <p role="status">{note}</p>}{error && <p className="error" role="alert">{error}</p>}
      <footer><button disabled={busy} className="primary" onClick={() => void act('retry')}>Retry saving reply</button><button disabled={busy} onClick={() => void act('copy')}>Copy conversation</button>{confirm ? <><span>Discard this unsaved update? Saved history stays.</span><button disabled={busy} onClick={() => void act('discard')}>Discard unsaved reply</button><button disabled={busy} onClick={() => setConfirm(false)}>Keep reply</button></> : <button disabled={busy} onClick={() => setConfirm(true)}>Discard…</button>}</footer>
    </div></div>}
  </>;
}
