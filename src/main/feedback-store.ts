import fs from 'node:fs/promises';
import path from 'node:path';
import { feedbackRecordSchema, type FeedbackRecord, type FeedbackList } from '../shared/feedback.ts';
import { privateDirectory, readJSON, writeJSON } from './files.ts';
import type { ProjectService } from './project-service.ts';

// Raw advice is retained separately from the manuscript, including failed requests.
export class FeedbackStore {
  readonly projects: ProjectService;
  constructor(projects: ProjectService) { this.projects = projects; }
  private async directory(id: string) { return privateDirectory(await this.projects.stateDirectory(id), 'feedback'); }
  async save(projectId: string, record: FeedbackRecord) {
    const checked = feedbackRecordSchema.parse(record);
    if (this.projects.get(projectId).name !== checked.rootFile) throw new Error('Feedback belongs to another paper.');
    await writeJSON(path.join(await this.directory(projectId), `${checked.createdAt.replace(/[^0-9]/g, '')}-${checked.id}.json`), checked);
    return checked;
  }
  async list(projectId: string): Promise<FeedbackList> {
    const directory = await this.directory(projectId), items: FeedbackRecord[] = [], notices: string[] = [];
    let bytes = 0;
    for (const file of (await fs.readdir(directory)).filter(n => /^(?:\d{17}-)?[a-f0-9-]{36}\.json$/.test(n)).sort().reverse()) {
      if (items.length >= 50 || bytes > 8_000_000) { notices.push('Showing the most recent saved feedback within the display limit. Older records remain in this document’s feedback folder.'); break; }
      try {
        const record = feedbackRecordSchema.parse(await readJSON(path.join(directory, file)));
        if (record.rootFile !== this.projects.get(projectId).name || (file !== `${record.id}.json` && file !== `${record.createdAt.replace(/[^0-9]/g, '')}-${record.id}.json`)) throw new Error('Wrong paper or feedback identity.');
        bytes += Buffer.byteLength(JSON.stringify(record)); items.push(record);
      } catch { notices.push(`${file}: could not read this saved feedback; the file was preserved.`); }
    }
    return { items: items.sort((a,b) => b.createdAt.localeCompare(a.createdAt)), notices };
  }
}
