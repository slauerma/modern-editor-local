import { useEffect, useRef, useState } from 'react';
import type { ChatImage, ChatInput, ChatPreview, ChatState, ChatTurn } from '../shared/help-chat.ts';
import { CHAT_LIMITS } from '../shared/help-chat.ts';
import { chatImageDimensions } from '../shared/chat-images.ts';
import { MarkdownText } from './HelpPanel.tsx';
import { ReadableArea } from './ReadableArea.tsx';
import { useDialogFocus } from './use-dialog-focus.ts';
import './help-chat.css';

type Props = {
  open: boolean; projectId: string | null; paperName: string; paperPath: string; blocked: boolean; status: string;
  close(): void; capture(paper: boolean): Omit<ChatInput, 'message' | 'images' | 'paper' | 'includeComment' | 'includeDiagnostics' | 'includeReferences'>;
  send(projectId: string | null, previewId: string): Promise<ChatTurn>;
  add(turn: ChatTurn): Promise<void>; go(turn: ChatTurn, pdf: boolean): void; sources(): void;
};
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': Error: /, '');

function EnlargedImage({ image, close }: { image: ChatImage; close(): void }) {
  const dialog = useRef<HTMLDivElement>(null); useDialogFocus(dialog, close);
  return <div className="chat-image-backdrop"><div ref={dialog} role="dialog" aria-modal="true" aria-label="Screenshot preview" tabIndex={-1}><header><strong>{image.name}</strong><button onClick={close} aria-label="Close screenshot preview">×</button></header><img src={image.dataUrl} alt={image.name} /></div></div>;
}
async function imageFile(file: File): Promise<ChatImage> {
  if (!['image/png', 'image/jpeg'].includes(file.type)) throw new Error('Attach a PNG or JPEG screenshot.');
  if (file.size > CHAT_LIMITS.imageBytes) throw new Error('Each screenshot can be at most 2 MB. Crop or resize this image first.');
  chatImageDimensions(new Uint8Array(await file.arrayBuffer()), file.type);
  const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Could not read this screenshot.')); reader.readAsDataURL(file); });
  return { id: crypto.randomUUID(), name: (file.name || 'Pasted screenshot.png').slice(0, 120), dataUrl };
}

export function HelpChatDrawer(props: Props) {
  const [editorOnly, setEditorOnly] = useState(false);
  const paper = !!props.projectId && !editorOnly;
  return <aside className="help-chat-drawer" aria-label="Codex Side Chat" hidden={!props.open} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); props.close(); } }}>
    <header className="chat-heading"><div><strong>Codex Side Chat</strong><span>Ask Codex about the editor or your paper</span></div><button aria-label="Close Codex Side Chat" onClick={props.close}>×</button></header>
    <div className="chat-scope"><label>Conversation<select aria-label="Chat conversation" value={paper ? 'paper' : 'editor'} disabled={props.blocked} onChange={e => setEditorOnly(e.target.value === 'editor')}><option value="editor">Editor help · no paper context</option>{props.projectId && <option value="paper">This paper · {props.paperName}</option>}</select></label></div>
    <Conversation key={paper ? props.paperPath : 'editor-help'} {...props} paper={paper} />
  </aside>;
}
function Conversation(props: Props & { paper: boolean }) {
  const id = props.paper ? props.projectId : null;
  const [state, setState] = useState<ChatState>({ turns: [], notices: [], editorVersion: '' });
  const [message, setMessage] = useState(''), [images, setImages] = useState<ChatImage[]>([]), [expandedImage, setExpandedImage] = useState<ChatImage | null>(null);
  const [paper, setPaper] = useState<ChatInput['paper']>(props.paper ? 'draft' : 'none');
  const [comment, setComment] = useState(props.paper), [diagnostics, setDiagnostics] = useState(false), [references, setReferences] = useState(false);
  const [preview, setPreview] = useState<ChatPreview | null>(null), [previewOpen, setPreviewOpen] = useState(false), [working, setWorking] = useState(false), [sending, setSending] = useState(false), [failedLoad, setFailedLoad] = useState(false), [error, setError] = useState(''), [clearConfirm, setClearConfirm] = useState(false);
  const list = useRef<HTMLDivElement>(null), entry = useRef<HTMLTextAreaElement>(null), picker = useRef<HTMLInputElement>(null), alive = useRef(true), operation = useRef(false);
  const previewInput = useRef('');
  const busy = props.blocked || working;
  const refresh = async () => { const next = await window.editor.chatState({ projectId: id }); if (alive.current) { setState(next); setFailedLoad(false); } };
  useEffect(() => { alive.current = true; void refresh().catch(e => { if (alive.current) { setError(messageOf(e)); setFailedLoad(true); } }); return () => { alive.current = false; }; }, [id]);
  useEffect(() => { if (props.open) entry.current?.focus({ preventScroll: true }); }, [props.open]);
  useEffect(() => { if (props.open && list.current) list.current.scrollTop = list.current.scrollHeight; }, [state.turns.length, state.turns.at(-1)?.status]);
  function changed(action: () => void) { action(); setPreview(null); previewInput.current = ''; }
  function input(): ChatInput { return { ...props.capture(props.paper), projectId: id, message, images, paper, includeComment: props.paper && comment, includeDiagnostics: diagnostics, includeReferences: props.paper && references }; }
  async function prepare() {
    const value = input(), fingerprint = JSON.stringify(value);
    if (preview && previewInput.current === fingerprint) return preview;
    const ready = await window.editor.previewChat(value);
    if (!alive.current) throw new Error('This conversation is no longer displayed.');
    setPreview(ready); previewInput.current = fingerprint; return ready;
  }
  async function previewContext() {
    if (operation.current || busy) return; operation.current = true; setWorking(true); setError('');
    try { await prepare(); setPreviewOpen(true); } catch (e) { setError(messageOf(e)); } finally { operation.current = false; setWorking(false); }
  }
  async function send() {
    if (operation.current || busy || failedLoad || !message.trim()) return;
    operation.current = true; setWorking(true); setError('');
    try {
      const ready = await prepare(); setSending(true);
      // Sending consumes the server preview even if the model fails or Stop is
      // pressed. An unchanged retry must prepare a new request.
      setPreview(null); previewInput.current = '';
      const reply = await props.send(id, ready.id);
      if (!alive.current) return;
      setState(old => ({ ...old, turns: [...old.turns.filter(t => t.id !== reply.id), reply], notices: [] }));
      setMessage(''); setImages([]); setPreview(null); setPreviewOpen(false); previewInput.current = '';
      try { await refresh(); } catch (e) { setError('The reply is shown above, but its saved state could not be checked. ' + messageOf(e)); }
    } catch (e) { if (alive.current) { setError(messageOf(e)); try { await refresh(); } catch { /* Keep the visible conversation and question. */ } } }
    finally { operation.current = false; if (alive.current) { setWorking(false); setSending(false); } }
  }
  async function attach(files: File[]) {
    if (busy || operation.current) return;
    if (images.length + files.length > CHAT_LIMITS.images) { setError('Attach up to three screenshots per message.'); return; }
    operation.current = true; setWorking(true); setError('');
    try { const added = await Promise.all(files.map(imageFile)); if (alive.current) changed(() => setImages(old => [...old, ...added])); }
    catch (e) { if (alive.current) setError(messageOf(e)); }
    finally { operation.current = false; if (alive.current) setWorking(false); }
  }
  async function clear() {
    if (busy || operation.current) return; operation.current = true; setWorking(true); setError('');
    try { await window.editor.clearChat({ projectId: id }); if (alive.current) { setState(s => ({ ...s, turns: [], notices: [], needsSave: false })); setPreview(null); previewInput.current = ''; setClearConfirm(false); setFailedLoad(false); } }
    catch (e) { setError(messageOf(e)); } finally { operation.current = false; setWorking(false); }
  }
  return <>
    <div className="chat-transcript" ref={list} aria-label="Chat messages" tabIndex={0}>
      {!state.turns.length && <div className="chat-empty"><p>{props.paper ? 'Ask about a proof, a suggestion, or an error in this paper.' : 'Ask how to use Modern Editor or explain an error. Paper source and reference folders are excluded. Any screenshots or error details you choose to include are still sent.'}</p><p className="muted">Replies cannot change your source. You choose which ideas become comments.</p></div>}
      {state.notices.map((notice, i) => <p key={i} className="muted">{notice}</p>)}
      {state.needsSave && <button disabled={busy} onClick={() => void window.editor.retryChat({ projectId: id }).then(setState).catch(e => setError(messageOf(e)))}>Retry saving chat</button>}
      {state.turns.map(turn => <article className="chat-turn" key={turn.id}>
        <div className="chat-question"><strong>You</strong><p>{turn.message}</p></div>
        <details className="chat-sent-context"><summary>{turn.labels.join(' · ')}</summary><pre tabIndex={0}>{turn.context}</pre></details>
        {!!turn.images.length && <div className="chat-thumbnails">{turn.images.map(image => <button key={image.id} title="Enlarge screenshot" onClick={() => setExpandedImage(image)}><img src={image.dataUrl} alt={image.name} /></button>)}</div>}
        {turn.reply && <div className="chat-answer"><strong>Codex</strong><MarkdownText text={turn.reply} /></div>}
        {turn.error && <p className="error" role="alert">{turn.error}</p>}
        {turn.status === 'pending' && <p className="muted">This request did not finish. The question and screenshots were saved.</p>}
        {turn.comment && <details open className="chat-suggestion"><summary>{turn.comment.replacement === null ? 'Comment on the passage' : 'Proposed revision'} · {turn.comment.title}</summary><label>Original</label><ReadableArea label="chat original" resetKey={turn.id}><pre tabIndex={0}>{turn.comment.original}</pre></ReadableArea>{turn.comment.replacement !== null && <><label>Proposed replacement</label><ReadableArea label="chat replacement" resetKey={turn.id}><pre tabIndex={0}>{turn.comment.replacement}</pre></ReadableArea></>}</details>}
        {props.paper && turn.status === 'complete' && <div className="chat-reply-actions"><button disabled={busy} onClick={() => void props.add(turn).catch(e => setError(messageOf(e)))}>Turn into comment</button>{turn.comment && <><button disabled={busy} onClick={() => props.go(turn, false)}>Go to passage</button><button disabled={busy} onClick={() => props.go(turn, true)}>Show in PDF</button></>}</div>}
      </article>)}
    </div>
    <div className="chat-composer" onPaste={e => { const files = [...e.clipboardData.items].filter(item => item.kind === 'file').map(item => item.getAsFile()).filter((f): f is File => !!f); if (files.length) { e.preventDefault(); void attach(files); } }} onDragOver={e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }} onDrop={e => { if (e.dataTransfer.files.length) { e.preventDefault(); e.stopPropagation(); void attach([...e.dataTransfer.files]); } }}>
      <details className="chat-context-options"><summary>Context · {paper === 'draft' ? 'Current draft' : paper === 'passage' ? 'Selected passage' : 'Editor Help'}{comment && props.paper ? ' · Comment' : ''}{diagnostics ? ' · Errors' : ''}{references && props.paper ? ' · References' : ''}{images.length ? ` · ${images.length} screenshot(s)` : ''}</summary>
        <p>Bundled Help and the installed editor version are always included. Up to 12 recent exchanges accompany follow-ups. Older screenshots are saved but are not resent automatically.</p>
        {props.paper && <><label>Paper context<select disabled={busy} value={paper} onChange={e => changed(() => setPaper(e.target.value as ChatInput['paper']))}><option value="draft">Current draft (up to 120,000 characters)</option><option value="passage">Selected passage</option><option value="none">No source text</option></select></label><label><input type="checkbox" checked={comment} disabled={busy} onChange={e => changed(() => setComment(e.target.checked))} /> Current comment and recent discussion</label><label><input type="checkbox" checked={references} disabled={busy} onChange={e => changed(() => setReferences(e.target.checked))} /> Let Codex read enabled reference folders and the current draft</label></>}
        <label><input type="checkbox" checked={diagnostics} disabled={busy} onChange={e => changed(() => setDiagnostics(e.target.checked))} /> Latest error and compilation details</label>
        <button disabled={busy || !message.trim() || failedLoad} onClick={() => void previewContext()}>Preview what is sent</button>{props.paper && <button onClick={props.sources}>Sources used…</button>}
      </details>
      {previewOpen && preview && <details className="chat-prepared" open><summary>Prepared context · {preview.labels.join(' · ')}</summary><pre tabIndex={0}>{preview.context}</pre><button onClick={() => setPreviewOpen(false)}>Hide preview</button></details>}
      {!!images.length && <div className="chat-thumbnails">{images.map(image => <div key={image.id}><button title="Enlarge attached screenshot" onClick={() => setExpandedImage(image)}><img src={image.dataUrl} alt={image.name} /></button><button disabled={busy} aria-label={`Remove ${image.name}`} onClick={() => changed(() => setImages(current => current.filter(i => i.id !== image.id)))}>×</button></div>)}</div>}
      <label className="chat-message-label" htmlFor={`chat-message-${id ?? 'help'}`}>Your question</label>
      <textarea ref={entry} id={`chat-message-${id ?? 'help'}`} aria-label="Message to Codex Side Chat" maxLength={10000} rows={3} placeholder="Ask about the editor, a proof, or a suggestion…" value={message} disabled={working} onChange={e => changed(() => setMessage(e.target.value))} onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }} />
      <input ref={picker} aria-label="Choose chat screenshots" hidden type="file" accept="image/png,image/jpeg" multiple onChange={e => { void attach([...e.target.files ?? []]); e.target.value = ''; }} />
      <div className="chat-send-actions"><button className="primary" disabled={busy || failedLoad || !message.trim()} title="Send · Command/Ctrl+Enter" onClick={() => void send()}>Ask Codex</button><button disabled={busy || images.length >= 3} onClick={() => picker.current?.click()}>Attach screenshot…</button>{sending && <button onClick={() => void window.editor.cancelCodex().catch(e => setError(messageOf(e)))}>Stop</button>}</div>
      {working && <p role="status">{sending ? props.status : 'Preparing chat context…'}</p>}
      {props.blocked && !sending && <p className="muted">Finish or stop the current Codex request before sending.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <p className="chat-privacy">Sending shares the selected context and screenshots with Codex. Paste or drop PNG/JPEG images here · up to 3, 2 MB each.</p>
      <div className="chat-footer"><span>Modern Editor {state.editorVersion}</span>{clearConfirm ? <span>Delete this saved chat? <button disabled={busy} onClick={() => void clear()}>Clear conversation</button><button onClick={() => setClearConfirm(false)}>Keep</button></span> : <button className="text-button" disabled={busy} onClick={() => setClearConfirm(true)}>Clear chat…</button>}</div>
    </div>
    {expandedImage && props.open && <EnlargedImage image={expandedImage} close={() => setExpandedImage(null)} />}
  </>;
}
