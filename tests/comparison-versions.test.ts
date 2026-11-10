import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProjectService } from '../src/main/project-service.ts';
import { CodexService } from '../src/main/codex-service.ts';
import { atomicWrite } from '../src/main/files.ts';
import { documentStatePath } from '../src/main/document-state.ts';

async function fixture(source = '', write = atomicWrite, name = 'report.txt') {
  const root = path.resolve('.test-runs', 'comparison-versions-' + randomUUID());
  await fs.mkdir(root, { recursive: true });
  const file = path.join(root, name); await fs.writeFile(file, source);
  const service = new ProjectService(path.join(root, 'runtime'), write), p = await service.open(file);
  return { root, file, service, p };
}

test('first paste is exact, immutable, selected automatically and survives Save, recovery and reopen', async () => {
  const f = await fixture(), original = '  A pasted report.\n\nUnicode: θ 😀.\n';
  const first = await f.service.captureInitialPaste(f.p.id, original);
  assert.equal(first.baseline?.text, original); assert.equal(first.versions.length, 1);
  assert.equal(first.versions[0].name, 'Original pasted text');
  assert.equal(await fs.readFile(f.file, 'utf8'), '');
  await f.service.captureInitialPaste(f.p.id, 'A later paste');
  await f.service.persist({ projectId: f.p.id, text: original + 'Unsaved edit.', review: f.p.review });
  const reopened = await new ProjectService(path.join(f.root, 'new-runtime')).open(f.file);
  assert.equal(reopened.baseline?.text, original); assert.equal(reopened.text, original + 'Unsaved edit.');
  await f.service.save({ projectId: f.p.id, text: original + 'Saved edit.', review: f.p.review });
  assert.equal((await f.service.open(f.file)).baseline?.text, original);
  assert.equal((await f.service.comparisonVersions(f.service.current!.id)).versions.length, 1);
});

test('review versions preserve full unsaved drafts, deduplicate section requests and never move the selected reference', async () => {
  const f = await fixture('Disk copy.');
  await f.service.captureInitialPaste(f.p.id, 'Replacement paste'); // A nonempty opened paper is not an initial paste.
  assert.equal((await f.service.comparisonVersions(f.p.id)).versions.length, 0);
  const first = 'Full unsaved draft.\nSecond section.';
  await f.service.captureReviewVersion(f.p.id, first);
  await f.service.captureReviewVersion(f.p.id, first);
  await f.service.captureReviewVersion(f.p.id, first + '\nFurther changes.');
  const state = await f.service.comparisonVersions(f.p.id);
  assert.equal(state.versions.length, 2); assert.equal(state.baseline?.text, first);
  assert.equal(state.versions[0].name, 'Before first review'); assert.equal(state.versions[1].name, 'Before review 2');
  const selected = await f.service.selectComparisonVersion(f.p.id, state.versions[1].id);
  await f.service.captureReviewVersion(f.p.id, 'Third draft.');
  const reopened = await f.service.open(f.file);
  assert.deepEqual(reopened.baseline, selected);
  assert.equal(await fs.readFile(f.file, 'utf8'), 'Disk copy.');
});

test('named references and sibling documents remain independent; a late paste cannot claim to be the original after review', async () => {
  const f = await fixture();
  const chosen = await f.service.pinBaseline(f.p.id, 'Before shortening', 'Chosen reference');
  await f.service.captureReviewVersion(f.p.id, 'Reviewed draft');
  await f.service.captureInitialPaste(f.p.id, 'Late paste');
  let state = await f.service.comparisonVersions(f.p.id);
  assert.deepEqual(state.baseline, chosen); assert(!state.versions.some(v => v.kind === 'paste'));
  const other = path.join(f.root, 'other.txt'); await fs.writeFile(other, '');
  const p = await f.service.open(other); await f.service.captureInitialPaste(p.id, 'Other paper');
  await assert.rejects(f.service.selectComparisonVersion(p.id, state.versions[0].id), /unavailable/);
  assert.equal((await f.service.comparisonVersions(p.id)).baseline?.text, 'Other paper');
  const original = await f.service.open(f.file); state = await f.service.comparisonVersions(original.id);
  assert.deepEqual(state.baseline, chosen); assert.equal(state.versions.length, 2);
});

test('corrupt, foreign or linked comparison records are never silently overwritten or selected', async () => {
  for (const corruption of ['index', 'owner', 'source', 'link']) {
    const f = await fixture();
    await f.service.captureInitialPaste(f.p.id, 'Original');
    const before = await f.service.comparisonVersions(f.p.id), folder = path.join(documentStatePath(f.file), 'comparison-checkpoints');
    const snapshot = path.join(folder, before.versions[0].id + '.json'), index = path.join(folder, 'index.json');
    if (corruption === 'index') await fs.writeFile(index, '{ damaged');
    if (corruption === 'owner') { const data = JSON.parse(await fs.readFile(index, 'utf8')); data.rootFile = 'another.txt'; await fs.writeFile(index, JSON.stringify(data)); }
    if (corruption === 'source') { const data = JSON.parse(await fs.readFile(snapshot, 'utf8')); data.text = 'Tampered'; await fs.writeFile(snapshot, JSON.stringify(data)); }
    if (corruption === 'link') { await fs.rename(snapshot, snapshot + '.kept'); await fs.symlink(snapshot + '.kept', snapshot); }
    const retainedIndex = await fs.readFile(index);
    await assert.rejects(f.service.selectComparisonVersion(f.p.id, before.versions[0].id));
    assert.deepEqual(f.service.get(f.p.id).baseline, before.baseline);
    if (corruption === 'index' || corruption === 'owner') await assert.rejects(f.service.captureReviewVersion(f.p.id, 'Next draft'), /preserved/);
    assert.deepEqual(await fs.readFile(index), retainedIndex); assert.equal(await fs.readFile(f.file, 'utf8'), '');
  }
});

test('failed checkpoint publication keeps earlier checkpoints and prevents an unrecorded review from being sent', async () => {
  let fail = false;
  const f = await fixture('Original', async (file, data, before) => {
    if (fail && file.endsWith('/comparison-checkpoints/index.json')) throw new Error('Injected checkpoint failure');
    await atomicWrite(file, data, before);
  });
  await f.service.captureReviewVersion(f.p.id, 'Original');
  const state = await f.service.comparisonVersions(f.p.id);
  fail = true;
  const codex = new CodexService(f.service, path.join(f.root, 'codex'));
  let calls = 0; (codex as any).run = async () => { calls++; return { comments: [] }; };
  const text = 'New draft';
  await assert.rejects(codex.review({ projectId: f.p.id, text, from: 0, to: text.length, instructions: '' }, () => {}), /Injected checkpoint failure/);
  assert.equal(calls, 0); assert.deepEqual(await f.service.comparisonVersions(f.p.id), state);
  assert.equal(await fs.readFile(f.file, 'utf8'), 'Original');
});

test('a review snapshots the whole current draft before a selected-passage request and retains it if Codex fails', async () => {
  const f = await fixture('Saved source');
  const text = 'Outside the selection.\nReview this sentence.\nMore context.';
  const codex = new CodexService(f.service, path.join(f.root, 'codex'));
  (codex as any).run = async () => {
    const versions = await f.service.comparisonVersions(f.p.id);
    assert.equal(versions.baseline?.text, text);
    throw new Error('Synthetic model failure');
  };
  await assert.rejects(codex.review({ projectId: f.p.id, text, from: 23, to: 43, instructions: '' }, () => {}), /Synthetic model failure/);
  const versions = await f.service.comparisonVersions(f.p.id);
  assert.equal(versions.versions.length, 1);
  assert.equal((await f.service.selectComparisonVersion(f.p.id, versions.versions[0].id)).text, text);
});
