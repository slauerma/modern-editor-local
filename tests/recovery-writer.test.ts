import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RecoveryWriter } from '../src/renderer/recovery-writer.ts';
import { WorkGate } from '../src/renderer/work-gate.ts';

const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
const turns = async () => { for (let n = 0; n < 12; n++) await Promise.resolve(); };

test('continuous typing records recovery at two seconds without waiting for an idle gap', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const writes: string[] = [], writer = new RecoveryWriter<string>(async value => { writes.push(value); }, error => assert.fail(String(error)));
  for (let i = 0; i < 20; i++) { writer.schedule(`edit ${i}`); t.mock.timers.tick(100); await turns(); }
  assert.deepEqual(writes, ['edit 19']);
  writer.schedule('final edit'); t.mock.timers.tick(499); await turns(); assert.equal(writes.length, 1);
  t.mock.timers.tick(1); await turns(); assert.deepEqual(writes, ['edit 19', 'final edit']);
  writer.clearTimers();
});

test('a slow write coalesces typing and every joining flush waits for the final revision', async () => {
  const first = deferred(), last = deferred(), writes: string[] = [];
  const writer = new RecoveryWriter<string>(async value => { writes.push(value); await (value === 'first' ? first.promise : last.promise); }, error => assert.fail(String(error)));
  const a = writer.flush('first');
  for (let i = 0; i < 100; i++) writer.schedule('middle ' + i);
  let finished = false;
  const b = writer.flush('last').then(() => { finished = true; });
  first.resolve(); await turns();
  assert.deepEqual(writes, ['first', 'last']); assert.equal(finished, false);
  last.resolve(); await Promise.all([a, b]); assert(finished); writer.clearTimers();
});

test('failed recovery stays retryable and a newer buffer replaces the failed snapshot', async () => {
  let fail = true; const writes: string[] = [];
  const writer = new RecoveryWriter<string>(async value => { if (fail) throw new Error('disk unavailable'); writes.push(value); }, error => assert.fail(String(error)));
  await assert.rejects(writer.flush('old'), /disk unavailable/);
  writer.schedule('newer author text'); fail = false; await writer.flush();
  assert.deepEqual(writes, ['newer author text']); writer.clearTimers();
});

test('close blocks new work and waits for pending work before its final recovery snapshot', async () => {
  const gate = new WorkGate(), events: string[] = [], done = gate.begin('codex')!;
  const closing = gate.close(async () => { events.push('cancel'); }, async () => { events.push('persist final'); }, async () => { events.push('close'); });
  assert(gate.locked); assert.equal(gate.begin('save'), null); await turns();
  assert.deepEqual(events, ['cancel']); done(); await closing;
  assert.deepEqual(events, ['cancel', 'persist final', 'close']);
});

test('close failure unlocks the window and does not grant permission to close', async () => {
  const gate = new WorkGate(); let closes = 0;
  await assert.rejects(gate.close(async () => {}, async () => { throw new Error('storage full'); }, async () => { closes++; }), /storage full/);
  assert.equal(closes, 0); assert.equal(gate.locked, false);
  await gate.close(async () => {}, async () => {}, async () => { closes++; }); assert.equal(closes, 1);
});

test('an accepted edit already being recorded settles before close captures it', async () => {
  const gate = new WorkGate(), written = deferred(), done = gate.begin('build')!;
  let source = 'old'; const records: string[] = [];
  const commit = gate.commit(async () => { source = 'accepted'; await written.promise; }).finally(done);
  const closing = gate.close(async () => {}, async () => { records.push(source); }, async () => { records.push('closed'); });
  await turns(); assert.deepEqual(records, []); assert(gate.locked);
  written.resolve(); await Promise.all([commit, closing]); assert.deepEqual(records, ['accepted', 'closed']);
});

test('project switching locks edits and cannot overlap another open or existing operation', () => {
  const gate = new WorkGate(), done = gate.begin('project')!;
  assert(gate.locked); assert.equal(gate.begin('project'), null); assert.equal(gate.begin('build'), null);
  done(); assert.equal(gate.locked, false);
  const saving = gate.begin('save')!; assert.equal(gate.begin('project'), null); saving();
});
