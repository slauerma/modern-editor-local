import { useEffect, useRef, useState } from 'react';
import type { ChatImage, ChatInput, ChatPreview, ChatState, ChatTurn } from '../shared/help-chat.ts';
import { CHAT_LIMITS, chatComments } from '../shared/help-chat.ts';
import { chatImageDimensions } from '../shared/chat-images.ts';
import { MarkdownText } from './HelpPanel.tsx';
import { ReadableArea } from './ReadableArea.tsx';
import { useDialogFocus } from './use-dialog-focus.ts';
import { useChatWindow } from './use-chat-window.ts';
import { useChatSettings } from './use-chat-settings.ts';
import './help-chat.css';

type Props = {
  guidanceKey: string;
  open: boolean; projectId: string | null; paperName: string; paperPath: string; blocked: boolean; status: string;
  close(): void; capture(paper: boolean): Omit<ChatInput, 'message' | 'images' | 'paper' | 'includeComment' | 'includeDiagnostics' | 'includeReferences' | 'model' | 'effort' | 'fastMode'>;
  send(projectId: string | null, previewId: string): Promise<ChatTurn>;
  addedCommentIds: string[];
  add(turn: ChatTurn, commentId?: string): Promise<void>; go(turn: ChatTurn, pdf: boolean, commentId: string): void; sources(): void; context(): void; guidance(): void;
};
type ChatDraft = { message: string; images: ChatImage[]; discussion?: ChatInput['discussion']; discussionTitle?: string };
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
  const drafts = useRef(new Map<string, ChatDraft>());
  const placement = useChatWindow(props.open), menu = useRef<HTMLDetailsElement>(null);
  const settings = useChatSettings(props.open && !placement.collapsed, props.blocked);
  useEffect(() => {
    const dismiss = (event: globalThis.PointerEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node)) menu.current.open = false;
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, []);
  const paper = !!props.projectId && !editorOnly;
  const conversationKey = paper ? props.paperPath : 'editor-help';
  return <aside className={'help-chat-drawer' + (placement.collapsed ? ' collapsed' : '') + (placement.moving ? ' moving' : '')} style={placement.style} aria-label="Codex Side Chat" hidden={!props.open} onKeyDown={e => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    if (menu.current?.open) { menu.current.open = false; menu.current.querySelector('summary')?.focus(); }
    else props.close();
  }}>
    <header className="chat-heading">
      <button className="chat-drag-handle" aria-label="Move Side Chat" title="Drag to move · Arrow keys move · Shift moves farther" {...placement.handlers('move')}>Side Chat</button>
      <button className="chat-window-button" aria-label={placement.collapsed ? 'Expand Side Chat' : 'Collapse Side Chat'} aria-expanded={!placement.collapsed} title={placement.collapsed ? 'Expand' : 'Collapse'} onClick={placement.toggle}>{placement.collapsed ? '+' : '−'}</button>
      <details className={'chat-window-menu' + (placement.menuAbove ? ' opens-up' : '')} ref={menu}>
        <summary aria-label="Side Chat options" title="Side Chat options">⋯</summary>
        <div><button onClick={() => { placement.reset(); if (menu.current) menu.current.open = false; }}>Reset position and size</button></div>
      </details>
      <button className="chat-window-button" aria-label="Close Codex Side Chat" title="Close" onClick={props.close}>×</button>
    </header>
    <div className="chat-body" hidden={placement.collapsed}>
    <details className="chat-settings">
    <summary aria-label="Side Chat settings">{settings.selected?.name ?? settings.value.model ?? 'Editor default'} · {settings.value.effort} effort · {settings.value.fastMode ? 'Fast' : 'Standard'}</summary>
    <div className="chat-model-controls" title="These settings apply only to Side Chat and are remembered locally.">
      <label>Model<select aria-label="Side Chat model" value={settings.value.model ?? ''} disabled={props.blocked || settings.loading} onChange={e => settings.change({ model: e.target.value || null })}>
        <option value="">Editor default</option>
        {settings.value.model && !settings.models?.some(m => m.id === settings.value.model) && <option value={settings.value.model}>{settings.value.model} · saved</option>}
        {settings.models?.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select></label>
      <label>Effort<select aria-label="Side Chat effort" value={settings.value.effort} disabled={props.blocked || settings.loading || !settings.selected} onChange={e => settings.change({ effort: e.target.value as typeof settings.value.effort })}>
        {!settings.efforts.includes(settings.value.effort) && <option value={settings.value.effort} disabled>{settings.value.effort} · unavailable</option>}
        {settings.efforts.map(e => <option key={e} value={e}>{e[0].toUpperCase() + e.slice(1)}</option>)}
      </select></label>
      <label>Speed<select aria-label="Side Chat speed" value={settings.value.fastMode ? 'fast' : 'standard'} disabled={props.blocked || settings.loading} onChange={e => settings.change({ fastMode: e.target.value === 'fast' })}>
        <option value="standard">Standard</option><option value="fast" disabled={!settings.selected?.fast}>Fast</option>
      </select></label>
      <button className="chat-model-refresh" aria-label="Refresh Side Chat models" title="Refresh available models; sends no paper text" disabled={props.blocked || settings.loading} onClick={() => void settings.refresh()}>{settings.loading ? '…' : '↻'}</button>
    </div>
    </details>
    {(settings.error || settings.invalid) && <p className="chat-model-error" role="alert">{settings.invalid || settings.error}</p>}
    <div className="chat-scope"><label>Conversation<select aria-label="Chat conversation" value={paper ? 'paper' : 'editor'} disabled={props.blocked} onChange={e => setEditorOnly(e.target.value === 'editor')}><option value="editor">Editor help · no paper context</option>{props.projectId && <option value="paper">This paper · {props.paperName}</option>}</select></label></div>
    <Conversation key={conversationKey} {...props} initialDraft={drafts.current.get(conversationKey)} saveDraft={draft => drafts.current.set(conversationKey, draft)} settingsKey={JSON.stringify(settings.value)} capture={isPaper => ({ ...props.capture(isPaper), ...settings.value })} controlsBusy={settings.loading || !!settings.invalid} open={props.open && !placement.collapsed} paper={paper} />
    </div>
    {!placement.collapsed && placement.edges.map(edge => edge === 'se'
      ? <button key={edge} className="chat-resize se" aria-label="Resize Side Chat" title="Drag to resize · Arrow keys resize" {...placement.handlers(edge)} />
      : <div key={edge} className={'chat-resize ' + edge} aria-hidden="true" {...placement.handlers(edge)} />)}
  </aside>;
}
function Conversation(props: Omit<Props, 'capture'> & { initialDraft?: ChatDraft; saveDraft(draft: ChatDraft): void; paper: boolean; settingsKey: string; controlsBusy?: boolean; capture(paper: boolean): ReturnType<Props['capture']> & import('../shared/help-chat.ts').ChatPreferences }) {
  const id = props.paper ? props.projectId : null;
  const [state, setState] = useState<ChatState>({ turns: [], notices: [], editorVersion: '' });
  const [message, setMessage] = useState(props.initialDraft?.message ?? ''), [images, setImages] = useState<ChatImage[]>(props.initialDraft?.images ?? []), [expandedImage, setExpandedImage] = useState<ChatImage | null>(null);
  const [discussion, setDiscussion] = useState(props.initialDraft?.discussion), [discussionTitle, setDiscussionTitle] = useState(props.initialDraft?.discussionTitle);
  const draft = useRef<ChatDraft>({ message, images, discussion, discussionTitle }); draft.current = { message, images, discussion, discussionTitle };
  useEffect(() => () => props.saveDraft(draft.current), []);
  const [paper, setPaper] = useState<ChatInput['paper']>(props.paper ? 'draft' : 'none');
  const [comment, setComment] = useState(props.paper), [diagnostics, setDiagnostics] = useState(false), [references, setReferences] = useState(false);
  const [preview, setPreview] = useState<ChatPreview | null>(null), [previewOpen, setPreviewOpen] = useState(false), [working, setWorking] = useState(false), [sending, setSending] = useState(false), [failedLoad, setFailedLoad] = useState(false), [error, setError] = useState(''), [clearConfirm, setClearConfirm] = useState(false);
  const list = useRef<HTMLDivElement>(null), entry = useRef<HTMLTextAreaElement>(null), picker = useRef<HTMLInputElement>(null), alive = useRef(true), operation = useRef(false);
  const composer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = composer.current, body = element?.closest('.chat-body');
    if (!element || !body) return;
    const measure = () => element.style.setProperty('--context-room', Math.max(0, element.getBoundingClientRect().top - body.getBoundingClientRect().top - 4) + 'px');
    const observer = new ResizeObserver(measure);
    observer.observe(element); observer.observe(body); measure();
    return () => observer.disconnect();
  }, []);
  const previewInput = useRef(''), stateRequest = useRef(0);
  const busy = props.blocked || props.controlsBusy || working;
  const refresh = async (reportFailure = false) => {
    const request = ++stateRequest.current;
    try {
      const next = await window.editor.chatState({ projectId: id });
      if (alive.current && request === stateRequest.current) { setState(next); setFailedLoad(false); }
    } catch (e) {
      if (!alive.current || request !== stateRequest.current) return;
      if (!reportFailure) throw e;
      setError(messageOf(e)); setFailedLoad(true);
    }
  };
  useEffect(() => {
    alive.current = true;
    const update = () => { void refresh(true); };
    update(); window.addEventListener('chat-persistence', update);
    return () => { alive.current = false; stateRequest.current++; window.removeEventListener('chat-persistence', update); };
  }, [id]);
  useEffect(() => { if (props.open) entry.current?.focus({ preventScroll: true }); }, [props.open]);
  useEffect(() => {
    if (!props.open || !list.current) return;
    const latest = state.turns.at(-1), answer = list.current.querySelector('.chat-turn:last-child .chat-answer');
    // Start a batch at its reply and Add all control, not at the final item.
    if (latest?.status === 'complete' && chatComments(latest).length > 1 && answer) {
      list.current.scrollTop += answer.getBoundingClientRect().top - list.current.getBoundingClientRect().top;
    } else list.current.scrollTop = list.current.scrollHeight;
  }, [state.turns.length, state.turns.at(-1)?.status]);
  useEffect(() => { setPreview(null); previewInput.current = ''; }, [props.guidanceKey, props.settingsKey]);
  function changed(action: () => void) { action(); setPreview(null); previewInput.current = ''; }
  function input(): ChatInput { return { ...props.capture(props.paper), projectId: id, message, images, paper, discussion, includeComment: props.paper && comment && !discussion, includeDiagnostics: diagnostics, includeReferences: props.paper && references }; }
  async function prepare() {
    const value = input(), fingerprint = JSON.stringify([value, props.paper ? props.guidanceKey : null]);
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
      setMessage(''); setImages([]); setDiscussion(undefined); setDiscussionTitle(undefined); setPreview(null); setPreviewOpen(false); previewInput.current = '';
      try { await refresh(); } catch (e) { setError('The reply is shown above, but its saved state could not be checked. ' + messageOf(e)); }
    } catch (e) { if (alive.current) { setError(messageOf(e)); try { await refresh(); } catch { /* Keep the visible conversation and question. */ } } }
    finally { operation.current = false; window.dispatchEvent(new Event('chat-persistence')); if (alive.current) { setWorking(false); setSending(false); } }
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
    try { await window.editor.clearChat({ projectId: id }); window.dispatchEvent(new Event('chat-persistence')); if (alive.current) { setPreview(null); previewInput.current = ''; setClearConfirm(false); setFailedLoad(false); setDiscussion(undefined); setDiscussionTitle(undefined); } }
    catch (e) { setError(messageOf(e)); } finally { operation.current = false; setWorking(false); }
  }
  async function retry() {
    if (busy || operation.current) return; operation.current = true; setWorking(true); setError('');
    try { await window.editor.retryChat({ projectId: id }); window.dispatchEvent(new Event('chat-persistence')); }
    catch (e) { if (alive.current) setError(messageOf(e)); }
    finally { operation.current = false; if (alive.current) setWorking(false); }
  }
  return <>
    <div className="chat-transcript" ref={list} aria-label="Chat messages" tabIndex={0}>
      {!state.turns.length && <div className="chat-empty"><p>{props.paper ? 'Ask about a proof, a suggestion, or an error in this paper.' : 'Ask how to use Modern Editor or explain an error. Paper source, saved guidance and references are excluded. Any screenshots or error details you choose to include are still sent.'}</p><p className="muted">Replies cannot change your source. You choose which ideas become comments.</p></div>}
      {state.notices.map((notice, i) => <p key={i} className="muted">{notice}</p>)}
      {state.needsSave && <button disabled={busy} onClick={() => void retry()}>Retry saving chat</button>}
      {state.turns.map(turn => {
        const suggestions = chatComments(turn), remaining = suggestions.filter(c => !props.addedCommentIds.includes(c.id));
        return <article className="chat-turn" key={turn.id}>
        <div className="chat-question"><strong>You</strong><p>{turn.message}</p></div>
        <details className="chat-sent-context"><summary>{turn.labels.join(' · ')}</summary><pre tabIndex={0}>{turn.context}</pre></details>
        {!!turn.images.length && <div className="chat-thumbnails">{turn.images.map(image => <button key={image.id} title="Enlarge screenshot" onClick={() => setExpandedImage(image)}><img src={image.dataUrl} alt={image.name} /></button>)}</div>}
        {turn.reply && <div className="chat-answer"><strong>Codex</strong><MarkdownText text={turn.reply} /></div>}
        {turn.error && <p className="error" role="alert">{turn.error}</p>}
        {turn.status === 'pending' && <p className="muted">This request did not finish. The question and screenshots were saved.</p>}
        {!!suggestions.length && <div className="chat-suggestions">
          {suggestions.length > 1 && <div className="chat-batch-heading"><span>{suggestions.length} comments</span>{props.paper && <button disabled={busy || !remaining.length} onClick={() => void props.add(turn).catch(e => setError(messageOf(e)))}>{remaining.length ? `Add all and review (${remaining.length})` : 'All added'}</button>}</div>}
          {suggestions.map((c, index) => <section className="chat-suggestion" key={c.id} aria-label={`Comment ${index + 1}: ${c.title}`}>
            <div className="chat-suggestion-title">{index + 1}. {c.title}</div>
            <MarkdownText text={c.explanation} />
            {c.validity !== 'current' && <p className="muted">Passage needs confirmation.</p>}
            <details open={suggestions.length === 1}><summary>{c.replacement === null ? 'Quoted passage' : 'Proposed revision'}</summary><label>Original</label><ReadableArea label="chat original" resetKey={c.id}><pre tabIndex={0}>{c.original}</pre></ReadableArea>{c.replacement !== null && <><label>Proposed replacement</label><ReadableArea label="chat replacement" resetKey={c.id}><pre tabIndex={0}>{c.replacement}</pre></ReadableArea></>}</details>
            {props.paper && turn.status === 'complete' && <div className="chat-reply-actions"><button disabled={busy || props.addedCommentIds.includes(c.id)} onClick={() => void props.add(turn, c.id).catch(e => setError(messageOf(e)))}>{props.addedCommentIds.includes(c.id) ? 'Added' : 'Add comment'}</button><button disabled={busy} onClick={() => changed(() => { setDiscussion({ turnId: turn.id, commentId: c.id }); setDiscussionTitle(`${index + 1}. ${c.title}`); entry.current?.focus(); })}>Discuss this</button><button disabled={busy || c.validity !== 'current'} onClick={() => props.go(turn, false, c.id)}>Go to passage</button><button disabled={busy || c.validity !== 'current'} onClick={() => props.go(turn, true, c.id)}>Show in PDF</button></div>}
          </section>)}
        </div>}
        {props.paper && turn.status === 'complete' && !suggestions.length && <div className="chat-reply-actions"><button disabled={busy || props.addedCommentIds.includes(turn.id)} onClick={() => void props.add(turn).catch(e => setError(messageOf(e)))}>{props.addedCommentIds.includes(turn.id) ? 'Added' : 'Turn into comment'}</button></div>}
      </article>; })}
    </div>
    <div ref={composer} className="chat-composer" onPaste={e => { const files = [...e.clipboardData.items].filter(item => item.kind === 'file').map(item => item.getAsFile()).filter((f): f is File => !!f); if (files.length) { e.preventDefault(); void attach(files); } }} onDragOver={e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }} onDrop={e => { if (e.dataTransfer.files.length) { e.preventDefault(); e.stopPropagation(); void attach([...e.dataTransfer.files]); } }}>
      <details className="chat-context-options"><summary>Context · {paper === 'draft' ? 'Current draft' : paper === 'passage' ? 'Selected passage' : 'Editor Help'}{discussion ? ' · Chosen suggestion' : comment && props.paper ? ' · Comment' : ''}{diagnostics ? ' · Errors' : ''}{references && props.paper ? ' · References' : ''}{images.length ? ` · ${images.length} screenshot(s)` : ''}</summary>
        <div className="chat-context-panel">
        <p>Sending shares the selected context and screenshots with Codex. Help is always included. Recent exchanges use a 48,000-character budget; large batches keep a numbered index. Discuss this includes the chosen wording. Older screenshots are not resent.</p>
        {props.paper && <><label>Paper context<select disabled={busy} value={paper} onChange={e => changed(() => setPaper(e.target.value as ChatInput['paper']))}><option value="draft">Current draft (up to 120,000 characters)</option><option value="passage">Selected passage</option><option value="none">No source text</option></select></label><label><input type="checkbox" checked={comment} disabled={busy} onChange={e => changed(() => setComment(e.target.checked))} /> Current comment and recent discussion</label><label><input type="checkbox" checked={references} disabled={busy} onChange={e => changed(() => setReferences(e.target.checked))} /> Let Codex read enabled context, references and the current draft</label></>}
        <label><input type="checkbox" checked={diagnostics} disabled={busy} onChange={e => changed(() => setDiagnostics(e.target.checked))} /> Latest error and compilation details</label>
        <button disabled={busy || !message.trim() || failedLoad} onClick={() => void previewContext()}>Preview what is sent</button>{props.paper && <button onClick={props.sources}>Sources used…</button>}
      {previewOpen && preview && <details className="chat-prepared" open><summary>Prepared context · {preview.labels.join(' · ')}</summary><pre tabIndex={0}>{preview.context}</pre><button onClick={() => setPreviewOpen(false)}>Hide preview</button></details>}
      {props.paper && <div className="chat-context-links"><button className="text-button" onClick={props.context}>Context / paste…</button><button className="text-button" onClick={props.guidance}>Paper instructions…</button></div>}
      <p className="chat-privacy">Sending shares the selected context and screenshots with Codex. Paste or drop PNG/JPEG images here · up to 3, 2 MB each.</p>
      <div className="chat-footer"><span>Modern Editor {state.editorVersion}</span>{clearConfirm ? <span>Delete this saved chat? <button disabled={busy} onClick={() => void clear()}>Clear conversation</button><button onClick={() => setClearConfirm(false)}>Keep</button></span> : <button className="text-button" disabled={busy} onClick={() => setClearConfirm(true)}>Clear chat…</button>}</div>
      </div></details>
      {discussion && <div className="chat-discussion-target" title={discussionTitle}><span>Discussing {discussionTitle}</span><button aria-label="Clear selected discussion" disabled={busy} onClick={() => changed(() => { setDiscussion(undefined); setDiscussionTitle(undefined); })}>×</button></div>}
      {!!images.length && <div className="chat-thumbnails">{images.map(image => <div key={image.id}><button title="Enlarge attached screenshot" onClick={() => setExpandedImage(image)}><img src={image.dataUrl} alt={image.name} /></button><button disabled={busy} aria-label={`Remove ${image.name}`} onClick={() => changed(() => setImages(current => current.filter(i => i.id !== image.id)))}>×</button></div>)}</div>}
      <label className="chat-message-label" htmlFor={`chat-message-${id ?? 'help'}`}>Your question</label>
      <textarea ref={entry} id={`chat-message-${id ?? 'help'}`} aria-label="Message to Codex Side Chat" maxLength={10000} rows={3} placeholder="Ask about the editor, a proof, or a suggestion…" value={message} disabled={working} onChange={e => changed(() => setMessage(e.target.value))} onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }} />
      <input ref={picker} aria-label="Choose chat screenshots" hidden type="file" accept="image/png,image/jpeg" multiple onChange={e => { void attach([...e.target.files ?? []]); e.target.value = ''; }} />
      <div className="chat-send-actions"><button className="primary" disabled={busy || failedLoad || !message.trim()} title="Send · Command/Ctrl+Enter" onClick={() => void send()}>Ask Codex</button><button disabled={busy || images.length >= 3} onClick={() => picker.current?.click()}>Attach screenshot…</button>{sending && <button onClick={() => void window.editor.cancelCodex().catch(e => setError(messageOf(e)))}>Stop</button>}</div>
      {working && <p role="status">{sending ? props.status : 'Preparing chat context…'}</p>}
      {props.blocked && !sending && <p className="muted">Finish or stop the current Codex request before sending.</p>}
      {error && <p className="error" role="alert">{error}</p>}

    </div>
    {expandedImage && props.open && <EnlargedImage image={expandedImage} close={() => setExpandedImage(null)} />}
  </>;
}
