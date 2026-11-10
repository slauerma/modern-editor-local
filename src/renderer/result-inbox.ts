import { bufferSchema, type BufferInput, type Comment, type EditorAPI, type WaitingResult } from '../shared/contracts.ts';
import { mergeResult, sourceHash } from '../shared/result-arrival.ts';

type Ports = {
  api: Pick<EditorAPI, 'waitingResults' | 'acknowledgeResult'>;
  input(): BufferInput | null;
  locked(): boolean;
  autoAddComments?(): boolean;
  begin(): (() => void) | null;
  install(comments: Comment[]): void;
  flush(): Promise<void>;
  changed(items: WaitingResult[], notices: string[], busy: boolean): void;
  error(error: unknown): void;
  canAct?(comment: Comment): boolean;
  ready?(requestId: string, delivery: 'automatic' | 'manual'): Promise<void>;
};

// A small inbox, not a second editor state. Completed answers live on disk first.
export class ResultInbox {
  private ports: Ports;
  private items: WaitingResult[] = [];
  private notices: string[] = [];
  private owner: string | null = null;
  private busy = false;
  private again = false;
  private readiness = new Map<string, { requestId: string; projectId: string; ids: string[]; persisted: boolean; delivery: 'automatic' | 'manual' }>();
  private reported = new Set<string>();
  constructor(ports: Ports) { this.ports = ports; }
  private publish() { this.ports.changed(this.items, this.notices, this.busy); }
  private finish(done: () => void) {
    this.busy = false; this.publish(); done(); this.checkReady();
    if (this.again) { this.again = false; void this.refresh(); }
  }
  private async adopt(result: WaitingResult, automatic: boolean) {
    const captured = this.ports.input();
    if (!captured || this.ports.locked() || captured.projectId !== this.owner || captured.review.rootFile !== result.rootFile) return false;
    const same = await sourceHash(captured.text) === result.sourceHash;
    if (automatic && result.kind === 'review') {
      const autoAdd = result.delivery === 'side-chat-suggest' ? true : this.ports.autoAddComments?.() ?? result.autoAddComments;
      if (autoAdd === false || (!same && autoAdd !== true)) return false;
    } else if (automatic && !same) return false;
    const now = this.ports.input();
    if (!now || now.projectId !== captured.projectId || now.text !== captured.text || this.ports.locked()) return false;
    if (automatic && result.kind === 'reply' && !now.review.comments.some(c => c.id === result.commentId && c.original === result.original)) return false;
    const comments = mergeResult(now.text, now.review.comments, result, same);
    // Reject an answer that would overflow the complete recovery envelope before
    // installing it. It remains available on disk and is never acknowledged.
    bufferSchema.parse({ ...now, review: { ...now.review, comments } });
    if (result.kind === 'review' && result.originRequestId && this.ports.ready && !this.readiness.has(result.id) && !this.reported.has(result.originRequestId)) {
      const existing = new Set(now.review.comments.map(c => c.id));
      const ids = comments.filter(c => !existing.has(c.id) && c.decision === 'open' && (c.replacement === null || c.validity === 'current')).map(c => c.id);
      if (ids.length) this.readiness.set(result.id, { requestId: result.originRequestId, projectId: captured.projectId, ids, persisted: false, delivery: automatic ? 'automatic' : 'manual' });
    }
    this.ports.install(comments);
    // Receipt follows recovery. On failure the retained answer can be retried
    // without duplicating comments or replacing a hand-edited proposal.
    await this.ports.flush();
    const pending = this.readiness.get(result.id);
    if (pending) pending.persisted = true;
    await this.ports.api.acknowledgeResult({ projectId: captured.projectId, resultId: result.id, outcome: 'adopted' });
    this.items = this.items.filter(item => item.id !== result.id); this.publish();
    return true;
  }
  checkReady() {
    if (this.busy || this.ports.locked()) return;
    const input = this.ports.input();
    if (!input) return;
    for (const [resultId, pending] of this.readiness) {
      if (pending.projectId !== input.projectId || this.reported.has(pending.requestId)) { this.readiness.delete(resultId); continue; }
      if (!pending.persisted) continue;
      const candidates = input.review.comments.filter(c => pending.ids.includes(c.id) && c.decision === 'open' && (c.replacement === null || c.validity === 'current'));
      if (!candidates.length) { this.readiness.delete(resultId); continue; }
      if (!candidates.some(c => this.ports.canAct?.(c))) continue;
      this.reported.add(pending.requestId);
      if (this.reported.size > 1000) this.reported.delete(this.reported.values().next().value!);
      this.readiness.delete(resultId);
      void this.ports.ready?.(pending.requestId, pending.delivery).catch(() => { /* Optional metadata never affects intake. */ });
    }
  }
  async refresh() {
    if (this.busy) { this.again = true; return; }
    const current = this.ports.input(); if (!current || this.ports.locked()) return;
    const done = this.ports.begin(); if (!done) return;
    this.busy = true;
    if (this.owner !== current.projectId) { this.items = []; this.notices = []; this.owner = current.projectId; }
    this.publish();
    try {
      const loaded = await this.ports.api.waitingResults(current.projectId);
      if (this.ports.input()?.projectId !== current.projectId) return;
      this.items = loaded.items; this.notices = loaded.notices; this.publish();
      for (const result of loaded.items) await this.adopt(result, true);
    } catch (error) { this.ports.error(error); }
    finally { this.finish(done); }
  }
  async handle(id: string, outcome: 'adopted' | 'dismissed') {
    if (this.busy || this.ports.locked()) return;
    const current = this.ports.input(), result = this.items.find(item => item.id === id);
    if (!current || current.projectId !== this.owner || !result) return;
    const done = this.ports.begin(); if (!done) return;
    this.busy = true; this.publish();
    try {
      if (outcome === 'adopted') await this.adopt(result, false);
      else { await this.ports.api.acknowledgeResult({ projectId: current.projectId, resultId: id, outcome }); this.items = this.items.filter(item => item.id !== id); }
    } catch (error) { this.ports.error(error); }
    finally { this.finish(done); }
  }
  async addAllComments(requestIds?: readonly string[]) {
    if (this.busy || this.ports.locked()) return;
    const current = this.ports.input();
    if (!current || current.projectId !== this.owner) return;
    const reviews = this.items.filter(item => item.kind === 'review' && (!requestIds || requestIds.includes(item.originRequestId ?? item.id)));
    if (!reviews.length) return;
    const done = this.ports.begin(); if (!done) return;
    this.busy = true; this.publish();
    try {
      // Preserve the same validation, recovery-before-receipt and retry behavior
      // as adding one result. Discussion answers still need their own choice.
      for (const result of reviews) if (!await this.adopt(result, false)) break;
    } catch (error) { this.ports.error(error); }
    finally { this.finish(done); }
  }
}
