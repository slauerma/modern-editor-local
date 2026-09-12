// Preserve the full prerelease identifier: a tested alpha does not authorize its neighbours.
const versionToken = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?`;
const cliVersion = new RegExp(String.raw`\bcodex(?:-cli)?\s+(${versionToken})(?=\s|$)`, 'i');
const serverVersion = new RegExp(String.raw`^modern_codex_editor/(${versionToken})(?=\s|$)`);

export function codexVersion(value: unknown, source: 'cli' | 'server'): string | undefined {
  if (typeof value !== 'string') return undefined;
  const found = (source === 'cli' ? cliVersion : serverVersion).exec(value)?.[1];
  return found && found.length <= 80 ? found : undefined;
}
