import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Transaction } from '@codemirror/state';
import { undo, redo } from '@codemirror/commands';
import { initialState, commentsField, loadComments } from '../src/renderer/editor-state.ts';
import { commentSchema } from '../src/shared/contracts.ts';
import { proposalContext } from '../src/shared/proposal-diff.ts';
import { proposalChanges } from '../src/shared/review.ts';
import { UsageStore } from '../src/main/usage-store.ts';
import { parseAccountLimits, summarizeUsage, type UsageRecord } from '../src/shared/usage.ts';

const makeComment = (text: string, original: string, id = original, from = text.indexOf(original)) => commentSchema.parse({ id, title: id, explanation: '', original, replacement: 'REVISED', from, to: from + original.length, validity: 'current' });

test('small edits show a few sentences, with expansion and exact edit bytes preserved', () => {
  const text = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} provides context. Its conclusion is valid.`).join('\n');
  const from = text.indexOf('conclusion', 1000), c = makeComment(text, 'conclusion', 'tiny', from);
  const context = proposalContext(text, c), full = proposalContext(text, c, true);
  assert(context.before.length + context.after.length < 250);
  assert(context.hasMore && context.omittedBefore && context.omittedAfter);
  assert.equal(full.before + c.original + full.after, text);
  assert.equal(proposalChanges(text, c)[0].insert, 'REVISED');
  const long = makeComment(text, text.slice(100, 1500), 'long');
  const display = proposalContext(text, long);
  assert.equal(display.before + long.original + display.after, text.slice(long.from - display.before.length, long.to + display.after.length));
  assert.equal(long.original.length, 1400);
});

test('unpunctuated context is bounded; stale proposals receive no guessed context', () => {
  const text = 'many words '.repeat(2000) + 'TARGET' + ' other words'.repeat(2000), c = makeComment(text, 'TARGET');
  const context = proposalContext(text, c);
  assert(context.before.length <= 600 && context.after.length <= 600 && context.hasMore);
  assert.equal(proposalContext(text, { ...c, validity: 'stale' }).contextual, false);
});

for (const event of ['input.paste', 'input.type']) test(`${event}: replacing a large selection preserves untouched anchors and Undo/Redo`, () => {
  const text = 'Intro: a result.\nThe first conclusion is stable.\nA second conclusion is stable.\nA final claim stays intact.';
  const comments = [makeComment(text, 'first conclusion'), makeComment(text, 'stable', 'second-stable', text.lastIndexOf('stable')), makeComment(text, 'final claim')];
  const after = text.replace('a result', 'an improved result').replace('final claim', 'last claim');
  let state = initialState(text, comments);
  state = state.update({ changes: { from: 0, to: text.length, insert: after }, selection: { anchor: after.length }, annotations: Transaction.userEvent.of(event) }).state;
  assert.equal(state.doc.toString(), after); assert.equal(state.selection.main.head, after.length);
  const next = state.field(commentsField);
  for (const c of next.slice(0, 2)) { assert.equal(c.validity, 'current'); assert.equal(after.slice(c.from, c.to), c.original); }
  assert.equal(next[1].from, after.lastIndexOf('stable'));
  assert.equal(next[2].validity, 'stale'); assert.throws(() => proposalChanges(after, next[2]));
  assert(undo({ state, dispatch: tr => { state = tr.state; } }));
  assert.equal(state.doc.toString(), text); assert.deepEqual(state.field(commentsField), comments);
  assert(redo({ state, dispatch: tr => { state = tr.state; } }));
  assert.equal(state.doc.toString(), after); assert.deepEqual(state.field(commentsField), next);
});

test('an already stale anchor remains stale after a nearly identical paste', () => {
  const text = 'A sufficiently long paragraph has a repeated word. Here is another repeated word.';
  const c = { ...makeComment(text, 'repeated word'), validity: 'stale' as const };
  const state = initialState(text, [c]).update({ changes: { from: 0, to: text.length, insert: text + ' More.' }, annotations: Transaction.userEvent.of('input.paste') }).state;
  assert.equal(state.field(commentsField)[0].validity, 'stale');
});

const record = (n = 0): UsageRecord => ({ id: randomUUID(), createdAt: new Date().toISOString(), scope: null, purpose: 'review', model: 'fixture-model', effort: 'high', fastMode: true, outcome: 'complete', elapsedMs: 1000 + n, firstAnswerMs: 400, connectMs: 100, setupMs: 200, tokens: null });
test('usage metadata persists independently, is bounded, and excludes source/unknown fields', async () => {
  const root = path.resolve('.test-runs', 'usage-' + randomUUID());
  const store = new UsageStore(path.join(root, 'usage'));
  try {
    await fs.mkdir(root, { recursive: true });
    const entries = Array.from({ length: 1000 }, (_, i) => record(i));
    await fs.mkdir(path.dirname(store.file));
    await fs.writeFile(store.file, JSON.stringify({ enabled: true, since: new Date().toISOString(), entries }));
    await Promise.all([store.record({ ...record(), source: 'PRIVATE SOURCE', reply: 'PRIVATE REPLY' } as UsageRecord), store.record(record())]);
    const state = await new UsageStore(path.join(root, 'usage')).state();
    assert.equal(state.entries.length, 1000); assert(!state.entries.some(r => r.id === entries[0].id));
    assert(!(await fs.readFile(store.file, 'utf8')).includes('PRIVATE'));
    await store.configure(false); await store.record(record());
    assert.equal((await store.state()).entries.length, 1000); assert.equal((await store.state()).enabled, false);
    const corrupt = path.join(root, 'broken'); await fs.mkdir(corrupt); await fs.writeFile(path.join(corrupt, 'requests.json'), 'broken');
    const broken = new UsageStore(corrupt); await broken.record(record());
    assert.match((await broken.state()).notice, /preserved/); assert.equal(await fs.readFile(broken.file, 'utf8'), 'broken');
    const fresh = new UsageStore(path.join(root, 'fresh')); await fresh.record(record()); assert.equal((await fresh.state()).entries.length, 1);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('reported tokens are distinct from account allowance, with unknown values preserved', () => {
  const a = record(), b = { ...record(2000), tokens: { totalTokens: 120, inputTokens: 100, cachedInputTokens: 30, outputTokens: 20, reasoningOutputTokens: 10 } };
  assert.deepEqual(summarizeUsage([a, b]), { requests: 2, complete: 2, errors: 0, cancelled: 0, medianMs: 2000, totalTokens: 120, tokenReports: 1 });
  const limits = parseAccountLimits({ rateLimits: { primary: null }, rateLimitsByLimitId: { codex: { limitName: 'Codex', primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 12345 } } }, accountId: 'private', credits: 'private' });
  assert.equal(limits.windows[0].usedPercent, 25); assert.equal(limits.windows[1].usedPercent, null);
  assert(!JSON.stringify(limits).includes('private')); assert.equal(summarizeUsage([a]).totalTokens, null);
});


test('background comment arrivals survive Undo after a refined paste', () => {
  const text = 'First paragraph is clear. Another paragraph has an exact target. Last words are unchanged.';
  const a = makeComment(text, 'First paragraph');
  const changed = 'An introduction. ' + text;
  let state = initialState(text, [a]).update({ changes: { from: 0, to: text.length, insert: changed }, annotations: Transaction.userEvent.of('input.paste') }).state;
  const b = makeComment(changed, 'exact target');
  state = state.update({ effects: loadComments.of([...state.field(commentsField), b]), annotations: Transaction.addToHistory.of(false) }).state;
  assert(undo({ state, dispatch: tr => { state = tr.state; } }));
  assert.equal(state.doc.toString(), text); assert.equal(state.field(commentsField).length, 2);
  for (const c of state.field(commentsField)) { assert.equal(c.validity, 'current'); assert.equal(text.slice(c.from, c.to), c.original); }
});
