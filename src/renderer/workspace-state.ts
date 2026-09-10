import type { EditorView } from '@codemirror/view';
import type { WorkspaceState } from '../shared/contracts.ts';

export function sourcePosition(editor: EditorView): WorkspaceState['source'] {
  const selection = editor.state.selection.main, top = editor.scrollDOM.scrollTop;
  const block = editor.lineBlockAtHeight(top);
  return { anchor: selection.anchor, head: selection.head, topLine: editor.state.doc.lineAt(block.from).number, offset: top - block.top };
}

export function restoreSourcePosition(editor: EditorView, saved: WorkspaceState['source']) {
  const limit = editor.state.doc.length;
  editor.dispatch({ selection: { anchor: Math.min(saved.anchor, limit), head: Math.min(saved.head, limit) } });
  editor.requestMeasure({
    read: view => view.lineBlockAt(view.state.doc.line(Math.min(saved.topLine, view.state.doc.lines)).from).top,
    write: top => { editor.scrollDOM.scrollTop = top + saved.offset; }
  });
}

// At most one active and one latest queued lookup. Rapid Next clicks do not
// flood SyncTeX; each obsolete result is separately rejected by App's identity check.
export class LatestTask {
  private next?: () => Promise<void>;
  private running = false;
  clear() { this.next = undefined; }
  replace(task: () => Promise<void>) { this.next = task; void this.drain(); }
  private async drain() {
    if (this.running) return;
    this.running = true;
    try { while (this.next) { const task = this.next; this.next = undefined; await task(); } }
    finally { this.running = false; }
  }
}
