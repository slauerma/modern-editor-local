import * as fs from 'node:fs/promises';
import path from 'node:path';
import type { SourceRecovery } from '../shared/contracts.ts';
import { documentStatePath, regularDirectory } from './document-state.ts';
import { digest, readRegularFile, readJSON } from './files.ts';

// Export is deliberately independent of review validation and never replaces a file.
export async function writeSourceCopy(file: string, text: string) {
  const handle = await fs.open(file, 'wx', 0o600);
  try { await handle.writeFile(text, 'utf8'); await handle.sync(); }
  catch (error) { throw new Error(`The source copy could not be completed at ${file}. A partial new file may exist; the original is unchanged. ${String(error)}`); }
  finally { await handle.close(); }
}

async function readRegular(file: string, limit: number) {
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await readRegularFile(file, limit));
}

// Read-only escape hatch, including when review.json is corrupt. Never repair, select
// a winner, change the open project, or rewrite any source/recovery record here.
export async function inspectSourceRecovery(file: string): Promise<SourceRecovery> {
  const name = path.basename(file), directory = await fs.realpath(path.dirname(file));
  if (path.extname(name).toLowerCase() !== '.tex') throw new Error('Choose the root .tex document.');
  const result: SourceRecovery = { name, choices: [], notices: [] };
  try { result.choices.push({ label: 'Source currently on disk', text: await readRegular(path.join(directory, name), 8000000) }); }
  catch (error) { result.notices.push(String(error)); }
  const seen = new Set(result.choices.map(choice => digest(choice.text)));
  let total = result.choices.reduce((n, c) => n + Buffer.byteLength(c.text), 0);
  const add = (label: string, text: string) => {
    const hash = digest(text);
    if (seen.has(hash)) return;
    if (result.choices.length >= 100 || total + Buffer.byteLength(text) > 32000000) throw new Error('Recovery preview limit reached. Remaining versions are preserved in the recovery/backups folders.');
    seen.add(hash); total += Buffer.byteLength(text); result.choices.push({ label, text });
  };
  const home = path.join(directory, '.modern-editor');
  const document = documentStatePath(path.join(directory, name));
  for (const [kind, parts] of [
    ['Document', [home, path.join(home, 'documents'), document]],
    ['Legacy', [home]]
  ] as const) try {
    if (!(await Promise.all(parts.map(regularDirectory))).every(Boolean)) continue;
    const base = parts[parts.length - 1], recovery = path.join(base, 'recovery');
    if (await regularDirectory(recovery)) {
      const entries = await fs.readdir(recovery, { withFileTypes: true });
      const archives = entries.filter(e => /^conflict-[a-f0-9-]+-(session|save)\.json$/.test(e.name)).map(e => e.name);
      const dated = await Promise.all(archives.map(async record => ({ record, date: (await fs.lstat(path.join(recovery, record))).mtimeMs })));
      const records = ['session.json', 'save.json', ...dated.sort((a, b) => b.date-a.date).map(x => x.record)];
      if (records.length > 1002) result.notices.push('Only the 1,000 most recent archived records are inspected. Older records remain on disk.');
      for (const record of records.slice(0, 1002)) try {
        const file = path.join(recovery, record);
        const saved = await readJSON(file) as any;
        if (saved?.schemaVersion !== 1 || typeof saved.text !== 'string' || saved.text.length > 2000000 ||
            saved.review?.rootFile !== name || !/^[a-f0-9]{64}$/.test(saved.baseDiskHash) ||
            (saved.revision !== undefined && (!Number.isSafeInteger(saved.revision) || saved.revision < 0))) throw new Error('Invalid source identity or recovery envelope.');
        const when = new Date((await fs.stat(file)).mtimeMs).toLocaleString();
        const type = record.startsWith('conflict-') ? 'archived recovery' : record === 'session.json' ? 'recovery session' : 'interrupted save';
        add(`${kind} ${type} · ${when}${saved.revision === undefined ? '' : ` · revision ${saved.revision}`}`, saved.text);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') result.notices.push(`${record}: ${String(error)}`); if (String(error).includes('preview limit')) break; }
    }
    const backups = path.join(base, 'backups');
    if (!(await regularDirectory(backups))) continue;
    // A content-addressed backup has no root filename. Require its owning identity.
    const identity = await readJSON(path.join(base, kind === 'Document' ? 'document.json' : 'review.json')) as any;
    if (identity.rootFile !== name) { result.notices.push(`${kind} backups belong to another or unidentified document; they were preserved.`); continue; }
    const entries = (await fs.readdir(backups)).filter(n => /^source-[a-f0-9]{64}\.tex$/.test(n));
    const dated = await Promise.all(entries.map(async record => ({ record, date: (await fs.lstat(path.join(backups, record))).mtimeMs })));
    for (const { record, date } of dated.sort((a,b) => b.date-a.date).slice(0,1000)) try {
      const bytes = await readRegularFile(path.join(backups, record), 8000000);
      if (record !== `source-${digest(bytes)}.tex`) throw new Error('Backup checksum does not match its name.');
      add(`${kind} source backup · ${new Date(date).toLocaleString()}`, new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes));
    } catch (error) { result.notices.push(`${record}: ${String(error)}`); if (String(error).includes('preview limit')) break; }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') result.notices.push(String(error)); }
  return result;
}
