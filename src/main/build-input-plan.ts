import fs from 'node:fs/promises';
import path from 'node:path';
import { digest, readRegularFile } from './files.ts';

export type BuildInputLimits = { maxBytes: number; maxFiles: number };
export type BuildDirectoryIdentity = { path: string; dev: number; ino: number };
export type BuildInputFile = { relative: string; size: number; hash?: string };
export type BuildInputInventory = { paths: BuildInputFile[]; truncated: boolean; visitedEntries: number };
export type BuildInputPreparation = {
  status: 'needs-selection'; reason: string; issues: string[]; requiredPaths: string[];
  requiredBytes: number; requiredFiles: number; inventory: BuildInputInventory; limits: BuildInputLimits;
  selectedBytes?: number; selectedFiles?: number;
};
export type BuildInputPlan = BuildInputPreparation | {
  status: 'ready'; mode: 'folder' | 'dependencies' | 'explicit'; files: BuildInputFile[]; totalBytes: number;
  requiredPaths: string[]; inventory: BuildInputInventory; limits: BuildInputLimits; unresolvedIssues: string[];
};
export const BUILD_INPUT_COPY_THRESHOLD: Readonly<BuildInputLimits> = { maxBytes: 50_000_000, maxFiles: 500 };
export const DEFAULT_BUILD_INPUT_LIMITS: Readonly<BuildInputLimits> = { maxBytes: 200_000_000, maxFiles: 2000 };
export const MAX_BUILD_INPUT_LIMITS: Readonly<BuildInputLimits> = { maxBytes: 200_000_000, maxFiles: 2000 };
const MAX_INVENTORY_ENTRIES = 10_000, MAX_DEPTH = 32, MAX_TEXT_BYTES = 8_000_000, MAX_GRAPH_TEXT_BYTES = 30_000_000;
const allowed = new Set(['.tex', '.bib', '.bst', '.cls', '.sty', '.png', '.jpg', '.jpeg', '.pdf', '.eps', '.svg', '.csv', '.dat', '.txt', '.bbl', '.bb', '.def', '.cfg', '.clo', '.fd', '.ltx', '.otf', '.ttf', '.tikz', '.pgf']);
const ignoredDirectories = new Set(['node_modules', 'dist', 'build', 'output', 'out', 'releases']);
const texExtensions = new Set(['.tex', '.sty', '.cls', '.def', '.cfg', '.clo', '.fd', '.ltx', '.tikz', '.pgf', '.bbl']);
const companionExtensions = new Set(['.sty', '.cls', '.def', '.cfg', '.clo', '.fd', '.ltx']);
// Only this exact bundled support library is known to define SWP commands without
// loading paper inputs. Caller-side legacy graphics commands still need review.
const bundledTciHash = '18a30fde335b55c0e251f95b69c433d70e8d04cf88b7e3cfad42211a9a40a02b';
type Settings = {
  rootDir: string; rootName: string; text: string; selectedPaths?: string[]; limits?: BuildInputLimits;
  expectedIdentity?: BuildDirectoryIdentity;
  signal?: AbortSignal;
  // Only verified toolchain names or app-provided support files may satisfy this.
  standardFileExists?: (name: string) => Promise<boolean>;
  inventoryEntryLimit?: number;
};
function cancelled(signal?: AbortSignal) { if (signal?.aborted) throw new Error('Compilation cancelled.'); }
function code(error: unknown) { return (error as NodeJS.ErrnoException).code; }
function contained(root: string, target: string) {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}
function portable(relative: string) { return relative.split(path.sep).join('/'); }
function canonicalRelative(value: string) {
  if (typeof value !== 'string' || !value || value.length > 2000 || /[\x00-\x1f\\:]/.test(value) || path.posix.isAbsolute(value)) throw new Error(`Invalid relative input path: ${String(value).slice(0, 120)}`);
  const normalized = path.posix.normalize(value);
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) throw new Error(`Input is outside the paper folder: ${value}`);
  const parts = normalized.split('/');
  if (parts.some(p => p.startsWith('.') || ignoredDirectories.has(p))) throw new Error(`Input is in an excluded folder or hidden path: ${value}`);
  if (path.posix.extname(normalized) && !allowed.has(path.posix.extname(normalized).toLowerCase())) throw new Error(`Unsupported build input type: ${value}`);
  return normalized;
}
function limitsFor(settings: Settings): BuildInputLimits {
  const limits = settings.limits ?? DEFAULT_BUILD_INPUT_LIMITS;
  if (!Number.isSafeInteger(limits.maxBytes) || !Number.isSafeInteger(limits.maxFiles) || limits.maxBytes < 1 || limits.maxFiles < 1 || limits.maxBytes > MAX_BUILD_INPUT_LIMITS.maxBytes || limits.maxFiles > MAX_BUILD_INPUT_LIMITS.maxFiles) throw new Error('Invalid build input limits (maximum 200 MB / 2,000 files).');
  return { ...limits };
}

/** Capture an already canonical, regular paper directory at the opening boundary. */
export async function captureBuildDirectory(rootDir: string): Promise<BuildDirectoryIdentity> {
  const directory = path.resolve(rootDir), stat = await fs.lstat(directory);
  const identity = { path: directory, dev: stat.dev, ino: stat.ino };
  await assertBuildDirectory(directory, identity);
  return identity;
}

/** Do not rebind trust by resolving a replacement root to a new real path. */
export async function assertBuildDirectory(rootDir: string, expectedIdentity: BuildDirectoryIdentity) {
  const directory = path.resolve(rootDir);
  try {
    const stat = await fs.lstat(directory);
    if (directory !== expectedIdentity.path || !stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== expectedIdentity.dev || stat.ino !== expectedIdentity.ino || await fs.realpath(directory) !== directory) throw new Error('Directory identity or canonical resolution changed.');
    const after = await fs.lstat(directory);
    if (!after.isDirectory() || after.isSymbolicLink() || after.dev !== expectedIdentity.dev || after.ino !== expectedIdentity.ino) throw new Error('Directory changed during its identity check.');
  } catch (error) {
    throw new Error(`The paper folder changed or is linked. Reopen the paper before reading or compiling: ${directory}`, { cause: error });
  }
}

// Check every component, not only the final file. In particular, a regular file
// reached through a linked directory must never become a snapshot input.
async function safeStat(root: string, relative: string, expectedIdentity: BuildDirectoryIdentity) {
  await assertBuildDirectory(root, expectedIdentity);
  const normalized = canonicalRelative(relative), parts = normalized.split('/');
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink()) throw new Error(`Linked build input is not supported: ${normalized}`);
    if (i < parts.length - 1 && !stat.isDirectory()) throw new Error(`Input parent is not a regular directory: ${normalized}`);
    if (i === parts.length - 1 && !stat.isFile()) throw new Error(`Build input is not a regular file: ${normalized}`);
  }
  const actual = await fs.realpath(current);
  if (!contained(root, actual)) throw new Error(`Build input leaves the paper folder: ${normalized}`);
  const stat = await fs.lstat(actual);
  await assertBuildDirectory(root, expectedIdentity);
  return { relative: portable(path.relative(root, actual)), stat, actual };
}

/** Recheck containment and identity when materializing or validating a plan. */
export async function readBuildInput(rootDir: string, relative: string, limit: number, expectedIdentity?: BuildDirectoryIdentity) {
  const root = path.resolve(rootDir), identity = expectedIdentity ?? await captureBuildDirectory(root);
  const before = await safeStat(root, relative, identity);
  const bytes = await readRegularFile(before.actual, limit, before.stat);
  const after = await safeStat(root, relative, identity);
  if (after.stat.dev !== before.stat.dev || after.stat.ino !== before.stat.ino || after.actual !== before.actual) throw new Error(`Build input changed while being read: ${relative}`);
  return bytes;
}

async function inventory(root: string, rootName: string, textSize: number, limit: number, expectedIdentity: BuildDirectoryIdentity, signal?: AbortSignal) {
  const result: BuildInputInventory = { paths: [], truncated: false, visitedEntries: 0 };
  const problems: string[] = [];
  const walk = async (relative: string, depth: number) => {
    if (depth > MAX_DEPTH) { result.truncated = true; return; }
    cancelled(signal);
    try {
      await assertBuildDirectory(root, expectedIdentity);
      const directory = path.join(root, relative);
      if (relative) {
        const actual = await fs.realpath(directory), stat = await fs.lstat(directory);
        if (stat.isSymbolicLink() || !stat.isDirectory() || !contained(root, actual) || actual !== directory) throw new Error(`Linked inventory directory: ${relative}`);
      }
      // opendir bounds memory even for a single huge directory.
      for await (const entry of await fs.opendir(directory)) {
        cancelled(signal);
        if (result.visitedEntries >= limit) { result.truncated = true; break; }
        result.visitedEntries++;
        if (entry.name.startsWith('.') || ignoredDirectories.has(entry.name)) continue;
        const rel = portable(path.join(relative, entry.name));
        if (entry.isSymbolicLink()) { problems.push(`Linked candidate: ${rel}`); continue; }
        if (entry.isDirectory()) { await walk(rel, depth + 1); if (result.visitedEntries >= limit) { result.truncated = true; break; } continue; }
        if (!entry.isFile() || !allowed.has(path.extname(entry.name).toLowerCase()) || rel === rootName.replace(/\.tex$/i, '.pdf')) continue;
        try {
          const checked = await safeStat(root, rel, expectedIdentity);
          result.paths.push({ relative: checked.relative, size: checked.relative === rootName ? textSize : checked.stat.size });
        } catch (error) { problems.push(String(error)); }
      }
    } catch (error) { cancelled(signal); result.truncated = true; problems.push(`Folder inventory could not read ${relative || '.'}: ${String(error).slice(0, 200)}`); }
  };
  await walk('', 0);
  await assertBuildDirectory(root, expectedIdentity);
  result.paths.sort((a, b) => a.relative.localeCompare(b.relative));
  return { inventory: result, problems };
}

// Strip comments while preserving line offsets; verbatim bodies are prose, not
// dependency commands. TeX macro expansion is deliberately outside this parser.
function sourceForScan(text: string) {
  let output = '', cursor = 0;
  while (cursor < text.length) {
    if (text[cursor] === '%') {
      const end = text.indexOf('\n', cursor); if (end < 0) break;
      output += ' '.repeat(end - cursor); cursor = end; continue;
    }
    if (text[cursor] === '\\') {
      const verbatim = text.slice(cursor).match(/^\\begin\{(verbatim\*?|Verbatim|lstlisting|minted)\}/);
      if (verbatim) {
        const end = text.indexOf(`\\end{${verbatim[1]}}`, cursor + verbatim[0].length);
        const stop = end < 0 ? text.length : end + verbatim[1].length + 6;
        output += text.slice(cursor, stop).replace(/[^\n]/g, ' '); cursor = stop; continue;
      }
      const verb = text.slice(cursor).match(/^\\verb\*?([^a-zA-Z\s])/);
      if (verb) {
        const end = text.indexOf(verb[1], cursor + verb[0].length);
        const stop = end < 0 ? text.length : end + 1;
        output += text.slice(cursor, stop).replace(/[^\n]/g, ' '); cursor = stop; continue;
      }
      output += text.slice(cursor, cursor + 2); cursor += 2; continue;
    }
    output += text[cursor++];
  }
  return output;
}
type Argument = { value: string; end: number };
function group(text: string, offset: number, open = '{', close = '}'): Argument | null {
  let i = offset; while (/\s/.test(text[i] ?? '') && i < text.length) i++;
  if (text[i] !== open) return null;
  const start = ++i; let depth = 1;
  for (; i < text.length; i++) {
    if (text[i] === '\\') { i++; continue; }
    if (text[i] === open) depth++;
    if (text[i] === close && --depth === 0) return { value: text.slice(start, i), end: i + 1 };
  }
  return null;
}
function afterOptions(text: string, offset: number) {
  let cursor = offset; if (text[cursor] === '*') cursor++;
  for (let i = 0; i < 3; i++) { const option = group(text, cursor, '[', ']'); if (!option) break; cursor = option.end; }
  return cursor;
}
function literal(value: string) { return value.trim().replace(/^"([^"\n]+)"$/, '$1'); }
function isLiteral(value: string) { return !!value && !/[\\{}#$%^~\x00-\x1f]/.test(value); }

/** Plan a bounded folder snapshot, narrowing a large folder by literal dependencies. */
export async function planBuildInputs(settings: Settings): Promise<BuildInputPlan> {
  const limits = limitsFor(settings), root = path.resolve(settings.rootDir), rootName = canonicalRelative(settings.rootName);
  const expectedIdentity = settings.expectedIdentity ?? await captureBuildDirectory(root);
  const rootInfo = await safeStat(root, rootName, expectedIdentity), rootSize = Buffer.byteLength(settings.text);
  const listed = await inventory(root, rootName, rootSize, Math.min(MAX_INVENTORY_ENTRIES, Math.max(1, settings.inventoryEntryLimit ?? MAX_INVENTORY_ENTRIES)), expectedIdentity, settings.signal);
  const all = listed.inventory.paths, folderBytes = all.reduce((sum, file) => sum + file.size, 0);
  if (!settings.selectedPaths && !listed.inventory.truncated && !listed.problems.length && all.some(f => f.relative === rootInfo.relative) && all.length <= Math.min(limits.maxFiles, BUILD_INPUT_COPY_THRESHOLD.maxFiles) && folderBytes <= Math.min(limits.maxBytes, BUILD_INPUT_COPY_THRESHOLD.maxBytes)) {
    return { status: 'ready', mode: 'folder', files: all, totalBytes: folderBytes, requiredPaths: all.map(f => f.relative), inventory: listed.inventory, limits, unresolvedIssues: [] };
  }
  const selected = settings.selectedPaths ? new Set<string>() : undefined;
  const issues: string[] = [], unresolvedIssues: string[] = [], required = new Map<string, BuildInputFile>(), parsed = new Set<string>();
  const problem = (message: string) => { if (issues.length < 50 && !issues.includes(message)) issues.push(message); };
  const uncertain = (message: string) => { if (unresolvedIssues.length < 50 && !unresolvedIssues.includes(message)) unresolvedIssues.push(message); };
  if (selected) {
    if (settings.selectedPaths!.length > MAX_BUILD_INPUT_LIMITS.maxFiles) problem('The proposed file list exceeds 2,000 entries.');
    else for (const value of settings.selectedPaths!) {
      try { selected.add(canonicalRelative(value)); } catch (error) { problem(String(error)); }
    }
  }
  let graphBytes = 0, commands = 0;
  const graphicPaths = new Set<string>();
  const resolved = new Map<string, Awaited<ReturnType<typeof safeStat>> | null>();
  const lookup = async (relative: string) => {
    const normalized = canonicalRelative(relative);
    if (normalized === rootName.replace(/\.tex$/i, '.pdf')) throw new Error('The root output PDF cannot be a build input.');
    if (!resolved.has(normalized)) {
      try { resolved.set(normalized, await safeStat(root, normalized, expectedIdentity)); }
      catch (error) { if (code(error) === 'ENOENT' || code(error) === 'ENOTDIR') resolved.set(normalized, null); else throw error; }
    }
    return resolved.get(normalized)!;
  };
  const add = async (file: Awaited<ReturnType<typeof safeStat>>, scan: boolean, base: string) => {
    cancelled(settings.signal);
    if (!required.has(file.relative)) {
      if (required.size >= MAX_BUILD_INPUT_LIMITS.maxFiles) { problem('The dependency graph exceeds 2,000 required files; its list is incomplete.'); return; }
      required.set(file.relative, { relative: file.relative, size: file.relative === rootInfo.relative ? rootSize : file.stat.size });
    }
    const parseKey = file.relative + '\0' + base;
    if (!scan || parsed.has(parseKey)) return;
    parsed.add(parseKey);
    if (parsed.size > MAX_BUILD_INPUT_LIMITS.maxFiles) { problem('The dependency graph has too many import contexts to analyze completely.'); return; }
    if (file.stat.size > MAX_TEXT_BYTES && file.relative !== rootInfo.relative) { problem(`Dependency source is too large to analyze (8 MB limit): ${file.relative}`); return; }
    let text: string;
    try {
      const bytes = file.relative === rootInfo.relative ? Buffer.from(settings.text) : await readBuildInput(root, file.relative, MAX_TEXT_BYTES, expectedIdentity);
      required.set(file.relative, { relative: file.relative, size: bytes.length, hash: digest(bytes) });
      graphBytes += bytes.length;
      if (graphBytes > MAX_GRAPH_TEXT_BYTES) { problem('Dependency source text exceeds the 30 MB analysis limit; its list is incomplete.'); return; }
      if (file.relative !== rootInfo.relative && path.posix.basename(file.relative).toLowerCase() === 'tcilatex.tex' && digest(bytes) === bundledTciHash) return;
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (error) { problem(`Cannot analyze ${file.relative}: ${String(error).slice(0, 200)}`); return; }
    await scanSource(text, file.relative, base);
  };
  const reference = async (raw: string, suffixes: string[], source: string, base: string, scan: boolean, graphics = false, standard = false) => {
    const name = literal(raw), at = `${source}: ${name || '(empty filename)'}`;
    if (!isLiteral(name)) { uncertain(`Computed or malformed dependency needs an explicit decision: ${at}`); return; }
    if (path.posix.isAbsolute(name) || /^[a-z]:/i.test(name)) { problem(`Dependency is outside the paper folder: ${at}`); return; }
    const directories = graphics ? [...new Set([base, ...graphicPaths])] : [base];
    const found = new Map<string, Awaited<ReturnType<typeof safeStat>>>();
    try {
      for (const directory of directories) for (const suffix of suffixes) {
        const relative = path.posix.join(directory, name + suffix);
        const file = await lookup(relative);
        if (file) found.set(file.relative, file);
      }
    } catch (error) { problem(`${at}: ${String(error).slice(0, 200)}`); return; }
    const matches = [...found.values()];
    if (!matches.length) {
      // Names with paths never fall through to a system/user TeX search path.
      if (standard && !name.includes('/') && settings.standardFileExists) {
        for (const suffix of suffixes) if (await settings.standardFileExists(name + suffix)) return;
      }
      problem(`Unresolved dependency: ${at}`); return;
    }
    let chosen = matches;
    if (matches.length > 1 && selected) chosen = matches.filter(f => selected.has(f.relative));
    // Preserve normal TeX lookup when several local image formats/paths exist.
    // Copy the bounded superset instead of guessing the engine's preferred file.
    if (graphics && chosen.length) {
      for (const file of chosen) await add(file, scan, base);
      return;
    }
    if (chosen.length !== 1) {
      problem(`Ambiguous dependency ${at}; choose exactly one of: ${matches.map(f => f.relative).join(', ')}`);
      return;
    }
    await add(chosen[0], scan, base);
  };
  const scanSource = async (raw: string, source: string, base: string) => {
    const text = sourceForScan(raw), command = /\\([a-zA-Z@]+|[^a-zA-Z@])/g;
    let match: RegExpExecArray | null;
    while ((match = command.exec(text))) {
      cancelled(settings.signal);
      if (++commands > 100_000) { problem('The dependency scan exceeded its command limit; its list is incomplete.'); return; }
      const name = match[1], offset = afterOptions(text, command.lastIndex);
      if (['csname', 'catcode', 'openin', 'read', 'directlua', 'latelua', 'scantokens', 'input@path', 'DeclareGraphicsRule', 'DeclareGraphicsExtensions', 'externaldocument', 'includeinkscape', 'includestandalone', 'pgfplotstableread', 'DTLloaddb', 'addplot', 'addplotthree', 'tikzexternalize', 'setmainfont', 'setsansfont', 'setmonofont', 'newfontfamily', 'newfontface', 'font', 'csvreader', 'csvautotabular', 'FRAME', 'IFRAME', 'DFRAME', 'FFRAME', 'GRAPHIC', 'GRAPHICSPS', 'GRAPHICSHP', 'graffile', 'epsfig', 'psfig'].includes(name)) {
        uncertain(`Dependency command \\${name} in ${source} requires an explicit decision.`); continue;
      }
      if (name === 'graphicspath') {
        const arg = group(text, offset);
        if (!arg) { problem(`Malformed \\graphicspath in ${source}.`); continue; }
        let pos = 0, count = 0, next: Argument | null;
        while ((next = group(arg.value, pos))) {
          const directory = literal(next.value);
          if (!isLiteral(directory)) uncertain(`Computed graphics path in ${source}: ${directory}`);
          // SWP often retains a Windows drive fallback alongside local paths.
          // It cannot resolve on this host; do not rewrite it or grant access.
          else if (process.platform !== 'win32' && /^[a-z]:\//i.test(directory)) { /* Local matches are still required below. */ }
          else if (path.posix.isAbsolute(directory) || directory.includes(':')) problem(`Outside graphics path in ${source}: ${directory}`);
          else {
            const joined = path.posix.normalize(path.posix.join(base, directory));
            if (joined === '..' || joined.startsWith('../')) problem(`Graphics path leaves the paper folder in ${source}.`);
            else graphicPaths.add(joined === '.' ? '' : joined);
          }
          pos = next.end; count++;
        }
        if (!count || arg.value.slice(pos).trim()) problem(`Malformed or computed \\graphicspath in ${source}.`);
        command.lastIndex = arg.end; continue;
      }
      if (['import', 'subimport', 'inputfrom', 'subinputfrom', 'includefrom', 'subincludefrom'].includes(name)) {
        const dir = group(text, offset), file = dir && group(text, dir.end);
        if (!dir || !file || !isLiteral(literal(dir.value))) { uncertain(`Computed or malformed \\${name} in ${source}.`); continue; }
        if (path.posix.isAbsolute(literal(dir.value))) { problem(`Outside import path in ${source}.`); continue; }
        const nextBase = path.posix.join(name.startsWith('sub') ? base : '', literal(dir.value));
        await reference(file.value, path.posix.extname(literal(file.value)) ? [''] : ['.tex', ''], source, nextBase, true, false, false);
        command.lastIndex = file.end; continue;
      }
      // Including the full literal include list is a safe superset of
      // includeonly. We never guess which conditional TeX branch will execute.
      if (name === 'includeonly') {
        const arg = group(text, offset);
        if (!arg || arg.value.split(',').some(value => value.trim() && !isLiteral(literal(value)))) uncertain(`Computed \\includeonly in ${source}.`);
        if (arg) command.lastIndex = arg.end;
        continue;
      }
      if (name === 'usetikzlibrary' || name === 'usepgflibrary') {
        const arg = group(text, offset);
        if (!arg) { uncertain(`Computed or malformed \\${name} in ${source}.`); continue; }
        for (const library of arg.value.split(',')) await reference(`${name === 'usetikzlibrary' ? 'tikzlibrary' : 'pgflibrary'}${literal(library)}.code.tex`, [''], source, base, true, false, true);
        command.lastIndex = arg.end; continue;
      }
      const tex = ['input', 'include', 'subfile', 'subfileinclude', 'InputIfFileExists', 'IfFileExists'].includes(name);
      const packages = ['usepackage', 'RequirePackage', 'RequirePackageWithOptions'].includes(name);
      const classes = ['documentclass', 'LoadClass', 'LoadClassWithOptions'].includes(name);
      const bibliography = ['bibliography', 'addbibresource', 'addglobalbib', 'addsectionbib'].includes(name);
      const style = name === 'bibliographystyle';
      const graphics = ['includegraphics', 'includepdf', 'pgfimage'].includes(name);
      const data = ['lstinputlisting', 'verbatiminput', 'VerbatimInput', 'inputminted'].includes(name);
      if (!tex && !packages && !classes && !bibliography && !style && !graphics && !data) continue;
      let arg = group(text, offset);
      if (name === 'inputminted' && arg) arg = group(text, arg.end);
      if (!arg && name === 'input') {
        const token = text.slice(offset).match(/^\s*("[^"\n]+"|[^\s{}%]+)/);
        if (token) arg = { value: token[1], end: offset + token[0].length };
      }
      if (!arg) { uncertain(`Malformed or computed \\${name} in ${source}.`); continue; }
      const list = packages || bibliography && name === 'bibliography' ? arg.value.split(',') : [arg.value];
      for (const value of list) {
        const literalName = literal(value), ext = path.posix.extname(literalName);
        const suffixes = ext ? [''] : packages ? ['.sty'] : classes ? ['.cls'] : bibliography ? ['.bib'] : style ? ['.bst'] : tex ? ['.tex', ''] : graphics ? ['.pdf', '.png', '.jpg', '.jpeg', '.eps'] : [''];
        await reference(value, suffixes, source, base, tex || packages || classes, graphics, tex || packages || classes || style);
      }
      command.lastIndex = arg.end;
    }
  };
  await add(rootInfo, true, '');
  // Standard packages can probe root-local configuration and load local style
  // overrides indirectly. Keep these companions even without a literal edge.
  // An explicit list may omit them, but that preview cannot claim verification.
  for (const candidate of all.filter(file => !file.relative.includes('/') && companionExtensions.has(path.posix.extname(file.relative).toLowerCase()))) {
    if (required.has(candidate.relative)) continue;
    if (selected && !selected.has(candidate.relative)) { uncertain(`The selected list omits a possible local package companion: ${candidate.relative}`); continue; }
    try { const file = await lookup(candidate.relative); if (file) await add(file, true, ''); }
    catch (error) { problem(`Cannot check local package companion ${candidate.relative}: ${String(error).slice(0, 200)}`); }
  }
  if (listed.inventory.truncated) uncertain('The folder inventory was truncated; additional local package companions could not be ruled out.');
  let files: BuildInputFile[] = [];
  if (selected) {
    for (const relative of selected) {
      try {
        const file = await lookup(relative);
        if (!file) { problem(`Selected input is missing: ${relative}`); continue; }
        files.push({ relative: file.relative, size: file.relative === rootInfo.relative ? rootSize : file.stat.size });
        if (!required.has(file.relative) && texExtensions.has(path.posix.extname(file.relative).toLowerCase())) await add(file, true, '');
      } catch (error) { problem(`Invalid selected input ${relative}: ${String(error).slice(0, 200)}`); }
    }
    files = [...new Map(files.map(f => [f.relative, f])).values()].sort((a, b) => a.relative.localeCompare(b.relative));
  }
  const requiredFiles = [...required.values()].sort((a, b) => a.relative.localeCompare(b.relative));
  if (!selected) files = requiredFiles;
  else {
    const included = new Set(files.map(f => f.relative));
    for (const file of requiredFiles) if (!included.has(file.relative)) problem(`The selected list omits required input: ${file.relative}`);
    files = files.map(file => required.get(file.relative) ?? file);
  }
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  await assertBuildDirectory(root, expectedIdentity);
  if (files.length > limits.maxFiles || totalBytes > limits.maxBytes) problem(`Required selection is ${files.length.toLocaleString('en-US')} files / ${(totalBytes / 1_000_000).toFixed(2)} MB; this build allows ${limits.maxFiles.toLocaleString('en-US')} files / ${limits.maxBytes / 1_000_000} MB.`);
  if (issues.length || !selected && unresolvedIssues.length) return { status: 'needs-selection', reason: 'The local dependency check needs a reviewed file selection before compilation.', issues: [...issues, ...unresolvedIssues].slice(0, 50), requiredPaths: requiredFiles.map(f => f.relative), requiredBytes: requiredFiles.reduce((sum, f) => sum + f.size, 0), requiredFiles: requiredFiles.length, inventory: listed.inventory, limits, ...(selected ? { selectedBytes: totalBytes, selectedFiles: files.length } : {}) };
  return { status: 'ready', mode: selected ? 'explicit' : 'dependencies', files, totalBytes, requiredPaths: requiredFiles.map(f => f.relative), inventory: listed.inventory, limits, unresolvedIssues };
}

/** Same checker for a proposed list; no model output is treated as a file path authority. */
export async function validateBuildInputSelection(settings: Settings & { selectedPaths: string[] }) { return planBuildInputs(settings); }
