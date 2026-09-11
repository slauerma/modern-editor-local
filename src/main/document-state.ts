import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { serializeJSON } from '../shared/persistence.ts';
import { reviewSchema } from '../shared/contracts.ts';
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

const HASH = /^[a-f0-9]{64}$/, HISTORY_MARKER = 'legacy-history-imports.json';
type LegacyVersion = { hash: string; bytes: Buffer; modified: Date };
function legacyHistoryOwner(value: any): { owner: string; hashes: string[] } | null {
  const review = reviewSchema.safeParse(value?.review ?? value);
  if (!review.success || !HASH.test(review.data.sourceHash) || review.data.rootFile !== path.basename(review.data.rootFile) || !/\.tex$/i.test(review.data.rootFile)) return null;
  if (value.review !== undefined) {
    if (value.schemaVersion !== 1 || typeof value.text !== 'string' || value.text.length > 2_000_000 || !HASH.test(value.baseDiskHash) || value.revision !== undefined && (!Number.isSafeInteger(value.revision) || value.revision < 0)) return null;
    return { owner: review.data.rootFile, hashes: [value.baseDiskHash, review.data.sourceHash, digest(value.text)] };
  }
  return { owner: review.data.rootFile, hashes: [review.data.sourceHash] };
}

// Legacy backups have no owner field. A filename alone is insufficient: require
// a valid root-owned review/recovery record AND verify the backup's exact bytes.
async function legacyVersions(legacy: string, name: string, notices: string[]): Promise<LegacyVersion[]> {
  const result: LegacyVersion[] = [], own = new Set<string>(), known = new Set<string>();
  let records = 0, inspectedEntries = 0, metadataBytes = 0, sourceBytes = 0;
  try {
    if (!await regularDirectory(legacy) || !await regularDirectory(path.join(legacy, 'backups'))) return result;
    for (const relative of ['', 'recovery', 'reviews']) {
      const directory = path.join(legacy, relative);
      try {
        if (!await regularDirectory(directory)) continue;
        for await (const entry of await fs.opendir(directory)) {
          if (++inspectedEntries > 1000) throw new Error('Legacy history metadata exceeds the 1,000-entry inspection limit.');
          if (!entry.name.endsWith('.json') || relative === '' && !entry.name.startsWith('review')) continue;
          if (++records > 200 || metadataBytes >= 20_000_000) throw new Error('Legacy history metadata exceeds the 200-record / 20 MB inspection limit.');
          try {
            const bytes = await readStateFile(path.join(directory, entry.name), Math.min(10_000_000, 20_000_000 - metadataBytes)); metadataBytes += bytes.length;
            const owner = legacyHistoryOwner(JSON.parse(bytes.toString('utf8')));
            if (!owner) continue;
            for (const hash of owner.hashes) { known.add(hash); if (owner.owner === name) own.add(hash); }
          } catch { notices.push(`Legacy history could not verify ${path.join(relative, entry.name)}. The original was kept; inspect that record to recover any unlisted versions.`); }
        }
      } catch (error) { notices.push(`Some legacy history records could not be inspected: ${String(error)} Originals remain in ${directory}.`); }
    }
    const backups = path.join(legacy, 'backups'), entries = [];
    for await (const entry of await fs.opendir(backups)) {
      if (entries.length >= 5000) throw new Error('Legacy history exceeds the 5,000-entry inspection limit.');
      entries.push(entry);
    }
    let unowned = 0;
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const match = entry.name.match(/^source-([a-f0-9]{64})\.tex$/);
      if (!match) continue;
      if (!own.has(match[1])) { if (!known.has(match[1])) unowned++; continue; }
      if (result.length >= 1000 || sourceBytes >= 50_000_000) throw new Error('Legacy history exceeds the 1,000-version / 50 MB copy limit.');
      try {
        const file = path.join(backups, entry.name), stat = await fs.lstat(file);
        const bytes = await readStateFile(file, Math.min(2_000_000, 50_000_000 - sourceBytes), stat);
        sourceBytes += bytes.length;
        if (digest(bytes) !== match[1]) throw new Error('The content checksum does not match its associated saved record.');
        result.push({ hash: match[1], bytes, modified: stat.mtime });
      } catch (error) { notices.push(`Legacy saved version ${entry.name} could not be verified: ${String(error)} It remains in ${backups}; inspect it before restoring it.`); }
    }
    if (unowned) notices.push(`${unowned} legacy saved version(s) could not be attributed safely to a document. Originals remain in ${backups}; matching valid review or recovery records are needed before importing them.`);
  } catch (error) { notices.push(`Legacy saved history needs attention: ${String(error)} Source and comments can still open; originals remain in ${legacy}.`); }
  return result;
}

async function importLegacyVersions(home: string, name: string, versions: LegacyVersion[], notices: string[]) {
  if (!versions.length) return;
  const marker = path.join(home, HISTORY_MARKER), imported = new Set<string>();
  let oldMarker: Buffer | null = null, copied = 0;
  try {
    try {
      oldMarker = await readStateFile(marker, 500_000);
      const value = JSON.parse(oldMarker.toString('utf8'));
      if (value.schemaVersion !== 1 || value.rootFile !== name || !Array.isArray(value.hashes) || value.hashes.length > 5000 || !value.hashes.every((hash: unknown) => typeof hash === 'string' && HASH.test(hash))) throw new Error('The legacy-history import record is invalid.');
      value.hashes.forEach((hash: string) => imported.add(hash));
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const before = imported.size;
    for (const version of versions) {
      // Remember successful imports so deleting/pruning an imported version
      // does not resurrect it from the untouched legacy backup on next open.
      if (imported.has(version.hash)) continue;
      if (imported.size >= 5000) throw new Error('The legacy-history import record reached its 5,000-version limit.');
      let temporary: string | undefined;
      try {
        const backups = await privateDirectory(home, 'backups'), target = path.join(backups, `source-${version.hash}.tex`);
        try {
          const existing = await readStateFile(target, 2_000_000);
          if (digest(existing) !== version.hash) throw new Error('An existing document backup has different contents; it was not overwritten.');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          temporary = path.join(backups, `.legacy-${randomUUID()}.pending`);
          const handle = await fs.open(temporary, 'wx', 0o600);
          try { await handle.writeFile(version.bytes); await handle.sync(); } finally { await handle.close(); }
          await fs.utimes(temporary, version.modified, version.modified);
          // Publish complete bytes exclusively, preserving an existing target
          // even if another writer created it after the initial existence check.
          try { await fs.link(temporary, target); copied++; }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || digest(await readStateFile(target, 2_000_000)) !== version.hash) throw error; }
        }
        const directory = await fs.open(backups, 'r');
        try { await directory.sync(); } finally { await directory.close(); }
        imported.add(version.hash);
      } catch (error) { notices.push(`Legacy version ${version.hash} was not imported: ${String(error)} Both the legacy original and existing document state were preserved.`); }
      finally { if (temporary) try { await fs.unlink(temporary); } catch (error) { notices.push(`A temporary legacy-history copy was retained at ${temporary}: ${String(error)}`); } }
    }
    if (imported.size !== before) {
      const value = serializeJSON({ schemaVersion: 1, rootFile: name, hashes: [...imported].sort() }, 500_000);
      await atomicWrite(marker, value, async () => {
        try {
          const current = await readStateFile(marker, 500_000);
          if (!oldMarker || digest(current) !== digest(oldMarker)) throw new Error('The legacy-history import record changed during copying.');
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || oldMarker) throw error; }
      });
    }
    if (copied) notices.push(`Imported ${copied} verified legacy saved source version(s). Legacy originals were kept.`);
  } catch (error) { notices.push(`Legacy history import needs attention: ${String(error)} Source, comments and legacy originals were preserved.`); }
}

// Copy, never move, matching legacy records. Publish the complete directory with
// one rename, so a stopped migration cannot be mistaken for finished migration.
// The identity file also prevents old legacy recovery from being imported again.
export async function prepareDocumentState(file: string, create: boolean, notices: string[] = [], write = atomicWrite) {
  const name = path.basename(file), home = documentStatePath(file);
  const legacy = path.join(path.dirname(file), '.modern-editor'), documents = path.dirname(home);
  if (await regularDirectory(legacy) && await regularDirectory(documents) && await regularDirectory(home)) {
    await checkIdentity(home, name);
    // Opening also upgrades older per-document folders. Routine autosave and
    // metadata writes only ensure that folder; they must not rescan legacy data.
    if (!create) await importLegacyVersions(home, name, await legacyVersions(legacy, name, notices), notices);
    return home;
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
  const versions = await legacyVersions(legacy, name, notices);
  if (!create && !copies.length && !versions.length) return home;
  await privateDirectory(path.dirname(file), '.modern-editor');
  await privateDirectory(legacy, 'documents');
  const staging = await privateDirectory(documents, `.migrate-${randomUUID()}`);
  for (const copy of copies) {
    if (copy.relative.startsWith('recovery/')) await privateDirectory(staging, 'recovery');
    await write(path.join(staging, copy.relative), copy.bytes);
  }
  await importLegacyVersions(staging, name, versions, notices);
  await write(path.join(staging, 'document.json'), serializeJSON({ schemaVersion: 1, rootFile: name }, 10000));
  // Never replace a previously installed state directory, even after a failed attempt.
  if (await regularDirectory(home)) { await checkIdentity(home, name); await importLegacyVersions(home, name, versions, notices); return home; }
  await fs.rename(staging, home);
  const handle = await fs.open(documents, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
  if (copies.length) notices.push(`Copied this document's saved review/settings/recovery to its own state folder. Legacy originals remain in ${legacy}.`);
  return home;
}
