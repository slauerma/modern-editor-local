import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Comment, Engine } from '../shared/contracts.ts';
import { inlineEdits, type ComparisonChange } from '../shared/changes-pdf.ts';
import { PdfPane, type PdfChangeTarget, type PdfPaneHandle, type PdfSourcePoint } from './PdfPane.tsx';
import type { PdfPosition } from './pdf-position.ts';
import { pdfReviewChangeState, pdfReviewOwners, pdfReviewPlan, pdfReviewScopes, pdfReviewScopeIds, pdfReviewTentative, pdfReviewRegion, type PdfReviewSession } from './pdf-review-plan.ts';
import { usePdfReviewBuild, type PdfReviewWork } from './use-pdf-review-build.ts';
import { InfoHint } from './CommentDetails.tsx';
import './pdf-review.css';

export type PdfReviewExports = {
  projectId: string; sessionId: string; fresh: boolean; right: 'proposed' | 'original'; pending: number;
  changes?: string; proposed?: string; original?: string;
};
type Props = {
  onOutline(): void;
  onPdfSource(point: PdfSourcePoint, snapshot: { text: string; title: string }): void;
  session: PdfReviewSession; projectId: string; text: string; comments: Comment[]; engine: Engine; selectedPaths?: string[];
  visible: boolean; disabled: boolean; activeId: string | null; inspector: ReactNode; work: PdfReviewWork;
  onSelect(id: string): void; onClose(): void; onRestart(): void; onExport(id: string): void; onExportSource(artifactId: string): void;
  onDecide(ids: string[], decision: 'applied' | 'dismissed' | 'resolved', mode: 'individual' | 'bulk'): Promise<boolean>;
  onDiscuss(): void; onUndo(): void; canUndo: boolean; onSource(id: string): void;
  onBuilds(ids: string[]): void;
  onExportReady(value: PdfReviewExports | null): void;
};
const startPosition: PdfPosition = { page: 1, zoom: 1 };
export function PdfReviewMode(props: Props) {
  const { session, projectId, text, comments, engine, selectedPaths, visible, disabled, work } = props;
  const planned = useMemo(() => {
    try { return { value: pdfReviewPlan(session, text, comments), error: '' }; }
    catch (e) { return { value: null, error: String(e instanceof Error ? e.message : e) }; }
  }, [session, text, comments]);
  const plan = planned.value;
  const [right, setRight] = useState<'proposed' | 'original'>('proposed');
  const [style, setStyle] = useState<'markup' | 'clean'>('markup');
  const [scopeId, setScopeId] = useState('all'), [open, setOpen] = useState(false), [expanded, setExpanded] = useState(false), [editing, setEditing] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const popup = useRef<HTMLElement>(null);
  const [leftPosition, setLeftPosition] = useState<PdfPosition>(startPosition);
  const [positions, setPositions] = useState({ original: startPosition, proposed: startPosition });
  const [target, setTarget] = useState<PdfChangeTarget | null>(null), navigation = useRef(0);
  const [selectedChange, setSelectedChange] = useState<ComparisonChange | null>(null), [ownerIds, setOwnerIds] = useState<string[]>([]);
  const leftToolbar = useRef<HTMLDivElement>(null), rightToolbar = useRef<HTMLDivElement>(null);
  const leftFind = useRef<PdfPaneHandle>(null), rightFind = useRef<PdfPaneHandle>(null), focusedPane = useRef<'left' | 'right'>('left');
  const built = usePdfReviewBuild({ projectId, before: session.original, after: plan?.text ?? text, name: 'PDF review original', engine, selectedPaths, presentation: style, interactive: true }, visible && !!plan, editing, work);
  const { value, fresh } = built;
  const scopes = useMemo(() => pdfReviewScopes(session.original), [session.original]);
  const scope = scopes.find(s => s.id === scopeId) ?? scopes[0];
  const scoped = new Set(pdfReviewScopeIds(session, scope));
  const members = plan?.members ?? [], active = selectedChange && !ownerIds.length ? undefined : members.find(c => c.id === props.activeId);
  const scopedMembers = members.filter(c => scoped.has(c.id));
  const scopedIndex = scopedMembers.findIndex(c => c.id === active?.id);
  const remaining = scopedMembers.filter(c => c.decision === 'open' && c.replacement !== null && !c.later);
  const pending = members.filter(c => plan?.applicable.includes(c.id)).length;
  const acceptIds = remaining.filter(c => plan?.applicable.includes(c.id)).map(c => c.id);
  const blocked = disabled || built.busy;
  const changes = value?.changes?.changes ?? [];
  const tentative = useMemo(() => plan ? pdfReviewTentative(changes, session, plan) : [], [changes, session, plan]);
  const regionStates = useMemo(() => Object.fromEntries(changes.flatMap(c => (inlineEdits(c.oldText, c.newText) ?? []).map((_, i) => [c.id + ':' + i, plan ? pdfReviewChangeState(pdfReviewRegion(c, i), session, plan) : 'Manual/unlinked change']))), [changes, session, plan]);
  const changeStates = useMemo(() => Object.fromEntries(changes.map(c => {
    const states = (inlineEdits(c.oldText, c.newText) ?? []).map((_, i) => regionStates[c.id + ':' + i]);
    const related = plan && pdfReviewOwners(c, session, plan).length;
    return [c.id, states.length && states.every(s => s === states[0]) ? states[0] : states.length && states.every(s => ['Accepted', 'Tentative', 'Mixed'].includes(s)) ? 'Mixed' : related ? 'Related suggestion' : 'Manual/unlinked change'];
  })), [changes, regionStates, session, plan]);
  const original = value?.original ?? null, proposed = value?.proposed ?? null;
  const artifact = value?.changes;
  const visualProblem = artifact?.visual && ['problem', 'unavailable'].includes(artifact.visual.status)
    ? artifact.visual.status === 'problem' ? 'Sol found a presentation problem.' : 'Visual check incomplete.' : '';
  useEffect(() => {
    props.onBuilds([original?.id, proposed?.id, artifact?.build?.id].filter((id): id is string => !!id));
    return () => props.onBuilds([]);
  }, [original?.id, proposed?.id, artifact?.build?.id, props.onBuilds]);
  useEffect(() => {
    props.onExportReady({ projectId, sessionId: session.id, fresh, right, pending,
      changes: artifact?.build?.success ? artifact.build.id : undefined,
      proposed: proposed?.success ? proposed.id : undefined, original: original?.success ? original.id : undefined });
    return () => props.onExportReady(null);
  }, [projectId, session.id, fresh, right, pending, artifact?.build?.id, artifact?.build?.success, proposed?.id, proposed?.success, original?.id, original?.success, props.onExportReady]);
  useEffect(() => { setEditing(false); }, [props.activeId, open]);
  useEffect(() => {
    navigation.current++; setTarget(null); setSelectedChange(null); setOwnerIds([]);
  }, [value?.key, artifact?.id, fresh]);
  useEffect(() => {
    if (!visible) return;
    const find = () => (focusedPane.current === 'left' ? leftFind : rightFind).current?.find();
    window.addEventListener('pdf-review-find', find);
    return () => window.removeEventListener('pdf-review-find', find);
  }, [visible]);
  function inspect(id: string, fromChange = false) {
    if (!fromChange) { setSelectedChange(null); setOwnerIds([]); }
    props.onSelect(id); setOpen(true);
    requestAnimationFrame(() => popup.current?.focus({ preventScroll: true }));
  }
  function change(c: ComparisonChange, jump = false) {
    if (!fresh || !plan) return;
    const owners = pdfReviewOwners(c, session, plan);
    setSelectedChange(c); setOwnerIds(owners);
    if (owners.length) { if (!scoped.has(owners[0])) setScopeId('all'); inspect(owners[0], true); } else setOpen(true);
    if (jump && artifact?.build) setTarget({ buildId: artifact.build.id, id: c.id, requestId: ++navigation.current });
  }
  async function decide(ids: string[], decision: 'applied' | 'dismissed' | 'resolved', mode: 'individual' | 'bulk' = 'individual') {
    if (blocked || !ids.length) return;
    if (await props.onDecide(ids, decision, mode)) setOpen(false);
  }
  const extra = comments.filter(c => c.decision === 'open' && !session.comments.some(s => s.id === c.id)).length;
  return <section className="pdf-review-mode" hidden={!visible} aria-label="PDF review mode">
    <div className="pdf-review-commandbar">
      <button onClick={props.onClose}>Workspace</button>
      <button onClick={props.onOutline}>Outline</button>
      <select aria-label="Review scope" value={scope.id} onChange={e => { setScopeId(e.target.value); setOpen(false); setSelectedChange(null); setOwnerIds([]); }}>
        {scopes.map(s => <option key={s.id} value={s.id}>{s.level > 2 ? '↳ ' : ''}{s.label}</option>)}
      </select>
      <select aria-label="PDF review comment" value={active && scoped.has(active.id) ? active.id : ''} onChange={e => { setSelectedChange(null); setOwnerIds([]); inspect(e.target.value); }}>
        <option value="" disabled>Suggestions ({scopedMembers.length})</option>
        {scopedMembers.map(c => <option key={c.id} value={c.id}>{c.decision === 'resolved' ? 'Resolved · ' : c.decision === 'dismissed' ? 'Rejected · ' : c.replacement === null ? 'Question · ' : c.decision === 'applied' ? 'Accepted · ' : 'Tentative · '}{c.title}</option>)}
      </select>
      <button onClick={() => { setSelectedChange(null); setOwnerIds([]); const chosen = scopedMembers[scopedIndex] ?? scopedMembers[0]; if (chosen) inspect(chosen.id); }} disabled={!scopedMembers.length}>Inspect</button>
      <div className="pdf-review-queue"><button aria-label="Previous review suggestion" disabled={scopedIndex <= 0} onClick={() => inspect(scopedMembers[scopedIndex - 1].id)}>‹</button><span>{scopedIndex < 0 ? '–' : scopedIndex + 1} / {scopedMembers.length}</span><button aria-label="Next review suggestion" disabled={!scopedMembers.length || scopedIndex >= scopedMembers.length - 1} onClick={() => inspect(scopedMembers[scopedIndex + 1].id)}>›</button></div>
      <button onClick={() => void decide(acceptIds, 'applied', 'bulk')} disabled={blocked || !acceptIds.length} title="Compile and apply applicable suggestions in this scope as one Undo action, even if only one remains. Suggestions with missing or changed passages are excluded.">Accept all applicable ({acceptIds.length})</button>
      <button onClick={() => void decide(remaining.map(c => c.id), 'dismissed', 'bulk')} disabled={blocked || !remaining.length} title="Reject remaining suggestions in this scope, even with missing passages. Kept in History; Undo restores the batch. Questions are retained.">Reject all remaining ({remaining.length})</button>
      <details className="pdf-review-options"><summary aria-label="PDF review options">⋯</summary><div>
          <select aria-label="PDF review change" value={selectedChange?.id ?? ''} disabled={!fresh || !changes.length} onChange={e => { const c = changes.find(c => c.id === e.target.value); if (c) change(c, true); }}>
            <option value="" disabled>{changes.length} marked passages</option>{changes.map((c, i) => <option key={c.id} value={c.id}>{i + 1}{c.layout === 'omitted' ? ' · not shown inline' : ''}</option>)}
          </select>
        <button disabled={!artifact?.build?.success} title="Save the displayed Changes PDF, including an older snapshot. Numbered buttons, gray tentative cues and comments are available only in the editor." onClick={e => { if (artifact?.build) { e.currentTarget.closest('details')?.removeAttribute('open'); props.onExport(artifact.build.id); } }}>Save Changes PDF…</button>
        <button disabled={!artifact?.build?.success} title="Save the generated comparison source to a new .tex file. Figures, bibliography and other project resources are not copied." onClick={e => { if (artifact?.build) { e.currentTarget.closest('details')?.removeAttribute('open'); props.onExportSource(artifact.id); } }}>Save comparison LaTeX…</button>
        <button disabled={blocked} onClick={() => built.refresh(true)}>Refine comparison with Sol</button>
        <button disabled={blocked} onClick={props.onRestart}>Restart from current draft{extra ? ' · ' + extra + ' new comments' : ''}</button>
        <details><summary>About these PDFs</summary><p>The original is the draft captured when this session started. Changes keeps accepted and tentative edits; rejected edits stay in History. Faint gray behind an inline edit means tentative; other layouts use a gray marker. Hover a marker for Tentative, Accepted or Mixed. These live cues are not part of exported PDFs. Save writes the current draft, not unaccepted proposals. Contextual overlap is labelled Related suggestion; it does not establish who made an edit.</p>
        <p>Sections come from the original LaTeX headings. A section includes its subsections. Crossing edits and questions remain for individual review.</p>
        <p>Uses current project resources. Newly arriving comments join the workspace; restart this PDF session to include them and capture a new original.</p>
        <p>Sol can advise on layout and request a visual check. This takes time and uses your Codex account. Ordinary updates are local.</p>
        <p>{artifact?.visual?.status === 'checked' ? 'Sol visually checked pages ' + artifact.visual.pages.join(', ') + '.' : artifact?.visual?.status === 'not-requested' ? 'Sol did not request a visual check.' : artifact?.visual?.issues.join(' ') || 'This presentation has not been visually checked by Sol.'}</p>
        {proposed?.diagnostics.map((d, i) => <p key={i}>{d.message}</p>)}</details>
      </div></details>
      <button aria-label="Refresh PDF review" title="Refresh all PDF snapshots locally" disabled={blocked} onClick={() => built.refresh()}>↻</button>
    </div>
    <div className="pdf-review-papers">
      <section className="pdf-review-left" aria-label="Changes PDF" onFocusCapture={() => { focusedPane.current = 'left'; }}>
        <div className="pdf-review-heading"><select aria-label="PDF review presentation" value={style} disabled={blocked} onChange={e => setStyle(e.target.value as typeof style)}><option value="markup">Changes</option><option value="clean">Clean with markers</option></select>
<div ref={leftToolbar} className="pdf-toolbar-slot" /></div>
        <PdfPane toolbarHost={leftToolbar} compactControls findHandle={leftFind} hideState hideFollow hideClose
          visible={visible} build={artifact?.build ?? null} freshness={fresh ? pending ? 'Whole proposed revision · includes tentative suggestions' : 'Changes from the session original' : 'Earlier review snapshot'}
          position={leftPosition} onPositionChange={p => setLeftPosition(old => ({ ...old, ...p }))} followComments={false} onFollowChange={() => {}}
          changeIds={fresh ? changes.map(c => c.id) : []} showChangeNotes={fresh} changeTarget={fresh ? target : null}
          changeStates={changeStates} regionStates={regionStates} tentativeRegions={tentative} onChangeRegion={(id, index) => { const c = changes.find(c => c.id === id); if (c) change(pdfReviewRegion(c, index)); }}
          onChangeNote={id => { const c = changes.find(c => c.id === id); if (c) change(c); }}
          onUserNavigate={() => setTarget(null)} onClose={props.onClose} onExport={artifact?.build ? () => props.onExport(artifact.build!.id) : undefined} />
        {!artifact?.build && <div className="pdf-review-empty">{built.busy ? 'Preparing Changes PDF…' : built.error || planned.error ? 'Preview not possible · see build details below.' : built.status ? built.status : value ? session.original === plan?.text ? 'No differences from the original.' : 'Preview not possible · see build details below.' : 'Preparing the whole proposed revision…'}</div>}
      </section>
      <section className="pdf-review-right" aria-label="Reference PDF" onFocusCapture={() => { focusedPane.current = 'right'; }}>
        <div className="pdf-review-heading"><select aria-label="Right PDF" value={right} onChange={e => setRight(e.target.value as typeof right)}><option value="proposed">Proposed revision</option><option value="original">Original</option></select><InfoHint label={right === 'original' ? 'original snapshot' : 'proposed revision'}>{right === 'original' ? 'Draft captured when this PDF review session started. It may differ from the file on disk.' : 'Current draft plus applicable tentative suggestions. Accept edits the draft; Reject removes an unapplied suggestion. Save writes the current draft, not unaccepted proposals.'}</InfoHint><div ref={rightToolbar} className="pdf-toolbar-slot" /></div>
        <PdfPane toolbarHost={rightToolbar} compactControls findHandle={rightFind} hideState hideFollow hideClose visible={visible}
          onSource={value ? point => props.onPdfSource(point, { text: right === 'original' ? value.before : value.after, title: right === 'original' ? 'Original source' : 'Proposed source' }) : undefined}
          build={right === 'proposed' ? proposed : original} freshness={fresh ? right === 'proposed' ? pending ? 'Whole proposed revision · includes tentative suggestions' : 'Proposed PDF · no tentative suggestions' : 'Original draft captured for PDF review' : 'Earlier review snapshot'}
          position={positions[right]} onPositionChange={p => setPositions(old => ({ ...old, [right]: { ...old[right], ...p } }))} followComments={false} onFollowChange={() => {}}
          onUserNavigate={() => {}} onClose={props.onClose} onExport={(right === 'proposed' ? proposed : original) ? () => props.onExport((right === 'proposed' ? proposed : original)!.id) : undefined} />
      </section>
    </div>
    {(built.status || built.error || planned.error || value?.problem || artifact?.notice || visualProblem || value && !fresh || !!plan?.excluded.length) && <div className="pdf-review-status" role={built.error || planned.error ? 'alert' : 'status'}>
      {built.status || built.error || planned.error || value?.problem || (value && !fresh ? 'Preview out of date · Refresh before relying on it' : '')}
      {artifact?.notice && <span>{artifact.notice}</span>}
      {visualProblem && <details><summary>{visualProblem}</summary>{artifact?.visual?.issues.join(' ')}</details>}
      {!!plan?.excluded.length && <details><summary>{plan.excluded.length} suggestions not included</summary>{plan.excluded.map(c => <button key={c.id} onClick={() => inspect(c.id)}>{c.title} · {c.validity !== 'current' ? c.validity : 'overlapping, Later or incomplete'}</button>)}</details>}
      {built.busy && <button onClick={built.stop}>Stop</button>}
    </div>}
    {open && <section ref={popup} className={'pdf-review-inspector' + (expanded ? ' expanded' : '')} role="dialog" aria-label="PDF comment inspector" tabIndex={-1}
      style={expanded ? undefined : { transform: 'translate(' + offset.x + 'px,' + offset.y + 'px)' }}
      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } }}
      onFocusCapture={e => setEditing(e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement)}
      onBlurCapture={e => { if (!e.currentTarget.contains(e.relatedTarget)) setEditing(false); }}>
      <div className="pdf-review-inspector-heading" onPointerDown={e => {
        if (expanded || (e.target as Element).closest('button,select')) return;
        const rect = e.currentTarget.parentElement!.getBoundingClientRect();
        drag.current = { x: e.clientX, y: e.clientY, left: rect.left, top: rect.top }; e.currentTarget.setPointerCapture(e.pointerId);
      }} onPointerMove={e => {
        if (!drag.current || expanded) return;
        const rect = e.currentTarget.parentElement!.getBoundingClientRect(), d = drag.current;
        const x = Math.max(8, Math.min(window.innerWidth - rect.width - 8, d.left + e.clientX - d.x));
        const y = Math.max(64, Math.min(window.innerHeight - 80, d.top + e.clientY - d.y));
        setOffset(old => ({ x: old.x + x - rect.left, y: old.y + y - rect.top }));
      }} onPointerUp={() => { drag.current = null; }}>
        <span>Comment{active ? ' · ' + (active.decision === 'open' ? 'Tentative' : active.decision === 'applied' ? 'Accepted' : active.decision === 'dismissed' ? 'Rejected' : 'Resolved') : ''}</span>
        <button aria-label={expanded ? 'Shrink inspector' : 'Expand inspector'} onClick={() => { setExpanded(v => !v); setOffset({ x: 0, y: 0 }); }}>{expanded ? 'Shrink' : 'Expand'}</button>
        <button aria-label="Close inspector" onClick={() => setOpen(false)}>×</button>
      </div>
      {ownerIds.length > 1 && <select aria-label="Comments in this change" value={active?.id ?? ownerIds[0]} onChange={e => props.onSelect(e.target.value)}>{ownerIds.map(id => <option key={id} value={id}>{members.find(c => c.id === id)?.title ?? id}</option>)}</select>}
      <div className="pdf-review-inspector-body">
        {selectedChange && plan && pdfReviewChangeState(selectedChange, session, plan) === 'Related suggestion' && <p>Related suggestion · this passage overlaps the comment; later manual edits may also be present.</p>}
        {selectedChange?.omission && <p>{selectedChange.omission}</p>}
        {selectedChange && !ownerIds.length ? <><p>This difference has no suggestion in this review session.</p><pre>{selectedChange.oldText}</pre><pre>{selectedChange.newText}</pre></> : props.inspector}
      </div>
      <div className="pdf-review-inspector-actions">
        <button disabled={blocked || !active || active.decision !== 'open' || active.replacement !== null && active.validity !== 'current'} onClick={() => active && void decide([active.id], active.replacement === null ? 'resolved' : 'applied')}>{active?.replacement === null ? 'Resolve' : 'Accept'}</button>
        <button disabled={blocked || !active || active.decision !== 'open'} onClick={() => active && void decide([active.id], 'dismissed')}>Reject</button>
        <button disabled={!active} onClick={props.onDiscuss}>Discuss</button>
        <button disabled={!props.canUndo || blocked} onClick={props.onUndo}>Undo</button>
        <button disabled={!active} onClick={() => active && props.onSource(active.id)}>Source</button>
        <button onClick={() => setOpen(false)}>Back to PDFs</button>
      </div>
    </section>}
  </section>;
}
