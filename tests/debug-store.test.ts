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


test('disabling periodic screenshots invalidates an in-flight capture while other logging stays on', async () => {
  const { root, store } = await fixture();
  try {
    await store.configure({ ...defaultDebugSettings, enabled: true, screenshots: true });
    const generation = store.captureGeneration;
    let finish!: () => void;
    const capture = new Promise<void>(resolve => { finish = resolve; }).then(() => store.recordWindowScreenshot(generation, Buffer.from('synthetic capture')));
    await store.configure({ ...defaultDebugSettings, enabled: true, screenshots: false });
    finish(); await capture;
    await store.record('event', 'Still recording events', { synthetic: true });
    assert.deepEqual((await store.state()).entries.map(e => e.kind), ['event']);
    await store.configure({ ...defaultDebugSettings, enabled: true, screenshots: true });
    await store.recordWindowScreenshot(generation, Buffer.from('late capture from before off/on'));
    assert.equal((await store.state()).entries.length, 1);
    await store.recordWindowScreenshot(store.captureGeneration, Buffer.from('new capture'));
    assert.equal((await store.state()).entries.filter(e => e.kind === 'screenshot').length, 1);
    const beforeClearing = store.captureGeneration;
    await store.remove('all');
    await store.configure({ ...defaultDebugSettings, enabled: true, screenshots: true });
    await store.recordWindowScreenshot(beforeClearing, Buffer.from('late capture after clearing'));
    assert.equal((await store.state()).entries.length, 0);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('action/timing batches default off, retain timestamps and exact byte counts, and can be cleansed', async () => {
  const { root, store, directory } = await fixture(1000000);
  try {
    await store.recordEvent('Interaction', { action: 'discussion', elapsedMs: 1200 });
    await assert.rejects(fs.stat(directory), { code: 'ENOENT' });
    await store.configure({ ...defaultDebugSettings, enabled: true, screenshots: false });
    for (let i = 0; i < 105; i++) await store.recordEvent('Interaction', { action: 'discussion', elapsedMs: i });
    const state = await store.state(); assert.equal(state.entries.length, 2);
    const batches = await Promise.all([...state.entries].reverse().map(async e => {
      const bytes = await fs.readFile(path.join(directory, e.file)); assert.equal(bytes.length, e.bytes); return JSON.parse(bytes.toString());
    }));
    assert.deepEqual(batches.map(b => b.events.length), [100, 5]);
    assert(batches.flatMap(b => b.events).every(e => Number.isFinite(Date.parse(e.at))));
    assert.equal(batches[1].events[4].data.elapsedMs, 104);
    // Simulate a payload append surviving a failed register replacement.
    const registry = JSON.parse(await fs.readFile(path.join(directory, 'register.json'), 'utf8')); registry[1].bytes = 1;
    await fs.writeFile(path.join(directory, 'register.json'), JSON.stringify(registry));
    const reopened = new DebugStore(directory); assert.equal((await reopened.state()).bytes, state.bytes);
    await store.remove([state.entries[0].id]); await store.recordEvent('Interaction', { action: 'accept' });
    assert.equal((await store.state()).entries.length, 2); // Deleted batch was not resurrected.
    const queued = store.recordEvent('Interaction', { action: 'reject' }); const clear = store.remove('all'); await queued; await clear;
    await store.recordEvent('Interaction', { action: 'accept' }); assert.equal((await store.state()).bytes, 0);
    assert.deepEqual((await fs.readdir(directory)).sort(), ['register.json', 'settings.json']);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('bounded action metadata rejects content and invalid elapsed times', async () => {
  const { debugInteractionSchema } = await import('../src/shared/debugging.ts');
  assert(debugInteractionSchema.safeParse({ action: 'discussion', mode: 'quick', elapsedMs: 4100, outcome: 'complete' }).success);
  for (const bad of [{ action: 'discussion', text: 'source text' }, { action: 'keystroke' }, { action: 'accept', elapsedMs: -1 }, { action: 'accept', elapsedMs: Infinity }]) assert(!debugInteractionSchema.safeParse(bad).success);
});

for (const action of ['selected', 'all', 'configure'] as const) test(`an in-flight batch append cannot resurrect old events after ${action}`, { timeout: 5000 }, async () => {
  const { root, store, directory } = await fixture(), originalRename = fs.rename;
  let release!: () => void, entered!: () => void;
  const paused = new Promise<void>(resolve => { entered = resolve; }), resume = new Promise<void>(resolve => { release = resolve; });
  try {
    await store.configure({ ...defaultDebugSettings, enabled: true });
    await store.recordEvent('First', {}); const first = (await store.state()).entries[0];
    fs.rename = async (from, to) => { if (to === path.join(directory, first.file)) { entered(); await resume; } return originalRename(from, to); };
    const append = store.recordEvent('Second', {}); await paused;
    const operation = action === 'configure' ? store.configure(defaultDebugSettings) : store.remove(action === 'all' ? 'all' : [first.id]);
    release(); await append; await operation; fs.rename = originalRename;
    if (action !== 'selected') await store.configure({ ...defaultDebugSettings, enabled: true });
    await store.recordEvent('Third', {});
    const entries = (await store.state()).entries, newest = entries[0];
    assert.notEqual(newest.id, first.id); assert.equal(entries.length, action === 'configure' ? 2 : 1);
    const payload = JSON.parse(await fs.readFile(path.join(directory, newest.file), 'utf8'));
    assert.deepEqual(payload.events.map((e: any) => e.label), ['Third']);
    if (action !== 'configure') await assert.rejects(fs.stat(path.join(directory, first.file)), { code: 'ENOENT' });
  } finally { release(); fs.rename = originalRename; await store.settle(); await fs.rm(root, { recursive: true, force: true }); }
});

for (const kind of ['prompt', 'event', 'append'] as const) test(`post-rename ${kind} failure stays inspectable and Delete all removes its payload`, async () => {
  const { root, store, directory } = await fixture(), originalOpen = fs.open;
  let injected = false;
  try {
    await store.configure({ ...defaultDebugSettings, enabled: true });
    if (kind === 'append') await store.recordEvent('First', { synthetic: true });
    fs.open = async (...args: Parameters<typeof fs.open>) => {
      const handle = await originalOpen(...args);
      if (args[0] === directory && args[1] === 'r' && !injected) {
        injected = true;
        handle.sync = async () => { throw Object.assign(new Error('Synthetic directory-sync failure after rename'), { code: 'EIO' }); };
      }
      return handle;
    };
    if (kind === 'prompt') await store.record('prompt', 'Synthetic prompt', { text: 'Private test data' });
    else await store.recordEvent('Second', { synthetic: true });
    fs.open = originalOpen; assert(injected);
    const state = await store.state(); assert.equal(state.entries.length, 1); assert.match(state.notice, /could not be saved/);
    assert.equal(state.bytes, (await fs.stat(path.join(directory, state.entries[0].file))).size);
    if (kind === 'append') {
      await store.recordEvent('Third', {});
      const batches = await Promise.all((await store.state()).entries.map(async e => JSON.parse(await fs.readFile(path.join(directory, e.file), 'utf8'))));
      assert.deepEqual(batches.flatMap(b => b.events.map((e: any) => e.label)).sort(), ['First', 'Second', 'Third']);
    }
    const cleared = await store.remove('all'); assert.equal(cleared.bytes, 0); assert.equal(cleared.settings.enabled, false);
    assert.deepEqual((await fs.readdir(directory)).sort(), ['register.json', 'settings.json']);
  } finally { fs.open = originalOpen; await store.settle(); await fs.rm(root, { recursive: true, force: true }); }
});

test('Delete all reconciles a committed payload even without inspecting or reopening first', async () => {
  const { root, store, directory } = await fixture(), originalOpen = fs.open;
  let injected = false;
  try {
    await store.configure({ ...defaultDebugSettings, enabled: true });
    fs.open = async (...args: Parameters<typeof fs.open>) => {
      const handle = await originalOpen(...args);
      if (args[0] === directory && args[1] === 'r' && !injected) {
        injected = true; handle.sync = async () => { throw new Error('Synthetic post-rename failure'); };
      }
      return handle;
    };
    await store.record('prompt', 'Synthetic', 'Private test content'); fs.open = originalOpen; assert(injected);
    await store.remove('all');
    assert.deepEqual((await fs.readdir(directory)).sort(), ['register.json', 'settings.json']);
  } finally { fs.open = originalOpen; await store.settle(); await fs.rm(root, { recursive: true, force: true }); }
});
