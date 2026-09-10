import * as fs from 'node:fs/promises';
import path from 'node:path';
import { baselineSchema, historyBudgetSchema, type VersionHistory, type SavedVersion } from '../shared/contracts.ts';
import { documentStatePath, regularDirectory } from './document-state.ts';
import { serializeJSON } from '../shared/persistence.ts';
import { atomicWrite, digest, privateDirectory, readJSON, readRegularFile, writeJSON } from './files.ts';

const DEFAULT_BUDGET = 50000000, HASH = /^[a-f0-9]{64}$/;
type Entry = SavedVersion & { file: string; document: string };
type Scan = { summary: VersionHistory; entries: Entry[]; safe: boolean };
const decode = (bytes: Buffer) => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
type Checkpoints = { original: string; hashes: string[]; pending?: { previous: string; next: string } };
async function recentCheckpoints(document: string, rootFile: string): Promise<Checkpoints | null> {
  try {
    const value = await readJSON(path.join(document, 'save-checkpoints.json'), 10000) as any;
    if (value?.schemaVersion !== 1 || value.rootFile !== rootFile || typeof value.original !== 'string' || !HASH.test(value.original) || !Array.isArray(value.hashes) || !value.hashes.length || value.hashes.length > 2 || new Set(value.hashes).size !== value.hashes.length || !value.hashes.every((h: unknown) => typeof h === 'string' && HASH.test(h)) || (value.pending !== undefined && (!value.pending || ![value.pending.previous, value.pending.next].every(h => typeof h === 'string' && HASH.test(h))))) throw new Error('Saved checkpoint metadata needs inspection.');
    return { original: value.original, hashes: value.hashes, ...(value.pending ? { pending: value.pending } : {}) };
  } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
}
export async function recordSaveCheckpoints(document: string, rootFile: string, previous: string, next: string, write = atomicWrite) {
  let old: Checkpoints | null;
  // Checkpoints only guide history retention. Preserve unreadable metadata in
  // place; the save journal and verified source backups still protect Save.
  // Keep write failures outside this catch, including interrupted atomic writes.
  try { old = await recentCheckpoints(document, rootFile); } catch { return false; }
  const prior = old?.pending?.next === previous ? [old.pending.previous, ...old.hashes] : old?.hashes ?? [];
  const hashes = [...new Set([previous, ...prior])].slice(0, 2);
  // Record before replacing source: an interrupted attempt also has save.json.
  // Hash recency is durable even when an old byte-identical backup is reused.
  await write(path.join(document, 'save-checkpoints.json'), serializeJSON({ schemaVersion: 1, rootFile, original: old?.original ?? previous, hashes, pending: { previous, next } }, 10000));
  return true;
}
export async function completeSaveCheckpoints(document: string, rootFile: string, previous: string, next: string, write = atomicWrite) {
  const old = await recentCheckpoints(document, rootFile);
  if (old?.pending?.previous !== previous || old.pending.next !== next) throw new Error('The pending save checkpoints changed. Existing versions were kept.');
  const hashes = [...new Set([next, previous, ...old.hashes])].slice(0, 2);
  await write(path.join(document, 'save-checkpoints.json'), serializeJSON({ schemaVersion: 1, rootFile, original: old.original, hashes }, 10000));
}
export async function originalSaveVersion(document: string, rootFile: string) {
  const checkpoint = await recentCheckpoints(document, rootFile);
  if (!checkpoint) throw new Error('The original Save checkpoint is unavailable.');
  const bytes = await readRegularFile(path.join(document, 'backups', `source-${checkpoint.original}.tex`), 2000000);
  if (digest(bytes) !== checkpoint.original) throw new Error('The original Save checkpoint checksum is invalid.');
  return decode(bytes);
}

// Reuse Save's byte-exact backups. No history operation targets a manuscript,
// baseline, journal or review. All mutations run in ProjectService's serial queue.
async function scan(file: string, extraProtected: string[] = []): Promise<Scan> {
  const folder = path.dirname(file), home = path.join(folder, '.modern-editor'), documents = path.join(home, 'documents');
  const summary: VersionHistory = { versions: [], folderBytes: 0, protectedBytes: 0, budgetBytes: DEFAULT_BUDGET, notices: [] };
  const result: Scan = { summary, entries: [], safe: true };
  if (!await regularDirectory(home)) return result;
  try {
    const settings = await readJSON(path.join(home, 'history-settings.json'), 10000) as any;
    if (settings.schemaVersion !== 1) throw new Error('Unknown history settings.');
    summary.budgetBytes = historyBudgetSchema.parse(settings.budgetBytes);
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') { result.safe = false; summary.notices.push('History settings could not be read; automatic deletion is paused.'); } }
  if (!await regularDirectory(documents)) return result;
  const dirs = await fs.readdir(documents, { withFileTypes: true });
  if (dirs.length > 1000) throw new Error('Too many document-state folders to inspect safely. Existing versions were kept.');
  for (const dir of dirs) {
    if (!HASH.test(dir.name)) continue;
    const document = path.join(documents, dir.name);
    try {
      await regularDirectory(document);
      const identity = await readJSON(path.join(document, 'document.json'), 10000) as any;
      const name = identity?.rootFile;
      if (identity?.schemaVersion !== 1 || typeof name !== 'string' || name !== path.basename(name) || path.extname(name).toLowerCase() !== '.tex' || digest(name) !== dir.name) throw new Error('Unverified document owner.');
      const backups = path.join(document, 'backups');
      if (!await regularDirectory(backups)) continue;
      const names = (await fs.readdir(backups)).filter(n => /^source-[a-f0-9]{64}\.tex$/.test(n));
      if (names.length + result.entries.length > 5000) throw new Error('History inspection limit reached.');
      const entries: Entry[] = [];
      for (const name of names) {
        const backup = path.join(backups, name), stat = await fs.lstat(backup);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2000000) throw new Error('A backup is linked, nonregular or oversized.');
        entries.push({ id: name.slice(7, -4), createdAt: stat.mtime.toISOString(), bytes: stat.size, protectedReason: null, file: backup, document });
      }
      entries.sort((a,b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
      const protectedHashes = new Map<string,string>();
      if (document === documentStatePath(file)) for (const hash of extraProtected) protectedHashes.set(hash, 'Current save checkpoint');
      let protectAll = false;
      try {
        const recent = await recentCheckpoints(document, identity.rootFile);
        if (recent) protectedHashes.set(recent.original, 'Original before first editor Save');
        for (const hash of recent?.hashes ?? entries.slice(0,2).map(e => e.id)) protectedHashes.set(hash, 'Recent save checkpoint');
        if (recent?.pending) for (const hash of [recent.pending.previous, recent.pending.next]) protectedHashes.set(hash, 'Pending save checkpoint');
        const disk = await readRegularFile(path.join(folder, identity.rootFile), 2000000), raw = decode(disk);
        protectedHashes.set(digest(disk), 'Source currently on disk');
        const bom = raw.startsWith('\uFEFF') ? '\uFEFF' : '', ending = raw.includes('\r\n') ? '\r\n' : '\n';
        const recovery = path.join(document, 'recovery');
        if (await regularDirectory(recovery)) for (const name of ['session.json','save.json']) {
          try {
            const record = await readJSON(path.join(recovery,name)) as any;
            if (record?.schemaVersion !== 1 || record.review?.rootFile !== identity.rootFile || typeof record.text !== 'string' || record.text.length > 2000000 || !HASH.test(record.baseDiskHash)) throw new Error('Unverified recovery record.');
            protectedHashes.set(record.baseDiskHash, 'Needed by recovery');
            protectedHashes.set(digest(bom + record.text.replace(/\n/g, ending)), 'Needed by recovery');
          } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
        }
        try {
          const baseline = baselineSchema.parse(await readJSON(path.join(document,'baseline.json')));
          if (baseline.rootFile !== identity.rootFile || baseline.sourceHash !== digest(baseline.text)) throw new Error('Unverified baseline.');
          protectedHashes.set(baseline.sourceHash, 'Pinned comparison version');
        } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
      } catch { protectAll = true; result.safe = false; summary.notices.push(`${identity.rootFile}: versions kept and deletion paused because save checkpoints, source, recovery or baseline could not be verified.`); }
      for (const entry of entries) {
        entry.protectedReason = protectAll ? 'Source or history protection needs inspection' : protectedHashes.get(entry.id) ?? null;
        result.entries.push(entry); summary.folderBytes += entry.bytes;
        if (entry.protectedReason) summary.protectedBytes += entry.bytes;
        if (document === documentStatePath(file)) { const { file: _file, document: _document, ...visible } = entry; summary.versions.push(visible); }
      }
    } catch (e) { result.safe = false; summary.notices.push(`A document's history could not be inspected; deletion is paused. ${String(e)}`); }
  }
  if (!result.safe) summary.notices.push('Folder usage may be incomplete until the preserved records can be inspected.');
  return result;
}
async function verifiedBytes(entry: Entry) {
  const bytes = await readRegularFile(entry.file, 2000000);
  if (bytes.length !== entry.bytes || digest(bytes) !== entry.id) throw new Error('The saved version changed or has an invalid checksum. It was kept.');
  return bytes;
}
export async function listVersions(file: string) { return (await scan(file)).summary; }
export async function savedVersion(file: string, id: string) {
  if (!HASH.test(id)) throw new Error('Invalid saved version.');
  const { entries } = await scan(file), entry = entries.find(e => e.document === documentStatePath(file) && e.id === id);
  if (!entry) throw new Error('That saved version is no longer available. Refresh the history.');
  return { text: decode(await verifiedBytes(entry)), createdAt: entry.createdAt };
}
export async function deleteVersion(file: string, id: string) {
  const inspected = await scan(file), entry = inspected.entries.find(e => e.document === documentStatePath(file) && e.id === id);
  if (!inspected.safe) throw new Error('History could not be verified; nothing was deleted.');
  if (!entry || entry.protectedReason) throw new Error(entry?.protectedReason ? `This version is protected: ${entry.protectedReason}.` : 'Saved version not found.');
  await verifiedBytes(entry); await fs.unlink(entry.file);
  return listVersions(file);
}
export async function pruneVersions(file: string, extraProtected: string[] = []) {
  const inspected = await scan(file, extraProtected), { summary } = inspected;
  if (!inspected.safe) return summary;
  for (const entry of inspected.entries.filter(e => !e.protectedReason).sort((a,b) => a.createdAt.localeCompare(b.createdAt))) {
    if (summary.folderBytes <= summary.budgetBytes) break;
    try { await verifiedBytes(entry); await fs.unlink(entry.file); summary.folderBytes -= entry.bytes; }
    catch (e) { summary.notices.push(String(e)); }
  }
  const fresh = await scan(file, extraProtected);
  fresh.summary.notices = [...new Set([...summary.notices,...fresh.summary.notices])];
  if (fresh.summary.folderBytes > fresh.summary.budgetBytes) fresh.summary.notices.push('The storage target cannot be met without deleting protected or unverified versions. They were kept.');
  return fresh.summary;
}
export async function setVersionBudget(file: string, bytes: number) {
  historyBudgetSchema.parse(bytes);
  const inspected = await scan(file);
  if (!inspected.safe) throw new Error('History could not be verified. Existing settings and versions were kept.');
  const home = await privateDirectory(path.dirname(file), '.modern-editor');
  await writeJSON(path.join(home,'history-settings.json'), { schemaVersion:1, budgetBytes:bytes }, 10000);
  return pruneVersions(file);
}
