import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { referenceText, searchReferenceText } from './reference-text.ts';
import { digest, readRegularFile } from './files.ts';
import { ATTACHMENT_LIMITS as limits, attachmentSelectionsSchema, selectedPdfPages, selectedTextLines, type AttachmentInventory, type AttachmentItem, type AttachmentPreview, type AttachmentSelection, type AttachmentExcerpt } from '../shared/attachments.ts';

type Grant = { item: AttachmentItem; file: string; root: string; dev: number; ino: number };
type Snapshot = { preview: AttachmentPreview; files: { grant: Grant; hash: string }[] };
type Scope = { grants: Map<string, Grant>; notices: string[]; generation: number; snapshot: Snapshot | null };
type PdfResult = { count: number; pages: { page: number; text: string; clipped: boolean }[]; searchedTo?: number; nextPage?: number };
type Options = { pdfModulePath: string; pdfTimeoutMs?: number };
const hiddenOrPrivate = (name: string) => name.startsWith('.') || /(?:credential|password|secret|api[-_.]?key|private[-_.]?key|access[-_.]?token)/i.test(name) || /^(?:AGENTS|CLAUDE)\.md$/i.test(name);
const excludedDirectory = (name: string) => hiddenOrPrivate(name) || /^(?:node_modules|dist|build|builds|target|backups?|recovery|cache|logs?|venv|__pycache__)$/i.test(name);
const displayName = (name: string) => name.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 500);
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

// Only bytes already read from an explicitly granted local file reach this worker.
// It extracts text, never renders PDF actions or retrieves external resources.
// The worker can be terminated even when a malformed PDF blocks its event loop.
const pdfWorker = `
const { parentPort, workerData } = require('node:worker_threads');
(async () => {
  const { getDocument } = await import(workerData.module);
  const task = getDocument({ data: new Uint8Array(workerData.bytes), verbosity: 0,
    disableFontFace: true, useSystemFonts: false,
    useWorkerFetch: false, useWasm: false, enableXfa: false,
    disableAutoFetch: true, disableStream: true, stopAtErrors: true });
  try {
    const pdf = await task.promise;
    if (!Number.isSafeInteger(pdf.numPages) || pdf.numPages < 1 || pdf.numPages > 100000) throw new Error('Unsupported PDF page count.');
    const search = workerData.search;
    const start = search?.startPage || 1;
    if (start > pdf.numPages) throw new Error('Choose a page within this PDF.');
    const chosen = search ? Array.from({length: Math.min(20, pdf.numPages - start + 1)}, (_, i) => start + i) : workerData.pages || Array.from({length: Math.min(8, pdf.numPages)}, (_, i) => i + 1);
    if (chosen.some(page => page > pdf.numPages)) throw new Error('Choose PDF pages between 1 and ' + pdf.numPages + '.');
    const perPage = Math.max(1, Math.floor(workerData.characters / chosen.length));
    const pages = []; let searchedTo = 0;
    for (const page of chosen) {
      const p = await pdf.getPage(page);
      const content = await p.getTextContent({ disableNormalization: true });
      let text = '';
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue;
        const cap = search ? 200000 : perPage;
        text += item.str.slice(0, cap + 1 - text.length) + (item.hasEOL ? '\\n' : ' ');
        if (text.length > cap) break;
      }
      if (search) {
        const at = text.toLowerCase().indexOf(search.query.toLowerCase());
        if (at >= 0) pages.push({page, text: text.slice(Math.max(0, at - 250), at + search.query.length + 750).trim(), clipped: true});
        else if (text.length > 200000) pages.push({page, text: '', clipped: true});
        searchedTo = page;
      } else pages.push({page, text: text.slice(0, perPage).trim(), clipped: text.length > perPage});
      p.cleanup();
    }
    parentPort.postMessage({ok: true, count: pdf.numPages, pages, ...(search ? {searchedTo, nextPage: searchedTo < pdf.numPages ? searchedTo + 1 : undefined} : {})});
  } finally { await task.destroy(); }
})().catch(error => parentPort.postMessage({ok:false,
  error: error?.name === 'PasswordException' ? 'This PDF requires a password. Use an unlocked local copy.' : String(error?.message || error).slice(0, 400)}));
`;

export class AttachmentService {
  private scopes = new Map<string, Scope>();
  private active: { projectId: string; worker: Worker } | null = null;
  private preparing: string | null = null;
  private options: Options;
  constructor(options: Options) { this.options = options; }
  // Independent per-request reader: no preview/grant state is shared with the UI.
  forkReader() { return new AttachmentService(this.options); }
  excludeFile(projectId: string, file: string) {
    const scope = this.scope(projectId);
    for (const [id, grant] of scope.grants) if (grant.file === file) scope.grants.delete(id);
  }
  async readReference(projectId: string, selection: AttachmentSelection) {
    const preview = await this.preview(projectId, [selection]);
    const stored = this.scope(projectId).snapshot!;
    return { name: stored.files[0].grant.item.name, hash: stored.files[0].hash, excerpts: preview.excerpts.map(({ location, text }) => ({ location, text })), notices: preview.notices };
  }
  async searchReference(projectId: string, id: string, query: string, startPage = 1) {
    if (this.preparing) throw new Error('A reference operation is already running.');
    const scope = this.scope(projectId), generation = scope.generation, grant = scope.grants.get(id);
    if (!grant) throw new Error('This reference is not available to this request.');
    this.preparing = projectId;
    try {
      const bytes = await this.readGranted(grant), hash = digest(bytes);
      let result: { excerpts: { location: string; text: string }[]; notices: string[]; location: string; nextPage?: number };
      if (grant.item.kind === 'pdf') {
        const pdf = await this.pdf(projectId, bytes, undefined, limits.perFileCharacters, { query, startPage });
        result = { excerpts: pdf.pages.filter(p => p.text).slice(0, 12).map(p => ({ location: `PDF page ${p.page} of ${pdf.count}`, text: p.text })),
          location: `Searched PDF pages ${startPage}-${pdf.searchedTo} of ${pdf.count}`,
          notices: ['PDF search uses extracted text; equations, scans and reading order may not be preserved.', ...(pdf.pages.some(p => !p.text) ? ['Some page text exceeded the 200,000-character search limit.'] : []), ...(pdf.pages.filter(p => p.text).length > 12 ? ['Only the first 12 matching pages are shown; narrow the query or start at a later page.'] : [])], nextPage: pdf.nextPage };
      } else result = searchReferenceText(referenceText(bytes), query);
      if (scope.generation !== generation) throw new Error('Reference reading was cancelled.');
      return { name: grant.item.name, hash, ...result };
    } finally { this.preparing = null; }
  }
  private scope(projectId: string) {
    let scope = this.scopes.get(projectId);
    if (!scope) { scope = { grants: new Map(), notices: [], generation: 0, snapshot: null }; this.scopes.set(projectId, scope); }
    return scope;
  }
  inventory(projectId: string): AttachmentInventory {
    const scope = this.scope(projectId);
    return { items: [...scope.grants.values()].map(grant => ({ ...grant.item })).sort((a, b) => a.name.localeCompare(b.name)), notices: [...scope.notices] };
  }
  // Call only with paths returned by the native file/folder picker, never renderer paths.
  async grant(projectId: string, selectedPaths: string[]): Promise<AttachmentInventory> {
    if (!selectedPaths.length || selectedPaths.length > 20) throw new Error('Choose between one and twenty files or folders at a time.');
    const scope = this.scope(projectId); scope.generation++; scope.snapshot = null;
    const generation = scope.generation;
    let inspected = 0, skipped = 0, limited = false;
    const notices: string[] = [];
    const add = async (file: string, root: string, name: string) => {
      if (hiddenOrPrivate(path.basename(file))) { skipped++; return; }
      const extension = path.extname(file).toLowerCase();
      const kind = extension === '.pdf' ? 'pdf' : ['.tex', '.txt', '.md', '.markdown'].includes(extension) ? 'text' : null;
      if (!kind) { skipped++; return; }
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink()) { skipped++; return; }
      const maxBytes = kind === 'pdf' ? limits.pdfBytes : limits.textBytes;
      if (stat.size > maxBytes) { notices.push(`${displayName(name)}: too large (${maxBytes / 1_000_000} MB limit).`); return; }
      const existing = [...scope.grants.values()].find(g => g.file === file);
      if (existing) { existing.dev = stat.dev; existing.ino = stat.ino; existing.item.bytes = stat.size; return; }
      if (scope.grants.size >= limits.inventory) { limited = true; return; }
      let label = displayName(name), suffix = 2;
      while ([...scope.grants.values()].some(g => g.item.name === label)) label = `${displayName(name)} (${suffix++})`;
      const item: AttachmentItem = { id: randomUUID(), name: label, kind, bytes: stat.size };
      scope.grants.set(item.id, { item, file, root, dev: stat.dev, ino: stat.ino });
    };
    const walk = async (dir: string, root: string, depth: number) => {
      const stat = await fs.lstat(dir);
      if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(dir) !== dir) { skipped++; return; }
      const handle = await fs.opendir(dir);
      for await (const entry of handle) {
        if (++inspected > limits.entries || scope.grants.size >= limits.inventory) { limited = true; break; }
        if (entry.isSymbolicLink() || hiddenOrPrivate(entry.name)) { skipped++; continue; }
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (excludedDirectory(entry.name)) { skipped++; continue; }
          if (depth >= limits.depth) { limited = true; continue; }
          await walk(file, root, depth + 1);
        } else if (entry.isFile()) await add(file, root, path.join(path.basename(root), path.relative(root, file)));
        else skipped++;
      }
    };
    for (const selected of selectedPaths) {
      if (inspected >= limits.entries) { limited = true; break; }
      const name = displayName(path.basename(selected));
      try {
        const stat = await fs.lstat(selected);
        if (stat.isSymbolicLink() || hiddenOrPrivate(path.basename(selected))) { notices.push(`${name}: hidden, sensitive-name or linked items are not attached.`); continue; }
        const file = await fs.realpath(selected);
        if (stat.isDirectory()) {
          if (excludedDirectory(path.basename(file))) { notices.push(`${name}: generated or application folders are not attached.`); continue; }
          await walk(file, file, 0);
        } else if (stat.isFile()) await add(file, path.dirname(file), path.basename(file));
        else notices.push(`${name}: choose an ordinary file or folder.`);
      } catch { notices.push(`${name}: could not inspect this local item. Check access and choose it again.`); }
      if (scope.generation !== generation) throw new Error('The reference selection changed. Choose the references again.');
    }
    if (scope.generation !== generation) throw new Error('The reference selection changed. Choose the references again.');
    if (skipped) notices.push(`${skipped} hidden, linked, generated, sensitive-name or unsupported items were excluded.`);
    if (limited) notices.push(`This inventory is incomplete: at most ${limits.inventory} files, ${limits.entries} entries and ${limits.depth} nested folder levels are inspected. Choose a smaller folder to see more.`);
    if (!scope.grants.size) notices.push('No eligible PDF, LaTeX, Markdown or text files were found.');
    scope.notices = [...new Set([...scope.notices, ...notices])].slice(-50);
    return this.inventory(projectId);
  }
  private async readGranted(grant: Grant) {
    const stat = await fs.lstat(grant.file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.dev !== grant.dev || stat.ino !== grant.ino || await fs.realpath(grant.file) !== grant.file || await fs.realpath(grant.root) !== grant.root) throw new Error('The selected file or its location changed. Choose it again.');
    const bytes = await readRegularFile(grant.file, grant.item.kind === 'pdf' ? limits.pdfBytes : limits.textBytes, stat);
    const after = await fs.lstat(grant.file);
    if (after.dev !== stat.dev || after.ino !== stat.ino || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) throw new Error('The file changed while it was being read. Preview it again.');
    return bytes;
  }
  private async pdf(projectId: string, bytes: Buffer, pages: string | undefined, characters: number, search?: { query: string; startPage: number }): Promise<PdfResult> {
    if (!bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('This file is not a readable PDF.');
    const chosen = pages?.trim() ? selectedPdfPages(pages, 100000) : null;
    const worker = new Worker(pdfWorker, { eval: true, workerData: { module: pathToFileURL(this.options.pdfModulePath).href, bytes, pages: chosen, characters, search }, resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 }, stdout: true, stderr: true });
    // Do not put document metadata/parser diagnostics into shared console logs.
    worker.stdout.resume(); worker.stderr.resume();
    this.active = { projectId, worker };
    return new Promise((resolve, reject) => {
      let finished = false;
      const finish = async (error: Error | null, result?: PdfResult) => {
        if (finished) return; finished = true; clearTimeout(timer);
        await worker.terminate();
        if (this.active?.worker === worker) this.active = null;
        if (error) reject(error); else resolve(result!);
      };
      const timer = setTimeout(() => { void finish(new Error('PDF text extraction took too long. Choose fewer pages or use a text excerpt.')); }, this.options.pdfTimeoutMs ?? 15000);
      worker.once('message', result => { void finish(result.ok ? null : new Error(result.error), result); });
      worker.once('error', () => { void finish(new Error('PDF text extraction failed or exceeded its memory limit. Use a smaller PDF or text excerpt.')); });
      worker.once('exit', () => { void finish(new Error('PDF text extraction was cancelled or stopped.')); });
    });
  }
  async preview(projectId: string, input: AttachmentSelection[]): Promise<AttachmentPreview> {
    const selections = attachmentSelectionsSchema.parse(input);
    if (this.preparing) throw new Error('A reference preview is being prepared. Wait for it to finish.');
    const scope = this.scope(projectId), generation = ++scope.generation;
    scope.snapshot = null; this.preparing = projectId;
    const budget = Math.min(limits.perFileCharacters, Math.floor(limits.characters / selections.length));
    const excerpts: AttachmentExcerpt[] = [], notices: string[] = [], files: Snapshot['files'] = [];
    try {
      for (const selection of selections) {
        const grant = scope.grants.get(selection.id);
        if (!grant) throw new Error('A reference is no longer selected. Choose it again.');
        try {
          const bytes = await this.readGranted(grant);
          files.push({ grant, hash: digest(bytes) });
          if (grant.item.kind === 'pdf') {
            if (selection.lines?.trim()) throw new Error('Choose PDF pages instead of text lines.');
            const result = await this.pdf(projectId, bytes, selection.pages, budget);
            for (const page of result.pages) {
              if (page.text.trim()) excerpts.push({ name: grant.item.name, location: `PDF page ${page.page} of ${result.count}${page.clipped ? ' (excerpt)' : ''}`, text: page.text });
              else notices.push(`${grant.item.name}: page ${page.page} has no selectable text; scanned pages require a separate text/OCR copy.`);
              if (page.clipped) notices.push(`${grant.item.name}: page ${page.page} continues beyond the excerpt. Choose fewer pages for a longer excerpt.`);
            }
            if (result.pages.length < result.count) notices.push(`${grant.item.name}: includes only pages ${result.pages.map(p => p.page).join(', ')} of ${result.count}.`);
            if (!result.pages.some(p => p.text.trim())) throw new Error('No selectable text was found on these pages. Scanned/image PDFs require a separate text/OCR copy.');
            notices.push(`${grant.item.name}: PDF text extraction can lose equation symbols, columns and reading order. Inspect the excerpts before using them.`);
          } else {
            if (selection.pages?.trim()) throw new Error('Choose text lines instead of PDF pages.');
            let text: string;
            try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
            catch { throw new Error('Use a UTF-8 text copy; this file uses a different or invalid encoding.'); }
            if (text.includes('\0')) throw new Error('This appears to be a binary file, not readable text.');
            const lines = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n'), range = selectedTextLines(selection.lines, lines.length);
            const chosen = lines.slice(range.from - 1, range.to).join('\n'), excerpt = chosen.slice(0, budget);
            if (!excerpt.trim()) throw new Error('The selected lines contain no text.');
            const end = range.from + excerpt.split('\n').length - 1;
            excerpts.push({ name: grant.item.name, location: `Text lines ${range.from}-${end}${chosen.length > excerpt.length ? ' (excerpt ends within this range)' : ''}`, text: excerpt });
            if (chosen.length > excerpt.length) notices.push(`${grant.item.name}: the selected text continues beyond this ${excerpt.length}-character excerpt. Choose a narrower line range.`);
            if (range.from > 1 || range.to < lines.length) notices.push(`${grant.item.name}: only the selected lines are included (${lines.length} lines in the file).`);
          }
        } catch (error) { throw new Error(`${grant.item.name}: ${errorText(error)}`); }
        if (scope.generation !== generation) throw new Error('The reference selection changed while preparing the preview. Preview it again.');
      }
      const preview: AttachmentPreview = { id: randomUUID(), selections: structuredClone(selections), excerpts, notices, characters: excerpts.reduce((total, excerpt) => total + excerpt.text.length, 0) };
      scope.snapshot = { preview: structuredClone(preview), files };
      return structuredClone(preview);
    } finally { this.preparing = null; }
  }
  async resolve(projectId: string, previewId: string): Promise<AttachmentPreview> {
    const scope = this.scope(projectId), snapshot = scope.snapshot;
    if (!snapshot || snapshot.preview.id !== previewId) throw new Error('The reference preview is no longer current. Preview the references again before asking Codex.');
    for (const { grant, hash } of snapshot.files) {
      try { if (digest(await this.readGranted(grant)) !== hash) throw new Error('The file changed after the preview. Preview it again before asking Codex.'); }
      catch (error) { throw new Error(`${grant.item.name}: ${errorText(error)}`); }
    }
    if (scope.snapshot !== snapshot) throw new Error('The reference selection changed. Preview it again before asking Codex.');
    return structuredClone(snapshot.preview);
  }
  remove(projectId: string, itemId: string): AttachmentInventory {
    const scope = this.scope(projectId);
    scope.generation++; scope.snapshot = null; scope.grants.delete(itemId);
    return this.inventory(projectId);
  }
  async clear(projectId: string) {
    const scope = this.scopes.get(projectId);
    if (scope) { scope.generation++; scope.snapshot = null; scope.grants.clear(); scope.notices = []; this.scopes.delete(projectId); }
    if (this.active?.projectId === projectId) await this.active.worker.terminate();
  }
  async stop() { if (this.active) await this.active.worker.terminate(); }
}
