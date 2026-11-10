import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { baselineSchema, type Baseline, type ComparisonVersion } from '../shared/contracts.ts';
import { atomicWrite, digest, privateDirectory, readJSON } from './files.ts';
import { regularDirectory } from './document-state.ts';
import { serializeJSON } from '../shared/persistence.ts';

const versionSchema = z.object({
  id: z.string().uuid(), kind: z.enum(['paste', 'review', 'named']),
  name: baselineSchema.shape.name, createdAt: baselineSchema.shape.createdAt,
  sourceHash: baselineSchema.shape.sourceHash, characters: z.number().int().min(0).max(2000000),
  preview: z.string().max(180)
}).strict();
const indexSchema = z.object({
  schemaVersion: z.literal(1), rootFile: baselineSchema.shape.rootFile,
  versions: z.array(versionSchema).max(1000)
}).strict();
const directory = (home: string) => path.join(home, 'comparison-checkpoints');

export async function comparisonVersions(home: string, rootFile: string): Promise<ComparisonVersion[]> {
  if (!await regularDirectory(directory(home))) return [];
  try {
    const index = indexSchema.parse(await readJSON(path.join(directory(home), 'index.json'), 2000000));
    if (index.rootFile !== rootFile || new Set(index.versions.map(v => v.id)).size !== index.versions.length)
      throw new Error('Comparison history belongs to another document or contains duplicate records.');
    return index.versions;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new Error('Comparison history could not be read. Existing versions were preserved. ' + String(error));
  }
}

export async function readComparisonVersion(home: string, rootFile: string, id: string): Promise<Baseline> {
  const versions = await comparisonVersions(home, rootFile), version = versions.find(v => v.id === id);
  if (!version) throw new Error('That comparison version is unavailable. Refresh the version list.');
  const baseline = baselineSchema.parse(await readJSON(path.join(directory(home), `${version.id}.json`)));
  if (baseline.rootFile !== rootFile || baseline.sourceHash !== version.sourceHash ||
      digest(baseline.text) !== version.sourceHash || baseline.text.length !== version.characters ||
      baseline.name !== version.name || baseline.createdAt !== version.createdAt)
    throw new Error('The comparison version could not be verified. Its files were preserved.');
  return baseline;
}

// Called within ProjectService's serial queue. Publish complete snapshot bytes
// before the index; failed writes never replace an earlier source or checkpoint.
export async function keepComparisonVersion(
  home: string, rootFile: string, text: string, kind: ComparisonVersion['kind'],
  name?: string, sourcePath: string | null = null, write = atomicWrite
): Promise<Baseline> {
  const versions = await comparisonVersions(home, rootFile), hash = digest(text);
  const sameKind = versions.filter(v => v.kind === kind), last = sameKind.at(-1);
  if (kind === 'paste' && sameKind.length) return readComparisonVersion(home, rootFile, sameKind[0].id);
  // Section reviews share one frozen full draft. Retain it once, not once per section.
  if (kind === 'review' && last?.sourceHash === hash) return readComparisonVersion(home, rootFile, last.id);
  if (versions.length >= 1000) throw new Error('This paper has reached the 1,000 comparison-version limit. Existing versions were preserved.');
  if (Buffer.byteLength(text) > 2000000) throw new Error('Comparison versions are limited to 2 MB.');
  const baseline = baselineSchema.parse({
    schemaVersion: 1, rootFile, text, sourceHash: hash, sourcePath, createdAt: new Date().toISOString(),
    name: name ?? (kind === 'paste' ? 'Original pasted text' : sameKind.length ? `Before review ${sameKind.length + 1}` : 'Before first review')
  });
  const version: ComparisonVersion = {
    id: randomUUID(), kind, name: baseline.name, createdAt: baseline.createdAt,
    sourceHash: hash, characters: text.length, preview: text.replace(/\s+/g, ' ').trim().slice(0, 180)
  };
  const indexJSON = serializeJSON({ schemaVersion: 1, rootFile, versions: [...versions, version] }, 2000000);
  const folder = await privateDirectory(home, 'comparison-checkpoints');
  await write(path.join(folder, `${version.id}.json`), serializeJSON(baseline));
  await write(path.join(folder, 'index.json'), indexJSON);
  return baseline;
}
