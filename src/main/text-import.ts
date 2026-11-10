import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { captureBuildDirectory, assertBuildDirectory, type BuildDirectoryIdentity } from './build-input-plan.ts';
import { digest, readRegularFile } from './files.ts';
import { inspectTextEncoding, textImportLimit } from './text-encoding.ts';
import type { TextEncoding, TextImportPreview } from '../shared/text-import.ts';

type Pending = { preview: TextImportPreview; bytes: Buffer; dev: number; ino: number; directory: BuildDirectoryIdentity };
export class TextImportService {
  private pending: Pending | null = null;
  private writing = false;
  async prepare(file: string): Promise<TextImportPreview | null> {
    if (this.writing) throw new Error('A text import is already being saved.');
    this.pending = null;
    const actual = await fs.realpath(file), extension = path.extname(actual).toLowerCase();
    if (!['.txt', '.tex'].includes(extension)) throw new Error('Choose a .tex or .txt document.');
    const directory = await captureBuildDirectory(path.dirname(actual)), stat = await fs.lstat(actual);
    const bytes = await readRegularFile(actual, textImportLimit, stat);
    await assertBuildDirectory(directory.path, directory);
    const conversion = inspectTextEncoding(bytes, extension === '.tex');
    if (!conversion) return null;
    const preview: TextImportPreview = { kind: 'text-import', id: randomUUID(), name: path.basename(actual), sourcePath: actual, ...conversion };
    this.pending = { preview, bytes, dev: stat.dev, ino: stat.ino, directory };
    return preview;
  }
  private get(id: string) {
    if (!this.pending || this.pending.preview.id !== id) throw new Error('This import has expired. Open the original file again.');
    return this.pending;
  }
  defaultPath(id: string) {
    const file = this.get(id).preview.sourcePath, extension = path.extname(file);
    return file.slice(0, -extension.length) + '-utf8' + extension;
  }
  cancel(id: string) {
    if (this.writing) throw new Error('Wait for the UTF-8 copy to finish saving.');
    if (this.pending?.preview.id === id) this.pending = null;
  }
  private async unchanged(pending: Pending) {
    await assertBuildDirectory(pending.directory.path, pending.directory);
    const bytes = await readRegularFile(pending.preview.sourcePath, textImportLimit, pending);
    await assertBuildDirectory(pending.directory.path, pending.directory);
    if (digest(bytes) !== digest(pending.bytes)) throw new Error('The original file changed after this preview. Cancel and open it again.');
  }
  async save(id: string, encoding: TextEncoding, destination: string): Promise<string> {
    if (this.writing) throw new Error('A text import is already being saved.');
    const pending = this.get(id), choice = pending.preview.choices.find(c => c.encoding === encoding);
    if (!choice) throw new Error('Choose an encoding from this preview.');
    if (choice.limitation) throw new Error(choice.limitation);
    const target = path.resolve(destination);
    if (path.extname(target).toLowerCase() !== path.extname(pending.preview.sourcePath).toLowerCase()) throw new Error('Keep the original .txt or .tex extension for the UTF-8 copy.');
    this.writing = true;
    let created: { dev: number; ino: number } | undefined;
    const output = Buffer.from(choice.text, 'utf8');
    let directory: BuildDirectoryIdentity | undefined;
    try {
      await this.unchanged(pending);
      directory = await captureBuildDirectory(path.dirname(target));
      const handle = await fs.open(target, 'wx', 0o600);
      try {
        created = await handle.stat();
        await handle.writeFile(output); await handle.sync();
      } finally { await handle.close(); }
      await assertBuildDirectory(directory.path, directory);
      const saved = await readRegularFile(target, textImportLimit, created);
      if (!saved.equals(output)) throw new Error('The new copy changed while it was being saved.');
      await this.unchanged(pending);
      this.pending = null;
      return target;
    } catch (e) {
      // Only remove our exact, unchanged output (including a partial write).
      // Never unlink a pre-existing destination or a replacement made by someone else.
      if (created && directory) {
        try {
          await assertBuildDirectory(directory.path, directory);
          const saved = await readRegularFile(target, textImportLimit, created);
          if (saved.equals(output.subarray(0, saved.length))) await fs.unlink(target);
        } catch { /* Preserve uncertain files. */ }
      }
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('That file already exists. Choose a new filename; ME never overwrites a file during conversion.');
      throw e;
    } finally { this.writing = false; }
  }
}
