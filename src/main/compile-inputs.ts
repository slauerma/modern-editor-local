// Personal editor: recorded-input correctness checks, not an OS security sandbox.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { userInfo } from 'node:os';
import { digest, readRegularFile } from './files.ts';

export type Toolchain = { directories: string[]; files: string[] };
export type RecordedInput = { path: string; hash: string };
const execute = promisify(execFile);
export function compilerEnvironment(executable: string, cache: string): NodeJS.ProcessEnv {
  // No inherited credentials, language-runtime injection, TEXINPUTS or latexmkrc.
  return { PATH: [path.dirname(executable), path.dirname(process.execPath), '/opt/homebrew/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(path.delimiter),
    HOME: path.join(cache, 'home'), TMPDIR: path.join(cache, 'tmp'), LANG: 'en_US.UTF-8', USER: userInfo().username,
    TEXMFVAR: cache, TEXMFCACHE: cache, openout_any: 'p', openin_any: 'p' };
}
export function within(root: string, file: string) {
  const relative = path.relative(root, file);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}
export async function toolchainPaths(executable: string, env: NodeJS.ProcessEnv, signal: AbortSignal): Promise<Toolchain> {
  const kpse = path.join(path.dirname(executable), 'kpsewhich');
  const query = async (args: string[]) => (await execute(kpse, args, { env, signal, timeout: 5000, maxBuffer: 65536 })).stdout.trim();
  const [roots, config] = await Promise.all([
    query(['-expand-path=$TEXMFDIST:$TEXMFLOCAL:$TEXMFSYSVAR:$TEXMFSYSCONFIG']),
    query(['-all', 'texmf.cnf'])
  ]);
  const canonical = async (values: string[]) => {
    const result: string[] = [];
    for (const value of values.filter(Boolean)) try { result.push(await fs.realpath(value)); } catch {}
    return [...new Set(result)];
  };
  return { directories: await canonical(roots.split(path.delimiter)), files: await canonical(config.split(/\r?\n/)) };
}

export async function recordedInputs(directory: string, stem: string, toolchain: Toolchain, texCache: string) {
  const fls = (await readRegularFile(path.join(directory, stem + '.fls'), 8000000)).toString('utf8');
  let cwd = directory;
  const files = new Set<string>();
  for (const line of fls.split(/\r?\n/)) {
    if (line.startsWith('PWD ')) cwd = path.resolve(directory, line.slice(4));
    if (line.startsWith('INPUT ')) files.add(path.resolve(cwd, line.slice(6).replace(/^"(.*)"$/, '$1')));
  }
  // BibTeX inputs are recorded by latexmk, not necessarily in TeX's .fls.
  try {
    const fdb = (await readRegularFile(path.join(directory, stem + '.fdb_latexmk'), 8000000)).toString('utf8');
    for (const line of fdb.split(/\r?\n/)) {
      const match = line.match(/^\s+"([^"]+)"\s+[\d.]+\s+\d+\s+[a-f0-9]{32}\s/);
      if (match) files.add(path.resolve(directory, match[1]));
    }
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  if (!files.size || files.size > 5000) throw new Error('The compiler did not provide a usable, bounded input record.');
  const root = await fs.realpath(directory), cache = await fs.realpath(texCache);
  const external: RecordedInput[] = [], unsupported: string[] = [];
  let total = 0;
  for (const file of files) {
    let actual: string;
    try { actual = await fs.realpath(file); }
    catch { unsupported.push(file + ' (no longer readable)'); continue; }
    if (within(root, actual) || within(cache, actual)) continue;
    const systemFont = ['/System/Library/Fonts', '/Library/Fonts'].some(dir => within(dir, actual)) && /\.(otf|ttf|ttc|dfont)$/i.test(actual);
    if (!toolchain.files.includes(actual) && !toolchain.directories.some(dir => within(dir, actual)) && !systemFont) {
      unsupported.push(actual); continue;
    }
    const bytes = await readRegularFile(actual, 64000000);
    total += bytes.length;
    if (total > 256000000) throw new Error('Recorded toolchain inputs exceed the validation limit.');
    external.push({ path: actual, hash: digest(bytes) });
  }
  return { external, unsupported };
}
