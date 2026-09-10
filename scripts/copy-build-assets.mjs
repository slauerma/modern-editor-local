import { copyFile, lstat, mkdir, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

// Runtime assets are explicit: Git's ignore rules do not filter filesystem copies.
// In particular, opening a fixture must never put its local review into a build.
const assets = [
  ['fixtures/sample/main.tex', 'fixtures/sample/main.tex'],
  ['fixtures/sample/review.json', 'fixtures/sample/review.json'],
  ['resources/tex-support/tcilatex.tex', 'tex-support/tcilatex.tex'],
  ['resources/tex-support/README.md', 'tex-support/README.md'],
  ['licenses/modern-editor-predecessor-MIT.txt', 'licenses/modern-editor-predecessor-MIT.txt'],
  ['licenses/dependencies.json', 'licenses/dependencies.json'],
  ...['LICENSE', 'THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_LICENSES.txt'].map(name => [name, `licenses/${name}`]),
  ['node_modules/electron/dist/LICENSE', 'licenses/electron-LICENSE.txt'],
  ['node_modules/electron/dist/LICENSES.chromium.html', 'licenses/electron-LICENSES.chromium.html'],
];

export async function verifyDependencyNotices(root = process.cwd()) {
  const lockBytes = await readFile(path.join(root, 'package-lock.json'));
  const lock = JSON.parse(lockBytes), inventory = JSON.parse(await readFile(path.join(root, 'licenses/dependencies.json'), 'utf8'));
  const locked = Object.entries(lock.packages).filter(([name]) => name).map(([name, entry]) => `${name.replace(/^.*node_modules\//, '')}@${entry.version}`).sort();
  const recorded = inventory.packages?.map(entry => `${entry.name}@${entry.version}`).sort();
  if (inventory.lockfileSha256 !== createHash('sha256').update(lockBytes).digest('hex') || JSON.stringify(locked) !== JSON.stringify(recorded))
    throw new Error('Dependency notices are stale. Run npm run notices with the locked dependencies installed, review the notices, and rebuild.');
}

export async function copyBuildAssets(root = process.cwd()) {
  // Fail before replacing the generated asset directories if a selected file or
  // its parent was replaced by a link; do not follow it to unrelated local data.
  for (const [source] of assets) {
    const parts = source.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const file = path.join(root, ...parts.slice(0, i)), stat = await lstat(file);
      if (stat.isSymbolicLink() || (i === parts.length ? !stat.isFile() : !stat.isDirectory())) throw new Error(`Build asset is not a regular ${i === parts.length ? 'file' : 'directory'}: ${source}`);
    }
  }
  await verifyDependencyNotices(root);
  const dist = path.join(root, 'dist');
  await mkdir(dist, { recursive: true });
  const stat = await lstat(dist);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('The build output must be a regular directory.');
  // Remove stale generated copies too: filtering this build alone would retain
  // private sidecars copied by an earlier version of the build script.
  for (const name of ['fixtures', 'tex-support', 'licenses']) await rm(path.join(dist, name), { recursive: true, force: true });
  for (const [source, destination] of assets) {
    const target = path.join(dist, destination);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(root, source), target);
  }
}
