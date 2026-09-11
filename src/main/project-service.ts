import { listVersions, savedVersion, deleteVersion, setVersionBudget, pruneVersions, recordSaveCheckpoints, completeSaveCheckpoints, originalSaveVersion } from './version-history.ts';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { bufferSchema, reviewSchema, commentSchema, engineSchema, effortSchema, fastModeSchema, baselineSchema, paperInstructionsSchema, workspaceSchema } from '../shared/contracts.ts';
import type { Project, Review, BufferInput, Engine, Effort, Baseline, WorkspaceState } from '../shared/contracts.ts';
import { prepareDocumentState, readStateFile } from './document-state.ts';
import { adoptComment, anchorReview } from '../shared/review.ts';
import { assertRecoveryFits, serializeJSON } from '../shared/persistence.ts';
import { atomicWrite, digest, exists, normalize, privateDirectory, readJSON, readRegularFile, writeJSON } from './files.ts';
import { assertBuildDirectory, captureBuildDirectory, type BuildDirectoryIdentity } from './build-input-plan.ts';

type Recovery = { schemaVersion: 1; baseDiskHash: string; text: string; review: Review; revision?: number };
async function readProjectSource(file: string, identity: BuildDirectoryIdentity) {
  await assertBuildDirectory(path.dirname(file), identity);
  const stat = await fs.lstat(file);
  await assertBuildDirectory(path.dirname(file), identity);
  const bytes = await readRegularFile(file, 2000000, stat);
  await assertBuildDirectory(path.dirname(file), identity);
  return bytes;
}
async function readRecovery(file: string, rootFile: string): Promise<Recovery | null> {
  if (!(await exists(file))) return null;
  const saved = await readJSON(file) as Recovery;
  const review = reviewSchema.parse(saved.review);
  if (saved.schemaVersion !== 1 || typeof saved.text !== 'string' || saved.text.length > 2000000 ||
      !/^[a-f0-9]{64}$/.test(saved.baseDiskHash) || review.rootFile !== rootFile ||
      (saved.revision !== undefined && (!Number.isSafeInteger(saved.revision) || saved.revision < 0))) throw new Error('Invalid saved recovery data.');
  return { ...saved, review };
}
function recoveryIdentity(bytes: Buffer) {
  try {
    const saved = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (saved.schemaVersion === 1 && typeof saved.text === 'string' && /^[a-f0-9]{64}$/.test(saved.baseDiskHash) &&
        (saved.revision === undefined || Number.isSafeInteger(saved.revision) && saved.revision >= 0) && reviewSchema.safeParse(saved.review).success) {
      // Keep every source, proposal, note, decision and message field, including
      // unknown fields. Only these two writer-generated bookkeeping values vary
      // on an otherwise unchanged Save. Archive bytes themselves stay untouched.
      return digest(JSON.stringify({ ...saved, revision: undefined, review: { ...saved.review, updatedAt: undefined } }));
    }
  } catch { /* Preserve malformed records byte-for-byte with their own identity. */ }
  return digest(bytes);
}
async function retainRecovery(file: string) {
  if (await exists(file)) {
    const bytes = await readRegularFile(file);
    const identity = recoveryIdentity(bytes);
    let target = path.join(path.dirname(file), `conflict-${identity}-${path.basename(file)}`);
    if (await exists(target)) {
      if (recoveryIdentity(await readRegularFile(target)) === identity) return;
      // An altered archive must neither replace nor hide this recovery state.
      target = path.join(path.dirname(file), `conflict-${randomUUID()}-${path.basename(file)}`);
    }
    await atomicWrite(target, bytes);
  }
}
export class ProjectService {
  current: Project | null = null;
  private lineEnding = '\n';
  private bom = '';
  private recoveryRevision = 0;
  private openedDirectory: { projectId: string; identity: BuildDirectoryIdentity } | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  readonly cache: string;
  private readonly writeAtomic: typeof atomicWrite;
  constructor(cache: string, writeAtomic = atomicWrite) { this.cache = cache; this.writeAtomic = writeAtomic; }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const pending = this.queue.then(action, action); this.queue = pending.catch(() => {}); return pending;
  }
  async settle() { await this.queue; }
  get(projectId: string) {
    if (!this.current || this.current.id !== projectId) throw new Error('This paper is no longer open.');
    return this.current;
  }
  async assertDirectory(projectId: string): Promise<BuildDirectoryIdentity> {
    const p = this.get(projectId), opened = this.openedDirectory;
    if (!opened || opened.projectId !== projectId) throw new Error('The opened paper folder identity is unavailable. Reopen the paper.');
    await assertBuildDirectory(path.dirname(p.path), opened.identity);
    this.get(projectId);
    return { ...opened.identity };
  }
  private async dirs(p: Project) {
    await this.assertDirectory(p.id);
    const home = await prepareDocumentState(p.path, true);
    return { home, recovery: await privateDirectory(home, 'recovery') };
  }
  async stateDirectory(projectId: string) { return (await this.dirs(this.get(projectId))).home; }
  async open(file: string): Promise<Project> { return this.serial(async () => {
    const actual = await fs.realpath(file);
    if (path.extname(actual).toLowerCase() !== '.tex') throw new Error('Choose the root .tex document.');
    const directoryIdentity = await captureBuildDirectory(path.dirname(actual));
    const bytes = await readProjectSource(actual, directoryIdentity);
    if (bytes.length > 2000000) throw new Error('This first version supports source files up to 2 MB.');
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const lineEnding = raw.includes('\r\n') ? '\r\n' : '\n';
    const bom = bytes.subarray(0, 3).equals(Buffer.from([239, 187, 191])) ? '\uFEFF' : '';
    const text = normalize(raw), name = path.basename(actual), diskHash = digest(bytes);
    const notices: string[] = [];
    let recoveryRevision = 0;
    let review: Review = { schemaVersion: 1, rootFile: name, sourceHash: digest(text), activeId: null, comments: [], updatedAt: new Date().toISOString() };
    const p: Project = { id: randomUUID(), path: actual, name, text, diskHash, review, notices, recovered: false, engine: 'pdflatex', effort: 'medium', fastMode: false, paperInstructions: '', baseline: null };
    const home = await prepareDocumentState(actual, false, notices);
    if (await exists(home)) {
      if ((await fs.lstat(home)).isSymbolicLink()) throw new Error('The review directory is a symbolic link. Choose a paper with a local review directory.');
      const workspaceFile = path.join(home, 'workspace.json');
      if (await exists(workspaceFile)) {
        try {
          const record = await readJSON(workspaceFile, 16000) as { rootFile: string; workspace: unknown };
          if (record.rootFile !== name) throw new Error('Different root document');
          p.workspace = workspaceSchema.parse(record.workspace);
        } catch { notices.push('The saved workspace could not be restored. Its file was kept; source and review recovery are independent.'); }
      }
      const settingsFile = path.join(home, 'settings.json');
      if (await exists(settingsFile)) {
        try {
          const settings = await readJSON(settingsFile) as { rootFile: string; engine: unknown; effort?: unknown; fastMode?: unknown; paperInstructions?: unknown };
          if (settings.rootFile !== name) throw new Error('Different root document');
          p.engine = engineSchema.parse(settings.engine);
          p.effort = effortSchema.parse(settings.effort ?? 'medium');
          p.fastMode = fastModeSchema.parse(settings.fastMode ?? false);
          p.paperInstructions = paperInstructionsSchema.parse(settings.paperInstructions ?? '');
        } catch { notices.push('Some saved paper settings could not be used. Check the review instructions and selectors; the settings file was kept.'); }
      }
      const baselineFile = path.join(home, 'baseline.json');
      if (await exists(baselineFile)) {
        try {
          const baseline = baselineSchema.parse(JSON.parse((await readStateFile(baselineFile)).toString('utf8')));
          if (baseline.rootFile !== name || digest(baseline.text) !== baseline.sourceHash) throw new Error('Baseline identity mismatch');
          p.baseline = baseline;
        } catch { notices.push('The saved comparison version could not be read. It was kept; choose a comparison version again.'); }
      }
      const sidecar = path.join(home, 'review.json');
      if (await exists(sidecar)) {
        review = reviewSchema.parse(await readJSON(sidecar));
        if (review.rootFile !== name) throw new Error(`Cannot open ${name}: its saved review belongs to ${review.rootFile}. Existing files were preserved.`);
      }
      const recoveryDir = path.join(home, 'recovery');
      if (await exists(recoveryDir)) {
        if ((await fs.lstat(recoveryDir)).isSymbolicLink()) throw new Error('The recovery directory must not be a symbolic link.');
        const saveFile = path.join(recoveryDir, 'save.json'), sessionFile = path.join(recoveryDir, 'session.json');
        // Read both before changing either. The sequence survives restarts and includes review-only edits.
        const pending = await readRecovery(saveFile, name), saved = await readRecovery(sessionFile, name);
        recoveryRevision = Math.max(pending?.revision ?? 0, saved?.revision ?? 0);
        const legacyOrder = !!pending && !!saved && (pending.revision === undefined || saved.revision === undefined);
        const latest = pending && (!saved || legacyOrder || pending.revision! >= saved.revision!) ? pending : saved;
        const committed = !!pending && digest(bom + pending.text.replace(/\n/g, lineEnding)) === diskHash;
        // A source rename can commit and then report an error before the in-memory base hash advances.
        // Only this matching journal proves that a newer session can be rebased onto those source bytes.
        const compatible = latest && (latest.baseDiskHash === diskHash ||
          (committed && latest.baseDiskHash === pending!.baseDiskHash));
        if (latest && compatible) {
          p.text = latest.text; review = latest.review; p.recovered = latest.text !== text;
          if (pending) {
            // Parsing a compact legacy record can add defaults and indentation.
            // Validate both replacements before retaining or replacing anything.
            assertRecoveryFits(latest.text, review);
            const sessionJSON = serializeJSON({ ...latest, baseDiskHash: diskHash, revision: recoveryRevision });
            const reviewJSON = serializeJSON(review);
            // Retain alternatives first, then install the chosen pair; remove the journal last.
            await retainRecovery(saveFile);
            if (saved && (saved.text !== latest.text || JSON.stringify(saved.review) !== JSON.stringify(latest.review))) await retainRecovery(sessionFile);
            await atomicWrite(sessionFile, sessionJSON);
            await atomicWrite(sidecar, reviewJSON);
            await fs.unlink(saveFile);
            notices.push('Reconciled an interrupted save; earlier recovery records were retained.');
            if (legacyOrder) notices.push('Legacy recovery ordering is uncertain. Both records were retained in the recovery folder.');
          }
          if (p.recovered) notices.push('Restored unsaved source and its review together.');
        } else if (latest) notices.push('Recovery conflicts with the current file. The file changed outside the editor; recovery was kept but not applied.');
      }
    }
    p.review = anchorReview(p.text, review, review.sourceHash === digest(p.text));
    await fs.mkdir(this.cache, { recursive: true });
    await assertBuildDirectory(path.dirname(actual), directoryIdentity);
    await writeJSON(path.join(this.cache, 'last-project.json'), { path: actual });
    await assertBuildDirectory(path.dirname(actual), directoryIdentity);
    this.openedDirectory = { projectId: p.id, identity: directoryIdentity };
    this.current = p; this.lineEnding = lineEnding; this.bom = bom; this.recoveryRevision = recoveryRevision;
    return structuredClone(p);
  }); }
  async resume() {
    const file = path.join(this.cache, 'last-project.json');
    if (!(await exists(file))) return null;
    const saved = await readJSON(file) as { path?: string };
    return typeof saved.path === 'string' ? this.open(saved.path) : null;
  }
  private checked(input: BufferInput) {
    const parsed = bufferSchema.parse(input), p = this.get(parsed.projectId);
    if (parsed.review.rootFile !== p.name) throw new Error('The review belongs to a different document.');
    const review = { ...parsed.review, sourceHash: digest(parsed.text), updatedAt: new Date().toISOString() };
    return { p, text: parsed.text, review };
  }
  private recovery(p: Project, text: string, review: Review): Recovery {
    if (this.recoveryRevision >= Number.MAX_SAFE_INTEGER) throw new Error('Recovery revision limit reached. The existing files were preserved.');
    return { schemaVersion: 1, baseDiskHash: p.diskHash, text, review, revision: ++this.recoveryRevision };
  }
  async setEngine(projectId: string, engine: Engine) { return this.serial(async () => {
    const p = this.get(projectId), checked = engineSchema.parse(engine), dirs = await this.dirs(p);
    await writeJSON(path.join(dirs.home, 'settings.json'), { rootFile: p.name, engine: checked, effort: p.effort, paperInstructions: p.paperInstructions, fastMode: p.fastMode });
    p.engine = checked;
  }); }
  async setEffort(projectId: string, effort: Effort) { return this.serial(async () => {
    const p = this.get(projectId), checked = effortSchema.parse(effort), dirs = await this.dirs(p);
    await writeJSON(path.join(dirs.home, 'settings.json'), { rootFile: p.name, engine: p.engine, effort: checked, paperInstructions: p.paperInstructions, fastMode: p.fastMode });
    p.effort = checked;
  }); }
  async setFastMode(projectId: string, fastMode: boolean) { return this.serial(async () => {
    const p = this.get(projectId), checked = fastModeSchema.parse(fastMode), dirs = await this.dirs(p);
    await writeJSON(path.join(dirs.home, 'settings.json'), { rootFile: p.name, engine: p.engine, effort: p.effort, paperInstructions: p.paperInstructions, fastMode: checked });
    p.fastMode = checked;
  }); }
  async setPaperInstructions(projectId: string, instructions: string) { return this.serial(async () => {
    const p = this.get(projectId), checked = paperInstructionsSchema.parse(instructions), dirs = await this.dirs(p);
    await writeJSON(path.join(dirs.home, 'settings.json'), { rootFile: p.name, engine: p.engine, effort: p.effort, paperInstructions: checked, fastMode: p.fastMode });
    p.paperInstructions = checked;
  }); }
  async setWorkspace(projectId: string, workspace: WorkspaceState) { return this.serial(async () => {
    const p = this.get(projectId), checked = workspaceSchema.parse(workspace), dirs = await this.dirs(p);
    const file = path.join(dirs.home, 'workspace.json'), next = serializeJSON({ rootFile: p.name, workspace: checked }, 16000);
    let previousBytes: Buffer | undefined, damaged: Buffer | undefined;
    try { previousBytes = await readRegularFile(file, 16000); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    if (previousBytes) {
      let previous: { rootFile?: unknown; workspace?: unknown } | null = null;
      try { previous = JSON.parse(previousBytes.toString('utf8').replace(/^\uFEFF/, '')); } catch { /* Preserve malformed optional view state below. */ }
      if (previous?.rootFile !== undefined && previous.rootFile !== p.name) throw new Error('The existing workspace record belongs to another document and was preserved.');
      if (previous?.rootFile !== p.name || !workspaceSchema.safeParse(previous.workspace).success) {
        const archive = path.join(dirs.home, `workspace-invalid-${digest(previousBytes)}.json`);
        try {
          if (!(await readRegularFile(archive, 16000)).equals(previousBytes)) throw new Error('The existing workspace diagnostic archive is inconsistent. The workspace record was preserved.');
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
          await this.writeAtomic(archive, previousBytes);
        }
        damaged = previousBytes;
      }
    }
    await this.writeAtomic(file, next, damaged ? async () => {
      if (!(await readRegularFile(file, 16000)).equals(damaged)) throw new Error('The workspace record changed while preserving it. Its current contents were kept.');
    } : undefined);
    p.workspace = checked;
  }); }
  async pinBaseline(projectId: string, name: string, text: string, sourcePath: string | null = null): Promise<Baseline> { return this.serial(() => this.keepBaseline(this.get(projectId), name, text, sourcePath)); }
  private async keepBaseline(p: Project, name: string, text: string, sourcePath: string | null = null): Promise<Baseline> {
    const baseline = baselineSchema.parse({ schemaVersion: 1, rootFile: p.name, name, text, sourceHash: digest(text), createdAt: new Date().toISOString(), sourcePath });
    if (Buffer.byteLength(text) > 2000000) throw new Error('Comparison versions are limited to 2 MB. The existing version was kept.');
    const baselineJSON = serializeJSON(baseline);
    const dirs = await this.dirs(p), file = path.join(dirs.home, 'baseline.json');
    if (await exists(file)) {
      const previous = await readStateFile(file), archive = await privateDirectory(dirs.home, 'comparison-versions');
      await atomicWrite(path.join(archive, `baseline-${digest(previous)}.json`), previous);
    }
    await this.writeAtomic(file, baselineJSON);
    p.baseline = baseline;
    return structuredClone(baseline);
  }
  async versionHistory(projectId: string) { return this.serial(() => listVersions(this.get(projectId).path)); }
  async deleteSavedVersion(projectId: string, versionId: string) { return this.serial(() => deleteVersion(this.get(projectId).path, versionId)); }
  async setHistoryBudget(projectId: string, bytes: number) { return this.serial(() => setVersionBudget(this.get(projectId).path, bytes)); }
  async compareSavedVersion(projectId: string, versionId: string) { return this.serial(async () => {
    const p = this.get(projectId), version = await savedVersion(p.path, versionId);
    return this.keepBaseline(p, 'Version ' + new Date(version.createdAt).toLocaleString(), version.text);
  }); }
  async baselineFromFile(projectId: string, file: string) {
    this.get(projectId);
    const actual = await fs.realpath(file);
    if (path.extname(actual).toLowerCase() !== '.tex') throw new Error('Choose a .tex comparison version.');
    const bytes = await readStateFile(actual, 2000000);
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    return this.pinBaseline(projectId, path.basename(actual), text, actual);
  }
  async assertUnchanged(projectId: string) {
    const p = this.get(projectId);
    const directoryIdentity = await this.assertDirectory(projectId);
    const stat = await fs.lstat(p.path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('The source path was replaced. Reopen the paper before saving; your recovery is preserved.');
    if (digest(await readProjectSource(p.path, directoryIdentity)) !== p.diskHash) throw new Error('The source changed in another editor. Reload it before saving or compiling; your recovery is preserved.');
  }
  async persist(input: BufferInput) { return this.serial(async () => {
    const { p, text, review } = this.checked(input), recovery = this.recovery(p, text, review);
    const sessionJSON = serializeJSON(recovery), reviewJSON = serializeJSON(review);
    const dirs = await this.dirs(p), sessionFile = path.join(dirs.recovery, 'session.json');
    const old = await readRecovery(sessionFile, p.name);
    if (old && old.baseDiskHash !== p.diskHash) await retainRecovery(sessionFile);
    // Keep any interrupted-save journal as proof of a possible committed source transition.
    // The higher session revision supersedes it even if this process stops before writing review.json.
    await atomicWrite(sessionFile, sessionJSON);
    await atomicWrite(path.join(dirs.home, 'review.json'), reviewJSON);
  }); }
  async save(input: BufferInput) { return this.serial(async () => {
    const { p, text, review } = this.checked(input);
    const recovery = this.recovery(p, text, review), bytes = this.bom + text.replace(/\n/g, this.lineEnding);
    // Preflight the journal, sidecar and rebased session before changing any
    // saved state. Source byte-limit failures still retain a readable draft.
    const journalJSON = serializeJSON(recovery), reviewJSON = serializeJSON(review);
    const sessionJSON = serializeJSON({ ...recovery, baseDiskHash: digest(bytes) });
    await this.assertUnchanged(p.id);
    try { await fs.access(p.path, fs.constants.W_OK); }
    catch { throw new Error('The source file is read-only. Save stopped; the original source was preserved.'); }
    const dirs = await this.dirs(p);
    const journal = path.join(dirs.recovery, 'save.json');
    await retainRecovery(journal);
    await this.writeAtomic(journal, journalJSON);
    if (Buffer.byteLength(bytes) > 2000000) throw new Error('The edited source exceeds the 2 MB file limit. Save stopped; the original source and your recovery draft were preserved.');
    const previous = await readProjectSource(p.path, await this.assertDirectory(p.id));
    if (digest(previous) !== p.diskHash) throw new Error('The source changed in another editor. Reload it before saving; your recovery is preserved.');
    const backups = await privateDirectory(dirs.home, 'backups');
    for (const content of [previous, Buffer.from(bytes)]) {
      const file = path.join(backups, `source-${digest(content)}.tex`);
      if (await exists(file)) {
        if ((await fs.lstat(file)).isSymbolicLink() || digest(await readRegularFile(file, 2000000)) !== digest(content)) throw new Error('A saved source backup is inconsistent. Save stopped before replacing the source. Check ' + file);
      } else await this.writeAtomic(file, content);
    }
    const checkpointsRecorded = await recordSaveCheckpoints(dirs.home, p.name, digest(previous), digest(bytes), this.writeAtomic);
    await this.writeAtomic(p.path, bytes, async () => { await this.assertUnchanged(p.id); await fs.access(p.path, fs.constants.W_OK); });
    p.diskHash = digest(bytes); p.text = text; p.review = review;
    await this.writeAtomic(path.join(dirs.home, 'review.json'), reviewJSON);
    await retainRecovery(path.join(dirs.recovery, 'session.json'));
    await this.writeAtomic(path.join(dirs.recovery, 'session.json'), sessionJSON);
    await fs.unlink(journal);
    // History maintenance is after the complete save. Failure here must not claim
    // the source was unsaved, nor prune a version needed by an interrupted save.
    const historyNotices: string[] = checkpointsRecorded ? [] : ['Source saved; version history needs attention. save-checkpoints.json could not be verified and was preserved. History updates and deletion are paused.'];
    if (checkpointsRecorded) for (const maintain of [
      () => completeSaveCheckpoints(dirs.home, p.name, digest(previous), p.diskHash, this.writeAtomic),
      async () => { if (!p.baseline && !(await exists(path.join(dirs.home, 'baseline.json')))) await this.keepBaseline(p, 'Before first editor Save', await originalSaveVersion(dirs.home, p.name)); },
      async () => { const history = await pruneVersions(p.path, [digest(previous), p.diskHash]); historyNotices.push(...history.notices); }
    ]) try { await maintain(); } catch (e) { historyNotices.push('Source saved; version history needs attention. ' + String(e)); }
    return { diskHash: p.diskHash, baseline: p.baseline, historyNotice: historyNotices.join(' ') };
  }); }
  async import(file: string, projectId: string, text: string): Promise<Review> {
    const p = this.get(projectId), raw = (await readRegularFile(file, 10000000)).toString('utf8');
    if (raw.length > 10000000) throw new Error('The review file is too large.');
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) {
      if (!value || typeof value !== 'object') throw new Error('Expected a JSON review with a comments array.');
      if (value.rootFile !== undefined && value.rootFile !== p.name) throw new Error('The imported review belongs to a different root document.');
      if (value.schemaVersion !== undefined && value.schemaVersion !== 1) throw new Error('Unsupported imported review version.');
      if (value.sourceHash !== undefined && !/^[a-f0-9]{64}$/.test(value.sourceHash)) throw new Error('The imported review has invalid source-revision metadata.');
    }
    const list = Array.isArray(value) ? value : value.comments;
    if (!Array.isArray(list)) throw new Error('Expected a JSON review with a comments array.');
    const comments = list.map((c, i) => commentSchema.parse({ ...c, id: c.id ?? `import-${i + 1}`, title: c.title ?? 'Review suggestion', explanation: c.explanation ?? c.comment ?? '', original: c.original, replacement: c.replacement ?? null }));
    const review = reviewSchema.parse({ schemaVersion: 1, rootFile: p.name, sourceHash: digest(text), activeId: comments[0]?.id ?? null, comments, updatedAt: new Date().toISOString() });
    return !Array.isArray(value) && value.sourceHash !== undefined
      ? anchorReview(text, review, value.sourceHash === digest(text))
      : { ...review, comments: comments.map(c => adoptComment(text, c)) };
  }
}
