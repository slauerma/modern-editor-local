import { EditorState, Transaction, type TransactionSpec } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import { diff } from '@codemirror/merge';

// A paste may replace an entire paragraph/document although most bytes are
// unchanged. Represent ordinary user replacements by their actual differences,
// so CodeMirror can map comments, selections and Undo through unchanged spans.
export const sourceEditMapping = EditorState.transactionFilter.of(tr => {
  const event = tr.annotation(Transaction.userEvent);
  if (!tr.docChanged || tr.effects.length || (event !== 'input.paste' && event !== 'input.type')) return tr;
  const changes: { from: number; to: number; insert: string }[] = [];
  let refined = false;
  tr.changes.iterChanges((from, to, _newFrom, _newTo, inserted) => {
    const before = tr.startState.doc.sliceString(from, to), after = inserted.toString();
    if (before.length < 32 || after.length < 32) { changes.push({ from, to, insert: after }); return; }
    const parts = diff(before, after, { scanLimit: 500 });
    if (parts.length !== 1 || parts[0].fromA !== 0 || parts[0].toA !== before.length || parts[0].fromB !== 0 || parts[0].toB !== after.length) refined = true;
    for (const part of parts) changes.push({ from: from + part.fromA, to: from + part.toA, insert: after.slice(part.fromB, part.toB) });
  });
  if (!refined) return tr;
  const add = tr.annotation(Transaction.addToHistory), remote = tr.annotation(Transaction.remote), isolation = tr.annotation(isolateHistory);
  return {
    changes, selection: tr.newSelection, scrollIntoView: tr.scrollIntoView,
    annotations: [Transaction.userEvent.of(event), Transaction.time.of(tr.annotation(Transaction.time)!),
      ...(add === undefined ? [] : [Transaction.addToHistory.of(add)]),
      ...(remote === undefined ? [] : [Transaction.remote.of(remote)]),
      ...(isolation === undefined ? [] : [isolateHistory.of(isolation)])]
  } satisfies TransactionSpec;
});
