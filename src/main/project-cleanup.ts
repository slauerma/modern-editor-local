import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { documentStatePath } from './document-state.ts';
import { atomicWrite, digest, normalize, readRegularFile } from './files.ts';
import type { ProjectService } from './project-service.ts';
import type { CleanupFile, CleanupPreview, CleanupResult, CleanupMode } from '../shared/project-cleanup.ts';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const LIMIT = 512 * 1024 * 1024, TOTAL = 2 * 1024 * 1024 * 1024, COUNT = 10000;
type Identity = { dev: number; ino: number };
type Stamp = Identity & { size: number; mtimeMs: number; ctimeMs: number };
type File = CleanupFile & { stamp: Stamp; hash: string };
type Inventory = { files: File[]; directories: { path: string; stamp: Stamp; names: string[] }[]; parents: { path: string; identity: Identity }[]; kept: CleanupPreview['kept']; sources: { path: string; stamp: Stamp; hash: string }[] };
export type CleanupTarget = { path: string; name: string };
type Plan = { preview: CleanupPreview; inventory: Inventory; targets: CleanupTarget[]; mode: CleanupMode; before: number };
const stamp = (s: Stamp): Stamp => ({ dev: s.dev, ino: s.ino, size: s.size, mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const changed = () => new Error('Files changed since this preview. Nothing further was removed. Refresh the file list and confirm again.');
async function statOrNull(file: string) {
  try { return await fs.lstat(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}

// No paths are accepted from the renderer. Ownership comes from ME's storage
// layout and its saved owner records. Unknown/shared files are kept explicitly.
export class ProjectCleanup {
  private plan: Plan | null = null;
  private running = false;
  private projects: ProjectService;
  private runtime: string;
  constructor(projects: ProjectService, runtime: string) { this.projects = projects; this.runtime = runtime; }
  cancel() { if (this.running) throw new Error('Cleanup is already finishing.'); this.plan = null; }
  private async collect(p: CleanupTarget, mode: CleanupMode, before: number): Promise<Inventory> {
    if (!path.isAbsolute(p.path) || p.name !== path.basename(p.path) || !/\.(tex|txt)$/i.test(p.name)) throw new Error('Invalid paper identity.');
    const home = documentStatePath(p.path), key = digest(p.path);
    const files: File[] = [], directories: Inventory['directories'] = [], parents = new Map<string, Identity>(), kept: CleanupPreview['kept'] = [];
    let bytes = 0, inspected = 0;
    const keep = (file: string, reason: string) => kept.push({ path: file, reason });
    const checkParents = async (file: string) => {
      for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
        const s = await fs.lstat(dir);
        if (!s.isDirectory() || s.isSymbolicLink()) throw new Error(`Cleanup stopped: linked or invalid folder ${dir}`);
        const identity = { dev: s.dev, ino: s.ino }, previous = parents.get(dir);
        if (previous && !same(previous, identity)) throw changed();
        parents.set(dir, identity);
        if (dir === path.dirname(dir)) break;
      }
    };
    const read = async (file: string, limit = LIMIT) => {
      await checkParents(file);
      const before = await fs.lstat(file);
      if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) throw new Error(`Cleanup stopped: not a private regular file: ${file}`);
      const data = await readRegularFile(file, limit, before);
      await checkParents(file);
      if (!same(stamp(before), stamp(await fs.lstat(file)))) throw changed();
      return { data, stamp: stamp(before), hash: digest(data) };
    };
    const json = async (file: string) => JSON.parse((await read(file, 8_000_000)).data.toString('utf8'));
    const add = async (file: string, purpose: string, action: CleanupFile['action'] = 'remove') => {
      const value = await read(file);
      bytes += value.data.length;
      if (files.length >= COUNT || bytes > TOTAL) throw new Error('Cleanup exceeds the 10,000-file / 2 GB inspection limit. No files were removed.');
      files.push({ path: file, purpose, action, bytes: value.data.length, modifiedAt: new Date(value.stamp.mtimeMs).toISOString(), stamp: value.stamp, hash: value.hash });
    };
    const entries = async (dir: string) => {
      await checkParents(dir);
      const s = await fs.lstat(dir);
      if (!s.isDirectory() || s.isSymbolicLink()) throw new Error(`Cleanup stopped: linked or invalid folder ${dir}`);
      const names = (await fs.readdir(dir)).sort(); inspected += names.length;
      if (inspected > COUNT * 2) throw new Error('Cleanup inspection exceeds 20,000 directory entries. No files were removed.');
      directories.push({ path: dir, stamp: stamp(s), names });
      return names;
    };
    const tree = async (dir: string, purpose: string, allow: (relative: string, directory: boolean) => boolean, prefix = '') => {
      for (const name of await entries(dir)) {
        const file = path.join(dir, name), relative = prefix + name, s = await fs.lstat(file);
        if (!allow(relative, s.isDirectory())) { keep(file, 'Unrecognized file or folder; left untouched.'); continue; }
        if (s.isDirectory()) await tree(file, purpose, allow, relative + '/'); else await add(file, purpose, relative === 'document.json' ? 'reset' : 'remove');
      }
    };
    const source = await read(p.path, 2_000_000);
    if (mode === 'forget') {
    const session = path.join(home, 'recovery/session.json');
    if (await statOrNull(session)) {
      const saved = await json(session);
      const disk = normalize(new TextDecoder('utf-8', { fatal: true }).decode(source.data));
      if (typeof saved.text !== 'string' || saved.text !== disk) throw new Error('Save the current draft before clearing editing data. Unsaved recovery was kept.');
    }
    keep(p.path, 'Source document — always kept.');
    keep(path.dirname(p.path), 'Figures, bibliography, attached originals, exported PDFs and other project files are kept. Only the listed ME files are cleared.');
    if (await statOrNull(home)) {
      const identity = await json(path.join(home, 'document.json'));
      if (identity.schemaVersion !== 1 || identity.rootFile !== p.name) throw new Error(`Cannot verify this paper's editing data: ${home}`);
      const rootFiles = new Set(['document.json', 'review.json', 'settings.json', 'workspace.json', 'baseline.json', 'session-start.json', 'change-journal.json', 'save-checkpoints.json', 'legacy-history-imports.json']);
      const folders = new Set(['recovery', 'reviews', 'backups', 'comparison-versions', 'comparison-checkpoints', 'feedback']);
      await tree(home, 'Comments, paper settings, recovery and editing history', (rel, dir) => dir ? folders.has(rel) : !rel.includes('/') ? rootFiles.has(rel) || /^workspace-invalid-[a-f0-9]{64}\.json$/.test(rel) : folders.has(rel.split('/')[0]) && /^[^/]+\/[^/]+\.(json|tex|txt)$/.test(rel));
    }
    const chat = path.join(this.runtime, 'help-chats', key + '.json');
    if (await statOrNull(chat)) {
      if ((await json(chat)).owner !== p.path) throw new Error(`Cannot verify Side Chat ownership: ${chat}`);
      await add(chat, 'Side Chat, suggestions and attached screenshots');
    }
    const conversations = path.join(this.runtime, 'review-conversations', key);
    if (await statOrNull(conversations)) {
      for (const name of await entries(conversations)) {
        const file = path.join(conversations, name);
        if (name === 'active.json') { await add(file, 'Active review conversation pointer'); continue; }
        if (!UUID.test(name)) { keep(file, 'Unrecognized conversation item; left untouched.'); continue; }
        const meta = await json(path.join(file, 'conversation.json'));
        if (meta.owner !== p.path || meta.id !== name) throw new Error(`Cannot verify review conversation ownership: ${file}`);
        await tree(file, 'Review conversation and saved exchanges', (rel, dir) => !dir && (rel === 'conversation.json' || /^turn-[a-f0-9-]{36}\.json$/.test(rel)));
      }
    }
    const refs = path.join(this.runtime, 'reference-folders'), registry = path.join(refs, key + '.json');
    if (await statOrNull(registry)) {
      const record = await json(registry);
      if (record.paper !== p.path || !Array.isArray(record.roots)) throw new Error(`Cannot verify reference ownership: ${registry}`);
      await add(registry, 'Reference choices and folder permission');
      for (const root of record.roots) if (root.kind === 'paste') {
        const file = path.join(refs, key + '-' + root.id + '.txt');
        if (!UUID.test(root.id) || root.path !== file) throw new Error('Cannot verify a pasted context file. No files were removed.');
        if (await statOrNull(file)) await add(file, 'Pasted reference text (ME copy)');
      }
    }
    const receipts = path.join(refs, key + '-sources.json');
    if (await statOrNull(receipts)) await add(receipts, 'Sources-used receipts');
    } else keep(home, 'Editing history, comments, chats, reference choices and recovery are kept.');
    keep(p.path, 'Source document — always kept.');
    const builds = path.join(this.runtime, 'builds');
    if (await statOrNull(builds)) {
      for (const name of await entries(builds)) {
        const dir = path.join(builds, name);
        if (!UUID.test(name)) { keep(dir, 'Shared or unrecognized build data; kept.'); continue; }
        // New builds record the owner even on failure. Older successful builds
        // can be attributed by their PDF snapshot; old unowned builds stay put.
        let owner: unknown;
        try {
          const marker = await json(path.join(dir, '.editor-build.json'));
          if (marker.schemaVersion !== 1 || marker.id !== name) throw new Error('Invalid build marker');
          owner = marker.owner;
          if (!owner) { const snapshot = await json(path.join(dir, '.editor-pdf-snapshot.json')); if (snapshot.schemaVersion === 1 && snapshot.build?.id === name) owner = snapshot.owner; }
        } catch { keep(dir, 'Build ownership could not be verified; kept.'); continue; }
        if (owner === p.path) {
          const start = files.length, directoryStart = directories.length;
          await tree(dir, 'Temporary compilation copy, PDF and build logs', () => true);
          if (mode === 'temporary' && (files.slice(start).some(f => f.stamp.mtimeMs >= before) || !files.slice(start).length)) {
            bytes -= files.slice(start).reduce((n, f) => n + f.bytes, 0); files.splice(start); directories.splice(directoryStart);
            keep(dir, 'Recent or empty build; kept. Temporary cleanup only clears complete builds older than the chosen date.');
          }
        }
        else keep(dir, 'Build for another paper or without a verified owner; kept.');
      }
    }
    keep(path.join(path.dirname(p.path), '.modern-editor'), 'Other papers and legacy/shared records are kept. The reset identity prevents old records from being imported again.');
    for (const name of ['debugging', 'usage', 'codex-context', 'chat-context', 'cleanup-archives']) keep(path.join(this.runtime, name), 'Shared diagnostics, usage, protocol state or recovery archives are outside per-paper cleanup.');
    keep(this.runtime, 'Global model/compiler settings and sign-in are kept. Codex CLI conversation storage outside ME is not erased.');
    return { files: files.sort((a, b) => a.path.localeCompare(b.path)), directories: directories.sort((a, b) => a.path.localeCompare(b.path)), parents: [...parents].map(([path, identity]) => ({ path, identity })).sort((a, b) => a.path.localeCompare(b.path)), kept, sources: [{ path: p.path, stamp: source.stamp, hash: source.hash }] };
  }
  async inspect(paper: CleanupTarget, mode: CleanupMode, before: number) {
    const inventory = await this.collect(paper, mode, before);
    return { bytes: inventory.files.reduce((n, f) => n + f.bytes, 0), lastActivity: new Date(Math.max(...inventory.sources.map(f => f.stamp.mtimeMs), ...inventory.files.map(f => f.stamp.mtimeMs))).toISOString() };
  }
  private async collectAll(targets: CleanupTarget[], mode: CleanupMode, before: number): Promise<Inventory> {
    const inventories: Inventory[] = [];
    for (const target of targets) inventories.push(await this.collect(target, mode, before));
    const unique = <T extends { path: string }>(items: T[]): T[] => [...new Map(items.map(i => [i.path, i])).values()].sort((a,b) => a.path.localeCompare(b.path));
    const files = unique(inventories.flatMap(i => i.files));
    if (files.length > COUNT || files.reduce((n,f) => n + f.bytes, 0) > TOTAL) throw new Error('Selected cleanup exceeds 10,000 files / 2 GB. Select fewer papers. No files were removed.');
    return { files, directories: unique(inventories.flatMap(i => i.directories)), parents: unique(inventories.flatMap(i => i.parents)), sources: unique(inventories.flatMap(i => i.sources)), kept: unique(inventories.flatMap(i => i.kept)) };
  }
  async preview(projectId: string): Promise<CleanupPreview> {
    await this.projects.assertDirectory(projectId);
    return this.prepare(projectId, [this.projects.get(projectId)], 'forget', 0);
  }
  async previewPapers(targets: CleanupTarget[], mode: CleanupMode, before: number): Promise<CleanupPreview> {
    if (!targets.length || targets.length > 100 || new Set(targets.map(p => p.path)).size !== targets.length) throw new Error('Select between 1 and 100 different papers.');
    this.assertInactive(targets);
    return this.prepare('selected-papers', targets, mode, before);
  }
  private assertInactive(targets: CleanupTarget[]) {
    if (targets.some(p => p.path === this.projects.current?.path)) throw new Error('The open paper is protected. Close it before selecting it for cleanup.');
  }
  private async prepare(projectId: string, targets: CleanupTarget[], mode: CleanupMode, before: number) {
    if (this.running) throw new Error('Cleanup is already finishing.');
    this.plan = null;
    const inventory = await this.collectAll(targets, mode, before), id = randomUUID(), createdAt = new Date().toISOString();
    const preview: CleanupPreview = { id, projectId, paperPath: targets[0].path, papers: targets.map(p => p.path), mode, createdAt, archivePath: path.join(this.runtime, 'cleanup-archives', createdAt.replace(/[:.]/g, '-') + '-' + id), files: inventory.files.map(({ stamp: _s, hash: _h, ...file }) => file), bytes: inventory.files.reduce((n, f) => n + f.bytes, 0), kept: inventory.kept };
    // Files selected for another paper override its "other paper" kept entry.
    preview.kept = preview.kept.filter(k => !preview.files.some(f => f.path === k.path || f.path.startsWith(k.path + path.sep)) || !k.reason.startsWith('Build for another'));
    this.plan = { inventory, preview, targets: targets.map(p => ({ path: p.path, name: p.name })), mode, before };
    return preview;
  }
  private async verify(plan: Plan) {
    if (plan.preview.projectId === 'selected-papers') this.assertInactive(plan.targets);
    else await this.projects.assertDirectory(plan.preview.projectId);
    if (!same(await this.collectAll(plan.targets, plan.mode, plan.before), plan.inventory)) throw changed();
  }
  private async verifyParents(file: string, plan: Plan) {
    for (const parent of plan.inventory.parents.filter(p => file.startsWith(p.path.endsWith(path.sep) ? p.path : p.path + path.sep))) {
      const s = await fs.lstat(parent.path);
      if (!s.isDirectory() || s.isSymbolicLink() || s.dev !== parent.identity.dev || s.ino !== parent.identity.ino) throw changed();
    }
  }
  async confirm(projectId: string, planId: string): Promise<CleanupResult> {
    const plan = this.plan;
    if (this.running || !plan || plan.preview.id !== planId || plan.preview.projectId !== projectId) throw new Error('This cleanup preview has expired. Refresh the file list.');
    this.running = true; let removed = 0, reset = 0, archived = false;
    const { archivePath } = plan.preview;
    try {
      await this.verify(plan);
      const archiveRoot = path.dirname(archivePath);
      await fs.mkdir(archiveRoot, { mode: 0o700, recursive: true });
      if ((await fs.lstat(archiveRoot)).isSymbolicLink() || await fs.realpath(archiveRoot) !== archiveRoot) throw new Error('Recovery archive location must be a regular folder.');
      await fs.mkdir(archivePath, { mode: 0o700 });
      const archiveIdentity = await fs.lstat(archivePath), archiveRootIdentity = await fs.lstat(archiveRoot);
      const verifyArchive = async () => {
        for (const [dir, expected] of [[archiveRoot, archiveRootIdentity], [archivePath, archiveIdentity]] as const) {
          const current = await fs.lstat(dir);
          if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== expected.dev || current.ino !== expected.ino || await fs.realpath(dir) !== dir) throw new Error('Recovery archive location changed. Cleanup stopped.');
        }
      };
      const archivedStamps = new Map<string, Stamp>();
      const manifest = plan.inventory.files.map((file, i) => ({ ...file, archivedAs: `${String(i + 1).padStart(6, '0')}-${path.basename(file.path)}` }));
      for (const file of manifest) {
        await this.verifyParents(file.path, plan); await verifyArchive();
        const bytes = await readRegularFile(file.path, LIMIT, file.stamp);
        if (digest(bytes) !== file.hash) throw changed();
        const target = path.join(archivePath, file.archivedAs), handle = await fs.open(target, 'wx', 0o600);
        try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
        await fs.utimes(target, file.stamp.mtimeMs / 1000, file.stamp.mtimeMs / 1000);
        const copiedStamp = stamp(await fs.lstat(target));
        if (digest(await readRegularFile(target, LIMIT, copiedStamp)) !== file.hash || !same(stamp(await fs.lstat(target)), copiedStamp)) throw new Error('The recovery archive could not be verified. No files were removed.');
        archivedStamps.set(file.path, copiedStamp);
      }
      await atomicWrite(path.join(archivePath, 'manifest.json'), JSON.stringify({ schemaVersion: 1, paper: plan.preview.paperPath, papers: plan.preview.papers, mode: plan.mode, createdAt: plan.preview.createdAt, files: manifest, kept: plan.preview.kept }, null, 2));
      await atomicWrite(path.join(archivePath, 'README.txt'), 'Recovery archive created before ME cleanup. manifest.json maps each archived file to its original full path, date and checksum. To restore, close ME and copy the required archived files to those exact locations. Do not overwrite newer editing data. Source documents, figures and exported PDFs were not removed. Keep this archive until you no longer need the old comments or history.\n');
      archived = true;
      // All copies are durable and verified before changing any original file.
      await this.verify(plan);
      for (const file of manifest) {
        await this.verifyParents(file.path, plan);
        const s = await fs.lstat(file.path);
        if (!same(stamp(s), file.stamp) || digest(await readRegularFile(file.path, LIMIT, file.stamp)) !== file.hash) throw changed();
        // Reading/hashing a large file is an async window. Recheck both the
        // source and its verified archive copy after that read, before unlink.
        await verifyArchive();
        if (!same(stamp(await fs.lstat(path.join(archivePath, file.archivedAs))), archivedStamps.get(file.path))) throw new Error('An archived copy changed. Cleanup stopped.');
        await this.verifyParents(file.path, plan);
        if (!same(stamp(await fs.lstat(file.path)), file.stamp)) throw changed();
        if (file.action === 'reset') {
          await atomicWrite(file.path, JSON.stringify({ schemaVersion: 1, rootFile: plan.targets.find(p => documentStatePath(p.path) === path.dirname(file.path))!.name, legacyHistoryDisabled: true }), async () => { if (!same(stamp(await fs.lstat(file.path)), file.stamp)) throw changed(); });
          reset++;
        } else { await fs.unlink(file.path); removed++; }
      }
      // rmdir only: never recursively delete new or unrecognized content.
      for (const dir of [...plan.inventory.directories].sort((a, b) => b.path.length - a.path.length)) {
        const s = await fs.lstat(dir.path);
        if (s.dev !== dir.stamp.dev || s.ino !== dir.stamp.ino || !s.isDirectory() || s.isSymbolicLink()) throw changed();
        try { await fs.rmdir(dir.path); } catch (e) { if (!['ENOTEMPTY', 'EEXIST'].includes((e as NodeJS.ErrnoException).code ?? '')) throw e; }
      }
      await atomicWrite(path.join(archivePath, 'cleanup-result.json'), JSON.stringify({ removed, reset, completedAt: new Date().toISOString() }));
      this.plan = null;
      return { archivePath, removed, reset };
    } catch (error) {
      this.plan = null;
      // Once any data changed, finish closing rather than letting the old
      // renderer autosave the just-cleared comments back into the paper.
      if (removed || reset) return { archivePath, removed, reset, warning: `Cleanup stopped early: ${String(error)} Remaining files were kept. Recovery archive: ${archivePath}. Check the reported problem before restoring files.` };
      throw new Error(`${removed || reset ? `Cleanup stopped after removing ${removed} files and resetting ${reset} identity record(s).` : 'No editing files were removed.'} ${String(error)}${archived ? ` Recovery archive: ${archivePath}` : ''}`);
    } finally { this.running = false; }
  }
}
