import { z } from 'zod';

export const toolSettingsSchema = z.object({
  codexPath: z.string().trim().min(1).max(4096),
  latexmkPath: z.string().trim().min(1).max(4096)
}).strict();
export type ToolSettings = z.infer<typeof toolSettingsSchema>;
export type SetupIdentity = { editorVersion: string; platform: string; osVersion: string };
export type ToolSettingsState = {
  settings: ToolSettings;
  identity: SetupIdentity;
  runtimePath: string;
  notices: string[];
  verifiedCodexVersions: string[];
};
export type SetupTool = 'codex' | 'latexmk' | 'pdflatex' | 'lualatex' | 'xelatex' | 'kpsewhich' | 'synctex';
export type ToolCheck = { tool: SetupTool; path: string; ok: boolean; required: boolean; version: string | null; message: string };
export type SetupCheck = { checks: ToolCheck[]; ready: boolean };
export type CopiedSetupDetails = { details: string; check: SetupCheck };

const toolLabels: Record<SetupTool, string> = { codex: 'Codex CLI', latexmk: 'latexmk', pdflatex: 'pdfLaTeX', lualatex: 'LuaLaTeX', xelatex: 'XeLaTeX', kpsewhich: 'kpsewhich', synctex: 'SyncTeX' };
const platforms: Record<string, string> = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };
const plainVersion = (value: string) => /^\d+(?:[.-]\d+){0,8}$/.test(value) ? value : 'unavailable';
export function setupOperatingSystem(identity: SetupIdentity): string {
  return `${platforms[identity.platform] ?? 'Other operating system'} ${plainVersion(identity.osVersion)}`;
}

// Copy only recognised version tokens, never free-form executable output, paths,
// diagnostics, account information, or data from the open paper.
function copyableToolVersion(check: ToolCheck): string | null {
  const output = check.version ?? '';
  const match = check.tool === 'codex'
    ? /\bcodex(?:-cli)?\s+(\d+\.\d+\.\d+)(?=\s|$)/i.exec(output)
    : /\bversion\s+(\d+(?:[.-]\d+)*[a-z]?)(?=\s|$|[(),])/i.exec(output)
      ?? /\b(?:pdfTeX|XeTeX|LuaHBTeX|LuaTeX)\s*,?\s*(\d+(?:[.-]\d+)*[a-z]?)(?=\s|$|[(),])/i.exec(output);
  if (!match) return null;
  const texLive = check.tool === 'codex' ? null : /\bTeX Live (20\d\d)\b/.exec(output)?.[1];
  return match[1] + (texLive ? ` (TeX Live ${texLive})` : '');
}

export function formatSetupDetails(identity: SetupIdentity, result: SetupCheck): string {
  const rows = [
    'Modern Codex Editor setup',
    `Editor version: ${plainVersion(identity.editorVersion)}`,
    `OS: ${setupOperatingSystem(identity)}`
  ];
  for (const tool of Object.keys(toolLabels) as SetupTool[]) {
    const check = result.checks.find(candidate => candidate.tool === tool), version = check ? copyableToolVersion(check) : null;
    const status = check?.ok ? 'version check passed' : check?.required === false ? 'optional tool unavailable' : 'needs attention';
    rows.push(`${toolLabels[tool]}: ${version ?? 'version unavailable'}; ${status}`);
  }
  return rows.join('\n');
}
