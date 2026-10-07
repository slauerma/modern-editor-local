import type { Transaction } from '@codemirror/state';
import type { WorkspaceState } from '../shared/contracts.ts';

// Separate from Undo: navigation never enters the document's edit history.
// Source bookmarks follow edits; PDF positions are restored only for the same build.
export class NavigationHistory<T extends { source: WorkspaceState['source'] }> {
  private entries: T[] = [];
  get size() { return this.entries.length; }
  clear() { this.entries = []; }
  push(entry: T) { this.entries.push(entry); if (this.entries.length > 50) this.entries.shift(); }
  pop() { return this.entries.pop(); }
  map(transaction: Transaction) {
    if (!transaction.docChanged) return;
    for (const entry of this.entries) {
      const source = entry.source;
      const top = transaction.startState.doc.line(Math.min(source.topLine, transaction.startState.doc.lines)).from;
      entry.source = { ...source, anchor: transaction.changes.mapPos(source.anchor), head: transaction.changes.mapPos(source.head),
        topLine: transaction.newDoc.lineAt(transaction.changes.mapPos(top)).number };
    }
  }
}
