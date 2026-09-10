import { bufferSchema, type BufferInput, type Comment, type EditorAPI, type WaitingResult } from '../shared/contracts.ts';
import { mergeResult, sourceHash } from '../shared/result-arrival.ts';

type Ports = {
  api: Pick<EditorAPI, 'waitingResults' | 'acknowledgeResult'>;
  input(): BufferInput | null;
  locked(): boolean;
  begin(): (() => void) | null;
  install(comments: Comment[]): void;
  flush(): Promise<void>;
  changed(items: WaitingResult[], notices: string[], busy: boolean): void;
  error(error: unknown): void;
};

// A small inbox, not a second editor state. Completed answers live on disk first.
export class ResultInbox {
  private ports: Ports;
  private items: WaitingResult[] = [];
  private notices: string[] = [];
  private owner: string | null = null;
  private busy = false;
  private again = false;
  constructor(ports: Ports) { this.ports = ports; }
  private publish() { this.ports.changed(this.items, this.notices, this.busy); }
  private finish(done: () => void) {
    this.busy = false; this.publish(); done();
    if (this.again) { this.again = false; void this.refresh(); }
  }
  private async adopt(result: WaitingResult, automatic: boolean) {
    const captured = this.ports.input();
    if (!captured || this.ports.locked() || captured.projectId !== this.owner || captured.review.rootFile !== result.rootFile) return false;
    const same = await sourceHash(captured.text) === result.sourceHash;
    if (automatic && !same) return false;
    const now = this.ports.input();
    if (!now || now.projectId !== captured.projectId || now.text !== captured.text || this.ports.locked()) return false;
    if (automatic && result.kind === 'reply' && !now.review.comments.some(c => c.id === result.commentId && c.original === result.original)) return false;
    const comments = mergeResult(now.text, now.review.comments, result, same);
    // Reject an answer that would overflow the complete recovery envelope before
    // installing it. It remains available on disk and is never acknowledged.
    bufferSchema.parse({ ...now, review: { ...now.review, comments } });
    this.ports.install(comments);
    // Receipt follows recovery. On failure the retained answer can be retried
    // without duplicating comments or replacing a hand-edited proposal.
    await this.ports.flush();
    await this.ports.api.acknowledgeResult({ projectId: captured.projectId, resultId: result.id, outcome: 'adopted' });
    this.items = this.items.filter(item => item.id !== result.id); this.publish();
    return true;
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
}
