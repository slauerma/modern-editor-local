import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { commentSchema, commentsSchema, type Comment } from '../shared/contracts.ts';
import { adoptComment, captureContext } from '../shared/review.ts';
import { digest } from './files.ts';
import type { CodexReader } from './reference-service.ts';
import type { ReviewRange } from '../shared/changed-review.ts';

export const publishCommentsTool = 'publish_comments';
const responseSchema = z.object({ comments: z.array(z.unknown()).max(2000) }).strict();
const reviewCommentSchema = z.object(commentSchema.shape).pick({ category: true, title: true, explanation: true, original: true, before: true, after: true, replacement: true, packages: true });
// Repeat deliveries deduplicate, but identical edits at distinct passages remain separate.
const identity = (c: Comment) => JSON.stringify([c.validity === 'current' ? [c.from, c.to] : null, c.original, c.before, c.after, c.replacement, c.packages, c.replacement === null ? c.explanation : null]);

/** Validate complete batches against one frozen draft, then save before delivery. */
export class ReviewPublisher {
  private queue: Promise<unknown> = Promise.resolve();
  private acceptingTools = true;
  private comments: Comment[] = [];
  private seen = new Set<string>();
  private text: string;
  private from: number;
  private to: number;
  private persist: (comments: Comment[], final: boolean) => Promise<void>;
  private active: () => boolean;
  private category?: string;
  private ranges?: ReviewRange[];
  get publishedCount() { return this.comments.length; }
  constructor(text: string, from: number, to: number,
    persist: (comments: Comment[], final: boolean) => Promise<void>, active: () => boolean, category?: string, ranges?: ReviewRange[]) {
    this.text = text; this.from = from; this.to = to; this.persist = persist; this.active = active;
    this.category = category;
    this.ranges = ranges;
  }

  private enqueue(response: unknown, final: boolean) {
    const task = this.queue.then(async () => {
      if (!this.active() || (!final && !this.acceptingTools)) throw new Error('Review delivery cancelled.');
      const passage = this.text.slice(this.from, this.to), now = new Date().toISOString(), hash = digest(this.text);
      const parsed = responseSchema.parse(response);
      const candidates = commentsSchema.parse(parsed.comments.map(raw => {
        const c = commentSchema.parse({ ...reviewCommentSchema.parse(raw), ...(this.category ? { category: this.category } : {}), id: randomUUID(), decision: 'open', validity: 'missing' });
        const local = c.original && passage.includes(c.original) ? adoptComment(passage, c) : c;
        const placed = local.validity === 'current' ? captureContext(this.text, { ...local, from: local.from + this.from, to: local.to + this.from }) : local;
        if (this.ranges && placed.replacement !== null && (placed.validity !== 'current' || !this.ranges.some(r => placed.from >= r.from && placed.to <= r.to)))
          throw new Error('This replacement is outside the confirmed changed passages. Quote a current passage within review-changes, or raise the wider concern as a question with replacement:null. No comments from this batch were delivered.');
        return { ...placed, reviewedSourceHash: hash, reviewedAt: now };
      }));
      const seen = new Set(this.seen);
      const added = candidates.filter(c => { const key = identity(c); if (seen.has(key)) return false; seen.add(key); return true; });
      const combined = commentsSchema.parse([...this.comments, ...added]);
      // Empty final reviews retain the existing completed-result behavior.
      if (added.length || (final && !combined.length)) await this.persist(added, final);
      this.seen = seen; this.comments = combined;
      return { published: added.length, total: combined.length };
    });
    this.queue = task.catch(() => {});
    return task;
  }
  reader(schema: unknown, base?: CodexReader): CodexReader {
    return {
      tools: [...(base?.tools ?? []), {
        type: 'function', name: publishCommentsTool,
        description: 'Save and deliver one useful comment or a small complete batch now, then continue reviewing. Do not wait for five comments or the end of the review. Does not edit the draft or accept suggestions. Quote the frozen review passage exactly. Await success before treating the batch as delivered. Do not repeat delivered comments in the final response.',
        inputSchema: schema as CodexReader['tools'][number]['inputSchema']
      }],
      call: (name, args) => {
        if (name === publishCommentsTool) return this.enqueue(args, false);
        if (!base) return Promise.reject(new Error('Unknown review tool.'));
        return base.call(name, args);
      },
      cancel: async () => { this.acceptingTools = false; await this.queue; await base?.cancel(); }
    };
  }
  async finish(response: unknown) {
    await this.enqueue(response, true);
    return this.comments;
  }
}
