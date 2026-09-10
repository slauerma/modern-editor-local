import { sourcePosition, restoreSourcePosition, LatestTask } from './workspace-state.ts';
import { defaultWorkspace, workspaceSchema, type WorkspaceState } from '../shared/contracts.ts';
import { reviewShortcut } from './review-shortcuts.ts';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { EditorState, StateEffect, StateField, Transaction } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, drawSelection, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, historyKeymap, undo, redo, undoDepth, isolateHistory } from '@codemirror/commands';
import { StreamLanguage, syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { commentSchema, type PreambleRequest, type BufferInput, type Build, type Comment, type Engine, type Project, type Review, type SourceRecovery } from '../shared/contracts.ts';
import { preambleContext, preambleChanges } from '../shared/fragment-preamble.ts';
import { captureContext, changedText, commentVisible, discussionMessage, historyCommentId, mergeComments, nextCommentId, proposalChanges, reattachComment, replyFields, visibleCommentId } from '../shared/review.ts';
import { ProposalPreview } from './ProposalPreview.tsx';
import { DiscussionMessage } from './DiscussionMessage.tsx';
import { applyProposal, commentsField, initialState, loadComments, patchComments, validateReviewTransaction } from './editor-state.ts';
import { PdfPane } from './PdfPane.tsx';
import { sourceMatch } from './source-search.ts';
import { RecoveryWriter } from './recovery-writer.ts';
import { WorkGate } from './work-gate.ts';
import { ComparePane, type ComparisonPosition } from './ComparePane.tsx';
import type { Baseline, Effort, WaitingResult } from '../shared/contracts.ts';
import { ResultInbox } from './result-inbox.ts';
import { WaitingResults } from './WaitingResults.tsx';
import { deeperQuestion, replyContext, reviewContext } from '../shared/codex-context.ts';
import { SectionReview, reviewSections, type SectionProgress } from '../shared/section-review.ts';
import { CommentOverview } from './CommentOverview.tsx';
import { ActionMenu } from './ActionMenu.tsx';
import { PaneDivider } from './PaneDivider.tsx';
import type { PdfJump, PdfPosition } from './pdf-position.ts';
type PdfTarget = { projectId: string; text: string; from: number; to: number };

const selectComment = StateEffect.define<string | null>();
const activeField = StateField.define<string | null>({ create: () => null, update(value, tr) { for (const e of tr.effects) if (e.is(selectComment)) value = e.value; return value; } });
const highlights = ViewPlugin.fromClass(class {
  decorations;
  constructor(view: EditorView) { this.decorations = this.make(view); }
  update(u: { view: EditorView; docChanged: boolean; transactions: readonly Transaction[] }) { if (u.docChanged || u.transactions.some(t => t.effects.length)) this.decorations = this.make(u.view); }
  make(view: EditorView) { return Decoration.set(view.state.field(commentsField).filter(c => c.decision === 'open' && c.to > c.from && c.to <= view.state.doc.length).map(c => Decoration.mark({ class: `review-mark ${c.id === view.state.field(activeField) ? 'review-active' : ''} ${c.validity !== 'current' ? 'review-stale' : ''}` }).range(c.from, c.to)), true); }
}, { decorations: v => v.decorations });
const errorText = (e: unknown) => (e instanceof Error && e.name === 'ZodError' ? 'This review change exceeds a size/count limit or contains invalid data. The existing review was kept.' : e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': Error: /, '');

export function App() {
  const [project, setProject] = useState<Project | null>(null), [text, setText] = useState(''), [savedText, setSavedText] = useState('');
  const [comments, setComments] = useState<Comment[]>([]), [activeId, setActiveId] = useState<string | null>(null);
  const [status, setStatus] = useState('Ready'), [notice, setNotice] = useState(''), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [pdfOpen, setPdfOpen] = useState(false), [build, setBuild] = useState<Build | null>(null), [lastAttempt, setLastAttempt] = useState<Build | null>(null), [pdfText, setPdfText] = useState(''), [dependencyStale, setDependencyStale] = useState(false);
  const [engine, setEngine] = useState<Engine>('pdflatex'), [showHistory, setShowHistory] = useState(false), [notesOpen, setNotesOpen] = useState(false), [canUndo, setCanUndo] = useState(false);
  const [aiBusy, setAiBusy] = useState(false), [reviewOpen, setReviewOpen] = useState(false), [instructions, setInstructions] = useState('Improve clarity and technical precision. Preserve notation. Flag mathematical concerns with an explanation.');
  const [discussionBusy, setDiscussionBusy] = useState(false), discussionLock = useRef(false);
  const [preambleBusy, setPreambleBusy] = useState(false), preambleRun = useRef<{ cancelled: boolean } | null>(null);
  const [locked, setLocked] = useState(false), [recovery, setRecovery] = useState<SourceRecovery | null>(null), [recoveryChoice, setRecoveryChoice] = useState(0);
  const [pdfPosition, setPdfPosition] = useState<PdfPosition>({ page: 1, zoom: 1 }), [candidateBuild, setCandidateBuild] = useState<Build | null>(null), [viewCandidate, setViewCandidate] = useState(false);
  const [candidatePosition, setCandidatePosition] = useState<PdfPosition>({ page: 1, zoom: 1 });
  const [pdfJump, setPdfJump] = useState<PdfJump | null>(null), [pdfLocating, setPdfLocating] = useState(false);
  const [pdfNavigation, setPdfNavigation] = useState<{ reason: string; target?: PdfTarget } | null>(null);
  const [followRevision, setFollowRevision] = useState(0), followPending = useRef<{ projectId: string; id: string } | null>(null), followTasks = useRef(new LatestTask());
  const pdfRequest = useRef(0), displayedBuild = useRef<Build | null>(null); displayedBuild.current = viewCandidate ? candidateBuild : build;
  const gate = useRef(new WorkGate(() => setLocked(gate.current.locked)));
  const keyboardReviewFocus = useRef<{ element: HTMLElement; projectId: string } | null>(null);
  useEffect(() => {
    const focusChanged = (event: FocusEvent) => {
      const pending = keyboardReviewFocus.current, target = event.target;
      if (pending && target instanceof Node && target !== document.body && !pending.element.contains(target)) keyboardReviewFocus.current = null;
    };
    document.addEventListener('focusin', focusChanged);
    return () => document.removeEventListener('focusin', focusChanged);
  }, []);
  useLayoutEffect(() => {
    if (busy || locked || gate.current.closing) return;
    const pending = keyboardReviewFocus.current; keyboardReviewFocus.current = null;
    // Committing briefly makes the app inert, which drops focus to body. Restore
    // the comment rail after React unlocks it, unless the author focused elsewhere.
    if (pending && pending.projectId === project?.id && pending.element.isConnected &&
        document.activeElement === document.body && !pending.element.closest('[inert]')) {
      pending.element.focus({ preventScroll: true });
    }
  }, [busy, locked, project?.id]);
  const writer = useRef(new RecoveryWriter<BufferInput>(value => window.editor.persist(value), e => setError('Recovery could not be saved: ' + errorText(e))));
  const host = useRef<HTMLDivElement>(null), view = useRef<EditorView | null>(null), projectRef = useRef<Project | null>(null), reviewRef = useRef<Review | null>(null), activeRef = useRef<string | null>(null);
  const commandRef = useRef<(command: string) => void>(() => {});
  const historyRef = useRef(false), laterRef = useRef(false);
  const [laterOnly, setLaterOnly] = useState(false);
  const [findOpen, setFindOpen] = useState(false), [query, setQuery] = useState(''), [findNotice, setFindNotice] = useState('');
  const [compareOpen, setCompareOpen] = useState(false), [baseline, setBaseline] = useState<Baseline | null>(null), [comparisonBusy, setComparisonBusy] = useState(false);
  const [fastMode, setFastMode] = useState(false);
  const [followComments, setFollowComments] = useState(true);
  const [effort, setEffort] = useState<Effort>('medium'), [effortBusy, setEffortBusy] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const [paperInstructions, setPaperInstructions] = useState(''), [savedInstructions, setSavedInstructions] = useState('');
  const [contextText, setContextText] = useState(''), [contextOpen, setContextOpen] = useState(false), [overviewOpen, setOverviewOpen] = useState(false);
  const [sectionProgress, setSectionProgress] = useState<SectionProgress | null>(null), sectionRun = useRef<SectionReview | null>(null);
  const [toolbarCollapsed, setToolbarCollapsed] = useState(false), [paneSizes, setPaneSizes] = useState([.28, .33, .39]);
  const comparisonPosition = useRef<ComparisonPosition>({}), workspace = useRef<HTMLDivElement>(null);
  const workspaceValues = useRef(defaultWorkspace()), restoredSource = useRef<WorkspaceState['source'] | null>(null);
  workspaceValues.current = { ...workspaceValues.current, pdf: { page: pdfPosition.page, zoom: pdfPosition.zoom as WorkspaceState['pdf']['zoom'], scrollX: pdfPosition.scrollX ?? 0, scrollY: pdfPosition.scrollY ?? 0 }, pdfBuildId: build?.id ?? project?.workspace?.pdfBuildId ?? null, pdfOpen, paneSizes: paneSizes as WorkspaceState['paneSizes'], toolbarCollapsed, followComments, reviewView: showHistory ? 'history' : laterOnly ? 'later' : 'pending' };
  const workspaceWriter = useRef(new RecoveryWriter<{ projectId: string; workspace: WorkspaceState }>(value => window.editor.setWorkspace(value.projectId, value.workspace), e => setNotice('Reading position could not be saved. Source recovery is separate. ' + errorText(e))));
  const workspaceCallback = useRef<() => void>(() => {}); workspaceCallback.current = scheduleWorkspace;

  const [waiting, setWaiting] = useState<WaitingResult[]>([]), [waitingNotices, setWaitingNotices] = useState<string[]>([]), [inboxBusy, setInboxBusy] = useState(false), [inboxOpen, setInboxOpen] = useState(false);
  const inbox = useRef<ResultInbox>();
  inbox.current ??= new ResultInbox({ api: window.editor, input, locked: () => gate.current.locked, begin: () => gate.current.begin('results'),
    install: items => { view.current?.dispatch({ effects: loadComments.of(items), annotations: Transaction.addToHistory.of(false) }); },
    flush, changed: (items, notices, working) => { setWaiting(items); setWaitingNotices(notices); setInboxBusy(working); },
    error: e => setError('A Codex result remains available in waiting results. ' + errorText(e)) });
  useEffect(() => { if (project && !locked) void inbox.current!.refresh(); }, [project?.id, locked]);
  useEffect(() => { setCandidatePosition({ page: 1, zoom: pdfPosition.zoom }); }, [candidateBuild?.id]);
  const pending = comments.filter(c => c.decision === 'open'), laterCount = pending.filter(c => c.later).length, visible = comments.filter(c => commentVisible(c, showHistory, laterOnly));
  const active = visible.find(c => c.id === activeId), dirty = !!project && text !== savedText;

  function input(): BufferInput | null {
    const p = projectRef.current, editor = view.current, review = reviewRef.current;
    return p && review ? { projectId: p.id, text: editor ? editor.state.doc.toString() : p.text, review: { ...review, activeId: activeRef.current, comments: editor ? editor.state.field(commentsField) : review.comments } } : null;
  }
  function validateTransaction(transaction: Transaction) {
    const current = input();
    if (!current) throw new Error('This paper is no longer open.');
    validateReviewTransaction(transaction, current);
  }
  function dispatchTransactions(transactions: readonly Transaction[], editor: EditorView) {
    // History and selection-history transactions can bypass transaction filters.
    // Validate the whole batch before publishing any state or consuming Undo.
    try {
      for (const transaction of transactions) if (transaction.docChanged || transaction.effects.some(e => e.is(loadComments) || e.is(patchComments))) validateTransaction(transaction);
    } catch (e) { setError(errorText(e)); return; }
    editor.update(transactions);
  }
  async function flush() { const current = input(); if (current) await writer.current.flush(current); }
  function captureWorkspace() {
    const p = projectRef.current, editor = view.current;
    if (!p || !editor || restoredSource.current) return null;
    return { projectId: p.id, workspace: workspaceSchema.parse({ ...workspaceValues.current, source: sourcePosition(editor) }) };
  }
  function scheduleWorkspace() {
    if (gate.current.locked) return;
    try { const value = captureWorkspace(); if (value) workspaceWriter.current.schedule(value); }
    catch (e) { setNotice('Reading position could not be recorded. ' + errorText(e)); }
  }
  async function flushWorkspace() {
    try { const value = captureWorkspace(); if (value) await workspaceWriter.current.flush(value); else await workspaceWriter.current.flush(); }
    catch (e) { setNotice('Reading position could not be saved. Source recovery is separate. ' + errorText(e)); }
  }
  function load(p: Project) {
    keyboardReviewFocus.current = null;
    cancelPdfNavigation(); view.current?.destroy(); view.current = null;
    const saved = p.workspace ?? defaultWorkspace(); workspaceValues.current = saved; restoredSource.current = p.workspace?.source ?? null;
    projectRef.current = p; reviewRef.current = p.review; activeRef.current = p.review.activeId;
    setActiveId(p.review.activeId); setProject(p); setEngine(p.engine); setEffort(p.effort); setFastMode(p.fastMode ?? false);
    setPaperInstructions(p.paperInstructions ?? ''); setSavedInstructions(p.paperInstructions ?? ''); setSectionProgress(null);
    setContextOpen(false); setOverviewOpen(false); setInboxOpen(false); setBaseline(p.baseline); setCompareOpen(false); comparisonPosition.current = {};
    setText(p.text); setSavedText(p.recovered ? '\u0000recovered-unsaved' : p.text);
    setBuild(p.restoredPdf?.build ?? null); displayedBuild.current = p.restoredPdf?.build ?? null;
    setLastAttempt(null); setDependencyStale(!!p.restoredPdf); setPdfText(p.restoredPdf?.text ?? '');
    setPdfPosition(saved.pdf); setPdfOpen(saved.pdfOpen); setPaneSizes(saved.paneSizes); setToolbarCollapsed(saved.toolbarCollapsed); setFollowComments(saved.followComments);
    setCandidateBuild(null); setViewCandidate(false); setError(''); setNotice(p.notices.join(' '));
    historyRef.current = saved.reviewView === 'history'; setShowHistory(historyRef.current); laterRef.current = saved.reviewView === 'later'; setLaterOnly(laterRef.current);
    setFindOpen(false); setFindNotice(''); setStatus(p.recovered ? 'Unsaved work recovered' : 'Paper opened');
  }
  function openFind() { if (!view.current) return; setFindOpen(true); searchInput.current?.focus(); searchInput.current?.select(); }
  useEffect(() => { if (findOpen) { searchInput.current?.focus(); searchInput.current?.select(); } }, [findOpen]);
  function find(backwards = false) {
    const editor = view.current; if (!editor) return;
    const selection = editor.state.selection.main;
    const match = sourceMatch(editor.state.doc.toString(), query, selection.from, selection.to, backwards);
    setFindNotice(match ? `Line ${editor.state.doc.lineAt(match.from).number}` : query ? 'No match' : 'Enter text to find');
    if (match) editor.dispatch({ selection: { anchor: match.from, head: match.to }, effects: EditorView.scrollIntoView(match.from, { y: 'center' }) });
  }
  async function changeEngine(next: Engine) {
    const p = projectRef.current; if (!p) return;
    const done = gate.current.begin('engine'); if (!done) return;
    try { await window.editor.setEngine(p.id, next); if (projectRef.current?.id === p.id) { setEngine(next); setStatus('Engine saved for this paper'); } }
    catch (e) { setError(errorText(e)); } finally { done(); }
  }
  async function changeFastMode(next: boolean) {
    const p = projectRef.current; if (!p || aiBusy || effortBusy) return;
    const done = gate.current.begin('fast mode'); if (!done) return;
    setEffortBusy(true);
    try { await window.editor.setFastMode(p.id, next); if (projectRef.current?.id === p.id) { p.fastMode = next; setFastMode(next); setStatus(next ? 'Fast mode enabled for this paper · increased usage' : 'Standard speed selected'); } }
    catch (e) { setError(errorText(e)); } finally { setEffortBusy(false); done(); }
  }
  async function changeEffort(next: Effort) {
    const p = projectRef.current; if (!p || aiBusy) return;
    const done = gate.current.begin('effort'); if (!done) return;
    setEffortBusy(true);
    try { await window.editor.setEffort(p.id, next); if (projectRef.current?.id === p.id) { setEffort(next); setStatus('Codex effort saved for this paper'); } }
    catch (e) { setError(errorText(e)); } finally { setEffortBusy(false); done(); }
  }
  async function keepComparison(name?: string) {
    const captured = input(); if (!captured) return;
    const done = gate.current.begin('comparison'); if (!done) return;
    setComparisonBusy(true);
    try {
      const kept = name === undefined ? await window.editor.chooseBaseline(captured.projectId) : await window.editor.pinBaseline({ projectId: captured.projectId, text: captured.text, name });
      if (kept && projectRef.current?.id === captured.projectId && !gate.current.closing) { setBaseline(kept); setError(''); setStatus(`Comparison version kept: ${kept.name}`); }
    } catch (e) { setError(errorText(e)); } finally { setComparisonBusy(false); done(); }
  }
  async function compareSavedVersion(versionId: string) {
    const p = projectRef.current; if (!p) return;
    const done = gate.current.begin('comparison'); if (!done) return;
    setComparisonBusy(true);
    try { const next = await window.editor.compareSavedVersion(p.id, versionId); if (projectRef.current?.id === p.id) { p.baseline = next; setBaseline(next); } }
    finally { setComparisonBusy(false); done(); }
  }
  function returnToSource(position?: number) {
    setCompareOpen(false);
    const editor = view.current, previouslyFocused = document.activeElement;
    requestAnimationFrame(() => {
      if (!editor || view.current !== editor) return;
      editor.requestMeasure();
      if (position !== undefined) { const at = Math.min(position, editor.state.doc.length); editor.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: 'center' }) }); }
      // Do not take focus back if the author already moved to a PDF/control field.
      if (document.activeElement === document.body || document.activeElement === previouslyFocused || editor.dom.contains(document.activeElement)) editor.focus();
    });
  }
  function confirmPassage() {
    const editor = view.current; if (!editor || !active) return;
    try { const selected = editor.state.selection.main; const { from, to, before, after, validity } = reattachComment(editor.state.doc.toString(), active, selected.from, selected.to); patch(active.id, { from, to, before, after, validity }, true); setStatus('Comment attached to the selected passage'); setError(''); }
    catch (e) { setError(errorText(e)); }
  }
  function choose(id: string | null, reveal = true, follow = false) {
    if (gate.current.locked) return;
    cancelPdfNavigation();
    const items = view.current?.state.field(commentsField) ?? [];
    if (id !== null) id = visibleCommentId(items, id, historyRef.current, laterRef.current);
    activeRef.current = id; setActiveId(id); const editor = view.current;
    if (!editor) return;
    const c = editor.state.field(commentsField).find(c => c.id === id);
    editor.dispatch({ effects: [selectComment.of(id), ...(c && reveal && c.to > c.from && c.validity !== 'missing' && c.validity !== 'ambiguous' ? [EditorView.scrollIntoView(c.from, { y: 'center' })] : [])] });
    if (follow && id && projectRef.current) { followPending.current = { projectId: projectRef.current.id, id }; setFollowRevision(value => value + 1); }
  }
  function move(delta: number) {
    const editor = view.current; if (!editor) return;
    choose(nextCommentId(editor.state.field(commentsField), activeRef.current, delta, historyRef.current, laterRef.current), true, true);
  }
  function showReviewHistory(value: boolean) {
    historyRef.current = value; setShowHistory(value); laterRef.current = false; setLaterOnly(false);
    choose(visibleCommentId(view.current?.state.field(commentsField) ?? [], activeRef.current, value), true, true);
  }
  function showLater() {
    const value = !laterRef.current;
    laterRef.current = value; setLaterOnly(value); historyRef.current = false; setShowHistory(false);
    choose(visibleCommentId(view.current?.state.field(commentsField) ?? [], activeRef.current, false, value), true, true);
  }
  function markLater() {
    const c = view.current?.state.field(commentsField).find(c => c.id === activeRef.current);
    if (c?.decision === 'open' && patch(c.id, { later: !c.later }, true)) { move(1); setStatus(c.later ? 'Returned comment to pending' : 'Comment kept for later'); }
  }
  function patch(id: string, fields: Partial<Comment>, inHistory = false) {
    const editor = view.current; if (!editor || gate.current.locked) return false;
    try {
      const tr = editor.state.update({ effects: patchComments.of([{ id, fields }]), annotations: inHistory ? isolateHistory.of('full') : Transaction.addToHistory.of(false) });
      validateTransaction(tr); // Validate source + review before touching the view.
      editor.dispatch(tr); return true;
    } catch (e) { setError(errorText(e)); return false; }
  }
  function appendReview(incoming: Comment[]) {
    const editor = view.current; if (!editor || gate.current.locked) return;
    const existing = editor.state.field(commentsField), merged = mergeComments(existing, incoming);
    const transaction = editor.state.update({ effects: loadComments.of(merged), annotations: Transaction.addToHistory.of(false) });
    validateTransaction(transaction);
    editor.dispatch(transaction);
    historyRef.current = false; setShowHistory(false); laterRef.current = false; setLaterOnly(false); choose(merged[existing.length]?.id ?? activeRef.current);
  }
  function addAuthorComment() {
    const editor = view.current; if (!editor || gate.current.locked) return;
    const { from, to, empty } = editor.state.selection.main;
    if (empty) { setError('Select a passage in the source first, then add your comment.'); return; }
    try {
      const source = editor.state.doc.toString();
      const comment = captureContext(source, commentSchema.parse({ id: crypto.randomUUID(), category: 'Your comment', title: 'Your note or question', explanation: 'Add a note or ask Codex about this passage.', original: source.slice(from, to), replacement: null, from, to, validity: 'current' }));
      appendReview([comment]); setNotesOpen(true); setError(''); setStatus('Comment added to the selected passage');
    } catch (e) { setError(errorText(e)); }
  }
  function finishComment(decision: 'dismissed' | 'resolved') {
    const c = view.current?.state.field(commentsField).find(c => c.id === activeRef.current);
    if (c?.decision === 'open' && patch(c.id, { decision }, true)) move(1);
  }
  useEffect(() => {
    if (!project || !host.current) return;
    const state = initialState(project.text, project.review.comments, () => setError('This edit would exceed the source size limit. The existing source was kept.'));
    const editor = new EditorView({ parent: host.current, dispatchTransactions, state: state.update({ effects: StateEffect.appendConfig.of([
      activeField, highlights, lineNumbers(), EditorView.lineWrapping, drawSelection(), StreamLanguage.define(stex), syntaxHighlighting(defaultHighlightStyle), bracketMatching(),
      EditorState.transactionFilter.of(tr => gate.current.locked && (tr.docChanged || tr.effects.some(e => e.is(loadComments) || e.is(patchComments))) ? [] : tr),
      keymap.of([{ key: 'Mod-f', run: () => { openFind(); return true; } }, { key: 'Mod-z', run: () => { doHistory(); return true; }, shift: () => { doHistory(true); return true; } }, { key: 'Mod-y', run: () => { doHistory(true); return true; } }, ...defaultKeymap,
        ...historyKeymap.map(binding => ({ ...binding, run: (editor: EditorView) => { if (!gate.current.locked) binding.run?.(editor); return true; } }))
      ]), EditorView.contentAttributes.of({ 'aria-label': 'LaTeX source', spellcheck: 'false' }),
      EditorView.updateListener.of(update => {
        if (update.docChanged || update.selectionSet) { cancelPdfNavigation(); workspaceCallback.current(); }
        if (update.docChanged || update.transactions.some(tr => tr.effects.length)) {
          setText(update.state.doc.toString()); setComments(update.state.field(commentsField)); setCanUndo(undoDepth(update.state) > 0);
        }
      }),
      EditorView.domEventHandlers({ scroll() { workspaceCallback.current(); return false; }, click(event, v) {
        const pos = v.posAtCoords({ x: event.clientX, y: event.clientY });
        const c = pos === null ? undefined : v.state.field(commentsField).find(c => c.decision === 'open' && c.to > c.from && c.from <= pos && c.to >= pos && !['missing', 'ambiguous'].includes(c.validity));
        if (c) choose(c.id, false);
        return false;
      } })
    ]) }).state });
    view.current = editor; setComments(editor.state.field(commentsField)); setCanUndo(false);
    choose(project.review.activeId ?? project.review.comments.find(c => c.decision === 'open')?.id ?? null, !project.workspace);
    const position = restoredSource.current; restoredSource.current = null;
    if (position) restoreSourcePosition(editor, position);
    return () => { if (view.current === editor) { editor.destroy(); view.current = null; } };
  }, [project?.id]);
  useEffect(() => {
    const done = gate.current.begin('project'); if (!done) return;
    void window.editor.resumeProject().then(p => { if (p) load(p); }).catch(e => setError(errorText(e))).finally(done);
  }, []);
  useEffect(() => {
    const current = input(); if (current && !gate.current.locked) writer.current.schedule(current);
  }, [project?.id, text, comments, activeId]);
  useEffect(() => { scheduleWorkspace(); }, [project?.id, pdfPosition, pdfOpen, paneSizes, toolbarCollapsed, followComments, laterOnly, showHistory, build?.id]);
  useEffect(() => () => { writer.current.clearTimers(); workspaceWriter.current.clearTimers(); }, []);
  async function close() {
    if (preambleRun.current) preambleRun.current.cancelled = true;
    try { await gate.current.close(() => Promise.all([window.editor.cancelBuild(), sectionRun.current ? sectionRun.current.stop() : window.editor.cancelCodex()]), async () => { await flush(); await flushWorkspace(); }, () => window.editor.finishClose()); }
    catch (e) { setError('The window stayed open because closing could not finish: ' + errorText(e) + ' Retry Save or export your source.'); }
  }
  useEffect(() => window.editor.onCloseRequested(() => { void close(); }), []);
  useEffect(() => window.editor.onCommand(command => commandRef.current(command)), []);
  useEffect(() => window.editor.onCodexProgress(message => setStatus(message)), []);
  useEffect(() => {
    let disposed = false;
    const check = () => { if (build && project) void window.editor.validateBuild({ projectId: project.id, buildId: build.id, text: pdfText }).then(valid => { if (!disposed) setDependencyStale(!valid); }).catch(() => { if (!disposed) setDependencyStale(true); }); };
    window.addEventListener('focus', check); return () => { disposed = true; window.removeEventListener('focus', check); };
  }, [build, project?.id, pdfText]);

  async function open(demo = false, reload = false, draft = false) {
    const done = gate.current.begin('project'); if (!done) return;
    try {
      await flush(); await flushWorkspace(); if (gate.current.closing) return;
      const p = reload && projectRef.current ? await window.editor.reload(projectRef.current.id) : draft ? await window.editor.openDraft() : demo ? await window.editor.openDemo() : await window.editor.openProject();
      if (p) { load(p); if (demo) setNotice('This sample uses prepared feedback. Edits, JSON saving and compilation are real.'); if (draft) setNotice('Paste your LaTeX, then choose Add preamble and compile. Save keeps this local draft; Export source… lets you choose a new file.'); }
    } catch (e) { setError(errorText(e)); } finally { done(); }
  }
  async function save() {
    const captured = input(); if (!captured) return;
    const done = gate.current.begin('save'); if (!done) return;
    try { await gate.current.commit(async () => { await writer.current.flush(captured); const saved = await window.editor.save(captured);
        if (saved?.baseline && projectRef.current?.id === captured.projectId) { projectRef.current.baseline = saved.baseline; setBaseline(saved.baseline); }
        if (saved?.historyNotice) setNotice(saved.historyNotice); }); if (projectRef.current?.id === captured.projectId) { setSavedText(captured.text); setStatus('Source and review saved · source versions kept'); setError(''); } }
    catch (e) { setError(errorText(e)); } finally { done(); }
  }
  async function exportSource(recovered = false) {
    const choice = recovered ? recovery?.choices[recoveryChoice] : undefined;
    const source = choice ? { name: recovery!.name, text: choice.text } : !recovered && projectRef.current && view.current ? { name: projectRef.current.name, text: view.current.state.doc.toString() } : null;
    if (!source) return;
    const done = gate.current.begin('export'); if (!done) return;
    try { const file = await window.editor.exportSource(source); if (file) { setNotice(`Exported a source copy to ${file}`); setStatus('Source copy exported'); } }
    catch (e) { setError(errorText(e)); } finally { done(); }
  }
  async function inspectRecovery() {
    const done = gate.current.begin('inspect'); if (!done) return;
    try { const found = await window.editor.inspectRecovery(); if (found && !gate.current.closing) { setRecovery(found); setRecoveryChoice(0); } }
    catch (e) { setError(errorText(e)); } finally { done(); }
  }
  async function importReview() {
    const captured = input(); if (!captured) return;
    const done = gate.current.begin('import'); if (!done) return;
    try { const imported = await window.editor.importReview(captured.projectId, captured.text); if (imported && !gate.current.locked && projectRef.current?.id === captured.projectId && view.current?.state.doc.toString() === captured.text) {
      appendReview(imported.comments); setStatus(`Imported ${imported.comments.length} comments`);
    } } catch (e) { setError(errorText(e) + ' The imported file is unchanged.'); } finally { done(); }
  }
  async function compile(acceptId?: string, keyboardRail?: HTMLElement) {
    const captured = input(), editor = view.current; if (!captured || !editor || busy) return;
    let candidate = captured.text;
    const c = acceptId ? captured.review.comments.find(c => c.id === acceptId) : undefined;
    try { if (c) candidate = changedText(captured.text, proposalChanges(captured.text, c)); } catch (e) { setError(errorText(e)); return; }
    const done = gate.current.begin('build'); if (!done) return;
    if (keyboardRail) keyboardReviewFocus.current = { element: keyboardRail, projectId: captured.projectId };
    let applied = false;
    setBusy(true); setError(''); setStatus(c ? 'Checking the complete suggestion…' : 'Compiling the current source…');
    try {
      await flush();
      if (gate.current.closing) return;
      const result = await window.editor.compile({ projectId: captured.projectId, text: candidate, engine });
      if (gate.current.closing || projectRef.current?.id !== captured.projectId) return;
      setLastAttempt(result);
      if (!result.success || (c && !result.clean)) { if (c && result.success) setCandidateBuild(result); setStatus('Compilation needs attention'); setError(c ? 'The suggestion was not applied. Its candidate did not pass the compilation check.' : 'Compilation failed. The last successful PDF is still available.'); return; }
      // The dependency snapshot matters for ordinary Compile too, including changes
      // made while TeX was running. Keep its PDF viewable without claiming it is current.
      const valid = await window.editor.validateBuild({ projectId: captured.projectId, buildId: result.id, text: candidate });
      if (gate.current.closing || projectRef.current?.id !== captured.projectId) return;
      if (c) {
        const now = view.current?.state.field(commentsField).find(item => item.id === c.id);
        const unchanged = view.current === editor && editor.state.doc.toString() === captured.text && JSON.stringify(now) === JSON.stringify(c);
        if (!valid || !unchanged) { setStatus('Source or proposal changed during the check'); setError('Nothing was applied. Check the current suggestion again.'); return; }
        const transaction = editor.state.update(applyProposal(editor.state, c.id));
        validateTransaction(transaction);
        await gate.current.commit(async () => {
          // Publish the author-approved edit as one undoable transaction before
          // recording it. A failed write leaves the actual edit visible, never a
          // hidden candidate ahead of the editor. Close waits for this operation.
          editor.dispatch(transaction); applied = true;
          await flush();
        });
        move(1); setStatus('Suggestion applied · source not yet saved');
      } else setStatus(!valid ? 'Compiled snapshot · project inputs changed during compilation' : result.clean ? 'Compiled successfully' : 'Compiled with warnings');
      setBuild(result); setPdfText(candidate); setDependencyStale(!valid); setViewCandidate(false); if (c) setCandidateBuild(null); if (!c) setPdfOpen(true);
      displayedBuild.current = result;
      return result;
    } catch (e) { setError(applied ? 'The suggestion is applied in the editor, but recovery could not be saved. Keep the window open; retry Save, export the source, or Undo. ' + errorText(e) : errorText(e)); setStatus(applied ? 'Suggestion applied · recovery needs attention' : 'Ready'); } finally { setBusy(false); done(); }
  }
  function cancelPdfNavigation() { pdfRequest.current++; followPending.current = null; followTasks.current.clear(); setPdfLocating(false); setPdfNavigation(null); setPdfJump(null); }
  function toggleComparison() {
    cancelPdfNavigation();
    if (compareOpen) returnToSource();
    else { setCompareOpen(true); setReviewOpen(false); }
  }
  function togglePdf() { if (pdfOpen) cancelPdfNavigation(); setPdfOpen(value => !value); }
  function changeFollowing(value: boolean) { cancelPdfNavigation(); setFollowComments(value); }
  useEffect(() => {
    const pending = followPending.current;
    if (!pending || busy || locked || !pdfOpen) return;
    followPending.current = null;
    if (!followComments || viewCandidate || pending.projectId !== projectRef.current?.id || pending.id !== activeRef.current) return;
    const captured = input(), c = captured?.review.comments.find(c => c.id === pending.id);
    if (!captured || !c) return;
    if (!['current', 'stale'].includes(c.validity) || c.to <= c.from || c.to > captured.text.length) { setPdfNavigation({ reason: 'This comment has no confirmed current passage to show in the PDF.' }); return; }
    const request = pdfRequest.current;
    followTasks.current.replace(async () => {
      if (request !== pdfRequest.current || gate.current.closing || projectRef.current?.id !== pending.projectId || activeRef.current !== pending.id) return;
      await navigatePdf({ projectId: pending.projectId, text: captured.text, from: c.from, to: c.to }, false, true);
    });
  }, [followRevision, busy, locked, pdfOpen, followComments, viewCandidate]);
  function showInPdf(passage?: { from: number; to: number }) {
    const captured = input(), selection = view.current?.state.selection.main;
    if (!captured || !selection) return;
    cancelPdfNavigation();
    void navigatePdf({ projectId: captured.projectId, text: captured.text, from: passage?.from ?? selection.from, to: passage?.to ?? selection.to });
  }
  async function navigatePdf(target: PdfTarget, forceCompile = false, automatic = false) {
    if (gate.current.locked || busy) return;
    const request = ++pdfRequest.current;
    setPdfLocating(true); setPdfNavigation(null); setPdfJump(null);
    const current = () => pdfRequest.current === request && !gate.current.closing && projectRef.current?.id === target.projectId && view.current?.state.doc.toString() === target.text;
    try {
      const shown = forceCompile ? await compile() : displayedBuild.current;
      if (!current()) return;
      if (!shown) { if (!forceCompile) setPdfNavigation({ reason: 'Compile the current draft to show this passage in a PDF.', target }); return; }
      const result = await window.editor.locatePdf({ ...target, buildId: shown.id });
      if (!current() || displayedBuild.current?.id !== shown.id) return;
      if (result.kind !== 'mapped') { setPdfNavigation({ reason: result.reason, ...(result.kind === 'compile' ? { target } : {}) }); return; }
      setCompareOpen(false); setPdfOpen(true); (viewCandidate && !forceCompile ? setCandidatePosition : setPdfPosition)(previous => ({ ...previous, page: result.page })); setPdfJump({ ...result, requestId: request, persistent: automatic });
      if (!automatic) setStatus('Passage shown in the displayed PDF · approximate typeset region');
    } catch (e) { if (current()) setPdfNavigation({ reason: errorText(e) }); }
    finally { if (pdfRequest.current === request) setPdfLocating(false); }
  }
  async function acceptWithoutCompile(id: string) {
    const captured = input(), editor = view.current;
    if (!captured || !editor || busy) return;
    const c = captured.review.comments.find(item => item.id === id);
    if (!c) { setError('This suggestion is no longer available.'); return; }
    // Share the acceptance/build slot so a checked candidate cannot race this edit.
    const done = gate.current.begin('build'); if (!done) return;
    let applied = false;
    setBusy(true); setError(''); setStatus('Applying the suggestion without compiling…');
    try {
      const candidate = changedText(captured.text, proposalChanges(captured.text, c));
      await flush();
      if (gate.current.closing) return;
      const now = view.current?.state.field(commentsField).find(item => item.id === id);
      if (view.current !== editor || projectRef.current?.id !== captured.projectId || editor.state.doc.toString() !== captured.text || JSON.stringify(now) !== JSON.stringify(c))
        throw new Error('The source or proposal changed. Nothing was applied; review the current suggestion again.');
      const transaction = editor.state.update(applyProposal(editor.state, id));
      validateTransaction(transaction);
      const updated = transaction.state.field(commentsField);
      if (transaction.newDoc.toString() !== candidate || updated.find(item => item.id === id)?.decision !== 'applied')
        throw new Error('The suggestion could not be applied within the editor limits. The source was kept.');
      await gate.current.commit(async () => {
        editor.dispatch(transaction); applied = true;
        // Keep the previous source PDF; its existing source comparison marks it older.
        setViewCandidate(false); setCandidateBuild(null); setLastAttempt(null);
        await flush();
      });
      move(1);
      setNotice('Applied without compiling. Undo reverts the change; Compile updates the PDF; Save writes the source.');
      setStatus('Suggestion applied without compiling · source not yet saved');
    } catch (e) {
      setError(applied ? 'The suggestion is applied without compiling and is undoable, but recovery could not be saved. Retry Save or export your source. ' + errorText(e) : errorText(e));
      setStatus(applied ? 'Suggestion applied without compiling · recovery needs attention' : 'Suggestion was not applied');
    } finally { setBusy(false); done(); }
  }
  async function cancelPreamble() {
    if (!preambleRun.current) return;
    preambleRun.current.cancelled = true;
    await Promise.all([window.editor.cancelBuild(), window.editor.cancelCodex()]);
  }
  async function addPreambleAndCompile() {
    const captured = input(), editor = view.current;
    if (!captured || !editor || busy || aiBusy || effortBusy || preambleRun.current) return;
    try {
      if (captured.text.length > 120000) throw new Error('Use a draft of at most 120,000 characters for Codex preamble generation.');
      preambleContext(captured.text);
    } catch (e) { setError(errorText(e)); return; }
    const doneBuild = gate.current.begin('build'); if (!doneBuild) return;
    const doneCodex = gate.current.begin('codex'); if (!doneCodex) { doneBuild(); return; }
    const job = { cancelled: false }; preambleRun.current = job;
    const stopped = () => job.cancelled || gate.current.closing;
    const unchanged = () => view.current === editor && projectRef.current?.id === captured.projectId && editor.state.doc.toString() === captured.text;
    let applied = false, previousAttempt: PreambleRequest['previousAttempt'];
    setBusy(true); setAiBusy(true); setPreambleBusy(true); setError('');
    try {
      await flush();
      for (let attempt = 0; attempt < 2; attempt++) {
        if (stopped()) return;
        if (!unchanged()) throw new Error('The source changed. Ask Codex again for the current draft; nothing was applied.');
        setStatus(attempt ? 'Codex is correcting the preamble using the build log…' : 'Codex is preparing a preamble…');
        const proposal = await window.editor.generatePreamble({ projectId: captured.projectId, text: captured.text, engine, previousAttempt });
        if (stopped()) return;
        if (!unchanged()) throw new Error('The source changed while Codex was working. Nothing was applied.');
        if (proposal.needsInput) { setStatus('Preamble needs your input'); setError('Codex needs your input: ' + proposal.needsInput + ' The source is unchanged.'); return; }
        const changes = preambleChanges(captured.text, proposal), candidate = changedText(captured.text, changes);
        setStatus('Checking the Codex preamble with LaTeX…');
        const result = await window.editor.compile({ projectId: captured.projectId, text: candidate, engine });
        if (stopped()) return;
        if (!unchanged()) throw new Error('The source changed during compilation. Nothing was applied.');
        setLastAttempt(result);
        if (result.dependenciesVerified === false) throw new Error('The build used unsupported or unverified inputs. Check Build details and use a self-contained paper folder. Its log was not sent for automatic preamble repair.');
        if (!result.success || !result.clean) {
          if (result.success) setCandidateBuild(result);
          previousAttempt = { proposal, log: result.log.slice(-16000) };
          continue;
        }
        const valid = await window.editor.validateBuild({ projectId: captured.projectId, buildId: result.id, text: candidate });
        if (stopped()) return;
        if (!valid || !unchanged()) throw new Error('The source or its inputs changed during the check. Nothing was applied.');
        const transaction = editor.state.update({ changes, annotations: isolateHistory.of('full') });
        validateTransaction(transaction);
        if (transaction.newDoc.toString() !== candidate) throw new Error('The additions could not be installed. The source was kept.');
        await gate.current.commit(async () => {
          if (changes.length) { editor.dispatch(transaction); applied = true; }
          setBuild(result); setPdfText(candidate); setDependencyStale(false); setViewCandidate(false); setCandidateBuild(null); setPdfOpen(true);
          await flush();
        });
        setNotice((applied ? 'Codex added a preamble; LaTeX compilation passed. Your pasted text is unchanged. Undo removes the additions; Save writes the document. ' : 'The existing preamble passed compilation. ') + proposal.explanation);
        setStatus(applied ? 'Preamble added and compiled · source not yet saved' : 'Existing preamble compiled successfully');
        return;
      }
      setStatus('Preamble still needs attention');
      setError('Codex could not produce a passing preamble after two attempts. Nothing was applied. See Build details; original definitions or references may be needed.');
    } catch (e) {
      if (!stopped()) { setError(applied ? 'The preamble is applied and undoable, but recovery could not be saved. Retry Save or export your source. ' + errorText(e) : errorText(e)); setStatus(applied ? 'Preamble applied · recovery needs attention' : 'Preamble was not applied'); }
    } finally {
      if (job.cancelled && !applied && !gate.current.closing) setStatus('Preamble request cancelled · source unchanged by this action');
      preambleRun.current = null; setPreambleBusy(false); setBusy(false); setAiBusy(false); doneCodex(); doneBuild();
    }
  }
  function doHistory(forward = false) {
    const editor = view.current; if (!editor || gate.current.locked) return false;
    const beforeState = editor.state, before = beforeState.field(commentsField);
    if (!(forward ? redo : undo)(editor) || editor.state === beforeState) return false;
    const after = editor.state.field(commentsField), id = historyCommentId(before, after, activeRef.current);
    if (after.some(c => c.id === id && c.decision !== 'open')) { historyRef.current = true; setShowHistory(true); }
    const restored = after.find(c => c.id === id); laterRef.current = !!restored?.later && restored.decision === 'open'; setLaterOnly(laterRef.current);
    choose(visibleCommentId(after, id, historyRef.current, laterRef.current)); setNotice(''); setStatus(forward ? 'Redid the last edit' : 'Undid the last edit'); return true;
  }
  function menuHistory(forward: boolean) {
    if (gate.current.locked) return;
    // Proposal, note and Find fields keep their own native text-edit history.
    const focused = document.activeElement;
    if (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) document.execCommand(forward ? 'redo' : 'undo');
    else doHistory(forward);
  }
  async function saveInstructions() {
    const p = projectRef.current; if (!p || aiBusy) return;
    const done = gate.current.begin('instructions'); if (!done) return;
    try { await window.editor.setPaperInstructions(p.id, paperInstructions); p.paperInstructions = paperInstructions; setSavedInstructions(paperInstructions); setStatus('Paper instructions saved'); }
    catch (e) { setError(errorText(e)); } finally { done(); }
  }
  function resizePane(index: number, pixels: number) {
    const width = workspace.current?.clientWidth ?? window.innerWidth;
    setPaneSizes(old => { const next = [...old], visibleSum = pdfOpen && width > 1250 ? 1 : old[0] + old[1], delta = pixels / width * visibleSum;
      const minimum = (i: number) => [220, 300, 300][i] / width * visibleSum;
      const bounded = Math.max(minimum(index) - old[index], Math.min(old[index + 1] - minimum(index + 1), delta)); next[index] += bounded; next[index + 1] -= bounded; return next; });
  }
  async function clearBuilds() {
    const done = gate.current.begin('cleanup'); if (!done) return;
    try { const result = await window.editor.clearOldBuilds([build?.id, candidateBuild?.id].filter((id): id is string => !!id)); setStatus(`Removed ${result.removed} older builds; kept current and recent PDFs`); }
    catch (e) { setError(errorText(e)); } finally { done(); }
  }
  function reviewRequest() {
    const captured = input(), selection = view.current?.state.selection.main;
    if (!captured || !selection) throw new Error('Open a paper first.');
    return { projectId: captured.projectId, text: captured.text, from: selection.empty ? 0 : selection.from, to: selection.empty ? captured.text.length : selection.to, instructions, requestId: crypto.randomUUID() };
  }
  function previewContext(reply = false) {
    try {
      const captured = input(); if (!captured) return;
      const payload = reply && active ? replyContext({ projectId: captured.projectId, text: captured.text, comment: active, message: active.replyDraft.trim() || deeperQuestion }, projectRef.current?.paperInstructions) : reviewContext(reviewRequest(), projectRef.current?.paperInstructions);
      setContextText(JSON.stringify(payload, null, 2)); setContextOpen(true);
    } catch (e) { setError(errorText(e)); }
  }
  async function startSections() {
    const captured = input(); if (!captured || aiBusy || effortBusy || paperInstructions !== savedInstructions) return;
    try { reviewSections(captured.text); } catch (e) { setError(errorText(e)); return; }
    const done = gate.current.begin('codex'); if (!done) return;
    setAiBusy(true); setError(''); setReviewOpen(false);
    const runner = new SectionReview({ request: request => {
      setContextText(JSON.stringify(reviewContext(request, projectRef.current?.paperInstructions), null, 2));
      return window.editor.requestReview(request);
    }, delivered: () => inbox.current!.refresh(), cancel: () => window.editor.cancelCodex(), changed: setSectionProgress });
    sectionRun.current = runner;
    try { await runner.run({ projectId: captured.projectId, text: captured.text, instructions }); }
    catch (e) { setError(errorText(e) + ' Completed sections remain available.'); }
    finally { sectionRun.current = null; setAiBusy(false); done(); }
  }
  async function requestReview() {
    const captured = input(), editor = view.current; if (!captured || !editor || aiBusy || effortBusy) return;
    const done = gate.current.begin('codex'); if (!done) return;
    setAiBusy(true); setError(''); setReviewOpen(false);
    try {
      const request = reviewRequest();
      setContextText(JSON.stringify(reviewContext(request, projectRef.current?.paperInstructions), null, 2));
      const added = await window.editor.requestReview(request);
      if (!gate.current.closing) { setStatus(`Codex returned ${added.length} comments`); await inbox.current!.refresh(); }
    } catch (e) { setError(errorText(e) + ' Completed review results are kept in .modern-editor/documents/<document-id>/reviews.'); setStatus('Codex review stopped'); } finally { setAiBusy(false); done(); }
  }
  async function discuss(deeper = false) {
    const captured = input(), c = captured?.review.comments.find(c => c.id === activeRef.current), runner = sectionRun.current;
    if (!captured || !c || (!deeper && !c.replyDraft.trim()) || effortBusy || discussionLock.current || gate.current.locked || (aiBusy && !runner?.canDiscuss)) return;
    let message: string;
    try { message = discussionMessage(deeper ? { ...c, replyDraft: deeperQuestion } : c); } catch (e) { setError(errorText(e)); return; }
    const done = runner ? null : gate.current.begin('codex'); if (!runner && !done) return;
    setError('');
    const userMessage = { role: 'user' as const, text: message, createdAt: new Date().toISOString() };
    if (!patch(c.id, { messages: [...c.messages, userMessage], ...(deeper ? {} : { replyDraft: '' }) })) { done?.(); return; }
    discussionLock.current = true; setDiscussionBusy(true); if (!runner) setAiBusy(true);
    const request = { projectId: captured.projectId, text: captured.text, comment: c, message, requestId: crypto.randomUUID(), deeper };
    const perform = async () => {
      await flush(); if (gate.current.closing || projectRef.current?.id !== captured.projectId) return;
      setContextText(JSON.stringify(replyContext(request, projectRef.current?.paperInstructions), null, 2));
      await window.editor.replyToComment(request);
      if (!gate.current.closing) { await inbox.current!.refresh(); setStatus('Codex replied · inspect suggested wording in the discussion'); }
    };
    try {
      if (runner) {
        setStatus('Question queued after the current section · its comment and draft context are kept');
        if (!await runner.interrupt(perform) && !gate.current.closing) setStatus('Queued question kept in its discussion; it was not sent.');
      } else await perform();
    } catch (e) { setError(errorText(e) + ' Returned answers are kept in .modern-editor/documents/<document-id>/reviews (JSON or rejected text).'); setStatus('Discussion stopped · your message is saved'); }
    finally { discussionLock.current = false; setDiscussionBusy(false); if (!runner) setAiBusy(false); done?.(); }
  }
  commandRef.current = command => { if (gate.current.locked || (compareOpen && ['undo', 'redo', 'find'].includes(command))) return; if (command === 'toolbar') setToolbarCollapsed(value => !value); if (command === 'open') void open(); if (command === 'save') void save(); if (command === 'compile') void compile(); if (command === 'pdf') togglePdf(); if (command === 'find') openFind(); if (command === 'undo' || command === 'redo') menuHistory(command === 'redo'); };
  const freshness = !build ? 'No PDF compiled yet' : dependencyStale || text !== pdfText ? 'PDF is older than the current source' : build.engine !== engine ? 'PDF uses a different LaTeX engine' : dirty ? 'PDF matches the current unsaved source' : 'PDF matches the current source';

  return <><main className="app-shell" aria-busy={locked} {...(locked ? { inert: '' } : {})}>
    <header className={`app-header unified-toolbar ${toolbarCollapsed ? 'collapsed' : ''}`}>
      <div className="brand-mark" title="Modern Editor">M</div><div className="file-name" title={project?.path}><strong>{project?.name ?? 'Modern Editor'}</strong>{project && <span className={dirty ? 'unsaved' : 'saved'}>{dirty ? 'Unsaved' : 'Saved'}</span>}</div>
      {!toolbarCollapsed && <div className="toolbar-actions">{project && <><button onClick={() => doHistory()} disabled={!canUndo || compareOpen}>Undo</button><button onClick={() => void save()}>Save</button><button onClick={() => setReviewOpen(v => !v)} disabled={aiBusy || busy || effortBusy || compareOpen}>Review with Codex</button><button className="primary" onClick={() => void compile()} disabled={busy}>{busy ? 'Compiling…' : 'Compile'}</button><button aria-pressed={pdfOpen} onClick={togglePdf}>PDF</button></>}
        <ActionMenu><div><strong>Paper</strong><button onClick={() => void open()} disabled={busy || aiBusy}>Open paper…</button><button onClick={() => void open(false, false, true)} disabled={busy || aiBusy}>New draft</button><button onClick={() => void open(true)} disabled={busy || aiBusy}>New sample</button><button onClick={() => void inspectRecovery()}>Recover source…</button>{project && <><button onClick={() => void exportSource()}>Export source…</button><button onClick={() => void importReview()} disabled={busy || aiBusy}>Import JSON…</button></>}</div>
          {project && <><div><strong>Writing</strong><button onClick={addAuthorComment} disabled={compareOpen}>Add comment to selection</button><button onClick={openFind} disabled={compareOpen}>Find…</button><button onClick={toggleComparison}>Compare versions…</button><button onClick={() => { setInboxOpen(true); void inbox.current!.refresh(); }}>Waiting Codex results…</button><button onClick={() => setContextOpen(true)}>Latest Codex context…</button><label>Codex effort<select aria-label="Codex effort" value={effort} disabled={aiBusy || busy || effortBusy} onChange={e => void changeEffort(e.target.value as Effort)}><option value="low">Quick</option><option value="medium">Standard</option><option value="high">Deep</option><option value="max">Max</option></select></label><label className="fast-mode-control"><span><input type="checkbox" aria-label="Fast mode" checked={fastMode} disabled={aiBusy || busy || effortBusy} onChange={e => void changeFastMode(e.target.checked)} /> Fast mode</span><small>Faster responses · increased usage</small></label></div>
          <div><strong>Compile &amp; layout</strong><label>LaTeX engine<select aria-label="LaTeX engine" value={engine} disabled={busy} onChange={e => void changeEngine(e.target.value as Engine)}><option value="pdflatex">pdfLaTeX</option><option value="lualatex">LuaLaTeX</option><option value="xelatex">XeLaTeX</option></select></label><button onClick={() => void addPreambleAndCompile()} disabled={busy || aiBusy || effortBusy || compareOpen || !text.trim()}>Add preamble and compile</button><button disabled={busy} title="Remove older cached PDFs. Other papers may need compiling again when reopened; source and saved reading positions are kept." onClick={() => void clearBuilds()}>Clear older builds</button><label><span><input type="checkbox" aria-label="PDF follows comments" checked={followComments} onChange={e => changeFollowing(e.target.checked)} /> PDF follows comments</span></label><button onClick={() => setPaneSizes([.28, .33, .39])}>Reset pane widths</button><button onClick={() => setToolbarCollapsed(true)}>Hide toolbar</button></div></>}
        </ActionMenu></div>}
      <button className="toolbar-toggle" aria-label={toolbarCollapsed ? 'Show toolbar' : 'Hide toolbar'} title="Show/hide toolbar · ⌘⇧M" onClick={() => setToolbarCollapsed(v => !v)}>{toolbarCollapsed ? 'Show controls ▾' : '⌃'}</button>
    </header>
    {recovery && <section className="source-recovery" aria-label="Source recovery export"><div className="recovery-heading"><strong>Recover source · {recovery.name}</strong><button className="icon" aria-label="Close source recovery" onClick={() => setRecovery(null)}>×</button></div><p>Inspect a source version and export it to a new file. The paper, review JSON and recovery records are preserved. Versions may conflict; no version is chosen as the newest automatically.</p>{recovery.notices.map((item, i) => <p key={i} className="error">{item}</p>)}{recovery.choices.length ? <><label>Source version <select aria-label="Recovery source version" value={recoveryChoice} onChange={e => setRecoveryChoice(Number(e.target.value))}>{recovery.choices.map((choice, i) => <option value={i} key={i}>{choice.label}</option>)}</select></label><textarea readOnly aria-label="Recovered source preview" value={recovery.choices[recoveryChoice]?.text ?? ''} /><button onClick={() => void exportSource(true)}>Export selected source…</button></> : <p>No readable source versions were found. Existing files were preserved.</p>}</section>}
    {!project ? <section className="welcome"><div className="eyebrow">WRITE. REVIEW. COMPILE.</div><h1>Your source, with a second pair of eyes.</h1><p>Work through comments beside the LaTeX, apply concrete suggestions, and inspect the compiled paper.</p><div className="welcome-actions"><button className="primary" onClick={() => void open()}>Open a LaTeX paper</button><button onClick={() => void open(false, false, true)}>New blank draft</button><button onClick={() => void open(true)}>Try the working sample</button></div><p className="muted">Your draft and saved comments are stored locally. When you request AI assistance, the relevant text, context and instructions are sent to Codex.</p>{error && <p role="alert" className="error">{error}</p>}{notice && <p role="status">{notice}</p>}</section> : <>

      {reviewOpen && <section className="review-request" aria-label="Request Codex review">
        <div className="request-heading"><strong>Review {view.current?.state.selection.main.empty ? 'this source file' : 'the selected passage'}</strong><button className="icon" aria-label="Close review request" onClick={() => setReviewOpen(false)}>×</button></div>
        <label>Instructions for this review<textarea maxLength={10000} value={instructions} onChange={e => setInstructions(e.target.value)} /></label>
        <details><summary>Saved paper instructions{paperInstructions !== savedInstructions ? ' · unsaved' : ''}</summary><p>Notation, assumptions and style preferences included in reviews and discussions for this document.</p><textarea aria-label="Paper instructions" maxLength={10000} value={paperInstructions} onChange={e => setPaperInstructions(e.target.value)} /><button disabled={aiBusy || paperInstructions === savedInstructions} onClick={() => void saveInstructions()}>Save paper instructions</button></details>
        <div className="request-actions"><button className="primary" disabled={aiBusy || paperInstructions !== savedInstructions} onClick={() => void requestReview()}>Start review</button><button disabled={aiBusy || paperInstructions !== savedInstructions} onClick={() => void startSections()}>Review section by section</button><button onClick={() => previewContext()}>Preview context sent to Codex</button></div>
        <p>Section review uses a fixed copy of this source, one section at a time. You may keep editing; results from an earlier draft wait for inspection. Pause finishes the current section; Stop cancels the remaining work.</p>
      </section>}
      {contextOpen && <section className="context-preview" aria-label="Codex context preview"><div className="recovery-heading"><strong>Codex context</strong><button className="icon" aria-label="Close Codex context" onClick={() => setContextOpen(false)}>×</button></div><p>This shows the latest preview or request. Starting a request updates it to the actual payload, including saved instructions and nearby source. No other paper files are attached by the editor.</p><pre tabIndex={0}>{contextText || 'Preview a review or discussion to see its context.'}</pre></section>}
      {sectionProgress && <div className="section-progress" role="status"><span>{sectionProgress.phase === 'complete' ? 'Section review complete' : `Section review · ${sectionProgress.phase.replaceAll('_', ' ')}`} · {sectionProgress.completed}/{sectionProgress.total} completed · {sectionProgress.label}</span>{sectionRun.current ? <>{['paused', 'pausing', 'discussion_queued', 'discussing'].includes(sectionProgress.phase) ? <button disabled={discussionBusy} title="Continue the remaining sections of the original review snapshot" onClick={() => sectionRun.current?.resume()}>Continue review</button> : <button disabled={sectionProgress.phase === 'stopping'} onClick={() => sectionRun.current?.pause()}>Pause after section</button>}<button disabled={sectionProgress.phase === 'stopping'} onClick={() => void sectionRun.current?.stop().catch(e => setError(errorText(e)))}>Stop review</button></> : <button className="icon" aria-label="Dismiss section progress" onClick={() => setSectionProgress(null)}>×</button>}</div>}
      {inboxOpen && <WaitingResults items={waiting} notices={waitingNotices} busy={inboxBusy} onHandle={(id, outcome) => void inbox.current!.handle(id, outcome)} onRefresh={() => void inbox.current!.refresh()} onClose={() => setInboxOpen(false)} />}
      {(waiting.length > 0 || waitingNotices.length > 0) && !inboxOpen && <button className="waiting-alert" onClick={() => setInboxOpen(true)}>{waiting.length} Codex results waiting · Inspect</button>}
      {notice && <div className="notice"><span>{notice}</span><button className="icon" aria-label="Dismiss notice" onClick={() => setNotice('')}>×</button></div>}
      {error && <div className="error-bar" role="alert"><span>{error}</span>{error.includes('another editor') && <button disabled={busy || aiBusy} onClick={() => void open(false, true)}>Reload disk</button>}<button className="icon" aria-label="Dismiss error" onClick={() => setError('')}>×</button></div>}
      {pdfNavigation && <div className="pdf-navigation" role="status"><span>{pdfNavigation.reason}</span>{pdfNavigation.target && <button disabled={busy || pdfLocating} onClick={() => void navigatePdf(pdfNavigation.target!, true)}>Compile and show</button>}<button className="icon" aria-label="Dismiss PDF navigation" onClick={cancelPdfNavigation}>×</button></div>}
      <div ref={workspace} className={`workspace ${pdfOpen ? 'with-pdf' : ''}`} style={{ ...(compareOpen ? { display: 'none' } : {}), '--source-fr': paneSizes[0] * 100 + 'fr', '--review-fr': paneSizes[1] * 100 + 'fr', '--pdf-fr': paneSizes[2] * 100 + 'fr' } as CSSProperties}>
        <section className="source-pane" aria-label="Source editor"><div className="pane-heading"><span>LaTeX source</span><button className="text-button" disabled={busy || pdfLocating} title="Show the source selection or cursor in the displayed PDF" onClick={() => showInPdf()}>{pdfLocating ? 'Locating…' : 'Show in PDF'}</button></div>{findOpen && <form className="source-search" aria-label="Find in source" onSubmit={e => { e.preventDefault(); find(); }} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); setFindOpen(false); view.current?.focus(); } if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); find(true); } }}><input ref={searchInput} aria-label="Find text in source" placeholder="Find exact text…" value={query} onChange={e => { setQuery(e.target.value); setFindNotice(''); }} /><button type="button" aria-label="Previous source match" onClick={() => find(true)}>↑</button><button type="submit" aria-label="Next source match">↓</button><span role="status">{findNotice}</span><button type="button" aria-label="Close source search" className="icon" onClick={() => { setFindOpen(false); view.current?.focus(); }}>×</button></form>}<div ref={host} className="editor-host" /></section>
        <PaneDivider label="Resize source and comments" onMove={delta => resizePane(0, delta)} />
        <aside className="review-rail" aria-label="Source comments" tabIndex={0} onKeyDown={event => {
          const action = reviewShortcut(event.nativeEvent, event.target);
          if (!action || busy || gate.current.locked) return;
          if (action === 'accept') { if (active?.decision !== 'open' || active.replacement === null || active.validity !== 'current') return; event.preventDefault(); void compile(active.id, event.currentTarget); }
          else if (action === 'dismiss') { if (!active) return; event.preventDefault(); finishComment(active.replacement === null ? 'resolved' : 'dismissed'); }
          else { event.preventDefault(); move(action === 'previous' ? -1 : 1); }
        }}>
          <div className="review-heading"><strong>Comments</strong><button className="text-button" aria-expanded={overviewOpen} onClick={() => setOverviewOpen(v => !v)}>Overview</button><button className="text-button" aria-pressed={laterOnly} onClick={showLater}>Later ({laterCount})</button><button className="text-button" onClick={() => showReviewHistory(!historyRef.current)}>{showHistory ? 'Pending' : 'History'}</button></div>
          {overviewOpen && <CommentOverview comments={comments} activeId={activeId} onChoose={c => { historyRef.current = c.decision !== 'open'; setShowHistory(historyRef.current); laterRef.current = c.decision === 'open' && c.later; setLaterOnly(laterRef.current); choose(c.id, true, true); }} />}
          <nav className="review-nav"><button aria-label="Previous comment" onClick={() => move(-1)} disabled={!visible.length}>← Previous</button><span>{visible.length && visible.some(c => c.id === activeId) ? `${visible.findIndex(c => c.id === activeId) + 1} of ${visible.length}` : 'Complete'}</span><button aria-label="Next comment" onClick={() => move(1)} disabled={!visible.length}>Next →</button></nav>
          {active ? <article className="comment-card"><h1>{active.title}</h1><p className="explanation">{active.explanation}</p>
            {active.validity !== 'current' && active.decision === 'open' && <div className="stale-notice"><p>{active.validity === 'unconfirmed' ? 'Check placement: this comment needs confirmation because its source context changed.' : `The passage is ${active.validity}.`} This suggestion cannot be applied yet.</p><p>Select the exact original words in the source, then confirm their placement.</p><button onClick={confirmPassage} disabled={busy}>Attach to selected text</button></div>}
            <div className="original-passage"><div id="original-label">Original</div><pre aria-labelledby="original-label" tabIndex={0}>{active.original}</pre></div>
            {active.replacement !== null ? <><label htmlFor="replacement">Proposed replacement</label><textarea id="replacement" maxLength={100000} spellCheck={false} value={active.draft ?? active.replacement} onChange={e => patch(active.id, { draft: e.target.value })} disabled={active.decision !== 'open'} /><ProposalPreview text={text} comment={active} /><div className="comment-actions"><button className="primary" title="Accept and next · Shift+A while focused on comments" aria-keyshortcuts="Shift+A Alt+Enter" disabled={busy || active.decision !== 'open' || active.validity !== 'current'} onClick={() => void compile(active.id)}>{busy ? 'Checking…' : 'Accept and next'}</button><button title="Skip · Shift+S while focused on comments" aria-keyshortcuts="Shift+S Alt+ArrowRight" onClick={() => move(1)} disabled={busy}>Skip</button><button disabled={busy || active.decision !== 'open' || active.validity !== 'current'} onClick={() => void acceptWithoutCompile(active.id)} title="Apply the suggestion and listed packages without running LaTeX, then move to the next comment.">Accept without compiling</button></div><p className="action-help">Accept and next checks compilation. Both acceptance actions are undoable; Save writes the source.</p></> : <div className="question-note">A question for the author · no source replacement</div>}
            <div className="secondary-actions">{active.decision === 'open' && <button className="text-button" aria-pressed={active.later} onClick={markLater}>{active.later ? 'Return to pending' : 'Later'}</button>}<button className="text-button" onClick={() => finishComment(active.replacement === null ? 'resolved' : 'dismissed')} disabled={active.decision !== 'open'}>{active.replacement === null ? 'Resolve' : 'Dismiss'}</button>{active.decision === 'open' && active.replacement !== null && <button className="text-button" onClick={() => finishComment('resolved')}>Mark addressed manually</button>}{['dismissed', 'resolved'].includes(active.decision) && <button className="text-button" onClick={() => { if (patch(active.id, { decision: 'open' }, true)) { historyRef.current = false; setShowHistory(false); choose(active.id); } }}>Reopen</button>}<span className="passage-links"><button className="text-button" title="Go to this comment’s passage in the source" onClick={() => choose(active.id)}>Source</button><span aria-hidden="true">·</span><button className="text-button" aria-label="Show comment in PDF" disabled={busy || pdfLocating || active.validity !== 'current'} title="Show this comment’s current passage in the displayed PDF" onClick={() => showInPdf(active)}>PDF</button></span><button className="text-button" onClick={() => setNotesOpen(v => !v)}>{notesOpen ? 'Hide discussion' : 'Discuss'}</button><button className="text-button" disabled={discussionBusy || effortBusy || (aiBusy && !sectionRun.current?.canDiscuss)} title="Ask Codex to reconsider this comment with high effort. Your draft stays unchanged." onClick={() => { setNotesOpen(true); void discuss(true); }}>Think more</button><button className="text-button" onClick={() => previewContext(true)}>Context…</button></div>
            {(notesOpen || active.messages.length > 0) && <div className="discussion"><h2>Discuss this comment</h2>{active.messages.map((m, i) => <DiscussionMessage key={i} message={m} comment={active} onUse={proposal => {
              if (patch(active.id, { replacement: proposal.replacement, draft: undefined, packages: proposal.packages }, true)) {
                setStatus('Proposal updated · Accept changes the paper; Undo restores your previous proposal');
                requestAnimationFrame(() => {
                  if (activeRef.current !== active.id) return;
                  // Keep review Undo/shortcuts active until the author chooses a text field.
                  document.querySelector<HTMLElement>('.review-rail')?.focus({ preventScroll: true });
                  document.getElementById('replacement')?.scrollIntoView({ block: 'center' });
                });
              }
            }} />)}<label htmlFor="reply">Your reply or note</label><textarea id="reply" maxLength={100000} value={active.replyDraft} onChange={e => patch(active.id, { replyDraft: e.target.value })} placeholder="Ask for an explanation or a different suggestion…" /><button className="primary" disabled={!active.replyDraft.trim() || discussionBusy || effortBusy || (aiBusy && !sectionRun.current?.canDiscuss)} onClick={() => void discuss()}>{discussionBusy ? 'Question in progress…' : sectionRun.current && sectionProgress?.phase !== 'paused' ? 'Ask after this section' : 'Ask Codex'}</button> <button disabled={!active.replyDraft.trim()} onClick={() => patch(active.id, { messages: [...active.messages, { role: 'user', text: active.replyDraft.trim(), createdAt: new Date().toISOString() }], replyDraft: '' })}>Save note</button><p className="action-help">Use this wording updates the proposal and can be undone. Accept changes the paper; Save writes the source.</p></div>}
          </article> : <div className="empty-comments"><h2>{laterOnly ? 'No comments for later' : visible.length ? 'Choose a comment' : 'No pending comments'}</h2><p>Request a Codex review or import saved comments to work through suggestions beside the source.</p><button onClick={() => setReviewOpen(true)} disabled={aiBusy || busy || effortBusy || compareOpen}>Review with Codex</button></div>}
        </aside>
        {pdfOpen && <PaneDivider label="Resize comments and PDF" extraClass="pdf-divider" onMove={delta => resizePane(1, delta)} />}
        {pdfOpen && <PdfPane jump={pdfJump} build={viewCandidate ? candidateBuild : build} freshness={viewCandidate ? 'Candidate PDF · suggestion snapshot · this check did not apply it' : freshness} position={viewCandidate ? candidatePosition : pdfPosition} onPositionChange={change => (viewCandidate ? setCandidatePosition : setPdfPosition)(previous => ({ ...previous, ...change }))} onUserNavigate={cancelPdfNavigation} onClose={() => { cancelPdfNavigation(); setPdfOpen(false); }} />}
      </div>
      {compareOpen && <ComparePane projectId={project.id} onSavedVersion={compareSavedVersion} position={comparisonPosition.current} baseline={baseline} text={text} dirty={dirty} pending={comparisonBusy} onChoose={() => void keepComparison()} onPin={name => void keepComparison(name)} onReturn={returnToSource} />}
      {candidateBuild && <div className="candidate-actions"><span>Suggestion compiled with warnings; source unchanged by this check.</span><button onClick={() => { cancelPdfNavigation(); setViewCandidate(!viewCandidate); setPdfOpen(true); }}>{viewCandidate ? 'Show source PDF' : 'View candidate PDF'}</button></div>}
      {lastAttempt && (!lastAttempt.success || lastAttempt.diagnostics.length > 0) && <details className="build-diagnostics" open={!lastAttempt.success}><summary>Build details · {lastAttempt.diagnostics.length} messages</summary><div>{lastAttempt.diagnostics.map((d, i) => <button key={i} onClick={() => { if (d.line && view.current && (!d.file || d.file === project.name)) { const line = view.current.state.doc.line(Math.min(d.line, view.current.state.doc.lines)); view.current.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from) }); view.current.focus(); } }}>{d.file}{d.line ? `:${d.line} ` : ''}{d.message}</button>)}<details><summary>Full build output</summary><pre>{lastAttempt.log}</pre></details></div></details>}
      <footer><span role="status">{status}</span><span>{pending.length} open · {comments.filter(c => c.decision === 'applied').length} applied</span><span className="footer-pdf">{build ? freshness : 'Comments saved separately in JSON'}</span>{preambleBusy ? <button onClick={() => void cancelPreamble()}>Cancel preamble</button> : <>{busy && <button onClick={() => void window.editor.cancelBuild()}>Cancel compilation</button>}{aiBusy && !sectionRun.current && <button onClick={() => void window.editor.cancelCodex()}>Cancel Codex</button>}</>}</footer>
    </>}
  </main>{locked && <div className="work-barrier" role="status">{gate.current.closing ? 'Finishing pending work and saving recovery before closing…' : gate.current.committing ? 'Recording changes…' : 'Opening paper…'}</div>}</>;
}
