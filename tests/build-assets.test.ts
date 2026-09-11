import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { copyBuildAssets, verifyDependencyNotices } from '../scripts/copy-build-assets.mjs';

const sources = ['docs/USER_GUIDE.md', 'docs/SETUP.md', 'docs/FAQ.md', 'CHANGELOG.md', 'fixtures/sample/main.tex', 'fixtures/sample/review.json',
  'resources/tex-support/tcilatex.tex', 'resources/tex-support/README.md',
  'licenses/modern-editor-predecessor-MIT.txt', 'licenses/dependencies.json',
  'LICENSE', 'THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_LICENSES.txt',
  'node_modules/electron/dist/LICENSE', 'node_modules/electron/dist/LICENSES.chromium.html'];
async function put(root: string, file: string, text: string) { await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true }); await fs.writeFile(path.join(root, file), text); }
async function fixture() {
  await fs.mkdir('.test-runs', { recursive: true });
  const root = await fs.mkdtemp(path.resolve('.test-runs/build-assets-'));
  for (const name of sources) await put(root, name, `Synthetic ${name}`);
  const lock = JSON.stringify({ packages: { '': { version: '1' }, 'node_modules/example': { version: '2' } } });
  await put(root, 'package-lock.json', lock);
  await put(root, 'licenses/dependencies.json', JSON.stringify({ lockfileSha256: createHash('sha256').update(lock).digest('hex'), packages: [{ name: 'example', version: '2' }] }));
  return root;
}
async function files(root: string, relative = ''): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
    const file = path.join(relative, entry.name);
    if (entry.isDirectory()) result.push(...await files(root, file)); else result.push(file);
  }
  return result.sort();
}
test('build assets include only the working sample, support macro and notices; stale and ignored sidecars are excluded', async () => {
  const root = await fixture();
  try {
    for (const name of ['fixtures/sample/.modern-editor/review.json', 'fixtures/private.tex', 'fixtures/sample/extra.pdf',
      'resources/tex-support/.private-note', 'licenses/local-note.txt', 'dist/fixtures/sample/.modern-editor/recovery.json']) await put(root, name, 'Private synthetic decoy');
    await put(root, 'dist/main.cjs', 'Keep the built application');
    await copyBuildAssets(root);
    assert.deepEqual(await files(path.join(root, 'dist')), [
      'help/USER_GUIDE.md', 'help/SETUP.md', 'help/FAQ.md', 'help/CHANGELOG.md',
      'fixtures/sample/main.tex', 'fixtures/sample/review.json', 'main.cjs',
      'tex-support/tcilatex.tex', 'tex-support/README.md',
      'licenses/modern-editor-predecessor-MIT.txt', 'licenses/dependencies.json', 'licenses/LICENSE',
      'licenses/THIRD_PARTY_NOTICES.md', 'licenses/THIRD_PARTY_LICENSES.txt',
      'licenses/electron-LICENSE.txt', 'licenses/electron-LICENSES.chromium.html',
    ].sort());
    assert.equal(await fs.readFile(path.join(root, 'dist/fixtures/sample/main.tex'), 'utf8'), 'Synthetic fixtures/sample/main.tex');
    assert.equal(await fs.readFile(path.join(root, 'fixtures/sample/.modern-editor/review.json'), 'utf8'), 'Private synthetic decoy');
    await put(root, 'dist/licenses/stale.txt', 'Old build');
    await copyBuildAssets(root);
    await assert.rejects(fs.stat(path.join(root, 'dist/licenses/stale.txt')), { code: 'ENOENT' });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test('a changed dependency lock or package inventory stops the build until notices are refreshed', async () => {
  const root = await fixture();
  try {
    await verifyDependencyNotices(root);
    const file = path.join(root, 'package-lock.json'), original = await fs.readFile(file);
    await fs.appendFile(file, '\n');
    await assert.rejects(copyBuildAssets(root), /notices are stale/);
    await fs.writeFile(file, original);
    const inventoryFile = path.join(root, 'licenses/dependencies.json'), inventory = JSON.parse(await fs.readFile(inventoryFile, 'utf8'));
    inventory.packages[0].version = '3'; await fs.writeFile(inventoryFile, JSON.stringify(inventory));
    await assert.rejects(verifyDependencyNotices(root), /notices are stale/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test('a selected build asset symlink fails before replacing existing generated assets', async () => {
  const root = await fixture();
  try {
    await put(root, 'dist/fixtures/keep.txt', 'Previous build');
    await put(root, 'private.txt', 'Private synthetic decoy');
    await fs.unlink(path.join(root, 'fixtures/sample/main.tex'));
    await fs.symlink(path.join(root, 'private.txt'), path.join(root, 'fixtures/sample/main.tex'));
    await assert.rejects(copyBuildAssets(root), /not a regular file/);
    assert.equal(await fs.readFile(path.join(root, 'dist/fixtures/keep.txt'), 'utf8'), 'Previous build');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
