import { useLayoutEffect, useRef, useState } from 'react';
import { Annotation, ChangeSet, EditorState } from '@codemirror/state';
import { EditorView, drawSelection } from '@codemirror/view';
import { getChunks, getOriginalDoc, originalDocChangeEffect, unifiedMergeView } from '@codemirror/merge';
import { comparisonDiffConfig } from './comparison.ts';

const refresh = Annotation.define<boolean>();
type Props = { original: string; text: string; visible: boolean; focusKey?: string; focusAt?: number };

export function TextDiffPane({ original, text, visible, focusKey, focusAt }: Props) {
  const host = useRef<HTMLDivElement>(null), editor = useRef<EditorView | null>(null);
  const [count, setCount] = useState(0), [selected, setSelected] = useState(0), [coarse, setCoarse] = useState(false);
  function measure() { const chunks = editor.current ? getChunks(editor.current.state)?.chunks ?? [] : []; setCount(chunks.length); setCoarse(chunks.some(c => !c.precise)); }
  function reveal(index: number) {
    const view = editor.current, chunks = view ? getChunks(view.state)?.chunks ?? [] : [];
    if (!view || !chunks.length) return;
    index = (index + chunks.length) % chunks.length; setSelected(index);
    view.dispatch({ effects: EditorView.scrollIntoView(Math.min(chunks[index].fromB, view.state.doc.length), { y: 'center' }) });
  }
  useLayoutEffect(() => {
    if (!host.current) return;
    const view = new EditorView({ parent: host.current, doc: text, extensions: [
      EditorState.readOnly.of(true), EditorView.editable.of(false), drawSelection(), EditorView.lineWrapping,
      EditorState.transactionFilter.of(tr => tr.docChanged && !tr.annotation(refresh) ? [] : tr),
      EditorView.contentAttributes.of({ 'aria-label': 'Read-only text diff', 'aria-readonly': 'true', tabindex: '0' }),
      unifiedMergeView({ original, mergeControls: false, allowInlineDiffs: true, highlightChanges: true, gutter: true, diffConfig: comparisonDiffConfig })
    ] });
    editor.current = view; measure();
    return () => { view.destroy(); editor.current = null; };
  }, []);
  useLayoutEffect(() => {
    const view = editor.current; if (!view) return;
    const previous = getOriginalDoc(view.state), changed = view.state.doc.toString() !== text;
    view.dispatch({ changes: changed ? { from: 0, to: view.state.doc.length, insert: text } : undefined,
      effects: previous.toString() !== original ? originalDocChangeEffect(view.state, ChangeSet.of({ from: 0, to: previous.length, insert: original }, previous.length)) : [],
      annotations: refresh.of(true) });
    measure(); setSelected(0);
  }, [text, original]);
  useLayoutEffect(() => {
    const view = editor.current; if (!visible || !view) return;
    view.requestMeasure();
    if (focusAt !== undefined) view.dispatch({ effects: EditorView.scrollIntoView(Math.min(focusAt, view.state.doc.length), { y: 'center' }) });
  }, [visible, focusKey]);
  return <div className="text-diff-pane" hidden={!visible} aria-label="Text changes">
    <div className="text-diff-controls"><button disabled={!count} onClick={() => reveal(selected - 1)}>← Previous</button><span role="status">{count ? `${Math.min(selected + 1, count)} of ${count} changes` : 'No text changes'}</span><button disabled={!count} onClick={() => reveal(selected + 1)}>Next →</button></div>
    {coarse && <p className="compare-note">Large changes are grouped into broader blocks. All text is included.</p>}
    <div className="text-diff-host" ref={host} />
  </div>;
}
