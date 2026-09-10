import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import type { Build, Engine, PdfRequest, PdfLocation } from '../shared/contracts.ts';
import { compiledPosition, syncTexLocation } from './pdf-navigation.ts';
import type { ProjectService } from './project-service.ts';
import { digest, readRegularFile, readJSON, privateDirectory, writeJSON } from './files.ts';
import { classifyBuildLog } from './diagnostics.ts';
import { compilerEnvironment, toolchainPaths, recordedInputs, type RecordedInput } from './compile-inputs.ts';
import { rememberPdf, restorePdf } from './pdf-workspace-cache.ts';

type Input = { relative: string; hash: string };
type Record = { build: Build; projectId: string; text: string; inputs: Input[]; directory: string; pdf: string; external: RecordedInput[]; tciSupport?: { path: string; hash: string }; restored?: boolean };
const allowed = new Set(['.tex', '.bib', '.bst', '.cls', '.sty', '.png', '.jpg', '.jpeg', '.pdf', '.eps', '.svg', '.csv', '.dat', '.txt', '.bbl', '.bb', '.def', '.otf', '.ttf', '.tikz', '.pgf']);
export class CompileService {
  private running: { child: ChildProcess; cancelled: boolean } | null = null;
  private busy = false;
  private cancelled = false;
  private stopped: (() => void)[] = [];
  private records = new Map<string, Record>();
  private navigation = new Map<AbortController, Promise<PdfLocation>>();
  private preparation: AbortController | null = null;
  readonly projects: ProjectService;
  readonly cache: string;
  readonly latexmk: string;
  readonly timeoutMs: number;
  readonly tciLatexPath: string | undefined;
  constructor(projects: ProjectService, cache: string, latexmk = '/Library/TeX/texbin/latexmk', timeoutMs = 120000, tciLatexPath?: string) { this.projects = projects; this.cache = cache; this.latexmk = latexmk; this.timeoutMs = timeoutMs; this.tciLatexPath = tciLatexPath; }
  private async inputFiles(rootDir: string, rootName: string, checkCancellation = false) {
    const files: string[] = []; let total = 0;
    const walk = async (relative = '') => {
      if (checkCancellation && this.cancelled) throw new Error('Compilation cancelled.');
      for (const entry of await fs.readdir(path.join(rootDir, relative), { withFileTypes: true })) {
        if (entry.name.startsWith('.') || ['node_modules', 'dist', 'build', 'output', 'out', 'releases'].includes(entry.name)) continue;
        const rel = path.join(relative, entry.name), source = path.join(rootDir, rel);
        if (entry.isSymbolicLink()) { if (allowed.has(path.extname(entry.name).toLowerCase())) throw new Error(`The snapshot cannot include the linked resource ${rel}. Use a self-contained project copy.`); continue; }
        if (entry.isDirectory()) { await walk(rel); continue; }
        if (!entry.isFile() || !allowed.has(path.extname(entry.name).toLowerCase()) || rel === rootName.replace(/\.tex$/i, '.pdf')) continue;
        total += (await fs.stat(source)).size;
        if (total > 200 * 1024 * 1024 || files.length >= 2000) throw new Error('Choose a smaller, self-contained paper folder (maximum 200 MB / 2,000 inputs in this version).');
        files.push(rel);
      }
    };
    await walk(); return files.sort();
  }
  async compile(projectId: string, text: string, engine: Engine): Promise<Build> {
    if (this.busy) throw new Error('A compilation is already running.');
    if (text.length > 2000000) throw new Error('Source exceeds the supported size.');
    this.busy = true;
    this.cancelled = false;
    this.preparation = new AbortController();
    try {
      const project = this.projects.get(projectId);
      await this.projects.assertUnchanged(projectId);
      const id = randomUUID(), directory = path.join(this.cache, id);
      await fs.mkdir(this.cache, { recursive: true, mode: 0o700 });
      await privateDirectory(this.cache, id);
      await writeJSON(path.join(directory, '.editor-build.json'), { schemaVersion: 1, id }, 1000);
      const inputs: Input[] = [];
      const rootDir = path.dirname(project.path);
      for (const rel of await this.inputFiles(rootDir, project.name, true)) {
        if (this.cancelled) throw new Error('Compilation cancelled.');
        const bytes = rel === project.name ? Buffer.from(text) : await readRegularFile(path.join(rootDir, rel), 200 * 1024 * 1024);
        const target = path.join(directory, rel);
        await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
        await fs.writeFile(target, bytes, { mode: 0o600, flag: 'wx' });
        inputs.push({ relative: rel, hash: digest(bytes) });
      }
      if (this.cancelled) throw new Error('Compilation cancelled.');
      if (!inputs.some(i => i.relative === project.name)) throw new Error('The root source was not included in the snapshot.');
      // SWP 5.5 support belongs only in the build snapshot. A paper's own
      // root-level copy always wins, including case variants on macOS.
      let tciSupport: Record['tciSupport'];
      if (this.tciLatexPath && !inputs.some(i => i.relative.toLowerCase() === 'tcilatex.tex')) {
        const bytes = await readRegularFile(this.tciLatexPath, 8000000);
        await fs.writeFile(path.join(directory, 'tcilatex.tex'), bytes, { flag: 'wx', mode: 0o600 });
        tciSupport = { path: this.tciLatexPath, hash: digest(bytes) };
      }
      if (this.cancelled) throw new Error('Compilation cancelled.');
      const flags = { pdflatex: '-pdf', lualatex: '-lualatex', xelatex: '-xelatex' };
      const args = ['-norc', flags[engine], '-synctex=1', '-interaction=nonstopmode', '-halt-on-error', '-file-line-error', '-latexoption=-recorder', '-latexoption=-no-shell-escape', './' + project.name];
      const started = Date.now();
      let output = '';
      const texCache = path.join(this.cache, 'texmf-cache');
      await privateDirectory(this.cache, 'texmf-cache');
      await privateDirectory(texCache, 'home'); await privateDirectory(texCache, 'tmp');
      const env = compilerEnvironment(this.latexmk, texCache);
      // Compatibility for older LuaTeX; openin_any has no effect in TeX Live 2026.
      // These flags are not an OS sandbox or a filesystem-read boundary.
      env.openin_any = engine === 'lualatex' ? 'r' : 'p';
      const toolchain = await toolchainPaths(this.latexmk, env, this.preparation.signal).catch(() => ({ directories: [], files: [] }));
      if (this.cancelled) throw new Error('Compilation cancelled.');
      const child = spawn(this.latexmk, args, { cwd: directory, shell: false, detached: process.platform !== 'win32', env, stdio: ['ignore', 'pipe', 'pipe'] });
      const running = { child, cancelled: false, timedOut: false }; this.running = running;
      // Decode streams incrementally: a Unicode character can span two output chunks.
      child.stdout!.setEncoding('utf8'); child.stderr!.setEncoding('utf8');
      const capture = (chunk: string) => { output = (output + chunk).slice(-200000); };
      child.stdout!.on('data', capture); child.stderr!.on('data', capture);
      const watchdog = setTimeout(() => { running.cancelled = true; running.timedOut = true; this.terminate(child); }, this.timeoutMs);
      let code: number | null;
      try { code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }); }
      finally { clearTimeout(watchdog); this.running = null; this.terminateDescendants(child); }
      await fs.writeFile(path.join(directory, 'editor-build.log'), output, { mode: 0o600 });
      const stem = project.name.replace(/\.tex$/i, ''), pdf = path.join(directory, stem + '.pdf');
      let validPdf = false;
      try { const data = await readRegularFile(pdf, 100000000); validPdf = data.subarray(0, 5).toString() === '%PDF-'; } catch {}
      let log = output, logReadable = true;
      try { log = (await readRegularFile(path.join(directory, stem + '.log'), 8000000)).toString('utf8'); }
      catch { logReadable = false; }
      const { diagnostics, blockingWarnings } = classifyBuildLog(log);
      if (!logReadable) diagnostics.unshift({ severity: 'warning', message: 'The complete compiler log could not be checked within the 8 MB regular-file limit.' });
      let dependenciesVerified = false, external: RecordedInput[] = [];
      try {
        const recorded = await recordedInputs(directory, stem, toolchain, texCache);
        external = recorded.external;
        if (recorded.unsupported.length) throw new Error('Unsupported external input: ' + recorded.unsupported.slice(0, 8).join(', ') + '. Copy manuscript resources into the paper folder and use relative paths.');
        for (const input of inputs.filter(i => !i.relative.endsWith('.bbl'))) {
          if (digest(await readRegularFile(path.join(directory, input.relative), 200 * 1024 * 1024)) !== input.hash) throw new Error(`Compilation changed the copied input ${input.relative}.`);
        }
        dependenciesVerified = true;
      } catch (error) { diagnostics.unshift({ severity: 'warning', message: `PDF dependencies are not verified. ${String(error)}` }); }
      if (running.cancelled || this.cancelled) diagnostics.unshift({ severity: 'error', message: running.timedOut ? 'Compilation exceeded its time limit and was stopped. Check the engine and build log.' : 'Compilation cancelled.' });
      const success = code === 0 && validPdf && !running.cancelled && !this.cancelled;
      if (!success && !diagnostics.some(d => d.severity === 'error')) diagnostics.push({ severity: 'error', message: 'LaTeX did not produce a successful PDF. See the build log.' });
      const build: Build = { id, engine, success, clean: success && !blockingWarnings && dependenciesVerified && logReadable, dependenciesVerified, sourceHash: digest(text), diagnostics: diagnostics.slice(0, 50), log: output.slice(-30000), elapsedMs: Date.now() - started };
      this.records.set(id, { build, projectId, text, inputs, directory, pdf, tciSupport, external });
      // This optional snapshot is only for reopening the reader. Failure does
      // not turn a valid compilation into a failed source edit.
      if (success) try { await rememberPdf(directory, project.path, build); }
      catch { build.diagnostics.push({ severity: 'warning', message: 'This PDF could not be retained for workspace restoration. It remains available in this session.' }); }
      return build;
    } finally { this.preparation = null; this.busy = false; this.stopped.splice(0).forEach(resolve => resolve()); }
  }
  private terminate(child: ChildProcess) {
    if (!child.pid) return;
    try { process.platform === 'win32' ? child.kill('SIGTERM') : process.kill(-child.pid, 'SIGTERM'); } catch {}
    const timer = setTimeout(() => this.terminateDescendants(child), 1500); timer.unref();
  }
  private terminateDescendants(child: ChildProcess) {
    if (!child.pid || process.platform === 'win32') return;
    try { process.kill(-child.pid, 'SIGKILL'); } catch {}
  }
  cancel() { this.cancelled = true; this.preparation?.abort(); if (this.running) { this.running.cancelled = true; this.terminate(this.running.child); } }
  async stop() { this.cancel(); for (const controller of this.navigation.keys()) controller.abort(); await Promise.allSettled(this.navigation.values()); if (this.busy) await new Promise<void>(resolve => this.stopped.push(resolve)); }
  async validate(projectId: string, buildId: string, text: string) {
    const record = this.records.get(buildId);
    if (!record || record.restored || record.projectId !== projectId || !record.build.success || !record.build.dependenciesVerified || record.text !== text) return false;
    try {
      const project = this.projects.get(projectId);
      await this.projects.assertUnchanged(projectId);
      if (record.tciSupport && digest(await readRegularFile(record.tciSupport.path, 8000000)) !== record.tciSupport.hash) return false;
      for (const input of record.external) if (digest(await readRegularFile(input.path, 64000000)) !== input.hash) return false;
      const names = await this.inputFiles(path.dirname(project.path), project.name);
      if (JSON.stringify(names) !== JSON.stringify(record.inputs.map(input => input.relative))) return false;
      for (const input of record.inputs) {
        const hash = input.relative === project.name ? digest(text) : digest(await readRegularFile(path.join(path.dirname(project.path), input.relative), 200 * 1024 * 1024));
        if (hash !== input.hash) return false;
      }
      return true;
    } catch { return false; }
  }
  async pdf(buildId: string) {
    const record = this.records.get(buildId);
    if (!record?.build.success) throw new Error('That successful PDF is no longer available. Compile again.');
    return new Uint8Array(await readRegularFile(record.pdf, 100000000));
  }
  async restore(projectId: string, buildId: string) {
    const project = this.projects.get(projectId), snapshot = await restorePdf(this.cache, project.path, buildId);
    this.projects.get(projectId);
    this.records.set(buildId, { ...snapshot, projectId, inputs: [], external: [], restored: true });
    return { build: snapshot.build, text: snapshot.text };
  }
  locatePdf(input: PdfRequest): Promise<PdfLocation> {
    if (this.navigation.size >= 4) return Promise.resolve({ kind: 'unavailable', reason: 'A PDF position is still being located. Try again in a moment.' });
    const controller = new AbortController(), task = this.locateSnapshot(input, controller.signal);
    this.navigation.set(controller, task);
    return task.finally(() => this.navigation.delete(controller));
  }
  private async locateSnapshot(input: PdfRequest, signal: AbortSignal): Promise<PdfLocation> {
    const project = this.projects.get(input.projectId), record = this.records.get(input.buildId);
    if (!record || record.projectId !== project.id || !record.build.success) return { kind: 'compile', reason: 'Compile this draft to create a PDF with source positions.' };
    if (!record.build.dependenciesVerified) return { kind: 'unavailable', reason: 'This PDF has unverified inputs. Resolve its build warnings before using source navigation.' };
    const position = compiledPosition(input.text, record.text, input.from, input.to);
    if ('kind' in position) return position;
    try {
      const source = path.join(record.directory, project.name), stem = project.name.replace(/\.tex$/i, '');
      if (digest(await readRegularFile(source, 8000000)) !== record.build.sourceHash) throw new Error('The compiled source snapshot changed.');
      await readRegularFile(path.join(record.directory, stem + '.synctex.gz'), 32000000);
      const location = await syncTexLocation(path.join(path.dirname(this.latexmk), 'synctex'), source, record.pdf, position, record.directory, signal);
      return location ? { kind: 'mapped', buildId: record.build.id, ...location } : { kind: 'unavailable', reason: 'LaTeX provided no visible PDF position for this line. Try nearby typeset text.' };
    } catch (error) {
      return { kind: 'unavailable', reason: 'The PDF position could not be read. Recompile, or check that the local SyncTeX utility is installed. ' + String(error).slice(0, 300) };
    }
  }
  async clearOldBuilds(keepIds: string[] = []) {
    if (this.busy) throw new Error('Finish or stop compilation before clearing build files.');
    this.busy = true;
    try {
      const recent = [...this.records.values()].slice(-5).map(r => r.build.id);
      const latestGood = [...this.records.values()].reverse().find(r => r.build.success)?.build.id;
      const keep = new Set([...keepIds, ...recent, ...(latestGood ? [latestGood] : [])]);
      let removed = 0;
      for (const entry of await fs.readdir(this.cache, { withFileTypes: true }).catch(() => [])) {
        if (!entry.isDirectory() || !/^[a-f0-9-]{36}$/.test(entry.name) || keep.has(entry.name)) continue;
        const dir = path.join(this.cache, entry.name);
        try {
          const marker = await readJSON(path.join(dir, '.editor-build.json'), 1000) as any;
          if (marker.schemaVersion !== 1 || marker.id !== entry.name) continue;
          await fs.rm(dir, { recursive: true }); this.records.delete(entry.name); removed++;
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }
      return { removed, retained: this.records.size };
    } finally { this.busy = false; this.stopped.splice(0).forEach(resolve => resolve()); }
  }
}
