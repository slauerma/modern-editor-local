import path from 'node:path';
import { wordingReason } from '../shared/alternatives.ts';
import { proposalPreview } from '../shared/proposal-preview.ts';
import { z } from 'zod';
import { ChangeSet } from '@codemirror/state';
import type { Comment } from '../shared/contracts.ts';
import { exactChanges, type ComparisonPlan, type ChangeReason } from '../shared/changes-pdf.ts';
import { atomicWrite, digest, exists, readJSON } from './files.ts';

const LIMIT = 8_000_000;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const reasonSchema = z.object({ from: z.number().int().nonnegative(), to: z.number().int().nonnegative(),
  text: z.string().max(12000), edited: z.boolean() });
const eventSchema = z.object({ before: hash, after: hash, length: z.number().int().nonnegative().max(2_000_000),
  time: z.string(), edits: z.array(z.object({ from: z.number().int().nonnegative(), to: z.number().int().nonnegative(), insert: z.string().max(2_000_000), removed: z.string().max(2_000_000) })).max(10000),
  reasons: z.array(reasonSchema).max(2000) });
const journalSchema = z.object({ version: z.literal(1), events: z.array(eventSchema).max(500) });
type Event = z.infer<typeof eventSchema>;

/** Supplemental history: a journal problem must never prevent recovery or Save. */
export class ChangeJournal {
  private file = ''; private text = ''; private comments: Comment[] = [];
  private liveText = ''; private liveComments: Comment[] = [];
  private events: Event[] = [];
  notice = '';
  async open(home: string, text: string, comments: Comment[]) {
    this.file = path.join(home, 'change-journal.json'); this.text = text; this.comments = structuredClone(comments); this.events = []; this.notice = '';
    this.liveText = text; this.liveComments = structuredClone(comments);
    try { if (await exists(this.file)) this.events = journalSchema.parse(await readJSON(this.file, LIMIT)).events; }
    catch { this.notice = 'The change journal could not be read. It is preserved; reason recording is paused. Exact source comparison is still available.'; }
  }
  async record(text: string, comments: Comment[]) {
    // Current proposal validation does not depend on optional durable history.
    this.liveText = text; this.liveComments = structuredClone(comments);
    if (!this.file || this.notice) return;
    try {
      if (text === this.text) { this.comments = structuredClone(comments); return; }
      const edits = exactChanges(this.text, text).map(c => ({ from: c.fromA, to: c.toA, insert: text.slice(c.fromB, c.toB), removed: this.text.slice(c.fromA, c.toA) }));
      let mapping = ChangeSet.of(edits, this.text.length);
      const accepted = comments.flatMap(c => {
        const prior = this.comments.find(p => p.id === c.id), value = c.appliedText ?? c.draft ?? c.replacement;
        if (!prior || prior.decision === 'applied' || c.decision !== 'applied' || prior.validity !== 'current' || c.validity !== 'current' || value === null ||
          this.text.slice(prior.from, prior.to) !== prior.original || text.slice(c.from, c.to) !== value) return [];
        return [{ from: prior.from, to: prior.to, insert: value }];
      }).sort((a, b) => a.from - b.from);
      // A character diff may align repeated letters across adjacent accepted
      // atoms. Prefer their recorded transaction spans when those edits alone
      // reconstruct this exact snapshot. Otherwise use the conservative net map.
      if (accepted.length && accepted.every((e, i) => !i || e.from >= accepted[i - 1].to)) {
        const pieces: string[] = []; let at = 0;
        for (const e of accepted) { pieces.push(this.text.slice(at, e.from), e.insert); at = e.to; }
        pieces.push(this.text.slice(at));
        if (pieces.join('') === text) mapping = ChangeSet.of(accepted, this.text.length);
      }
      const reasons: Event['reasons'] = [];
      for (const c of comments) {
        const prior = this.comments.find(p => p.id === c.id);
        if (!prior || prior.decision === 'applied' || c.decision !== 'applied') continue;
        const value = c.appliedText ?? c.draft ?? c.replacement;
        if (value === null || prior.validity !== 'current' || c.validity !== 'current') continue;
        // A coalesced write can include later typing. Record a reason only when
        // the actual accepted text and original are still established exactly.
        const at = c.from;
        if (prior.to < prior.from || c.to < at || prior.to > this.text.length || c.to > text.length ||
          this.text.slice(prior.from, prior.to) !== prior.original || text.slice(at, c.to) !== value ||
          mapping.mapPos(prior.from, -1) !== at || mapping.mapPos(prior.to, 1) !== c.to) continue;
        if (!edits.some(e => e.from < prior.to && e.to > prior.from || e.from === e.to && e.from >= prior.from && e.from <= prior.to)) continue;
        const explanation = wordingReason(c);
        if (explanation.length > 12000) continue;
        reasons.push({ from: at, to: at + value.length, text: explanation, edited: value !== c.replacement });
      }
      const event: Event = { before: digest(this.text), after: digest(text), length: this.text.length, time: new Date().toISOString(), edits, reasons };
      const next = journalSchema.parse({ version: 1, events: [...this.events, event] }), encoded = JSON.stringify(next);
      if (Buffer.byteLength(encoded) > LIMIT) throw new Error('Journal limit');
      await atomicWrite(this.file, encoded);
      this.events = next.events; this.text = text; this.comments = structuredClone(comments);
    } catch { this.notice = 'Reason recording is paused: the change journal reached its limit or could not be written. Existing records are preserved; source recovery and Save are unaffected.'; }
  }
  proposal(before: string, after: string, id: string): ChangeReason | null {
    const c = this.liveComments.find(c => c.id === id);
    if (!c || this.liveText !== before) return null;
    try { if (proposalPreview(before, c).text !== after) return null; } catch { return null; }
    const value = c.draft ?? c.replacement;
    return { text: wordingReason(c), edited: value !== c.replacement, origin: 'proposal' };
  }
  explain(before: string, after: string, plan: ComparisonPlan): ComparisonPlan {
    const result = structuredClone(plan); result.notice = this.notice || undefined;
    const start = digest(before), end = digest(after);
    // Most recent complete chain wins (including Undo/reapply). Gaps are not
    // bridged with fuzzy matching, and historical explanations are not invented.
    let chain: Event[] | undefined;
    for (let i = this.events.length - 1; i >= 0; i--) if (this.events[i].before === start) {
      const candidate: Event[] = []; let current = start;
      for (let j = i; j < this.events.length && this.events[j].before === current; j++) {
        candidate.push(this.events[j]); current = this.events[j].after;
        if (current === end) chain = [...candidate];
      }
      if (chain) break;
    }
    if (!chain) return result;
    // Remove exact source cycles, including an acceptance followed by Undo.
    // A later manual edit must not inherit a reason from the undone branch.
    const net: Event[] = [], positions = new Map<string, number>([[start, 0]]);
    for (const e of chain) {
      const position = positions.get(e.after);
      if (position !== undefined) {
        for (const removed of net.slice(position)) positions.delete(removed.after);
        net.length = position;
      } else { net.push(e); positions.set(e.after, net.length); }
    }
    let replay = before;
    let tracked: Event['reasons'] = [];
    try {
      for (const e of net) {
        if (digest(replay) !== e.before || replay.length !== e.length || e.edits.some(c => replay.slice(c.from, c.to) !== c.removed)) throw new Error('Inconsistent journal');
        const map = ChangeSet.of(e.edits, e.length);
        let next = replay;
        for (const c of [...e.edits].reverse()) next = next.slice(0, c.from) + c.insert + next.slice(c.to);
        if (digest(next) !== e.after) throw new Error('Inconsistent journal');
        replay = next;
        tracked = tracked.map(r => ({
          ...r, edited: r.edited || e.edits.some(c => c.from < r.to && c.to > r.from || c.from === c.to && c.from >= r.from && c.from <= r.to),
          from: map.mapPos(r.from, -1), to: map.mapPos(r.to, 1)
        }));
        tracked.push(...e.reasons);
      }
      for (const c of result.changes) {
        const seen = new Set<string>();
        c.reasons = tracked.filter(r => {
          if (r.from !== r.to) return r.from < c.toB && r.to > c.fromB;
          // A deletion leaves a point, often at a paragraph's first byte.
          // Give it one owner: exact deletion block, then the following block,
          // or the final block when the point is at EOF.
          const owner = result.changes.find(x => x.fromB === r.from && x.toB === r.from) ??
            result.changes.find(x => x.fromB <= r.from && r.from < x.toB) ??
            (r.from === after.length ? result.changes.findLast(x => x.toB === r.from) : undefined);
          return owner === c;
        }).filter(r => !seen.has(r.text) && !!seen.add(r.text))
          .map(r => ({ text: r.text, edited: r.edited, origin: 'accepted' as ChangeReason['origin'] }));
      }
    } catch { result.notice = 'Some recorded reasons could not be mapped. The exact comparison is still shown.'; }
    return result;
  }
}
