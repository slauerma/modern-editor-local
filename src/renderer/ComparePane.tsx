import { useLayoutEffect, useRef, useState } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers, drawSelection } from '@codemirror/view';
import { StreamLanguage, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { MergeView, unifiedMergeView, getChunks, type Chunk } from '@codemirror/merge';
import type { Baseline } from '../shared/contracts.ts';
import { comparisonText, comparisonDiffConfig } from './comparison.ts';
import { VersionHistoryPanel } from './VersionHistoryPanel.tsx';

export type ComparisonPosition = { baselineHash?: string; anchor?: number; scrollTop?: number; mode?: 'split' | 'inline'; collapse?: boolean };
type Props = { projectId: string; onSavedVersion(id:string):Promise<void>; baseline: Baseline | null; text: string; dirty: boolean; pending: boolean; position: ComparisonPosition;
  onPin(name: string): void; onChoose(): void; onReturn(position?: number): void };
export function ComparePane({ projectId, onSavedVersion, baseline, text, dirty, pending, position, onPin, onChoose, onReturn }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<'split' | 'inline'>(position.mode ?? 'split'), [collapse, setCollapse] = useState(position.collapse ?? true), [setupOpen, setSetupOpen] = useState(!baseline);
  const [name, setName] = useState('Before revisions'), [count, setCount] = useState(0), [selected, setSelected] = useState(0), [coarse, setCoarse] = useState(false);
  const [historyOpen,setHistoryOpen]=useState(false);
  const current = useRef<EditorView | null>(null), original = useRef<EditorView | null>(null), changes = useRef<readonly Chunk[]>([]);
  function reveal(index: number) {
    const list = changes.current; if (!list.length) return;
    index = (index + list.length) % list.length; setSelected(index);
    const chunk = list[index];
    position.anchor = chunk.fromB;
    for (const [view, position] of [[original.current, chunk.fromA], [current.current, chunk.fromB]] as const) {
      if (!view) continue;
      const at = Math.min(position, view.state.doc.length);
      view.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: 'center' }) });
    }
  }
  useLayoutEffect(() => {
    if (!host.current || !baseline) return;
    const extensions = (label: string) => [EditorState.readOnly.of(true), EditorView.editable.of(false),
      // Also block mutation commands invoked programmatically, not just typing.
      EditorState.transactionFilter.of(tr => tr.docChanged ? [] : tr),
      lineNumbers(), drawSelection(), EditorView.lineWrapping, StreamLanguage.define(stex), syntaxHighlighting(defaultHighlightStyle),
      EditorView.contentAttributes.of({ 'aria-label': label, tabindex: '0', 'aria-readonly': 'true' })];
    const config = { highlightChanges: true, gutter: true, diffConfig: comparisonDiffConfig, collapseUnchanged: collapse ? { margin: 3, minSize: 8 } : undefined };
    let destroy: () => void;
    if (mode === 'split') {
      const merge = new MergeView({ parent: host.current, a: { doc: comparisonText(baseline.text), extensions: extensions('Comparison version source') }, b: { doc: text, extensions: extensions('Current draft comparison') }, ...config });
      original.current = merge.a; current.current = merge.b; changes.current = merge.chunks; destroy = () => merge.destroy();
    } else {
      const view = new EditorView({ parent: host.current, doc: text, extensions: [extensions('Current draft comparison'), unifiedMergeView({ original: comparisonText(baseline.text), mergeControls: false, allowInlineDiffs: false, ...config })] });
      original.current = null; current.current = view; changes.current = getChunks(view.state)?.chunks ?? []; destroy = () => view.destroy();
    }
    const saved = position.baselineHash === baseline.sourceHash ? { ...position } : {};
    const anchor = Math.min(saved.anchor ?? 0, text.length);
    const index = Math.max(0, changes.current.findIndex(c => c.toB >= anchor));
    setCount(changes.current.length); setCoarse(changes.current.some(c => !c.precise)); setSelected(index);
    const scroller = mode === 'split' ? host.current.querySelector<HTMLElement>('.cm-mergeView')! : current.current!.scrollDOM;
    const frame = requestAnimationFrame(() => {
      if (saved.mode === mode && saved.collapse === collapse && saved.scrollTop !== undefined) scroller.scrollTop = saved.scrollTop;
      else if (saved.anchor !== undefined && current.current) current.current.dispatch({ effects: EditorView.scrollIntoView(anchor, { y: 'center' }) });
      else reveal(0);
    });
    return () => { cancelAnimationFrame(frame); Object.assign(position, { baselineHash: baseline.sourceHash, mode, collapse, scrollTop: scroller.scrollTop }); destroy(); original.current = null; current.current = null; changes.current = []; };
  }, [baseline?.sourceHash, text, mode, collapse]);
  return <section className="compare-pane" aria-label="Compare document versions">
    <div className="compare-heading"><div><strong>Compare versions</strong><p>{baseline ? <>Pinned: <b>{baseline.name}</b> · {new Date(baseline.createdAt).toLocaleString()}</> : 'Choose an original version, or keep the current draft before revising it.'}</p></div><button aria-expanded={historyOpen} onClick={()=>setHistoryOpen(v=>!v)}>Save history…</button><button aria-expanded={setupOpen} onClick={() => setSetupOpen(v => !v)}>Baseline…</button><button onClick={() => onReturn()}>Back to editing</button></div>
    {historyOpen&&<VersionHistoryPanel key={projectId} projectId={projectId} onCompare={onSavedVersion} />}
    {(setupOpen || !baseline) && <div className="compare-setup"><button disabled={pending} onClick={onChoose}>Choose older .tex file…</button><label>Snapshot name <input aria-label="Comparison snapshot name" maxLength={200} value={name} onChange={e => setName(e.target.value)} /></label><button disabled={pending || !name.trim()} onClick={() => onPin(name)}>Keep current draft as baseline</button><span>{pending ? 'Keeping comparison version…' : 'Save keeps this baseline fixed.'}</span></div>}
    {baseline ? <><div className="compare-controls"><div className="compare-modes" role="group" aria-label="Comparison layout"><button aria-pressed={mode === 'split'} onClick={() => setMode('split')}>Side by side</button><button aria-pressed={mode === 'inline'} onClick={() => setMode('inline')}>Inline</button></div><label><input type="checkbox" checked={collapse} onChange={e => setCollapse(e.target.checked)} /> Collapse unchanged text</label><button disabled={!count} onClick={() => reveal(selected - 1)}>← Previous change</button><span role="status">{count ? `Change ${selected + 1} of ${count}` : 'No text changes'}</span><button disabled={!count} onClick={() => reveal(selected + 1)}>Next change →</button><button disabled={!count} onClick={() => onReturn(Math.min(changes.current[selected]?.fromB ?? 0, text.length))}>Go to source</button></div>
      <div className={`compare-labels ${mode}`}><span title={baseline.sourcePath ?? 'Snapshot of the editor buffer'}>− {baseline.name}</span><span>+ Current draft · {dirty ? 'includes unsaved edits' : 'saved'}</span></div>
      {coarse && <div className="compare-note">Large changes are shown in broader blocks to keep comparison responsive. All source text is still included.</div>}
      <div ref={host} className={`comparison-host ${mode}`} />
      <div className="compare-note">Read-only comparison of this root file. Line endings and the UTF-8 BOM are normalized for display. Compilation is not required.</div>
    </> : <div className="compare-empty"><h2>Keep a reference for your revisions</h2><p>A baseline is a separate, frozen copy. Manual edits and accepted Codex suggestions will both appear here, including changes to the preamble.</p><p>Choosing another baseline keeps the previous copy in this document’s comparison-versions folder.</p></div>}
  </section>;
}
