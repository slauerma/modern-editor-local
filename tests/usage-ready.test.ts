import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { UsageStore } from '../src/main/usage-store.ts';
import type { UsageRecord } from '../src/shared/usage.ts';

test('readiness survives the final usage write, remains first-only and separates manual/unknown/empty', async t => {
  const directory = path.resolve('.test-runs', 'usage-ready-' + randomUUID());
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new UsageStore(directory);
  const record = (id: string): UsageRecord => ({ id, createdAt: new Date().toISOString(), scope: null, purpose: 'review',
    model: null, effort: 'high', fastMode: true, outcome: 'complete', elapsedMs: 200, firstAnswerMs: 80,
    connectMs: 10, setupMs: 10, tokens: null });
  const first = randomUUID(), final = randomUUID(), empty = randomUUID(), old = randomUUID();
  store.startComments(first, 100);
  await store.publishedComments(first, 2);
  await store.commentReady(first, 'automatic', 140);
  await store.record(record(first)); // Completion arrives after early delivery.
  await store.commentReady(first, 'manual', 300);
  await store.record(record(first)); // Late/repeated completion cannot erase readiness.
  store.startComments(final, 100); await store.record(record(final));
  await store.publishedComments(final, 1); // Final-only response arrives after client completion.
  await store.commentReady(final, 'manual', 350);
  store.startComments(empty, 100); await store.record(record(empty)); await store.record(record(old));
  const entries = (await store.state()).entries;
  assert.deepEqual(entries.find(r => r.id === first), { ...record(first), createdAt: entries.find(r => r.id === first)!.createdAt,
    commentCount: 2, firstUsableMs: 40, firstUsableDelivery: 'automatic' });
  assert.equal(entries.find(r => r.id === final)?.firstUsableMs, 250);
  assert.equal(entries.find(r => r.id === final)?.firstUsableDelivery, 'manual');
  assert.equal(entries.find(r => r.id === empty)?.commentCount, 0);
  assert.equal(entries.find(r => r.id === old)?.commentCount, undefined);
  const reopened = new UsageStore(directory); await reopened.commentReady(old, 'automatic', 500);
  assert.equal((await reopened.state()).entries.find(r => r.id === old)?.firstUsableMs, undefined);
  assert.equal((await reopened.state()).entries.find(r => r.id === first)?.firstUsableMs, 40);
  const review = randomUUID(), chat = randomUUID();
  store.startComments(review, 100); store.startComments(chat, 150);
  await store.record(record(review)); await store.record({ ...record(chat), purpose: 'help' });
  await store.commentReady(review, 'automatic', 400); // The latest row belongs to the other request.
  await store.commentReady(chat, 'automatic', 420);
  const overlapping = (await store.state()).entries;
  assert.equal(overlapping.find(r => r.id === review)?.firstUsableMs, 300);
  assert.equal(overlapping.find(r => r.id === chat)?.firstUsableMs, 270);
  await store.configure(false);
  const off = randomUUID(); store.startComments(off, 100); await store.record(record(off)); await store.commentReady(off, 'automatic', 150);
  assert(!(await store.state()).entries.some(r => r.id === off));
});
