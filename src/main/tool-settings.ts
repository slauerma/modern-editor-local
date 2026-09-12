// Personal editor: explicit local executables; setup checks never start a model or sign-in flow.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { toolSettingsSchema, type ToolSettings, type SetupCheck, type ToolCheck, type SetupTool } from '../shared/tool-settings.ts';
import { readJSON, writeJSON } from './files.ts';
import { verifiedCodexVersions, verifyCodexVersion } from './codex-policy.ts';
import { codexVersion } from '../shared/codex-version.ts';

const execute = promisify(execFile);
export const defaultToolSettings: ToolSettings = {
  codexPath: '/Applications/ChatGPT.app/Contents/Resources/codex',
  latexmkPath: '/Library/TeX/texbin/latexmk'
};

function validateExecutablePath(file: string) {
  if (!path.isAbsolute(file) || /[\0\r\n]/.test(file)) throw new Error('Choose an absolute executable path.');
}

export async function validateExecutable(file: string): Promise<string> {
  validateExecutablePath(file);
  const stat = await fs.stat(file);
  if (!stat.isFile()) throw new Error(`Choose an executable file: ${file}`);
  await fs.access(file, fs.constants.X_OK);
  // Keep the selected path: TeX's texbin links keep sibling utilities together.
  return file;
}

export class ToolSettingsService {
  readonly directory: string;
  readonly file: string;
  private readonly timeoutMs: number;
  constructor(directory: string, timeoutMs = 4000) {
    this.directory = directory; this.file = path.join(directory, 'tool-settings.json'); this.timeoutMs = timeoutMs;
  }
  async load(): Promise<{ settings: ToolSettings; notices: string[] }> {
    try { return { settings: toolSettingsSchema.parse(await readJSON(this.file, 16000)), notices: [] }; }
    catch (error) {
      return { settings: { ...defaultToolSettings }, notices: (error as NodeJS.ErrnoException).code === 'ENOENT' ? [] : ['Saved executable settings could not be read. Defaults are shown; the existing settings file was preserved.'] };
    }
  }
  async save(input: unknown): Promise<ToolSettings> {
    const settings = toolSettingsSchema.parse(input), current = (await this.load()).settings;
    // An unavailable, unchanged tool must not prevent configuring the other.
    // Changed paths are checked before either setting is written; availability
    // and supported versions are still checked when the tool is used.
    for (const key of ['codexPath', 'latexmkPath'] as const) {
      validateExecutablePath(settings[key]);
      if (settings[key] !== current[key]) await validateExecutable(settings[key]);
    }
    await writeJSON(this.file, settings, 16000);
    return settings;
  }
  async check(input: unknown): Promise<SetupCheck> {
    const settings = toolSettingsSchema.parse(input), texDirectory = path.dirname(settings.latexmkPath);
    const probeDirectory = path.join(this.directory, 'setup-check');
    await fs.mkdir(probeDirectory, { recursive: true, mode: 0o700 });
    // These version commands get no account credentials or inherited TeX startup settings.
    const env = { PATH: [texDirectory, path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter), HOME: probeDirectory, CODEX_HOME: probeDirectory, LANG: 'C' };
    const specs: { tool: SetupTool; file: string; args: string[]; required: boolean }[] = [
      { tool: 'codex', file: settings.codexPath, args: ['--version'], required: true },
      { tool: 'latexmk', file: settings.latexmkPath, args: ['-norc', '-v'], required: true },
      ...(['pdflatex', 'lualatex', 'xelatex', 'kpsewhich', 'synctex'] as const).map(tool => ({ tool, file: path.join(texDirectory, process.platform === 'win32' ? tool + '.exe' : tool), args: ['--version'], required: !['lualatex', 'xelatex'].includes(tool) }))
    ];
    const checks: ToolCheck[] = [];
    for (const spec of specs) {
      let version: string | null = null;
      try {
        await validateExecutable(spec.file);
        const result = await execute(spec.file, spec.args, { cwd: probeDirectory, env, timeout: this.timeoutMs, killSignal: 'SIGKILL', maxBuffer: 16000, windowsHide: true });
        const output = (result.stdout + '\n' + result.stderr).trim();
        version = output.split(/\r?\n/).find(line => line.trim())?.slice(0, 500) ?? null;
        if (!version) throw new Error('The executable returned no version information.');
        if (spec.tool === 'codex') {
          const number = codexVersion(output, 'cli');
          if (number) version = `codex-cli ${number}`;
          verifyCodexVersion(number ? `modern_codex_editor/${number}` : undefined);
        }
        checks.push({ tool: spec.tool, path: spec.file, required: spec.required, ok: true, version, message: spec.tool === 'codex' ? `Supported CLI version. Review restrictions are verified again before every review. Tested version: ${verifiedCodexVersions.join(', ')}.` : 'Local executable responded. Compilation is checked separately when you compile a paper.' });
      } catch (error) {
        const detail = error as NodeJS.ErrnoException & { killed?: boolean };
        const message = detail.killed ? 'The version check timed out and its process was stopped.' : detail.code === 'ENOENT' ? 'Executable not found. Choose its installed location.' : detail.code === 'EACCES' ? 'This file is not executable or access was denied.' : String(error).slice(0, 1000);
        checks.push({ tool: spec.tool, path: spec.file, required: spec.required, ok: false, version, message });
      }
    }
    return { checks, ready: checks.every(check => !check.required || check.ok) };
  }
}
