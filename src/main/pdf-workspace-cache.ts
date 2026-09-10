// Optional reading-state cache. It never supplies source/review recovery or a
// fresh-build verdict; restored PDFs are snapshots until the author compiles.
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { engineSchema, type Build } from '../shared/contracts.ts';
import { digest, readJSON, readRegularFile, writeJSON } from './files.ts';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const cachedBuildSchema = z.object({
  id: z.string().uuid(), engine: engineSchema, success: z.literal(true), clean: z.boolean(), dependenciesVerified: z.boolean().optional(), sourceHash: hash,
  diagnostics: z.array(z.object({ severity: z.enum(['error', 'warning']), message: z.string().max(10000), file: z.string().max(10000).optional(), line: z.number().int().nonnegative().optional() })).max(50),
  log: z.string().max(30000), elapsedMs: z.number().finite().nonnegative()
});
const snapshotSchema = z.object({ schemaVersion: z.literal(1), owner: z.string().max(10000), build: cachedBuildSchema, pdfHash: hash, syncTexHash: hash.nullable() });

export async function rememberPdf(directory: string, owner: string, build: Build) {
  const stem = path.basename(owner).replace(/\.tex$/i, '');
  const pdf = await readRegularFile(path.join(directory, stem + '.pdf'), 100000000);
  let syncTexHash: string | null = null;
  try { syncTexHash = digest(await readRegularFile(path.join(directory, stem + '.synctex.gz'), 32000000)); } catch {}
  const snapshot = snapshotSchema.parse({ schemaVersion: 1, owner, build, pdfHash: digest(pdf), syncTexHash });
  await writeJSON(path.join(directory, '.editor-pdf-snapshot.json'), snapshot, 1000000);
}

export async function restorePdf(cache: string, owner: string, id: string) {
  z.string().uuid().parse(id);
  const directory = path.join(cache, id), stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('The PDF snapshot directory is not a regular local directory.');
  const marker = await readJSON(path.join(directory, '.editor-build.json'), 1000) as { schemaVersion: number; id: string };
  if (marker.schemaVersion !== 1 || marker.id !== id) throw new Error('Unknown PDF snapshot.');
  const snapshot = snapshotSchema.parse(await readJSON(path.join(directory, '.editor-pdf-snapshot.json'), 1000000));
  if (snapshot.owner !== owner || snapshot.build.id !== id) throw new Error('The PDF snapshot belongs to another paper.');
  const stem = path.basename(owner).replace(/\.tex$/i, ''), pdf = path.join(directory, stem + '.pdf');
  const source = await readRegularFile(path.join(directory, path.basename(owner)), 2000000), bytes = await readRegularFile(pdf, 100000000);
  if (digest(source) !== snapshot.build.sourceHash || digest(bytes) !== snapshot.pdfHash || bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('The PDF snapshot changed.');
  if (snapshot.syncTexHash && digest(await readRegularFile(path.join(directory, stem + '.synctex.gz'), 32000000)) !== snapshot.syncTexHash) throw new Error('The PDF position map changed.');
  return { build: snapshot.build, text: new TextDecoder('utf-8', { fatal: true }).decode(source), directory, pdf };
}
