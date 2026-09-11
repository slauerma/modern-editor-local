// Personal editor: preserve original papers; migrate by verified copy, never by move.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { readJSON, readRegularFile, digest } from './files.ts';
import { writeSourceCopy } from './source-export.ts';

const persistentEntries = ['papers', 'builds', 'codex-context', 'last-project.json', 'tool-settings.json'];
const importing = '.runtime-importing.json', ready = '.storage-ready.json', stagingName = '.migration-copies';
type Inventory = { files: { relative: string; size: number; hash: string }[]; directories: string[] };
type Options = { directory: string; legacyDirectory?: string; isolated?: boolean; beforeCopy?: (relative: string) => Promise<void>; beforeReady?: () => Promise<void> };
function inside(root: string, file: string) { const rel = path.relative(root, file); return rel === '' || rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel); }
async function statOrNull(file: string) { try { return await fs.lstat(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; } }
async function directory(file: string) {
  const stat = await statOrNull(file);
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new Error(`Expected a regular storage directory: ${file}`);
  return !!stat;
}
async function fileHash(file: string) {
  const handle = await fs.open(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > 512000000) throw new Error(`A storage file is not a supported regular file: ${file}`);
    const hash = createHash('sha256'), buffer = Buffer.allocUnsafe(65536); let total = 0;
    for (;;) { const { bytesRead } = await handle.read(buffer, 0, buffer.length, null); if (!bytesRead) break; total += bytesRead; if (total > 512000000) throw new Error(`Storage file grew while copying: ${file}`); hash.update(buffer.subarray(0, bytesRead)); }
    const after = await handle.stat();
    if (before.size !== total || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error(`Storage changed during migration: ${file}`);
    return { size: total, hash: hash.digest('hex') };
  } finally { await handle.close(); }
}
async function inventory(root: string, entries: string[]): Promise<Inventory> {
  const result: Inventory = { files: [], directories: [] }; let bytes = 0;
  const walk = async (relative: string, depth = 0) => {
    if (depth > 40 || result.files.length + result.directories.length >= 50000) throw new Error('Storage migration exceeds the automatic file limit. Original files were preserved.');
    const file = path.join(root, relative), stat = await statOrNull(file); if (!stat) return;
    if (stat.isSymbolicLink()) throw new Error(`Linked storage cannot be migrated automatically: ${file}`);
    if (stat.isDirectory()) {
      result.directories.push(relative);
      for (const name of (await fs.readdir(file)).sort()) await walk(path.join(relative, name), depth + 1);
    } else {
      const info = await fileHash(file); bytes += info.size;
      if (bytes > 8000000000) throw new Error('Storage migration exceeds 8 GB. Original files were preserved; choose a smaller managed archive.');
      result.files.push({ relative, ...info });
    }
  };
  for (const entry of entries.sort()) await walk(entry);
  return result;
}
async function exclusiveJSON(file: string, value: unknown) {
  // A hard link installs a complete file exclusively. A stopped write cannot
  // publish half a readiness marker, and an existing marker is never replaced.
  const temp = path.join(path.dirname(file), `.storage-marker-${randomUUID()}.pending`);
  const handle = await fs.open(temp, 'wx', 0o600);
  try {
    try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); } finally { await handle.close(); }
    await fs.link(temp, file);
  } finally { await fs.unlink(temp); }
}
function remapPaper(file: unknown, legacy: string, destination: string) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || !inside(path.join(legacy, 'papers'), file)) return file;
  return path.join(destination, path.relative(legacy, file));
}
async function adjustedMetadata(source: string, relative: string, destination: string): Promise<Buffer | null> {
  if (relative !== 'last-project.json' && !/^builds[/\\][a-f0-9-]{36}[/\\]\.editor-pdf-snapshot\.json$/.test(relative)) return null;
  const bytes = await readRegularFile(path.join(source, relative), 1000000);
  try {
    const value = JSON.parse(bytes.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) return bytes;
    const key = relative === 'last-project.json' ? 'path' : 'owner', updated = remapPaper(value[key], source, destination);
    if (updated === value[key]) return bytes;
    return Buffer.from(JSON.stringify({ ...value, [key]: updated }, null, 2) + '\n');
  } catch { return bytes; } // Preserve malformed records for the ordinary recovery diagnostics.
}
async function copyRegular(source: string, target: string, expectedHash: string, replacement: Buffer | null, staging: string) {
  if (await statOrNull(target)) {
    if ((await fileHash(target)).hash !== expectedHash) throw new Error(`Storage migration found a conflicting destination. Both versions were preserved: ${target}`);
    return;
  }
  const temporary = path.join(staging, randomUUID() + '.pending');
  const output = await fs.open(temporary, 'wx', 0o600);
  try {
    if (replacement) await output.writeFile(replacement);
    else {
      const input = await fs.open(source, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      try {
        if (!(await input.stat()).isFile()) throw new Error(`The source is no longer a regular file: ${source}`);
        const buffer = Buffer.allocUnsafe(65536); let total = 0;
        for (;;) {
          const { bytesRead } = await input.read(buffer, 0, buffer.length, null); if (!bytesRead) break;
          total += bytesRead; if (total > 512000000) throw new Error(`Storage file grew during migration: ${source}`);
          let offset = 0;
          while (offset < bytesRead) offset += (await output.write(buffer, offset, bytesRead - offset)).bytesWritten;
        }
      } finally { await input.close(); }
    }
    await output.sync();
  } catch (error) { await output.close(); await fs.unlink(temporary); throw error; }
  await output.close();
  try {
    if ((await fileHash(temporary)).hash !== expectedHash) throw new Error(`Storage copy could not be verified: ${target}`);
    try { await fs.link(temporary, target); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || (await fileHash(target)).hash !== expectedHash) throw error;
    }
  } finally { await fs.unlink(temporary); }
}

export function runtimeLocation(userData: string, override?: string) {
  if (override !== undefined && (!path.isAbsolute(override) || !override.trim() || /[\0\r\n]/.test(override))) throw new Error('MODERN_EDITOR_RUNTIME_DIR must be an absolute directory path.');
  return override ?? path.join(userData, 'editor-data');
}

export async function prepareRuntimeStorage(options: Options): Promise<{ directory: string; notices: string[] }> {
  const root = options.directory, notices: string[] = [];
  if (!path.isAbsolute(root)) throw new Error('Runtime storage needs an absolute path.');
  await fs.mkdir(path.dirname(root), { recursive: true, mode: 0o700 });
  if (!(await directory(root))) await fs.mkdir(root, { mode: 0o700 });
  if (await statOrNull(path.join(root, ready))) {
    const record = await readJSON(path.join(root, ready), 16000) as { schemaVersion?: number };
    if (record.schemaVersion !== 1) throw new Error('The runtime storage marker is not recognized. Existing files were preserved.');
    return { directory: root, notices };
  }
  // An explicit test runtime never inspects the application's real legacy storage.
  // A completed migration likewise no longer depends on access to the old folder.
  const legacy = !options.isolated && options.legacyDirectory && await directory(options.legacyDirectory) ? options.legacyDirectory : null;
  if (legacy && (inside(root, legacy) || persistentEntries.some(entry => inside(path.join(legacy, entry), root)))) throw new Error('Old and new persistent storage directories must be separate.');
  const markerPath = path.join(root, importing), marker = await statOrNull(markerPath);
  if (marker) {
    const record = await readJSON(markerPath, 16000) as { schemaVersion?: number; legacy?: string | null };
    if (record.schemaVersion !== 1 || record.legacy !== legacy) throw new Error('An unfinished storage migration belongs to another source. Existing files were preserved.');
    notices.push('Finished verifying a previously interrupted storage copy. Original files remain in their previous location.');
  } else {
    if ((await fs.readdir(root)).length) throw new Error(`The new storage folder already contains unrecognized files. Nothing was overwritten: ${root}`);
    await exclusiveJSON(markerPath, { schemaVersion: 1, legacy, startedAt: new Date().toISOString() });
  }
  const original = legacy ? await inventory(legacy, [...persistentEntries]) : { files: [], directories: [] };
  const allowed = new Set([importing, ...original.files.map(file => file.relative), ...original.directories]);
  const dataEntries = async () => (await fs.readdir(root)).filter(name => ![importing, stagingName].includes(name));
  const present = await inventory(root, await dataEntries());
  if ([...present.directories, ...present.files.map(file => file.relative)].some(relative => !allowed.has(relative))) throw new Error('The migration destination contains unexpected files. Nothing was overwritten.');
  for (const relative of original.directories) if (!(await directory(path.join(root, relative)))) await fs.mkdir(path.join(root, relative), { mode: 0o700 });
  const staging = path.join(root, stagingName);
  if (original.files.length && !(await directory(staging))) await fs.mkdir(staging, { mode: 0o700 });
  const expectedFiles: Inventory['files'] = [];
  for (const entry of original.files) {
    const adjusted = await adjustedMetadata(legacy!, entry.relative, root);
    const expected = adjusted ? { ...entry, hash: digest(adjusted), size: adjusted.length } : entry;
    expectedFiles.push(expected);
    await options.beforeCopy?.(entry.relative);
    await copyRegular(path.join(legacy!, entry.relative), path.join(root, entry.relative), expected.hash, adjusted, staging);
  }
  await options.beforeReady?.();
  if (legacy && JSON.stringify(original) !== JSON.stringify(await inventory(legacy, [...persistentEntries]))) throw new Error('The old editor storage changed during migration. Close the old editor and retry; all original files were preserved.');
  const copied = await inventory(root, await dataEntries());
  if (JSON.stringify(copied) !== JSON.stringify({ files: expectedFiles, directories: original.directories })) throw new Error('The new storage changed before verification finished. Both locations were preserved.');
  await exclusiveJSON(path.join(root, ready), { schemaVersion: 1, migratedFrom: legacy, files: original.files.length, completedAt: new Date().toISOString() });
  const handle = await fs.open(root, 'r'); try { await handle.sync(); } finally { await handle.close(); }
  if (await directory(staging)) try { await fs.rmdir(staging); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOTEMPTY') throw error; notices.push(`An interrupted attempt left uncommitted migration copies in ${staging}. They were kept separately; the installed papers were verified.`); }
  if (legacy && original.files.length) notices.push(`Copied and verified saved papers, reviews, recovery, and runtime state to ${root}. Originals remain in ${legacy}. Chromium caches and temporary process files were not migrated.`);
  return { directory: root, notices };
}

export async function createDraftSource(file: string, applicationDirectory?: string) {
  if (!path.isAbsolute(file) || path.extname(file).toLowerCase() !== '.tex') throw new Error('Choose an absolute filename ending in .tex.');
  const folder = await fs.realpath(path.dirname(file)), target = path.join(folder, path.basename(file));
  if (applicationDirectory && inside(await fs.realpath(applicationDirectory), target)) throw new Error('Choose a paper folder outside the editor installation so updating the editor cannot remove your draft.');
  try { await writeSourceCopy(target, ''); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('That file already exists. Choose a new filename; New paper never overwrites an existing file.'); throw error; }
  return target;
}
