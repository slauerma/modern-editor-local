import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest } from './files.ts';
import { documentStatePath, regularDirectory } from './document-state.ts';
import type { ProjectService } from './project-service.ts';
import type { CompileService } from './compile-service.ts';
import type { ReferenceService } from './reference-service.ts';
import type { ProjectFile, ProjectFiles } from '../shared/project-files.ts';

/** A small, read-only inventory. Renderer actions use issued IDs, never paths. */
export class ProjectFilesService {
  private grants = new Map<string, { projectId: string; file: string; dev: number; ino: number }>();
  private projects: ProjectService; private compiler: CompileService; private references: ReferenceService; private chatDirectory: string;
  constructor(projects: ProjectService, compiler: CompileService, references: ReferenceService, chatDirectory: string) { this.projects = projects; this.compiler = compiler; this.references = references; this.chatDirectory = chatDirectory; }
  async list(projectId: string): Promise<ProjectFiles> {
    const paper = this.projects.get(projectId); await this.projects.assertDirectory(projectId);
    const items: ProjectFile[] = [], notices: string[] = [], grants = new Map<string, { projectId: string; file: string; dev: number; ino: number }>();
    const add = async (file: string, group: ProjectFile['group'], name = path.basename(file)) => {
      if (items.some(i => i.path === file)) return;
      try {
        const stat = await fs.lstat(file);
        if (stat.isSymbolicLink() || !stat.isFile() && !stat.isDirectory()) return;
        const id = randomUUID();
        items.push({ id, group, name, path: file, bytes: stat.isFile() ? stat.size : 0, modified: stat.mtime.toISOString(), directory: stat.isDirectory() });
        grants.set(id, { projectId, file, dev: stat.dev, ino: stat.ino });
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') notices.push(name + ' could not be inspected.'); }
    };
    await add(paper.path, 'Paper', paper.name + ' · source');
    await add(path.dirname(paper.path), 'Paper', 'Paper folder');
    const siblings = await fs.readdir(path.dirname(paper.path), { withFileTypes: true });
    for (const entry of siblings.filter(e => !e.name.startsWith('.') && (e.isDirectory() || /\.(tex|txt|bib|sty|cls|pdf|png|jpg|jpeg|eps)$/i.test(e.name))).slice(0, 80)) await add(path.join(path.dirname(paper.path), entry.name), 'Paper');
    if (siblings.length > 80) notices.push('The paper list is limited to 80 neighboring entries. Reveal the paper folder for the rest.');
    const home = documentStatePath(paper.path);
    if (await regularDirectory(home)) {
      await add(home, 'Saved state', 'Paper state folder');
      for (const name of ['review.json', 'settings.json', 'workspace.json', 'baseline.json', 'document.json', 'backups', 'recovery', 'reviews', 'feedback', 'change-journal.json']) await add(path.join(home, name), 'Saved state');
    }
    await add(path.join(this.chatDirectory, digest(paper.path) + '.json'), 'Context & chat', 'Paper Side Chat');
    try { for (const item of await this.references.files(projectId)) await add(item.path, 'Context & chat', item.name); }
    catch { notices.push('Context locations could not be read. Their saved files are preserved; other paper files are listed below.'); }
    for (const pdf of this.compiler.availablePdfs(projectId)) await add(pdf.path, 'PDFs', pdf.name);
    this.projects.get(projectId);
    this.grants = grants;
    return { items, notices };
  }
  async resolve(projectId: string, id: string) {
    const grant = this.grants.get(id);
    if (!grant || grant.projectId !== projectId) throw new Error('Refresh Files & history before using this item.');
    this.projects.get(projectId); await this.projects.assertDirectory(projectId);
    const stat = await fs.lstat(grant.file);
    if (stat.isSymbolicLink() || stat.dev !== grant.dev || stat.ino !== grant.ino || await fs.realpath(grant.file) !== grant.file) throw new Error('This file moved or changed. Refresh Files & history.');
    return grant.file;
  }
}
