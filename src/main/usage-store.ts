import path from 'node:path';
import fs from 'node:fs/promises';
import { readJSON, writeJSON } from './files.ts';
import { usageHistorySchema, usageRecordSchema, type UsageRecord, type UsageState } from '../shared/usage.ts';

export class UsageStore {
  private history = { enabled: true, since: new Date().toISOString(), entries: [] as UsageRecord[] };
  private loading: Promise<void> | null = null;
  private writable = true;
  private notice = '';
  private queue = Promise.resolve();
  private deliveries = new Map<string, { start: number; commentCount: number; firstUsableMs: number | null; firstUsableDelivery?: 'automatic' | 'manual'; reviewOutcome?: UsageRecord['reviewOutcome'] }>();
  readonly file: string;
  constructor(directory: string) { this.file = path.join(directory, 'requests.json'); }
  startComments(id: string, start: number) {
    if (this.deliveries.has(id)) return;
    this.deliveries.set(id, { start, commentCount: 0, firstUsableMs: null });
    if (this.deliveries.size > 1000) this.deliveries.delete(this.deliveries.keys().next().value!);
  }
  publishedComments(id: string, count: number) {
    const delivery = this.deliveries.get(id);
    if (!delivery) return;
    delivery.commentCount += count;
    return this.saveDelivery(id);
  }
  reviewOutcome(id: string, outcome: NonNullable<UsageRecord['reviewOutcome']>) {
    const delivery = this.deliveries.get(id);
    if (!delivery) return;
    delivery.reviewOutcome = outcome;
    return this.saveDelivery(id);
  }
  commentReady(id: string, mode: 'automatic' | 'manual', now = performance.now()) {
    const delivery = this.deliveries.get(id);
    // Restarted apps cannot reconstruct the originating monotonic clock.
    if (!delivery || delivery.firstUsableMs !== null) return Promise.resolve();
    delivery.firstUsableMs = Math.max(0, now - delivery.start);
    delivery.firstUsableDelivery = mode;
    return this.saveDelivery(id);
  }
  private deliveryFields(id: string) {
    const delivery = this.deliveries.get(id);
    if (!delivery) return {};
    const { start: _, ...fields } = delivery;
    return fields;
  }
  private saveDelivery(id: string) {
    return this.update(async () => {
      if (!this.writable || !this.history.enabled) return;
      const index = this.history.entries.findIndex(r => r.id === id);
      if (index < 0) return; // The final usage record will include this observation.
      const entries = [...this.history.entries];
      entries[index] = usageRecordSchema.parse({ ...entries[index], ...this.deliveryFields(id) });
      await writeJSON(this.file, { ...this.history, entries }, 2000000);
      this.history.entries = entries;
    }).catch(() => { this.notice = 'The latest timing could not be saved. Editing and Codex replies are unaffected.'; });
  }
  private load() {
    return this.loading ??= (async () => {
    try { this.history = usageHistorySchema.parse(await readJSON(this.file, 2000000)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.writable = false;
        this.notice = 'Usage history could not be read. The existing file is preserved; new recording is paused.';
      }
    }
    })();
  }
  private update(action: () => Promise<void>) {
    const next = this.queue.then(async () => { await this.load(); if (this.writable) await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 }); await action(); });
    this.queue = next.catch(() => {});
    return next;
  }
  record(value: UsageRecord): Promise<void> {
    return this.update(async () => {
      if (!this.writable || !this.history.enabled) return;
      const prior = this.history.entries.find(r => r.id === value.id);
      const item = usageRecordSchema.parse({ ...value, ...this.deliveryFields(value.id),
        ...(prior?.firstUsableMs != null ? { firstUsableMs: prior.firstUsableMs, firstUsableDelivery: prior.firstUsableDelivery } : {}) });
      const entries = [...this.history.entries.filter(r => r.id !== item.id), item].slice(-1000);
      await writeJSON(this.file, { ...this.history, entries }, 2000000);
      this.history.entries = entries; this.notice = '';
    }).catch(() => { this.notice = 'The latest usage record could not be saved. Editing and Codex replies are unaffected.'; });
  }
  async state(currentScope: string | null = null): Promise<UsageState> {
    await this.queue; await this.load();
    return { ...this.history, entries: [...this.history.entries].reverse(), currentScope, notice: this.notice };
  }
  configure(enabled: boolean) {
    return this.update(async () => {
      if (!this.writable) throw new Error(this.notice);
      await writeJSON(this.file, { ...this.history, enabled }, 2000000);
      this.history.enabled = enabled;
    });
  }
}
