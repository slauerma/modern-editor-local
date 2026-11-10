import fs from 'node:fs/promises';
import path from 'node:path';
import { digest, readRegularFile } from './files.ts';
import { ProjectCleanup, type CleanupTarget } from './project-cleanup.ts';
import type { ProjectService } from './project-service.ts';
import type { CleanupMode, CleanupPapers } from '../shared/project-cleanup.ts';

const HASH = /^[a-f0-9]{64}$/, UUID = /^[a-f0-9-]{36}$/;
// Discover only ME's own records and state folders beside known papers. Never
// search the user's disk, open a project, migrate history or create state here.
export class DataCleanup {
  private known = new Map<string, CleanupTarget>();
  private projects: ProjectService; private runtime: string; private cleanup: ProjectCleanup;
  constructor(projects: ProjectService, runtime: string, cleanup: ProjectCleanup) { this.projects = projects; this.runtime = runtime; this.cleanup = cleanup; }
  add(file: string, first = false) {
    if (!path.isAbsolute(file) || !/\.(tex|txt)$/i.test(file)) return;
    const id = digest(file), target = { path: file, name: path.basename(file) };
    if (first) { this.known.delete(id); this.known = new Map([[id, target], ...this.known]); }
    else this.known.set(id, target);
  }
  async list(mode: CleanupMode, days: number): Promise<CleanupPapers> {
    const notices: string[] = [], opened = new Map<string, string>();
    const names = async (dir: string) => {
      try {
        const stat = await fs.lstat(dir);
        if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(dir) !== dir) throw new Error('Not a regular local folder');
        const result: string[] = [];
        for await (const entry of await fs.opendir(dir)) { if (result.length >= 2000) throw new Error('More than 2,000 entries'); result.push(entry.name); }
        return result.sort();
      } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') notices.push(`Could not fully inspect ${dir}: ${String(e)}. Records there are kept.`); return []; }
    };
    const json = async (file: string) => {
      try {
        if (await fs.realpath(file) !== file) throw new Error('Linked record');
        return JSON.parse((await readRegularFile(file, 2_000_000)).toString('utf8'));
      } catch (e) { notices.push(`Could not inspect ${file}: ${String(e)}. Record kept.`); return null; }
    };
    try { for (const p of (await this.projects.recentProjects.list()).items) { this.add(p.path); opened.set(p.path, p.openedAt); } }
    catch (e) { notices.push(String(e)); }
    if (this.projects.current) this.add(this.projects.current.path);
    for (const directory of ['help-chats', 'reference-folders']) {
      const dir = path.join(this.runtime, directory);
      for (const name of await names(dir)) {
        if (!name.endsWith('.json') || !HASH.test(name.slice(0, -5))) continue;
        const record = await json(path.join(dir, name)), owner = record?.owner ?? record?.paper;
        if (typeof owner === 'string' && digest(owner) === name.slice(0, -5)) this.add(owner);
      }
    }
    const conversations = path.join(this.runtime, 'review-conversations');
    for (const key of await names(conversations)) {
      if (!HASH.test(key)) continue;
      for (const id of await names(path.join(conversations, key))) {
        if (!UUID.test(id)) continue;
        const record = await json(path.join(conversations, key, id, 'conversation.json'));
        if (typeof record?.owner === 'string' && digest(record.owner) === key && record.id === id) this.add(record.owner);
      }
    }
    const builds = path.join(this.runtime, 'builds');
    for (const id of await names(builds)) {
      if (!UUID.test(id)) continue;
      const record = await json(path.join(builds, id, '.editor-build.json'));
      if (record?.schemaVersion === 1 && record.id === id && typeof record.owner === 'string') this.add(record.owner);
    }
    for (const directory of new Set([...this.known.values()].map(p => path.dirname(p.path)))) {
      const documents = path.join(directory, '.modern-editor', 'documents');
      for (const key of await names(documents)) {
        if (!HASH.test(key)) continue;
        const record = await json(path.join(documents, key, 'document.json')), name = record?.rootFile;
        if (record?.schemaVersion === 1 && typeof name === 'string' && name === path.basename(name) && digest(name) === key) this.add(path.join(directory, name));
      }
    }
    const papers: CleanupPapers['papers'] = [], before = Date.now() - days * 86400000;
    if (this.known.size > 100) notices.push('Showing the first 100 known papers. Use Choose paper to inspect a specific additional paper.');
    for (const [id, p] of [...this.known].slice(0, 100)) {
      const current = p.path === this.projects.current?.path;
      if (current) { papers.push({ ...p, id, current, bytes: 0, lastActivity: opened.get(p.path) ?? null, problem: 'Open paper — close it before clearing its data.' }); continue; }
      try {
        const info = await this.cleanup.inspect(p, mode, before);
        papers.push({ ...p, ...info, id, current, lastActivity: [info.lastActivity, opened.get(p.path)].filter(Boolean).sort().at(-1)! });
      } catch (e) { papers.push({ ...p, id, current, bytes: 0, lastActivity: opened.get(p.path) ?? null, problem: String(e) }); }
    }
    return { papers: papers.sort((a,b) => (b.lastActivity ?? '').localeCompare(a.lastActivity ?? '') || a.path.localeCompare(b.path)), notices };
  }
  async preview(ids: string[], mode: CleanupMode, days: number) {
    const targets = ids.map(id => { const p = this.known.get(id); if (!p) throw new Error('Refresh the paper list before selecting this paper.'); return p; });
    return this.cleanup.previewPapers(targets, mode, Date.now() - days * 86400000);
  }
}
