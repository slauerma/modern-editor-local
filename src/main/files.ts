import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { JSON_FILE_LIMIT, serializeJSON } from '../shared/persistence.ts';
export const digest = (text: string | Uint8Array) => createHash('sha256').update(text).digest('hex');
export const normalize = (text: string) => text.replace(/\r\n/g, '\n');
export async function exists(file: string) { try { await fs.access(file); return true; } catch { return false; } }
// Bound allocations as well as the initial stat: a file can grow during a read.
export async function readRegularFile(file: string, limit = JSON_FILE_LIMIT) {
  // Nonblocking open lets fstat reject FIFOs without waiting for a writer.
  const handle = await fs.open(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > limit) throw new Error(`Expected a regular file of at most ${limit} bytes: ${file}`);
    const chunks: Buffer[] = []; let total = 0;
    while (total <= limit) {
      const buffer = Buffer.allocUnsafe(Math.min(65536, limit + 1 - total));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) return Buffer.concat(chunks, total);
      total += bytesRead;
      if (total > limit) throw new Error(`File grew beyond the size limit: ${file}`);
      chunks.push(buffer.subarray(0, bytesRead));
    }
    throw new Error(`File exceeds the size limit: ${file}`);
  } finally { await handle.close(); }
}
export async function readJSON(file: string, limit = JSON_FILE_LIMIT) { return JSON.parse((await readRegularFile(file, limit)).toString('utf8').replace(/^\uFEFF/, '')) as unknown; }
export async function writeJSON(file: string, value: unknown, limit = JSON_FILE_LIMIT) {
  await atomicWrite(file, serializeJSON(value, limit));
}
export async function atomicWrite(file: string, content: string | Uint8Array, beforeReplace?: () => Promise<void>) {
  let mode = 0o600;
  try { const info = await fs.lstat(file); if (info.isSymbolicLink()) throw new Error(`Refusing to overwrite a symbolic link: ${file}`); mode = info.mode & 0o777; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.pending`);
  let ownsTemp = false;
  try {
    const handle = await fs.open(temp, 'wx', mode); ownsTemp = true;
    try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
    await beforeReplace?.();
    await fs.rename(temp, file); ownsTemp = false;
    const directory = await fs.open(path.dirname(file), 'r');
    try { await directory.sync(); }
    catch (error) { if (!['EINVAL', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
    finally { await directory.close(); }
  } catch (error) {
    // Never remove the destination after rename: it may already be committed.
    // Clean only this call's exclusively created temporary file, not leftovers
    // or intentional recovery records belonging to another operation.
    if (ownsTemp) try { await fs.unlink(temp); }
    catch (cleanup) {
      if ((cleanup as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new AggregateError([error, cleanup], `Atomic write failed and its temporary file could not be removed: ${temp}`, { cause: error });
      }
    }
    throw error;
  }
}
export async function privateDirectory(parent: string, name: string) {
  const child = path.join(parent, name);
  try {
    const stat = await fs.lstat(child);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${child} must be a regular directory.`);
  } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') await fs.mkdir(child, { mode: 0o700 }); else throw e; }
  return child;
}
