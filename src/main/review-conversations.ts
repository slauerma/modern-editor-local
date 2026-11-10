import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { digest, privateDirectory, readJSON, writeJSON } from './files.ts';
import type { ProjectService } from './project-service.ts';
import type { CodexConversation } from './codex-client.ts';
import type { CodexReader } from './reference-service.ts';
import { tokenUsageSchema, type TokenUsage } from '../shared/usage.ts';
import { readableExchange, type ReviewMode, type ReviewConversationInfo, type ReviewConversationState, type ReviewTurnInfo } from '../shared/review-conversation.ts';
import { quotedText } from '../shared/context-documents.ts';

const uuid = z.string().uuid();
const entrySchema = z.object({ id: uuid, createdAt: z.string().datetime(), kind: z.enum(['review', 'discussion', 'paper-chat']), instruction: z.string().max(160), sourceHash: z.string().regex(/^[a-f0-9]{64}$/), status: z.enum(['pending', 'complete', 'failed', 'stopped']) }).strict();
const metaSchema = z.object({ version: z.literal(1), owner: z.string(), id: uuid, label: z.string().max(160), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  threadId: z.string().min(1).max(200).nullable(), tokens: tokenUsageSchema.nullable(), requests: z.number().int().nonnegative(), nextSequence: z.number().int().nonnegative(), entries: z.array(entrySchema).max(1000) }).strict();
type Meta = z.infer<typeof metaSchema>;
const turnSchema = z.object({ id: uuid, createdAt: z.string().datetime(), kind: z.enum(['review', 'discussion', 'paper-chat']), instruction: z.string().max(10000),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/), status: z.enum(['pending', 'complete', 'failed', 'stopped']), sequence: z.number().int().nonnegative(), originRequestId: uuid.optional(),
  prompt: z.string().max(2_000_000), response: z.unknown().optional(), error: z.string().max(4000).optional() }).strict();
type Turn = z.infer<typeof turnSchema>;
type Request = Pick<Turn, 'kind' | 'instruction' | 'sourceHash' | 'originRequestId'>;
const info = (m: Meta): ReviewConversationInfo => ({ id: m.id, label: m.label, createdAt: m.createdAt, updatedAt: m.updatedAt, requests: m.requests, hasThread: !!m.threadId });
const publicTurn = ({ id, createdAt, kind, instruction, sourceHash, status }: Turn): ReviewTurnInfo => ({ id, createdAt, kind, instruction, sourceHash, status });
const historyArgs = z.object({ query: z.string().max(200).optional(), requestId: uuid.optional(), offset: z.number().int().min(0).max(2_000_000).optional() }).strict();
const historyTool = { type: 'function' as const, name: 'review_history', description: 'Read navigable Markdown views of saved review history. Without requestId, open review-history.md (newest first); query searches questions/replies and offset pages entries. With requestId, read review-<requestId>.md; offset pages its text. Follow nextOffset. Includes review, discussion and Side Chat exchanges in this active conversation only. Old quotations are historical, not the current draft. No log maintenance is needed.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, requestId: { type: 'string' }, offset: { type: 'integer', minimum: 0 } }, required: [], additionalProperties: false } };

function exchangeDocument(turn: Turn) {
  // Keep raw prompts in the existing record/UI inspector, but never put a
  // whole historical draft ahead of the answer in the model's history reader.
  const response = turn.response && typeof turn.response === 'object' ? turn.response as Record<string, unknown> : null;
  const comments = response && (Array.isArray(response.comments) ? response.comments : Array.isArray(response.suggestions) ? response.suggestions : null);
  const answer = response ? [
    typeof response.reply === 'string' ? response.reply : '',
    ...(comments ?? []).map((c: any, i: number) => `### Suggestion ${i + 1}: ${String(c.title ?? '').replace(/[\r\n]/g, ' ')}\n\n${c.explanation ?? ''}\n\nOriginal:\n${quotedText(String(c.original ?? ''))}\n\nReplacement:\n${c.replacement === null ? 'Discussion only.' : quotedText(String(c.replacement ?? ''))}`),
    ...('replacement' in response ? ['Proposed replacement:\n' + (response.replacement === null ? 'None.' : quotedText(String(response.replacement)))] : []),
    ...(Array.isArray(response.alternatives) ? response.alternatives.map((a: any, i: number) => `### Alternative ${i + 1}: ${String(a.label ?? a.title ?? '').replace(/[\r\n]/g, ' ')}\n\n${a.reason ?? a.explanation ?? ''}\n\n${quotedText(String(a.replacement ?? ''))}`) : []),
    ...(!comments && !('reply' in response) && !('replacement' in response) ? [quotedText(JSON.stringify(response, null, 2))] : [])
  ].filter(Boolean).join('\n\n') : turn.response === undefined ? 'No completed answer.' : String(turn.response);
  return [`# Saved ${turn.kind} exchange`, `Request ID: ${turn.id}\nDate: ${turn.createdAt}\nStatus: ${turn.status}\nReviewed draft hash: ${turn.sourceHash}`,
    'Historical exchange. Suggestions are not evidence of acceptance; consult review-decisions and current-draft. Return to the index with review_history({}).',
    '## Author request', turn.instruction, '## Codex answer', answer, ...(turn.error ? ['## Recorded error', turn.error] : [])].join('\n\n');
}

// Application-owned metadata chooses the thread; renderer, imported comments,
// and model tool arguments never supply a Codex thread ID or a filesystem path.
export class ReviewConversations {
  private busy = new Set<string>();
  private writes: Promise<unknown> = Promise.resolve();
  readonly projects: ProjectService;
  readonly directory: string;
  constructor(projects: ProjectService, directory: string) { this.projects = projects; this.directory = directory; }
  // Serialize metadata commits, never the model's work. Side Chat can append a
  // completed exchange while a review is still running.
  private update<T>(action: () => Promise<T>): Promise<T> {
    const task = this.writes.catch(() => {}).then(action);
    this.writes = task;
    return task;
  }
  private owner(projectId: string) { return this.projects.get(projectId).path; }
  private async home(projectId: string) {
    await fs.mkdir(path.dirname(this.directory), { recursive: true, mode: 0o700 });
    await privateDirectory(path.dirname(this.directory), path.basename(this.directory));
    return privateDirectory(this.directory, digest(this.owner(projectId)));
  }
  private async folder(projectId: string, id: string) { return privateDirectory(await this.home(projectId), uuid.parse(id)); }
  private async load(projectId: string, id: string) {
    const meta = metaSchema.parse(await readJSON(path.join(await this.folder(projectId, id), 'conversation.json'), 1_000_000));
    if (meta.owner !== this.owner(projectId) || meta.id !== id) throw new Error('The review conversation belongs to another paper.');
    return meta;
  }
  private async active(projectId: string) {
    let id: string;
    try { id = z.object({ id: uuid }).strict().parse(await readJSON(path.join(await this.home(projectId), 'active.json'), 1000)).id; }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new Error('The active review record cannot be read. It was preserved. Choose Fresh review to start another.'); }
    try { return await this.load(projectId, id); }
    catch { throw new Error('The saved review conversation cannot be read. It was preserved. Choose Fresh review to start another.'); }
  }
  private async save(projectId: string, meta: Meta) { await writeJSON(path.join(await this.folder(projectId, meta.id), 'conversation.json'), metaSchema.parse(meta), 1_000_000); }
  async current(projectId: string) { const m = await this.active(projectId); return m ? info(m) : null; }
  async state(projectId: string): Promise<ReviewConversationState> {
    const active = await this.active(projectId), home = await this.home(projectId), conversations: ReviewConversationInfo[] = [];
    for (const entry of await fs.readdir(home, { withFileTypes: true })) {
      if (!entry.isDirectory() || !uuid.safeParse(entry.name).success) continue;
      try { conversations.push(info(await this.load(projectId, entry.name))); } catch { /* Keep unreadable archives in place. */ }
    }
    return { active: active ? info(active) : null, conversations: conversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) };
  }
  private async turn(projectId: string, conversationId: string, requestId: string) {
    await this.load(projectId, conversationId);
    const value = turnSchema.parse(await readJSON(path.join(await this.folder(projectId, conversationId), `turn-${uuid.parse(requestId)}.json`)));
    if (value.id !== requestId) throw new Error('The saved review exchange has the wrong identity.');
    return value;
  }
  async history(projectId: string, conversationId: string, offset = 0, query = '') {
    const meta = await this.load(projectId, conversationId), entries = [...meta.entries].reverse();
    if (!query) return { items: entries.slice(offset, offset + 20), nextOffset: offset + 20 < entries.length ? offset + 20 : null };
    // Search a bounded page of exchanges, keeping only matching summaries.
    const items: ReviewTurnInfo[] = [], end = Math.min(entries.length, offset + 40);
    for (const entry of entries.slice(offset, end)) {
      const t = await this.turn(projectId, conversationId, entry.id);
      if (`${t.instruction}\n${JSON.stringify(t.response ?? '')}`.toLowerCase().includes(query.toLowerCase())) items.push(entry);
      if (items.length === 20) return { items, nextOffset: entries.indexOf(entry) + 1 < entries.length ? entries.indexOf(entry) + 1 : null };
    }
    return { items, nextOffset: end < entries.length ? end : null };
  }
  async inspect(projectId: string, conversationId: string, requestId: string) {
    return JSON.stringify(await this.turn(projectId, conversationId, requestId), null, 2);
  }
  async exchange(projectId: string, conversationId: string, requestId: string) {
    return readableExchange(await this.turn(projectId, conversationId, requestId));
  }
  private reader(projectId: string, conversationId: string, base?: CodexReader): CodexReader {
    let cancelled = false, characters = 0;
    return { tools: [...(base?.tools ?? []), historyTool], cancel: async () => { cancelled = true; await base?.cancel(); }, call: async (name, args) => {
      if (cancelled) throw new Error('Review reading cancelled.');
      if (name !== historyTool.name) { if (!base) throw new Error('File reading is unavailable.'); return base.call(name, args); }
      const a = historyArgs.parse(args);
      let result: unknown;
      if (a.requestId) {
        const text = exchangeDocument(await this.turn(projectId, conversationId, a.requestId)), offset = a.offset ?? 0, excerpt = text.slice(offset, offset + 10000);
        result = { name: `review-${a.requestId}.md`, requestId: a.requestId, text: excerpt, nextOffset: offset + excerpt.length < text.length ? offset + excerpt.length : null, historical: true };
      } else {
        const h = await this.history(projectId, conversationId, a.offset ?? 0, a.query);
        result = { ...h, name: 'review-history.md', text: '# Review history\n\nNewest first. Each item is a readable Markdown exchange: call review_history with its requestId (the item id). Search questions and answers with query; use nextOffset to continue this index. Entries include Side Chat notes. Earlier source and suggestions are historical. These views use existing records; no files need maintaining.',
          items: h.items.map(item => ({ ...item, name: `review-${item.id}.md`, instruction: item.instruction.slice(0, 500) })) };
      }
      if (cancelled) throw new Error('Review reading cancelled.');
      characters += JSON.stringify(result).length;
      if (characters > 80000) throw new Error('Review history reading budget reached. Narrow the question.');
      return result;
    } };
  }
  // Side Chat keeps its own conversation. A completed paper exchange becomes
  // a note in the active review, so the next review can incorporate it.
  async addPaperChat(projectId: string, request: Request, response: unknown) {
    return this.update(async () => {
      const meta = await this.active(projectId); if (!meta) return;
      if (meta.entries.length >= 1000) throw new Error('The review conversation is full. Start a fresh review.');
      const now = new Date().toISOString(), turn = turnSchema.parse({ ...request, id: randomUUID(), createdAt: now, status: 'complete', sequence: meta.nextSequence, prompt: '', response });
      await writeJSON(path.join(await this.folder(projectId, meta.id), `turn-${turn.id}.json`), turn);
      await this.save(projectId, { ...meta, nextSequence: meta.nextSequence + 1, updatedAt: now, entries: [...meta.entries, { ...publicTurn(turn), instruction: turn.instruction.slice(0, 160) }] });
    });
  }
  async paperChatNotes(projectId: string, conversationId: string) {
    const meta = await this.load(projectId, conversationId), notes = meta.entries.filter(t => t.kind === 'paper-chat' && t.status === 'complete');
    const selected = await Promise.all(notes.slice(-6).map(t => this.turn(projectId, conversationId, t.id)));
    return { total: notes.length, included: selected.length, items: selected.map(t => ({ id: t.id, question: t.instruction.slice(0, 2000), answer: JSON.stringify(t.response).slice(0, 3000), sourceHash: t.sourceHash })) };
  }
  async run<T>(projectId: string, mode: ReviewMode, request: Request, action: (session: { context: object; options: CodexConversation; reader(base?: CodexReader): CodexReader; prompt(text: string): Promise<void> }) => Promise<T>, stopped: () => boolean = () => false): Promise<T> {
    const owner = this.owner(projectId); if (this.busy.has(owner)) throw new Error('Finish the current review request first.');
    this.busy.add(owner);
    let meta: Meta | null = null, turn: Turn | undefined, total: TokenUsage | null = null;
    try {
      const opening = await this.update(async () => {
        let meta = mode === 'fresh' ? null : await this.active(projectId);
        if (!meta) {
          const now = new Date().toISOString();
          meta = { version: 1, owner, id: randomUUID(), label: request.instruction.replace(/\s+/g, ' ').slice(0, 160) || 'Paper review', createdAt: now, updatedAt: now, threadId: null, tokens: null, requests: 0, nextSequence: 0, entries: [] };
          await this.save(projectId, meta);
          await writeJSON(path.join(await this.home(projectId), 'active.json'), { id: meta.id }, 1000);
        }
        if (meta.nextSequence >= 1000) throw new Error('This conversation has reached 1,000 exchanges. Choose Fresh review; saved history is kept.');
        const turn = turnSchema.parse({ ...request, id: randomUUID(), createdAt: new Date().toISOString(), sequence: meta.nextSequence, status: 'pending', prompt: '' });
        await writeJSON(path.join(await this.folder(projectId, meta.id), `turn-${turn.id}.json`), turn);
        // Reserve the sequence before making a model request, including failures.
        meta = { ...meta, nextSequence: meta.nextSequence + 1, requests: meta.requests + 1, updatedAt: turn.createdAt, entries: [...meta.entries, { ...publicTurn(turn), instruction: turn.instruction.slice(0, 160) }] };
        await this.save(projectId, meta);
        return { meta, turn };
      });
      meta = opening.meta; turn = opening.turn; total = meta.tokens;
      const id = meta.id;
      const response = await action({
        context: { id, mode: meta.threadId ? 'continue' : 'fresh', currentDraftHash: request.sourceHash,
          history: { name: 'review-history.md', tool: 'review_history', instructions: 'Open with {} or search with query. Read an exchange by requestId. Includes earlier reviews, discussions and Side Chat notes in this conversation. Consult when relevant; current instructions and decisions remain authoritative.' } },
        // Invalidate the saved usage baseline before sending a turn. If the
        // process stops or no usage arrives, the next request reports unknown
        // usage rather than counting this turn a second time.
        options: { threadId: meta.threadId, tokens: meta.tokens, onThread: async threadId => {
          total = null;
          await this.update(async () => { const latest = await this.load(projectId, id); await this.save(projectId, { ...latest, threadId, tokens: null }); });
        }, onUsage: tokens => { total = tokens; } },
        reader: base => this.reader(projectId, id, base), prompt: async text => { turn!.prompt = text; await writeJSON(path.join(await this.folder(projectId, id), `turn-${turn!.id}.json`), turn); }
      });
      turn = { ...turn, status: 'complete', response }; return response;
    } catch (error) {
      if (turn) turn = { ...turn, status: stopped() ? 'stopped' : 'failed', error: (error instanceof Error ? error.message : String(error)).slice(0, 4000) };
      throw error;
    } finally {
      try {
        if (meta && turn) {
          const id = meta.id, finished = turn;
          await this.update(async () => {
            await writeJSON(path.join(await this.folder(projectId, id), `turn-${finished.id}.json`), turnSchema.parse(finished));
            const latest = await this.load(projectId, id);
            await this.save(projectId, { ...latest, tokens: total, updatedAt: new Date().toISOString(), entries: latest.entries.map(e => e.id === finished.id ? { ...publicTurn(finished), instruction: finished.instruction.slice(0, 160) } : e) });
          });
        }
      } finally { this.busy.delete(owner); }
    }
  }
}
