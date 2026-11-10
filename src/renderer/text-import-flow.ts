import type { Project } from '../shared/contracts.ts';
import type { TextEncoding, TextImportPreview } from '../shared/text-import.ts';

/** Keeps the project-opening work gate alive through preview and Save As.
 * Closing waits for an in-flight save; it must never abandon a project switch. */
export class TextImportFlow {
  private pending: { preview: TextImportPreview; resolve(value: Project | null): void } | null = null;
  private saving: Promise<void> | null = null;
  private cancelling = false;
  private api: {
    saveTextImport(id: string, encoding: TextEncoding): Promise<Project | null>;
    cancelTextImport(id: string): Promise<void>;
  };
  private show: (preview: TextImportPreview | null) => void;
  constructor(api: TextImportFlow['api'], show: TextImportFlow['show']) { this.api = api; this.show = show; }
  request(preview: TextImportPreview): Promise<Project | null> {
    if (this.pending) throw new Error('Another text import is open.');
    this.cancelling = false;
    return new Promise(resolve => { this.pending = { preview, resolve }; this.show(preview); });
  }
  private finish(project: Project | null) {
    const pending = this.pending; this.pending = null;
    this.show(null); pending?.resolve(project);
  }
  async save(encoding: TextEncoding): Promise<void> {
    if (!this.pending || this.saving || this.cancelling) return;
    const id = this.pending.preview.id;
    const saving = this.api.saveTextImport(id, encoding).then(project => { if (project) this.finish(project); });
    this.saving = saving;
    try { await saving; } finally { this.saving = null; }
  }
  async cancel(): Promise<void> {
    this.cancelling = true;
    if (this.saving) try { await this.saving; } catch { /* Still release a failed import on close. */ }
    if (this.pending) {
      await this.api.cancelTextImport(this.pending.preview.id);
      this.finish(null);
    }
  }
}
