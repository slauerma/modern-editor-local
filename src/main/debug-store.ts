import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { debugSettingsSchema, debugEntrySchema, defaultDebugSettings, type DebugSettings, type DebugEntry, type DebugState } from '../shared/debugging.ts';
import { atomicWrite, privateDirectory, readJSON, writeJSON } from './files.ts';

// This store is never a source of paper, review, model context or recovery data.
// A fixed budget stops recording; it never silently deletes older evidence.
export class DebugStore {
  private settings: DebugSettings = { ...defaultDebugSettings };
  private entries: DebugEntry[] = [];
  private notice = '';
  private loaded = false;
  private queue: Promise<unknown> = Promise.resolve();
  private epoch = 0;
  readonly directory: string;
  readonly limitBytes: number;
  private entryLimit: number;
  constructor(directory: string, limitBytes = 200_000_000, entryLimit = 500) { this.directory = directory; this.limitBytes = limitBytes; this.entryLimit = entryLimit; }
  // Captures span an await outside the write queue. Changing settings or
  // clearing records invalidates captures already in flight, including off/on.
  get captureGeneration() { return this.epoch; }
  recordWindowScreenshot(generation: number, bytes: Uint8Array) {
    return this.record('screenshot', 'Periodic editor window', null, { bytes, extension: 'jpg' }, generation);
  }
  get enabled() { return this.loaded && this.settings.enabled; }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const next = this.queue.catch(() => {}).then(action); this.queue = next; return next;
  }
  private async load() {
    if (this.loaded) return;
    try {
      const stat = await fs.lstat(this.directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Debug storage must be a regular directory.');
      try { this.settings = debugSettingsSchema.parse(await readJSON(path.join(this.directory, 'settings.json'), 4000)); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
      try { this.entries = z.array(debugEntrySchema).max(500).parse(await readJSON(path.join(this.directory, 'register.json'), 300000)); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
      // Reconcile only our UUID payloads. A failed register write must not leave
      // a private payload that the cleanup register cannot identify.
      const files = await fs.readdir(this.directory);
      const existing = new Set(files); this.entries = this.entries.filter(e => existing.has(e.file));
      for (const file of files) {
        if (!/^[a-f0-9-]{36}\.(json|png|jpg)$/.test(file) || this.entries.some(e => e.file === file)) continue;
        const stat = await fs.lstat(path.join(this.directory, file));
        if (!stat.isFile() || stat.isSymbolicLink()) continue;
        const id = file.slice(0, 36); if (!z.string().uuid().safeParse(id).success) continue;
        this.entries.push({ id, file, bytes: stat.size, createdAt: stat.mtime.toISOString(), kind: file.endsWith('.json') ? 'event' : 'screenshot', label: 'Recovered debug record' });
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') { this.settings.enabled = false; this.notice = 'Debug logging is off: its storage could not be read. Inspect the debug folder before clearing it.'; }
    }
    this.loaded = true;
  }
  private async folder() { return privateDirectory(path.dirname(this.directory), path.basename(this.directory)); }
  private snapshot(): DebugState {
    const bytes = this.entries.reduce((sum, entry) => sum + entry.bytes, 0);
    return { settings: { ...this.settings }, directory: this.directory, entries: [...this.entries].reverse(), bytes, limitBytes: this.limitBytes,
      notice: this.notice || (bytes >= this.limitBytes || this.entries.length >= this.entryLimit ? 'Debug storage is full. Delete records to resume logging.' : '') };
  }
  state() { return this.serial(async () => { await this.load(); return this.snapshot(); }); }
  configure(settings: DebugSettings) {
    const checked = debugSettingsSchema.parse(settings); this.epoch++;
    return this.serial(async () => {
      await this.load(); await this.folder(); await writeJSON(path.join(this.directory, 'settings.json'), checked);
      this.settings = checked; this.notice = ''; return this.snapshot();
    });
  }
  record(kind: DebugEntry['kind'], label: string, data: unknown, image?: { bytes: Uint8Array; extension: 'png' | 'jpg' }, captureGeneration?: number) {
    const epoch = captureGeneration ?? this.epoch;
    return this.serial(async () => {
      await this.load(); if (!this.enabled || epoch !== this.epoch || captureGeneration !== undefined && !this.settings.screenshots) return;
      let content: string | Uint8Array;
      try { content = image?.bytes ?? JSON.stringify({ createdAt: new Date().toISOString(), kind, label, data }, null, 2); }
      catch { this.notice = 'A debug record could not be serialized.'; return; }
      const bytes = Buffer.byteLength(content), total = this.entries.reduce((n, e) => n + e.bytes, 0);
      if (bytes > 8_000_000 || total + bytes > this.limitBytes || this.entries.length >= this.entryLimit) { this.notice = 'Debug storage is full or this record is too large. No new record was saved. Delete records to resume.'; return; }
      const id = randomUUID(), file = `${id}.${image?.extension ?? 'json'}`;
      const entry: DebugEntry = { id, file, bytes, kind, label: label.slice(0, 200), createdAt: new Date().toISOString() };
      await this.folder(); await atomicWrite(path.join(this.directory, file), content);
      this.entries.push(entry);
      await writeJSON(path.join(this.directory, 'register.json'), this.entries);
    }).catch(() => { this.notice = 'A debug record could not be saved. Normal editing is unaffected; inspect the debug folder.'; });
  }
  remove(ids: string[] | 'all') {
    if (ids !== 'all') z.array(z.string().uuid()).max(500).parse(ids);
    this.epoch++;
    return this.serial(async () => {
      await this.load(); await this.folder();
      if (ids === 'all') { this.settings = { ...this.settings, enabled: false }; await writeJSON(path.join(this.directory, 'settings.json'), this.settings); }
      const selected = new Set(ids === 'all' ? this.entries.map(e => e.id) : ids);
      for (const entry of [...this.entries]) {
        if (!selected.has(entry.id)) continue;
        // Only exact registered basenames; never caller-supplied paths or a tree.
        const file = path.join(this.directory, entry.file);
        try { await fs.unlink(file); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
        this.entries = this.entries.filter(e => e !== entry);
      }
      await this.folder(); await writeJSON(path.join(this.directory, 'register.json'), this.entries); this.notice = '';
      return this.snapshot();
    });
  }
  async settle() { await this.queue.catch(() => {}); } // Optional logging must never block closing.
}
