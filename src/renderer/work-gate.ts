// A small window-lifecycle barrier: stop new edits, settle work, then save the final buffer.
export class WorkGate {
  closing = false;
  committing = false;
  private pending = new Map<string, Promise<void>>();
  private changed: () => void;
  constructor(changed: () => void = () => {}) { this.changed = changed; }
  get locked() { return this.closing || this.committing || this.pending.has('project'); }
  begin(kind: string): (() => void) | null {
    if (this.locked || this.pending.has(kind) || this.pending.has('project') || (kind === 'project' && this.pending.size)) return null;
    let finish!: () => void;
    this.pending.set(kind, new Promise<void>(resolve => { finish = resolve; }));
    this.changed();
    return () => { this.pending.delete(kind); finish(); this.changed(); };
  }
  async commit<T>(action: () => Promise<T>): Promise<T> {
    if (this.locked) throw new Error('The window is finishing another operation. Nothing was applied.');
    this.committing = true; this.changed();
    try { return await action(); } finally { this.committing = false; this.changed(); }
  }
  async close(cancel: () => Promise<unknown>, persist: () => Promise<void>, finish: () => Promise<void>) {
    if (this.closing) return;
    this.closing = true; this.changed();
    try {
      await cancel();
      await Promise.all(this.pending.values());
      await persist();
      await finish();
    } catch (error) { this.closing = false; this.changed(); throw error; }
  }
}
