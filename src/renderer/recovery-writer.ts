// Coalesce edits without postponing recovery indefinitely during continuous typing.
export class RecoveryWriter<T> {
  private latest?: { value: T; revision: number };
  private saved = 0;
  private revision = 0;
  private running?: Promise<void>;
  private idle?: ReturnType<typeof setTimeout>;
  private maximum?: ReturnType<typeof setTimeout>;
  private write: (value: T) => Promise<void>;
  private onError: (error: unknown) => void;
  private idleMs: number;
  private maximumMs: number;
  constructor(write: (value: T) => Promise<void>, onError: (error: unknown) => void, idleMs = 500, maximumMs = 2000) { this.write = write; this.onError = onError; this.idleMs = idleMs; this.maximumMs = maximumMs; }

  schedule(value: T) {
    this.latest = { value, revision: ++this.revision };
    if (this.idle) clearTimeout(this.idle);
    const save = () => { void this.flush().catch(this.onError); };
    this.idle = setTimeout(save, this.idleMs);
    this.maximum ??= setTimeout(save, this.maximumMs);
  }
  clearTimers() {
    if (this.idle) clearTimeout(this.idle);
    if (this.maximum) clearTimeout(this.maximum);
    this.idle = this.maximum = undefined;
  }
  async flush(value?: T): Promise<void> {
    if (value !== undefined) this.latest = { value, revision: ++this.revision };
    this.clearTimers();
    // A caller joining an existing write must also wait for its own latest snapshot.
    if (this.running) { await this.running; return this.flush(); }
    const drain = async () => {
      while (this.latest && this.latest.revision > this.saved) {
        const next = this.latest;
        await this.write(next.value);
        this.saved = next.revision;
      }
    };
    this.running = drain();
    try { await this.running; } finally { this.running = undefined; }
  }
}
