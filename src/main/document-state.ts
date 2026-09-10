import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { serializeJSON } from '../shared/persistence.ts';
import { atomicWrite, digest, privateDirectory, readRegularFile } from './files.ts';

// A filename identifies one root within its folder. Renamed copies start with
// separate state; moving the entire paper folder preserves the association.
export function documentStatePath(file: string) {
  return path.join(path.dirname(file), '.modern-editor', 'documents', digest(path.basename(file)));
}
export async function regularDirectory(directory: string) {
  try {
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${directory} must be a regular directory, not a linked path.`);
    return true;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
export const readStateFile = readRegularFile;
async function checkIdentity(home: string, name: string) {
  const identity = JSON.parse((await readStateFile(path.join(home, 'document.json'), 10000)).toString('utf8'));
  if (identity.schemaVersion !== 1 || identity.rootFile !== name) throw new Error(`Cannot open ${name}: its saved state identifies ${String(identity.rootFile)}. Existing files were preserved.`);
}

// Copy, never move, matching legacy records. Publish the complete directory with
// one rename, so a stopped migration cannot be mistaken for finished migration.
// The identity file also prevents old legacy recovery from being imported again.
export async function prepareDocumentState(file: string, create: boolean, notices: string[] = [], write = atomicWrite) {
  const name = path.basename(file), home = documentStatePath(file);
  const legacy = path.join(path.dirname(file), '.modern-editor'), documents = path.dirname(home);
  if (await regularDirectory(legacy) && await regularDirectory(documents) && await regularDirectory(home)) {
    await checkIdentity(home, name); return home;
  }
  const copies: { relative: string; bytes: Buffer }[] = [];
  if (await regularDirectory(legacy)) {
    for (const relative of ['review.json', 'settings.json', 'recovery/session.json', 'recovery/save.json']) {
      try {
        if (relative.startsWith('recovery/') && !(await regularDirectory(path.join(legacy, 'recovery')))) continue;
        const bytes = await readStateFile(path.join(legacy, relative));
        const value = JSON.parse(bytes.toString('utf8'));
        const owner = relative.startsWith('recovery/') ? value?.review?.rootFile : value?.rootFile;
        if (owner === name) copies.push({ relative, bytes });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') notices.push(`Legacy ${relative} could not be associated safely with ${name}; it was kept in ${legacy}. Use Recover source… if needed.`);
      }
    }
  }
  if (!create && !copies.length) return home;
  await privateDirectory(path.dirname(file), '.modern-editor');
  await privateDirectory(legacy, 'documents');
  const staging = await privateDirectory(documents, `.migrate-${randomUUID()}`);
  for (const copy of copies) {
    if (copy.relative.startsWith('recovery/')) await privateDirectory(staging, 'recovery');
    await write(path.join(staging, copy.relative), copy.bytes);
  }
  await write(path.join(staging, 'document.json'), serializeJSON({ schemaVersion: 1, rootFile: name }, 10000));
  // Never replace a previously installed state directory, even after a failed attempt.
  if (await regularDirectory(home)) { await checkIdentity(home, name); return home; }
  await fs.rename(staging, home);
  const handle = await fs.open(documents, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
  if (copies.length) notices.push(`Copied this document's saved review/settings/recovery to its own state folder. Legacy originals remain in ${legacy}.`);
  return home;
}
