import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultWorkspace, workspaceSchema } from '../src/shared/contracts.ts';
import { resolveLayout } from '../src/renderer/workspace-layout.ts';

test('legacy reading state acquires defaults without losing positions', () => {
  const { layout, compactTab, changesOpen, displayName, ...legacy } = defaultWorkspace();
  legacy.source.anchor = 52; legacy.pdf.page = 8; legacy.pdf.zoom = 1.5;
  const migrated = workspaceSchema.parse(legacy);
  assert.equal(migrated.layout, 'auto'); assert.equal(migrated.compactTab, 'source'); assert(migrated.changesOpen); assert.equal(migrated.displayName, '');
  assert.equal(migrated.source.anchor, 52); assert.equal(migrated.pdf.page, 8); assert.equal(migrated.pdf.zoom, 1.5);
  assert.deepEqual(workspaceSchema.parse({ ...migrated, layout: 'pdf-comments', compactTab: 'pdf', changesOpen: false }), { ...migrated, layout: 'pdf-comments', compactTab: 'pdf', changesOpen: false });
});
test('automatic review uses useful width and height; new comments can leave a writing layout', () => {
  assert.equal(resolveLayout('auto', false, true, { width: 1000, height: 650 }), 'tabs');
  assert.equal(resolveLayout('auto', false, true, { width: 1500, height: 500 }), 'tabs');
  assert.equal(resolveLayout('auto', false, true, { width: 1500, height: 860 }), 'three');
  assert.equal(resolveLayout('auto', false, false, { width: 1500, height: 860 }), 'source-comments');
  assert.equal(resolveLayout('pdf-comments', true, true, { width: 1000, height: 650 }), 'writing');
  assert.equal(resolveLayout('writing', false, true, { width: 1000, height: 650 }), 'tabs');
});
