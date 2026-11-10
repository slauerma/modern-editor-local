import * as fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { digest, readJSON, writeJSON } from './files.ts';
import type { RecentProjects } from '../shared/recent-projects.ts';

const itemSchema = z.object({ id: z.string().regex(/^[a-f0-9]{64}$/), name: z.string().min(1).max(500), path: z.string().max(10000).refine(p => path.isAbsolute(p) && ['.tex', '.txt'].includes(path.extname(p).toLowerCase())), openedAt: z.string().datetime() }).strict();
const schema = z.object({ schemaVersion: z.literal(1), items: z.array(itemSchema).max(30) }).strict();
type Item = z.infer<typeof itemSchema>;
export class RecentProjectStore {
  private directory: string;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(directory: string) { this.directory = directory; }
  private async read(): Promise<Item[]> {
    try { return schema.parse(await readJSON(path.join(this.directory, 'recent-projects.json'), 400000)).items; }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('The recent-project list could not be read. Use Open paper; the existing list was kept.');
      // Upgrade from the single automatic-resume entry, without scanning papers.
      try {
        const saved = await readJSON(path.join(this.directory, 'last-project.json'), 20000) as { path?: string };
        if (typeof saved.path === 'string') {
          const stat = await fs.lstat(path.join(this.directory, 'last-project.json'));
          return [itemSchema.parse({ id: digest(saved.path), name: path.basename(saved.path), path: saved.path, openedAt: stat.mtime.toISOString() })];
        }
      } catch { /* No previously recorded paper is available. */ }
      return [];
    }
  }
  async record(file: string) {
    const operation = this.queue.then(async () => {
      const items = await this.read(), item = itemSchema.parse({ id: digest(file), name: path.basename(file), path: file, openedAt: new Date().toISOString() });
      await fs.mkdir(this.directory, { recursive: true });
      await writeJSON(path.join(this.directory, 'recent-projects.json'), { schemaVersion: 1, items: [item, ...items.filter(previous => previous.path !== file)].slice(0, 30) });
    });
    this.queue = operation.catch(() => {}); return operation;
  }
  async list(): Promise<RecentProjects> {
    await this.queue;
    const items = await this.read();
    return { notices: [], items: await Promise.all(items.map(async item => {
      let available = false;
      try { const stat = await fs.lstat(item.path); available = stat.isFile() && !stat.isSymbolicLink() && await fs.realpath(item.path) === item.path; } catch { /* Listed for recognition; opening stays disabled. */ }
      return { ...item, available };
    })) };
  }
  async resolve(id: string): Promise<string> {
    const item = (await this.list()).items.find(item => item.id === id);
    if (!item?.available) throw new Error('This recent paper is unavailable or has moved. Use Open paper to locate it.');
    return item.path;
  }
}
