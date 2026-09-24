// Resolve only this checkout's locked CLI. Never fall back to PATH or a desktop app.
import fs from 'node:fs/promises';
import path from 'node:path';
import packageInfo from '../../package.json' with { type: 'json' };
import { readJSON } from './files.ts';

export const managedCodexVersion = packageInfo.dependencies['@openai/codex'];
const targets: Record<string, string> = {
  'darwin-arm64': 'aarch64-apple-darwin', 'darwin-x64': 'x86_64-apple-darwin',
  'linux-arm64': 'aarch64-unknown-linux-musl', 'linux-x64': 'x86_64-unknown-linux-musl',
  'win32-arm64': 'aarch64-pc-windows-msvc', 'win32-x64': 'x86_64-pc-windows-msvc'
};
export function managedCodexLocation(applicationDirectory = process.cwd(), platform: string = process.platform, arch: string = process.arch) {
  const variant = `${platform}-${arch}`, target = targets[variant];
  if (!target) throw new Error(`The editor-managed Codex CLI is unavailable for ${variant}.`);
  const modules = path.resolve(applicationDirectory, 'node_modules', '@openai');
  const directory = path.join(modules, `codex-${variant}`);
  return { version: managedCodexVersion, path: path.join(directory, 'vendor', target, 'bin', platform === 'win32' ? 'codex.exe' : 'codex'),
    packageFile: path.join(modules, 'codex', 'package.json'), nativePackageFile: path.join(directory, 'package.json'), nativeVersion: `${managedCodexVersion}-${variant}` };
}

export async function verifyManagedCodex(applicationDirectory = process.cwd()): Promise<string> {
  const location = managedCodexLocation(applicationDirectory);
  try {
    for (const [file, version] of [[location.packageFile, location.version], [location.nativePackageFile, location.nativeVersion]]) {
      const info = await readJSON(file, 16000) as { name?: string; version?: string };
      if (info.name !== '@openai/codex' || info.version !== version) throw new Error('Package version mismatch.');
    }
    if (!(await fs.stat(location.path)).isFile()) throw new Error('Executable missing.');
    await fs.access(location.path, fs.constants.X_OK);
    return location.path;
  } catch {
    throw new Error(`The editor-managed Codex CLI ${location.version} is missing or does not match this release. Quit the editor and repeat the dependency installation in Help → Setup (npm ci --ignore-scripts, including optional dependencies). No global Codex installation is needed.`);
  }
}
