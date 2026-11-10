import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CHAT_LIMITS, suggestEditsSettings, chatBatchSchema, chatInputSchema, chatRecordSchema, chatTurnSchema, chatAnswerSchema, chatOutputSchema, chatContext, type ChatRecord, type ChatInput, type ChatHelp, type ChatScope, type ChatState, type ChatPreview, type ChatTurn } from '../shared/help-chat.ts';
import { commentSchema, type Comment } from '../shared/contracts.ts';
import { adoptComment, captureContext } from '../shared/review.ts';
import { serializeJSON } from '../shared/persistence.ts';
import { digest, privateDirectory, readJSON, writeJSON } from './files.ts';
import type { ProjectService } from './project-service.ts';
import type { CodexClient } from './codex-client.ts';
import { draftOnlySession, type ReferenceService, type ReferenceSession } from './reference-service.ts';
import type { ContextDocument } from '../shared/context-documents.ts';
import type { ReviewConversations } from './review-conversations.ts';
import { paperGuidance } from '../shared/paper-guidance.ts';
import { ReviewPublisher } from './review-publisher.ts';
import { ReviewResults } from './review-results.ts';

// Chat state stays in app-owned storage, separate from source, recovery and
// review sidecars. An unreadable/full chat must never prevent opening a paper.
export class HelpChat {
  private previews = new Map<string, { input: ChatInput; owner: string; turn: ChatTurn; passage: string; documents: ContextDocument[]; stamp: string; guidance: string; expires: number }>();
  private operation: Promise<unknown> | null = null;
  private generation = 0;
  private unsaved = new Map<string, { record: ChatRecord; previous: string }>();
  readonly projects: ProjectService; readonly client: CodexClient; readonly directory: string; readonly help: () => Promise<ChatHelp>; readonly references?: ReferenceService;
  readonly write: typeof writeJSON;
  readonly results: ReviewResults;
  reviewConversations?: ReviewConversations;
  constructor(projects: ProjectService, client: CodexClient, directory: string, help: () => Promise<ChatHelp>, references?: ReferenceService, write = writeJSON) { this.projects = projects; this.client = client; this.directory = directory; this.help = help; this.references = references; this.write = write; this.results = new ReviewResults(projects); }
  private owner(scope: ChatScope) { return scope.projectId ? this.projects.get(scope.projectId).path : 'editor-help'; }
  private guidance(input: ChatInput) {
    if (!input.projectId || input.paper === 'none' && !input.includeComment && !input.includeReferences) return '';
    const paper = this.projects.get(input.projectId);
    return JSON.stringify(paperGuidance(paper.paperInstructions, paper.editPreferences));
  }
  private async file(owner: string) { await fs.mkdir(path.dirname(this.directory), { recursive: true, mode: 0o700 }); await privateDirectory(path.dirname(this.directory), path.basename(this.directory)); return path.join(this.directory, digest(owner) + '.json'); }
  private async load(owner: string) {
    try { const record = chatRecordSchema.parse(await readJSON(await this.file(owner), CHAT_LIMITS.recordBytes)); if (record.owner !== owner) throw new Error('Wrong conversation owner.'); return record; }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1 as const, owner, turns: [] }; throw new Error('This saved chat could not be read. It was preserved; opening and saving your paper are unaffected.'); }
  }
  async state(scope: ChatScope): Promise<ChatState> {
    const owner = this.owner(scope), unsaved = this.unsaved.get(owner), record = unsaved?.record ?? await this.load(owner);
    return { turns: record.turns, editorVersion: (await this.help()).version, needsSave: !!unsaved, notices: unsaved ? ['The latest reply is available in this window but could not be saved. Retry saving the chat before closing, or copy the answer. Paper saving is separate.'] : !this.operation && record.turns.some(t => t.status === 'pending') ? ['An earlier request did not finish. Its question and any received suggestions are retained.'] : [] };
  }
  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    if (this.operation) return Promise.reject(new Error('Wait for the current chat operation.'));
    const task = action(); this.operation = task;
    void task.then(() => { if (this.operation === task) this.operation = null; }, () => { if (this.operation === task) this.operation = null; });
    return task;
  }
  private label(owner: string) { return owner === 'editor-help' ? 'Editor help' : `${path.basename(path.dirname(owner))} / ${path.basename(owner)}`; }
  pending() { return [...this.unsaved.keys()].map(owner => ({ id: digest(owner), label: this.label(owner) })); }
  private pendingOwner(id: string) {
    const owner = [...this.unsaved.keys()].find(owner => digest(owner) === id);
    if (!owner) throw new Error('This reply no longer needs saving. Refresh the pending replies.');
    return owner;
  }
  pendingReply(id: string) {
    const owner = this.pendingOwner(id);
    return { id, label: this.label(owner), turns: this.unsaved.get(owner)!.record.turns };
  }
  private async retryOwner(owner: string) {
    const pending = this.unsaved.get(owner);
    if (!pending) return;
    const current = digest(serializeJSON(await this.load(owner)));
    if (current !== digest(serializeJSON(pending.record))) {
      if (current !== pending.previous) throw new Error('The saved chat changed outside this window. Copy the visible answer before resolving the conflict.');
      await this.write(await this.file(owner), chatRecordSchema.parse(pending.record), CHAT_LIMITS.recordBytes);
    }
    this.unsaved.delete(owner);
  }
  recover(id: string, action: 'retry' | 'discard') {
    return this.exclusive(async () => {
      const owner = this.pendingOwner(id);
      if (action === 'retry') await this.retryOwner(owner);
      else this.unsaved.delete(owner); // Explicitly discard only the in-memory update; saved history is untouched.
    });
  }
  retry(scope: ChatScope) { return this.exclusive(async () => {
    await this.retryOwner(this.owner(scope));
    return this.state(scope);
  }); }
  async clear(scope: ChatScope) {
    if (this.operation) throw new Error('Stop the current chat request before clearing a conversation.');
    return this.exclusive(async () => { const owner = this.owner(scope); this.previews.clear(); await fs.rm(await this.file(owner), { force: true }); this.unsaved.delete(owner); });
  }
  async preview(raw: ChatInput): Promise<ChatPreview> {
    if (this.operation) throw new Error('Wait for the current chat reply.');
    const input = chatInputSchema.parse(raw), owner = this.owner(input), record = await this.load(owner);
    if (input.action === 'suggest') Object.assign(input, suggestEditsSettings, { includeDiagnostics: false });
    if (this.unsaved.has(owner)) throw new Error('Retry saving this chat before sending another question. The last answer remains available.');
    if (record.turns.length >= CHAT_LIMITS.turns) throw new Error('This chat has reached 100 exchanges. Clear it to begin another; the saved conversation is unchanged.');
    const help = await this.help(), guidance = this.guidance(input);
    const paper = input.projectId ? this.projects.get(input.projectId) : undefined;
    const built = chatContext(input, help, record.turns, paper?.paperInstructions, paper?.editPreferences, paper?.review.comments);
    const turn = chatTurnSchema.parse({ id: randomUUID(), createdAt: new Date().toISOString(), ...(input.action ? { action: input.action } : {}), message: input.message, context: JSON.stringify(built.context, null, 2), labels: built.labels, images: input.images, status: 'pending', ...(input.projectId ? { sourceHash: digest(input.source) } : {}) });
    // Reserve enough for the largest permitted reply/proposal before contacting
    // Codex. A rejected append preserves the complete previous readable record.
    try { serializeJSON({ ...record, turns: [...record.turns, turn] }, CHAT_LIMITS.recordBytes - 2_000_000); }
    catch { throw new Error('This chat is near its 16 MB storage limit. Remove screenshots or clear the conversation; saved history was preserved.'); }
    const id = randomUUID(); this.previews.clear(); this.previews.set(id, { input, owner, turn, passage: built.passage, documents: built.documents, guidance, stamp: digest(serializeJSON(record)), expires: Date.now() + 10 * 60 * 1000 });
    return { id, context: turn.context, labels: turn.labels, images: turn.images };
  }
  send(scope: ChatScope, previewId: string, progress: (message: string) => void, delivered: (projectId: string) => void = () => {}): Promise<ChatTurn> {
    if (this.operation || this.client.isBusy) return Promise.reject(new Error('Finish or stop the current Side Chat request before sending another.'));
    const generation = this.generation;
    const operation = this.sendOperation(scope, previewId, progress, generation, delivered); this.operation = operation;
    void operation.then(() => { if (this.operation === operation) this.operation = null; }, () => { if (this.operation === operation) this.operation = null; });
    return operation;
  }
  private async sendOperation(scope: ChatScope, previewId: string, progress: (message: string) => void, generation: number, delivered: (projectId: string) => void) {
    const prepared = this.previews.get(previewId); this.previews.delete(previewId);
    if (!prepared || prepared.owner !== this.owner(scope) || prepared.expires < Date.now()) throw new Error('Chat context expired or belongs to another paper. Preview it again.');
    const { input, owner, turn } = prepared, record = await this.load(owner);
    if (prepared.guidance !== this.guidance(input)) throw new Error('Paper guidance changed. Preview the question again to use the saved instructions.');
    if (prepared.stamp !== digest(serializeJSON(record))) throw new Error('This conversation changed. Preview the question again.');
    const stopped = () => { if (generation !== this.generation) throw new Error('Chat request cancelled.'); };
    stopped();
    const next = { ...record, turns: [...record.turns, turn] }, file = await this.file(owner);
    await this.write(file, chatRecordSchema.parse(next), CHAT_LIMITS.recordBytes);
    let savedStamp = digest(serializeJSON(next));
    let session: ReferenceSession | undefined, managedSession = false, complete = false;
    try {
      stopped();
      const readableSource = input.includeReferences ? input.source : prepared.passage;
      if (input.projectId && this.references && (input.paper !== 'none' || input.includeReferences)) {
        session = await this.references.begin(input.projectId, readableSource, 'reply', progress, input.includeReferences);
        managedSession = true;
      } else session = draftOnlySession(owner, readableSource, 'reply', progress);
      if (input.paper === 'none' && !input.includeReferences) session.omitDraft();
      session.addDocuments(prepared.documents);
      stopped();
      let prompt = turn.context;
      if (session) { prompt = JSON.stringify({ ...JSON.parse(prompt), availableReferences: session.context() }, null, 2); const updated = chatTurnSchema.parse({ ...turn, context: prompt }); Object.assign(turn, updated); await this.write(file, chatRecordSchema.parse(next), CHAT_LIMITS.recordBytes); savedStamp = digest(serializeJSON(next)); }
      stopped();
      const from = input.paper === 'passage' ? input.from : 0;
      const publisher = input.action === 'suggest' ? new ReviewPublisher(input.source, from, from + prepared.passage.length, async added => {
        if (!added.length) return;
        const comments = [...(turn.comments ?? []), ...added];
        // Bound the complete streamed answer, reserving space for its final reply.
        if (comments.length > CHAT_LIMITS.suggestions || JSON.stringify(comments).length > CHAT_LIMITS.answerChars - 20000) throw new Error('This batch exceeds the chat reply limit. Finish this reply and request another batch.');
        const updated = chatTurnSchema.parse({ ...turn, comments });
        serializeJSON({ ...next, turns: [...next.turns.slice(0, -1), updated] }, CHAT_LIMITS.recordBytes);
        await this.results.retain(input.projectId!, {
          schemaVersion: 1, id: randomUUID(), originRequestId: turn.id, kind: 'review', rootFile: this.projects.get(input.projectId!).name,
          sourceHash: turn.sourceHash!, createdAt: new Date().toISOString(), comments: added, delivery: 'side-chat-suggest'
        });
        try { this.client.usageComments?.(turn.id, added.length); } catch { /* Timing is optional. */ }
        // The retained result is the durable delivery record. Chat-save failure
        // uses the existing retry path; it must not publish these edits twice.
        Object.assign(turn, updated);
        try { await this.write(file, chatRecordSchema.parse(next), CHAT_LIMITS.recordBytes); savedStamp = digest(serializeJSON(next)); this.unsaved.delete(owner); }
        catch { this.unsaved.set(owner, { record: next, previous: savedStamp }); }
        try { delivered(input.projectId!); } catch { /* Reopening the paper recovers the retained result. */ }
      }, () => generation === this.generation, 'Chat') : undefined;
      const response = chatAnswerSchema.parse(await this.client.run(prompt, chatOutputSchema, progress, input.effort, input.fastMode, publisher ? publisher.reader(chatBatchSchema, session) : session, { purpose: 'help', ...(publisher ? { requestId: turn.id, commentDelivery: true } : {}), ...(input.model ? { model: input.model } : {}), images: turn.images.map(i => i.dataUrl) }));
      stopped();
      const comments: Comment[] = publisher ? await publisher.finish({ comments: response.suggestions }) : [];
      let unverified = comments.filter(c => c.validity !== 'current').length;
      if (!publisher && input.projectId && input.paper !== 'none') {
        for (const [index, suggestion] of response.suggestions.entries()) {
          const candidate = commentSchema.parse({ ...suggestion, id: index === 0 ? turn.id : `${turn.id}:${index + 1}`, category: 'Chat', decision: 'open', validity: 'missing', reviewedSourceHash: turn.sourceHash, reviewedAt: turn.createdAt });
          if (!prepared.passage.includes(suggestion.original)) {
            // Keep the wording and reason for inspection, but never guess an anchor.
            comments.push(candidate); unverified++; continue;
          }
          const local = adoptComment(prepared.passage, candidate);
          const offset = input.paper === 'passage' ? input.from : 0;
          const placed = { ...local, from: local.from + offset, to: local.to + offset };
          comments.push(placed.validity === 'current' ? captureContext(input.source, placed) : placed);
        }
        if (!response.suggestions.length && input.to > input.from && input.to - input.from <= 100000) {
          comments.push(captureContext(input.source, commentSchema.parse({ id: turn.id, category: 'Chat', title: input.message.slice(0, 200), explanation: response.reply.slice(0, 10000), original: input.source.slice(input.from, input.to), replacement: null, from: input.from, to: input.to, validity: 'current', reviewedSourceHash: turn.sourceHash, reviewedAt: turn.createdAt })));
        }
      }
      const answer = chatTurnSchema.parse({ ...turn, status: 'complete', reply: response.reply,
        ...(publisher ? { comments } : comments.length === 1 ? { comment: comments[0] } : comments.length ? { comments } : {}),
        ...(unverified ? { error: `${unverified} proposed quotation${unverified === 1 ? '' : 's'} could not be verified in the included source. The comments are retained, but their passages must be confirmed before edits can be accepted.` } : {}) });
      if (input.projectId && (input.paper !== 'none' || input.includeComment || input.includeReferences) && this.reviewConversations) {
        try { await this.reviewConversations.addPaperChat(input.projectId, { kind: 'paper-chat', instruction: input.message, sourceHash: turn.sourceHash! }, { reply: response.reply, suggestions: publisher ? comments : response.suggestions }); }
        catch (e) { answer.error = [answer.error, 'This answer could not be shared with the active review: ' + (e instanceof Error ? e.message : String(e))].filter(Boolean).join(' ').slice(0, 4000); }
      }
      next.turns[next.turns.length - 1] = answer;
      try { await this.write(file, chatRecordSchema.parse(next), CHAT_LIMITS.recordBytes); this.unsaved.delete(owner); }
      catch { this.unsaved.set(owner, { record: next, previous: savedStamp }); }
      complete = true; return answer;
    } catch (e) {
      const failed = chatTurnSchema.parse({ ...turn, status: 'failed', error: (e instanceof Error ? e.message : String(e)).slice(0, 4000) });
      next.turns[next.turns.length - 1] = failed;
      try { await this.write(file, chatRecordSchema.parse(next), CHAT_LIMITS.recordBytes); this.unsaved.delete(owner); }
      catch { this.unsaved.set(owner, { record: next, previous: savedStamp }); }
      throw e;
    } finally { if (session) { if (managedSession) await this.references!.finish(session, complete); else await session.cancel(); } }
  }
  cancel() { this.generation++; this.previews.clear(); return this.client.cancel(); }
  async settle() { if (this.operation) await Promise.allSettled([this.operation]); if (this.unsaved.size) throw new Error(`A chat reply has not been saved (${this.pending().slice(0, 3).map(p => p.label).join(', ')}). Use Review unsaved replies to retry, copy or deliberately discard it.`); }
}
