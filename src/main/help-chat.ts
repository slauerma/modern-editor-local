import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CHAT_LIMITS, chatInputSchema, chatRecordSchema, chatTurnSchema, chatAnswerSchema, chatOutputSchema, chatContext, type ChatRecord, type ChatInput, type ChatHelp, type ChatScope, type ChatState, type ChatPreview, type ChatTurn } from '../shared/help-chat.ts';
import { commentSchema } from '../shared/contracts.ts';
import { adoptComment, captureContext } from '../shared/review.ts';
import { serializeJSON } from '../shared/persistence.ts';
import { digest, privateDirectory, readJSON, writeJSON } from './files.ts';
import type { ProjectService } from './project-service.ts';
import type { CodexClient } from './codex-client.ts';
import type { ReferenceService, ReferenceSession } from './reference-service.ts';

// Chat state stays in app-owned storage, separate from source, recovery and
// review sidecars. An unreadable/full chat must never prevent opening a paper.
export class HelpChat {
  private previews = new Map<string, { input: ChatInput; owner: string; turn: ChatTurn; passage: string; stamp: string; expires: number }>();
  private operation: Promise<unknown> | null = null;
  private generation = 0;
  private unsaved = new Map<string, { record: ChatRecord; previous: string }>();
  readonly projects: ProjectService; readonly client: CodexClient; readonly directory: string; readonly help: () => Promise<ChatHelp>; readonly references?: ReferenceService;
  readonly write: typeof writeJSON;
  constructor(projects: ProjectService, client: CodexClient, directory: string, help: () => Promise<ChatHelp>, references?: ReferenceService, write = writeJSON) { this.projects = projects; this.client = client; this.directory = directory; this.help = help; this.references = references; this.write = write; }
  private owner(scope: ChatScope) { return scope.projectId ? this.projects.get(scope.projectId).path : 'editor-help'; }
  private async file(owner: string) { await fs.mkdir(path.dirname(this.directory), { recursive: true, mode: 0o700 }); await privateDirectory(path.dirname(this.directory), path.basename(this.directory)); return path.join(this.directory, digest(owner) + '.json'); }
  private async load(owner: string) {
    try { const record = chatRecordSchema.parse(await readJSON(await this.file(owner), CHAT_LIMITS.recordBytes)); if (record.owner !== owner) throw new Error('Wrong conversation owner.'); return record; }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1 as const, owner, turns: [] }; throw new Error('This saved chat could not be read. It was preserved; opening and saving your paper are unaffected.'); }
  }
  async state(scope: ChatScope): Promise<ChatState> {
    const owner = this.owner(scope), unsaved = this.unsaved.get(owner), record = unsaved?.record ?? await this.load(owner);
    return { turns: record.turns, editorVersion: (await this.help()).version, needsSave: !!unsaved, notices: unsaved ? ['The latest reply is available in this window but could not be saved. Retry saving the chat before closing, or copy the answer. Paper saving is separate.'] : record.turns.some(t => t.status === 'pending') ? ['An earlier request did not finish. Its question and screenshots are retained; send the question again if needed.'] : [] };
  }
  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    if (this.operation) return Promise.reject(new Error('Wait for the current chat operation.'));
    const task = action(); this.operation = task;
    void task.then(() => { if (this.operation === task) this.operation = null; }, () => { if (this.operation === task) this.operation = null; });
    return task;
  }
  retry(scope: ChatScope) { return this.exclusive(async () => {
    const owner = this.owner(scope), pending = this.unsaved.get(owner);
    if (pending) {
      const current = digest(serializeJSON(await this.load(owner)));
      if (current !== digest(serializeJSON(pending.record))) {
        if (current !== pending.previous) throw new Error('The saved chat changed outside this window. Copy the visible answer before resolving the conflict.');
        await this.write(await this.file(owner), chatRecordSchema.parse(pending.record), CHAT_LIMITS.recordBytes);
      }
      this.unsaved.delete(owner);
    }
    return this.state(scope);
  }); }
  async clear(scope: ChatScope) {
    if (this.operation) throw new Error('Stop the current chat request before clearing a conversation.');
    return this.exclusive(async () => { const owner = this.owner(scope); this.previews.clear(); await fs.rm(await this.file(owner), { force: true }); this.unsaved.delete(owner); });
  }
  async preview(raw: ChatInput): Promise<ChatPreview> {
    if (this.operation) throw new Error('Wait for the current chat reply.');
    const input = chatInputSchema.parse(raw), owner = this.owner(input), record = await this.load(owner);
    if (this.unsaved.has(owner)) throw new Error('Retry saving this chat before sending another question. The last answer remains available.');
    if (record.turns.length >= CHAT_LIMITS.turns) throw new Error('This chat has reached 100 exchanges. Clear it to begin another; the saved conversation is unchanged.');
    const built = chatContext(input, await this.help(), record.turns, input.projectId ? this.projects.get(input.projectId).paperInstructions : '');
    const turn = chatTurnSchema.parse({ id: randomUUID(), createdAt: new Date().toISOString(), message: input.message, context: JSON.stringify(built.context, null, 2), labels: built.labels, images: input.images, status: 'pending', ...(input.projectId ? { sourceHash: digest(input.source) } : {}) });
    // Reserve enough for the largest permitted reply/proposal before contacting
    // Codex. A rejected append preserves the complete previous readable record.
    try { serializeJSON({ ...record, turns: [...record.turns, turn] }, CHAT_LIMITS.recordBytes - 2_000_000); }
    catch { throw new Error('This chat is near its 16 MB storage limit. Remove screenshots or clear the conversation; saved history was preserved.'); }
    const id = randomUUID(); this.previews.clear(); this.previews.set(id, { input, owner, turn, passage: built.passage, stamp: digest(serializeJSON(record)), expires: Date.now() + 10 * 60 * 1000 });
    return { id, context: turn.context, labels: turn.labels, images: turn.images };
  }
  send(scope: ChatScope, previewId: string, progress: (message: string) => void): Promise<ChatTurn> {
    if (this.operation || this.client.isBusy) return Promise.reject(new Error('Finish or stop the current Codex request before asking Help me.'));
    const generation = this.generation;
    const operation = this.sendOperation(scope, previewId, progress, generation); this.operation = operation;
    void operation.then(() => { if (this.operation === operation) this.operation = null; }, () => { if (this.operation === operation) this.operation = null; });
    return operation;
  }
  private async sendOperation(scope: ChatScope, previewId: string, progress: (message: string) => void, generation: number) {
    const prepared = this.previews.get(previewId); this.previews.delete(previewId);
    if (!prepared || prepared.owner !== this.owner(scope) || prepared.expires < Date.now()) throw new Error('Chat context expired or belongs to another paper. Preview it again.');
    const { input, owner, turn } = prepared, record = await this.load(owner);
    if (prepared.stamp !== digest(serializeJSON(record))) throw new Error('This conversation changed. Preview the question again.');
    const stopped = () => { if (generation !== this.generation) throw new Error('Chat request cancelled.'); };
    stopped();
    const next = { ...record, turns: [...record.turns, turn] }, file = await this.file(owner);
    await this.write(file, chatRecordSchema.parse(next), CHAT_LIMITS.recordBytes);
    let savedStamp = digest(serializeJSON(next));
    let session: ReferenceSession | undefined, complete = false;
    try {
      stopped();
      if (input.projectId && input.includeReferences) session = await this.references?.begin(input.projectId, input.source, 'reply', progress);
      stopped();
      let prompt = turn.context;
      if (session) { prompt = JSON.stringify({ ...JSON.parse(prompt), availableReferences: session.context() }, null, 2); const updated = chatTurnSchema.parse({ ...turn, context: prompt }); Object.assign(turn, updated); await this.write(file, chatRecordSchema.parse(next), CHAT_LIMITS.recordBytes); savedStamp = digest(serializeJSON(next)); }
      stopped();
      const response = chatAnswerSchema.parse(await this.client.run(prompt, chatOutputSchema, progress, input.effort, input.fastMode, session, { purpose: 'help', images: turn.images.map(i => i.dataUrl) }));
      stopped();
      let comment;
      if (input.projectId && input.paper !== 'none') {
        const suggestion = response.suggestion;
        if (suggestion && prepared.passage.includes(suggestion.original)) {
          const local = adoptComment(prepared.passage, commentSchema.parse({ ...suggestion, id: turn.id, category: 'Chat', decision: 'open', validity: 'missing', reviewedSourceHash: turn.sourceHash, reviewedAt: turn.createdAt }));
          const offset = input.paper === 'passage' ? input.from : 0;
          const placed = { ...local, from: local.from + offset, to: local.to + offset };
          comment = placed.validity === 'current' ? captureContext(input.source, placed) : placed;
        } else if (!suggestion && input.to > input.from && input.to - input.from <= 100000) {
          comment = captureContext(input.source, commentSchema.parse({ id: turn.id, category: 'Chat', title: input.message.slice(0, 200), explanation: response.reply.slice(0, 10000), original: input.source.slice(input.from, input.to), replacement: null, from: input.from, to: input.to, validity: 'current', reviewedSourceHash: turn.sourceHash, reviewedAt: turn.createdAt }));
        }
      }
      const answer = chatTurnSchema.parse({ ...turn, status: 'complete', reply: response.reply, ...(comment ? { comment } : {}), ...(response.suggestion && !comment ? { error: 'The proposed quotation could not be verified in the included source. It was not made an applicable revision. Ask for an exact quotation or select a passage.' } : {}) });
      next.turns[next.turns.length - 1] = answer;
      try { await this.write(file, chatRecordSchema.parse(next), CHAT_LIMITS.recordBytes); }
      catch { this.unsaved.set(owner, { record: next, previous: savedStamp }); }
      complete = true; return answer;
    } catch (e) {
      const failed = chatTurnSchema.parse({ ...turn, status: 'failed', error: (e instanceof Error ? e.message : String(e)).slice(0, 4000) });
      next.turns[next.turns.length - 1] = failed;
      try { await this.write(file, chatRecordSchema.parse(next), CHAT_LIMITS.recordBytes); }
      catch { this.unsaved.set(owner, { record: next, previous: savedStamp }); }
      throw e;
    } finally { if (session) await this.references!.finish(session, complete); }
  }
  cancel() { this.generation++; this.previews.clear(); return this.client.cancel(); }
  async settle() { if (this.operation) await Promise.allSettled([this.operation]); if (this.unsaved.size) throw new Error('A chat reply has not been saved. Open Help me and retry saving the chat or copy the answer before clearing it.'); }
}
