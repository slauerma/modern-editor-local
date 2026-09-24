import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DebugStore } from '../src/main/debug-store.ts';
import { defaultDebugSettings } from '../src/shared/debugging.ts';

async function fixture(limit = 100000) {
  const root = path.resolve('.test-runs', 'debug-' + randomUUID()); await fs.mkdir(root, { recursive: true });
  return { root, directory: path.join(root, 'debugging'), store: new DebugStore(path.join(root, 'debugging'), limit) };
}
test('debugging defaults off, creates no payloads and is separate from normal data', async () => {
  const { root, directory, store } = await fixture();
  try {
    await store.record('prompt', 'Test', { text: 'synthetic private text' });
    assert.equal((await store.state()).settings.enabled, false);
    await assert.rejects(fs.stat(directory), { code: 'ENOENT' });
    await store.configure({ ...defaultDebugSettings, enabled: true });
    await store.record('prompt', 'Review instruction', { text: 'Synthetic language review' });
    await store.record('screenshot', 'Page', null, { bytes: Buffer.from('synthetic image'), extension: 'png' });
    const state = await store.state(), registry = JSON.parse(await fs.readFile(path.join(directory, 'register.json'), 'utf8'));
    assert.equal(state.entries.length, 2); assert.equal(registry.length, 2);
    for (const e of registry) assert.equal((await fs.stat(path.join(directory, e.file))).size, e.bytes);
    const reopened = new DebugStore(directory); assert.equal((await reopened.state()).entries.length, 2);
    await store.configure(defaultDebugSettings); await store.record('reply', 'Test', 'Should not be saved');
    assert.equal((await store.state()).entries.length, 2);
    await store.remove([state.entries[0].id]); assert.equal((await store.state()).entries.length, 1);
    await store.remove('all'); assert.equal((await store.state()).bytes, 0);
    assert.deepEqual((await fs.readdir(directory)).sort(), ['register.json', 'settings.json']);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test('debug budget stops logging, retains prior evidence, and permits cleansing', async () => {
  const { root, store } = await fixture(500);
  try {
    await store.configure({ ...defaultDebugSettings, enabled: true });
    await store.record('event', 'one', 'x'.repeat(160)); await store.record('event', 'two', 'y'.repeat(500));
    const state = await store.state(); assert.equal(state.entries.length, 1); assert.match(state.notice, /full|large/);
    await store.remove('all'); await store.configure({ ...defaultDebugSettings, enabled: true }); await store.record('event', 'three', 'ok'); assert.equal((await store.state()).entries.length, 1);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test('debug register recovers an orphan payload and rejects caller paths and symlink storage', async () => {
  const { root, store, directory } = await fixture();
  try {
    await store.configure({ ...defaultDebugSettings, enabled: true });
    const id = randomUUID(); await fs.writeFile(path.join(directory, id + '.json'), '{"synthetic":true}');
    const reopened = new DebugStore(directory); assert.equal((await reopened.state()).entries.length, 1);
    assert.throws(() => reopened.remove(['../paper.tex']));
    await reopened.remove('all'); await assert.rejects(fs.stat(path.join(directory, id + '.json')), { code: 'ENOENT' });
    const link = path.join(root, 'linked'); await fs.symlink(directory, link);
    const blocked = new DebugStore(link); assert.equal((await blocked.state()).settings.enabled, false);
    await assert.rejects(blocked.configure({ ...defaultDebugSettings, enabled: true }), /regular directory/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('a failed debug write reports a notice but cannot block the close drain', async () => {
  const { root, store, directory } = await fixture();
  try {
    await store.configure({ ...defaultDebugSettings, enabled: true });
    // A directory at the register path makes its atomic replacement fail.
    await fs.mkdir(path.join(directory, 'register.json'));
    await store.record('event', 'Synthetic write failure', { outcome: 'test' });
    await assert.doesNotReject(store.settle());
    assert.match((await store.state()).notice, /could not be saved/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
