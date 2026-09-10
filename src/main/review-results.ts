// Personal editor: keep completed answers until the UI has safely recorded them.
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { resultSchema, type WaitingResult } from '../shared/contracts.ts';
import { digest, exists, privateDirectory, readJSON, readRegularFile, writeJSON } from './files.ts';
import type { ProjectService } from './project-service.ts';

export class ReviewResults {
  readonly projects: ProjectService;
  constructor(projects: ProjectService) { this.projects = projects; }
  private async directory(projectId: string) { return privateDirectory(await this.projects.stateDirectory(projectId), 'reviews'); }
  async retain(projectId: string, result: WaitingResult) {
    const p = this.projects.get(projectId), checked = resultSchema.parse(result);
    if (checked.rootFile !== p.name) throw new Error('The result belongs to another document.');
    const file = path.join(await this.directory(projectId), `result-${checked.id}.json`);
    if (await exists(file)) throw new Error('A result with this identity already exists; it was preserved.');
    await writeJSON(file, checked);
  }
  async list(projectId: string) {
    const p = this.projects.get(projectId), directory = await this.directory(projectId);
    const items: WaitingResult[] = [], notices: string[] = []; let bytes = 0;
    const files = (await fs.readdir(directory)).filter(n => /^result-[a-f0-9-]{36}\.json$/.test(n)).sort();
    for (const file of files) try {
      const raw = await readRegularFile(path.join(directory, file)), item = resultSchema.parse(JSON.parse(raw.toString('utf8')));
      if (item.rootFile !== p.name || file !== `result-${item.id}.json`) throw new Error('Wrong document or result identity.');
      const receiptFile = path.join(directory, `received-${item.id}.json`);
      if (await exists(receiptFile)) {
        try {
          const receipt = await readJSON(receiptFile, 10000) as any;
          if (receipt.rootFile === p.name && receipt.resultHash === digest(raw) && ['adopted', 'dismissed'].includes(receipt.outcome)) continue;
          throw new Error('Inconsistent acknowledgement');
        } catch { notices.push(`${file}: its acknowledgement could not be verified. Inspect this preserved answer again.`); }
      }
      bytes += raw.length;
      if (items.length >= 100 || bytes > 32000000) { notices.push('More answers remain in the reviews folder. Handle the displayed results, then refresh.'); break; }
      items.push(item);
    } catch (error) { notices.push(`${file}: ${String(error)}`); }
    return { items: items.sort((a, b) => a.createdAt.localeCompare(b.createdAt)), notices };
  }
  async acknowledge(projectId: string, id: string, outcome: 'adopted' | 'dismissed') {
    z.string().uuid().parse(id); z.enum(['adopted', 'dismissed']).parse(outcome);
    const p = this.projects.get(projectId), directory = await this.directory(projectId);
    const raw = await readRegularFile(path.join(directory, `result-${id}.json`)), item = resultSchema.parse(JSON.parse(raw.toString('utf8')));
    if (item.id !== id || item.rootFile !== p.name) throw new Error('Cannot acknowledge a result for another document.');
    await writeJSON(path.join(directory, `received-${id}.json`), { rootFile: p.name, resultHash: digest(raw), outcome, recordedAt: new Date().toISOString() }, 10000);
  }
}
