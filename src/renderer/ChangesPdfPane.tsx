import { traceInteraction } from './debug-interactions.ts';
import { useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import type { ChangesArtifact, ChangesInput, ChangesPresentation } from '../shared/changes-pdf.ts';
import { changesUpdateDue, defaultChangesEvery } from '../shared/changes-agent.ts';
import type { PdfJump, PdfPosition } from './pdf-position.ts';
import { PdfPane, type PdfChangeTarget, type PdfPaneHandle } from './PdfPane.tsx';
import { comparisonScreenshots } from './comparison-screenshots.ts';

type Props = { onExport: (buildId: string) => void; onExportSource: (artifactId: string) => void; onExportReady: (pdf: { id: string; label: string } | null) => void; findHandle?: Ref<PdfPaneHandle>; input: ChangesInput; reasonsKey?: string; visible: boolean; disabled: boolean; proposalCurrent: boolean; previewRequest?: number;
  events: { accepted: number; saved: number };
  work: <T>(kind: 'build' | 'arrange', action: () => Promise<T>) => Promise<T>;
  baselineControl: ReactNode; onFormat: (format: 'pdf' | 'text') => void;
  onClose: () => void; onSource: (from: number, to: number) => void; onText: () => void };
type Snapshot = { key: string; proposal?: string; last: ChangesPresentation; values: Partial<Record<ChangesPresentation, ChangesArtifact>>; agentNotice?: string };
const errorText = (e: unknown) => String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': Error: /, '');
const label = (p: ChangesPresentation) => p === 'clean' ? 'Clean paper' : 'Revision markup';

export function ChangesPdfPane({ onExport, onExportSource, onExportReady, findHandle, input, reasonsKey, visible, disabled, proposalCurrent, previewRequest, events, work, baselineControl, onFormat, onClose, onSource, onText }: Props) {
  const identity = useMemo(() => JSON.stringify([input.projectId, input.before, input.after, input.name, input.engine, input.proposalId, input.selectedPaths, reasonsKey]), [input.projectId, input.before, input.after, input.name, input.engine, input.proposalId, input.selectedPaths, reasonsKey]);
  const [presentation, setPresentation] = useState<ChangesPresentation>('markup');
  const key = JSON.stringify([identity, presentation]);
  const [saved, setSaved] = useState<Snapshot | null>(null);
  const [selected, setSelected] = useState(0), [noteOpen, setNoteOpen] = useState(false);
  const [message, setMessage] = useState(''), [error, setError] = useState(''), [working, setWorking] = useState(false);
  const [elapsed, setElapsed] = useState(0), started = useRef(0);
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => setElapsed(Math.floor((performance.now() - started.current) / 1000)), 500);
    return () => clearInterval(timer);
  }, [working]);
  const [every, setEvery] = useState(defaultChangesEvery), [settingsReady, setSettingsReady] = useState(false), [paused, setPaused] = useState(false), [refreshRequest, setRefreshRequest] = useState(0);
  const [position, setPosition] = useState<PdfPosition>({ page: 1, zoom: 1 }), [jump, setJump] = useState<PdfJump | null>(null);
  const [noteTarget, setNoteTarget] = useState<PdfChangeTarget | null>(null);
  const bottomOverlay = useRef<HTMLDivElement>(null), toolbar = useRef<HTMLDivElement>(null);
  const workRef = useRef(work); workRef.current = work;
  const request = useRef(0), mounted = useRef(true), job = useRef<{ key: string; cancelled: boolean; kind: 'build' | 'arrange' | null } | null>(null);
  const current = useRef({ key, visible, proposalCurrent }); current.current = { key, visible, proposalCurrent };
  const cursor = useRef({ ...events }), attempted = useRef(''), attemptedStyle = useRef(''), entry = useRef(0), wasVisible = useRef(false);
  const requestedStyle = useRef<ChangesPresentation | null>(null);
  const consumedRefresh = useRef(0);
  if (visible && !wasVisible.current) entry.current++;
  wasVisible.current = visible;
  const trigger = JSON.stringify([input.projectId, input.before, input.name, input.engine, input.proposalId, previewRequest, entry.current, refreshRequest]);
  function stop() {
    const active = job.current; if (!active || active.cancelled) return;
    active.cancelled = true; request.current++; setJump(null); setNoteTarget(null);
    if (active.kind) void (active.kind === 'build' ? window.editor.cancelBuild() : window.editor.cancelCodex()).catch(() => {});
  }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current++; stop(); }; }, []);
  useEffect(() => {
    // Navigation can still be waiting after generation has finished. Hiding or
    // changing the comparison invalidates it even when we own no worker job.
    request.current++; setJump(null); setNoteTarget(null);
    // Late-result rejection protects the PDF, but also stop work that can no
    // longer be used. Only the job currently owned by this pane is cancelled.
    if (job.current && (!visible || !proposalCurrent || job.current.key !== key)) stop();
  }, [visible, proposalCurrent, key]);
  useEffect(() => { let live = true;
    void window.editor.changesSettings().then(s => { if (live) setEvery(s.every); }).catch(e => { if (live) setError(errorText(e)); }).finally(() => { if (live) setSettingsReady(true); });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    const changed = (event: Event) => { const value = (event as CustomEvent<number>).detail; if (Number.isInteger(value) && value >= 1 && value <= 50) setEvery(value); };
    window.addEventListener('changes-settings-updated', changed);
    return () => window.removeEventListener('changes-settings-updated', changed);
  }, []);
  const snapshot = saved?.proposal === input.proposalId ? saved : null;
  // Keep the previous PDF while compiling another presentation, with its actual
  // label. Never imply that one style has the other's visual-check result.
  const artifact = snapshot?.values[presentation] ?? (snapshot ? snapshot.values[snapshot.last] : undefined);
  const [invalidSnapshot, setInvalidSnapshot] = useState('');
  const fresh = invalidSnapshot !== snapshot?.key && !!artifact && snapshot?.key === identity && artifact.presentation === presentation && proposalCurrent;
  useEffect(() => {
    onExportReady(artifact?.build ? { id: artifact.build.id, label: (fresh ? '' : 'Older preview · ') + label(artifact.presentation) + (input.proposalId ? ' · not applied' : '') } : null);
    return () => onExportReady(null);
  }, [artifact?.build?.id, artifact?.presentation, fresh, input.proposalId, onExportReady]);
  useEffect(() => {
    if (!visible || !artifact?.build || disabled || working) return;
    let disposed = false, checking = false;
    const inspect = async () => {
      if (checking) return; checking = true;
      try { const result = await window.editor.inspectChanges(input.projectId, artifact.id); if (!disposed && ['changed','unavailable'].includes(result.status)) setInvalidSnapshot(snapshot!.key); }
      catch { if (!disposed) setInvalidSnapshot(snapshot!.key); }
      finally { checking = false; }
    };
    void inspect(); const timer = setInterval(() => void inspect(), 10000);
    window.addEventListener('focus', inspect);
    return () => { disposed = true; clearInterval(timer); window.removeEventListener('focus', inspect); };
  }, [visible, artifact?.id, snapshot?.key, disabled, working, input.projectId]);
  const selectedChange = artifact?.changes[Math.min(selected, artifact.changes.length - 1)];
  const selection = useRef({ change: selectedChange, index: selected });
  selection.current = { change: selectedChange, index: selected };
  const blocked = disabled || working || !proposalCurrent;

  async function show(index: number, value = artifact, expectedKey = key) {
    if (!value) return;
    traceInteraction('changes-navigate', { projectId: input.projectId, mode: String(index + 1) });
    setSelected(index); setJump(null); setNoteTarget(null);
    const c = value.changes[index], id = ++request.current;
    if (!c) return;
    if (!value.build) { setNoteOpen(true); return; }
    try {
      const location = await window.editor.locateChange(input.projectId, value.id, c.id);
      if (!mounted.current || !current.current.visible || id !== request.current || current.current.key !== expectedKey) return;
      // Every comparison change owns a measured PDF destination, including
      // omitted/deleted text. Do not highlight SyncTeX's approximate line.
      if (location.kind === 'mapped') setNoteTarget({ buildId: value.build.id, id: c.id, requestId: id });
      else setMessage(location.reason);
    } catch (e) { if (mounted.current && id === request.current) setMessage(errorText(e)); }
  }
  async function generate(styleOnly = false, force = false, localOnly = false) {
    if (job.current || blocked || styleOnly && !artifact) return;
    const active = { key, cancelled: false, kind: null as 'build' | 'arrange' | null }; job.current = active;
    const began = performance.now(); let completed = false;
    requestedStyle.current = null;
    const expected = key, captured = { ...input, presentation };
    const alive = () => mounted.current && !active.cancelled && current.current.visible && current.current.proposalCurrent && current.current.key === expected;
    const run = <T,>(kind: 'build' | 'arrange', action: () => Promise<T>) => workRef.current(kind, async () => {
      if (!alive()) throw new Error('Comparison cancelled.');
      active.kind = kind;
      try { return await action(); }
      finally { active.kind = null; } // Clear ownership before the shared gate is released.
    });
    const explicit = force || refreshRequest !== consumedRefresh.current;
    if (styleOnly) attemptedStyle.current = JSON.stringify([snapshot?.key, presentation]);
    else { attempted.current = trigger; cursor.current = { ...events }; consumedRefresh.current = refreshRequest; }
    traceInteraction('changes-refresh', { projectId: input.projectId, mode: styleOnly ? 'presentation' : explicit ? 'manual' : 'scheduled', outcome: 'started' });
    started.current = began; setElapsed(0); setWorking(true); setError('');
    setMessage('Checking comparison…');
    try {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      if (!alive()) return;
      // A no-op Save or re-entry is not a new analysis request. Recheck the
      // actual resource snapshot before reusing source- and reason-bound work.
      if (!styleOnly && !explicit && fresh && artifact) {
        const valid = !artifact.build || (await window.editor.inspectChanges(input.projectId, artifact.id)).status === 'valid';
        if (!alive()) return;
        if (valid) { completed = true; return; }
      }
      setJump(null); setNoteTarget(null); request.current++;
      setMessage('Waiting to prepare the local PDF…');
      const local = await run('build', () => {
        setMessage('Preparing ' + label(presentation).toLowerCase() + ' locally…');
        return styleOnly ? window.editor.presentChanges(input.projectId, artifact!.id, presentation) : window.editor.buildChanges(captured);
      });
      if (!alive()) return;
      // IDs are ordinal and can change when an earlier paragraph is edited.
      // Keep the reader's latest selection, including navigation during this
      // refresh. Match only an unambiguous surviving source pair, never an ID.
      function publish(value: ChangesArtifact, agentNotice?: string) {
        const latest = selection.current;
        const matches = latest.change ? value.changes.flatMap((c, i) => c.oldText === latest.change!.oldText && c.newText === latest.change!.newText ? [i] : []) : [];
        const index = matches.length === 1 ? matches[0] : latest.change ? Math.min(latest.index, Math.max(0, value.changes.length - 1)) : Math.max(0, value.changes.findIndex(c => c.layout !== 'omitted'));
        const next: Snapshot = styleOnly
          ? { ...snapshot!, last: presentation, values: { ...snapshot!.values, [presentation]: value } }
          : { key: identity, proposal: input.proposalId, last: presentation, values: { [presentation]: value }, agentNotice };
        setSaved(next); setSelected(index); if (!styleOnly) setInvalidSnapshot('');
        return { next, index, first: !latest.change };
      }
      // Publish the verified local PDF before requesting a model. Keep current
      // explanations during a no-change refresh until their replacements arrive.
      const retained = fresh && artifact?.build?.id === local.build?.id && !!local.build && !styleOnly && !localOnly;
      const initial = retained ? null : publish(local, localOnly ? 'Built locally without Sol.' : undefined);
      if (!snapshot) setNoteOpen(false);
      completed = true;
      if (initial?.first && local.build && initial.next.key === identity) await show(initial.index, local, expected);
      if (styleOnly || localOnly || !local.build || !alive()) return;
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      if (!alive()) return;
      let value: ChangesArtifact;
      try {
        setMessage('Local PDF ready · waiting for Sol…');
        const plan = await run('arrange', () => {
          setMessage('Local PDF ready · Sol is adding explanations; this may take a few minutes…');
          return window.editor.planChanges(captured);
        });
        if (!alive()) return;
        if (!plan.id) return;
        setMessage('Preparing Sol’s comparison…');
        value = await run('build', () => window.editor.buildChanges({ ...captured, arrangementId: plan.id }));
        if (!alive()) return;
      } catch (e) {
        if (alive()) publish(local, 'Sol analysis unavailable. The local comparison remains available with recorded reasons. ' + errorText(e));
        return;
      } finally { active.kind = null; }
      const { next } = publish(value);
      if (value.build && value.visual?.status === 'requested' && alive()) {
        setMessage('Sol requested a visual check of the comparison…');
        try {
          const screenshots = await comparisonScreenshots(value.build.id, value.visual.pages, alive);
          if (!alive()) return;
          await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
          if (!alive()) return;
          const visual = await run('arrange', () => window.editor.checkChangesVisual(input.projectId, value.id, screenshots));
          if (!alive()) return;
          setSaved({ ...next, values: { [presentation]: { ...value, visual } } });
        } catch (e) {
          if (alive()) setSaved({ ...next, values: { [presentation]: { ...value, visual: { ...value.visual, status: 'unavailable', issues: [errorText(e)] } } } });
        }
      }
    } catch (e) {
      if (alive()) { setError(errorText(e)); if (!styleOnly && snapshot) setInvalidSnapshot(snapshot.key); }
    } finally {
      traceInteraction('changes-refresh', { projectId: input.projectId, mode: styleOnly ? 'presentation' : explicit ? 'manual' : 'scheduled', outcome: !alive() ? 'cancelled' : completed ? 'complete' : 'error', elapsedMs: performance.now() - began });
      active.kind = null; if (job.current === active) job.current = null;
      if (mounted.current) { setWorking(false); setMessage(active.cancelled ? 'Changes PDF update stopped.' : current.current.key !== expected ? 'The draft changed during generation. Refresh or wait for the next scheduled update.' : ''); }
    }
  }
  useEffect(() => {
    if (!visible || blocked || !settingsReady) return;
    if (!paused && (attempted.current !== trigger || changesUpdateDue(cursor.current, events, every))) { void generate(); return; }
    // Re-present the same snapshot even when typing made it older. Switching
    // style never reviews new text or restarts the accepted-change count.
    if (requestedStyle.current === presentation && snapshot && artifact && !snapshot.values[presentation] && attemptedStyle.current !== JSON.stringify([snapshot.key, presentation])) void generate(true);
  }, [visible, blocked, settingsReady, paused, trigger, events.accepted, events.saved, every, presentation, snapshot, artifact]);

  function choosePresentation(p: ChangesPresentation) {
    if (blocked || p === presentation) return;
    request.current++; setJump(null); setNoteTarget(null); setError(''); requestedStyle.current = p; setPresentation(p); attemptedStyle.current = '';
  }
  const changes = artifact?.changes ?? [], notes = changes.filter(c => c.omissionKind === 'source-only').length;
  const omitted = changes.filter(c => c.layout === 'omitted' && c.omissionKind !== 'source-only').length;
  const waiting = visible && disabled && !working && settingsReady && !paused && (attempted.current !== trigger || changesUpdateDue(cursor.current, events, every));
  return <div className="changes-pdf-pane" hidden={!visible} aria-busy={working} data-artifact={artifact?.id} data-presentation={artifact?.presentation}>
    {visible && <div className="changes-toolbar" role="toolbar" aria-label="Changes PDF controls">
      <select className="changes-format" aria-label="Viewer format" title={label(presentation)} value={presentation === 'clean' ? 'changes-clean' : 'changes'} onChange={e => {
        const value = e.target.value;
        if (value === 'pdf' || value === 'text') onFormat(value);
        else choosePresentation(value === 'changes-clean' ? 'clean' : 'markup');
      }}>
        <option value="pdf">PDF</option><option value="text">Text diff</option>
        <optgroup label="Changes PDF"><option value="changes" disabled={blocked}>Revision markup</option><option value="changes-clean" disabled={blocked}>Clean paper</option></optgroup>
      </select>
      <div className="change-navigation" role="group" aria-label="Navigate changes">
        <button aria-label="Previous change" title="Previous change" onClick={() => void show(Math.max(0, selected - 1))} disabled={!fresh || !changes.length || selected === 0}>‹</button>
        {changes.length ? <select aria-label="Comparison change" title={'Change ' + (Math.min(selected, changes.length - 1) + 1) + ' of ' + changes.length} value={Math.min(selected, changes.length - 1)} disabled={!fresh} onChange={e => void show(Number(e.target.value))}>
          {changes.map((c, i) => <option key={c.id} value={i}>{i + 1} / {changes.length}{c.omissionKind === 'source-only' ? ' · source note' : c.layout === 'omitted' ? ' · not shown' : ''}</option>)}
        </select> : <span className="change-count" title={working ? 'Comparing…' : 'No changes'}>–</span>}
        <button aria-label="Next change" title="Next change" onClick={() => void show(Math.min(changes.length - 1, selected + 1))} disabled={!fresh || !changes.length || selected >= changes.length - 1}>›</button>
      </div>
      <div ref={toolbar} className="pdf-toolbar-slot changes-pdf-tools" /><button className="change-details-toggle text-button" aria-label={noteOpen ? 'Hide explanation' : 'Explain change'} title="Reason for this change" aria-expanded={noteOpen} onClick={() => { traceInteraction('changes-why', { projectId: input.projectId, mode: noteOpen ? 'close' : 'open' }); setNoteOpen(!noteOpen); }}>Why?</button>
      <button className={'changes-refresh' + (!fresh && !working ? ' primary' : '')} aria-label="Refresh Changes PDF" title="Refresh Changes PDF with Sol" onClick={() => { setPaused(false); setRefreshRequest(n => n + 1); }} disabled={blocked}>↻</button>
      <details className="changes-options" onKeyDown={e => { if (e.key === 'Escape') { e.currentTarget.open = false; e.currentTarget.querySelector('summary')?.focus(); e.stopPropagation(); } }}><summary aria-label="Comparison options" title="Save comparison, baseline and update settings">⋯</summary><div>
        <button disabled={!artifact?.build?.success} title="Save the displayed comparison, including an older snapshot. Numbered buttons and explanations are available only in the editor." onClick={e => { if (artifact?.build) { e.currentTarget.closest('details')?.removeAttribute('open'); onExport(artifact.build.id); } }}>Save Changes PDF…</button>
        <button disabled={!artifact?.build?.success} title="Save the generated source for the displayed comparison to a new .tex file. Figures, bibliography and other project resources are not copied." onClick={e => { if (artifact?.build) { e.currentTarget.closest('details')?.removeAttribute('open'); onExportSource(artifact.id); } }}>Save comparison LaTeX…</button>
        {baselineControl}
        <label>Update after <select aria-label="Accepted changes per update" value={every} disabled={working} onChange={e => { const n = Number(e.target.value); void window.editor.changesSettings(n).then(s => setEvery(s.every)).catch(e => setError(errorText(e))); }}>{[1,3,5,10,20,50].map(n => <option key={n} value={n}>{n}</option>)}</select> accepts, and on Save.</label>
        <button disabled={blocked} onClick={() => void generate(false, true, true)}>Build locally without Sol</button>
        <p>The local PDF appears first. Sol then adds explanations and may inspect page images, using your Codex account. Keep reading while it works.</p>
        <p>Unchanged Save and reopen reuse the comparison after checking its inputs. Refresh requests new Sol analysis; identical generated PDFs are reused after resource checks. Switching presentation is local.</p>
        <p>Typing alone does not start an update. Changing the draft or hiding this view stops work that is no longer current. Save, Refresh or the next batch of accepts updates it.</p>
        <p>Compares root source using current project resources, not historical figures or included files.</p>
        <p>{artifact?.visual?.status === 'checked' ? 'Sol visually checked pages ' + artifact.visual.pages.join(', ') + ' in this presentation.' : artifact?.visual?.status === 'not-requested' ? 'Sol did not request a visual check.' : artifact?.visual?.issues.join(' ') || 'This presentation has not been visually checked by Sol.'}</p>
        <button onClick={() => { if (!paused) stop(); else if (!fresh) setRefreshRequest(n => n + 1); setPaused(!paused); }}>{paused ? 'Resume updates' : 'Pause updates'}</button>
      </div></details>
      <button className="icon" aria-label="Hide viewer" title="Hide viewer" onClick={onClose}>×</button>
    </div>}
    <div ref={bottomOverlay} className="changes-bottom">
      {(working || waiting || !!message || artifact && !fresh || paused || !!omitted || !!notes) && <div className="changes-agent-status">
        <span role="status">{working ? message + ' · ' + elapsed + 's' : waiting ? 'Waiting for the current operation…' : artifact && !fresh ? 'Older comparison · Refresh to update' : paused ? 'Updates paused' : message}</span>
        {!!(omitted + notes) && <button className="text-button omitted-changes" onClick={() => { const index = changes.findIndex(c => c.layout === 'omitted'); setSelected(index); setNoteOpen(true); if (fresh) void show(index); }}>{[omitted ? omitted + ' not shown' : '', notes ? notes + (notes === 1 ? ' source note' : ' source notes') : ''].filter(Boolean).join(' · ')}</button>}
        {working && <button className="text-button" onClick={() => { stop(); setPaused(true); }}>Stop</button>}
      </div>}
    {artifact && artifact.presentation !== presentation && <p className="changes-pdf-notice">Showing {label(artifact.presentation).toLowerCase()} while {label(presentation).toLowerCase()} is unavailable.</p>}
    {snapshot?.agentNotice && <p className="changes-pdf-notice">Local comparison <button className="text-button" onClick={() => setNoteOpen(true)}>Details</button></p>}
    {artifact?.notice && <p role="status" className="changes-pdf-notice">{artifact.notice}</p>}
    {artifact?.visual && ['problem', 'unavailable'].includes(artifact.visual.status) && <p className="changes-pdf-notice">{artifact.visual.status === 'problem' ? 'Sol found a presentation problem.' : 'Visual check incomplete.'} <button className="text-button" onClick={() => setNoteOpen(true)}>Details</button></p>}
    {error && <div role="alert" className="changes-pdf-error">{error}<button onClick={onText}>Show exact text diff</button></div>}
    {noteOpen && <section className="change-detail" aria-label="Comparison details" key={selectedChange?.id}>
      <div className="change-detail-heading"><strong>Why this change?</strong><button className="icon" aria-label="Close explanation" onClick={() => setNoteOpen(false)}>×</button></div>
      {selectedChange && <div className="change-explanation">
        {selectedChange.reasons.map((r, i) => <p className="change-reason" key={i}>{r.text}<small>{r.origin === 'proposal' ? 'Proposal explanation' : 'Recorded acceptance reason'}{r.edited ? ' · edited since suggested' : ''}</small></p>)}
        {!selectedChange.reasons.length && <p className="comparison-context">No reason was recorded for this change.</p>}
        {selectedChange.summary && <p><strong>Sol summary:</strong> {selectedChange.summary}</p>}
        {selectedChange.omission && <p><strong>{selectedChange.omissionKind === 'source-only' ? 'Source note.' : 'Change not shown.'}</strong> {selectedChange.omission}</p>}
        <details className="change-source-details"><summary>Compare LaTeX source</summary><div className="change-wording"><div><strong>Before</strong><pre>{selectedChange.oldText || 'No earlier text (addition).'}</pre></div><div><strong>After</strong><pre>{selectedChange.newText || 'Passage deleted.'}</pre></div></div></details>
        {!input.proposalId && <button disabled={!fresh} onClick={() => onSource(selectedChange.fromB, selectedChange.toB)}>Show in source</button>}
      </div>}
      <p className="comparison-context">{input.name} → {input.proposalId ? 'proposed draft · not applied' : 'current draft, including unsaved edits'}{!fresh ? ' · older comparison' : ''}</p>
      {snapshot?.agentNotice && <p>{snapshot.agentNotice}</p>}
      {artifact?.visual && ['problem', 'unavailable'].includes(artifact.visual.status) && <p>{artifact.visual.issues.join(' ')}</p>}
    </section>}
    </div>
    {(!artifact?.build && !error) && <div className="changes-pdf-empty" role="status">
      <strong>{working ? 'Preparing Changes PDF…' : artifact && fresh ? changes.length ? notes === changes.length ? 'Source notes only' : 'Preview not possible' : 'No source changes.' : 'Changes preview'}</strong>
      <p>{working ? 'Preparing the local comparison. Your draft stays unchanged.' : artifact && fresh ? changes.length ? notes === changes.length ? 'Only LaTeX source notes changed. Read their exact wording in Text diff; there is no visible passage to mark.' : 'These changes cannot be marked safely in this PDF view. Their exact differences are available in Text diff.' : 'The current draft matches ' + input.name + '.' : 'Request Refresh for a local comparison, followed by Sol explanations and optional visual inspection.'}</p>
      {!working && !!changes.length && <button onClick={onText}>Show exact text diff</button>}
    </div>}
    <PdfPane onExport={() => { if (artifact?.build) onExport(artifact.build.id); }} toolbarHost={toolbar} compactControls findHandle={findHandle} bottomOverlay={bottomOverlay} changeTarget={fresh ? noteTarget : null} visible={visible && !!artifact?.build} build={artifact?.build ?? null} freshness={fresh ? input.proposalId ? 'Not applied' : label(artifact!.presentation) : 'Older preview'} position={position}
      hideState={fresh && !input.proposalId} onFind={() => setNoteOpen(false)} followComments={false} hideFollow hideClose onFollowChange={() => {}} jump={fresh ? jump : null} onPositionChange={change => setPosition(p => ({ ...p, ...change }))}
      onUserNavigate={() => { request.current++; setJump(null); setNoteTarget(null); }} onClose={onClose}
      showChangeNotes={fresh && noteOpen} changeIds={fresh ? changes.map(c => c.id) : []} onChangeNote={id => { const index = fresh ? changes.findIndex(c => c.id === id) : -1; if (index >= 0) { setSelected(index); setNoteOpen(true); } }} />
  </div>;
}
