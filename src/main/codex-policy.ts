// Personal editor: keep this policy small and verify it with the real CLI probe before adding versions.
export const verifiedCodexVersions = ['0.153.4'] as const;
export const disabledCodexFeatures = ['apps', 'plugins', 'remote_plugin', 'enable_mcp_apps', 'shell_tool', 'unified_exec', 'multi_agent', 'multi_agent_v2', 'browser_use', 'computer_use', 'image_generation', 'view_image', 'hooks', 'code_mode', 'code_mode_host', 'skill_mcp_dependency_install', 'skill_search', 'tool_suggest', 'workspace_dependencies'];

export class CodexPolicyError extends Error {
  constructor(detail: string) { super(`Codex review restrictions could not be verified. ${detail} No paper text was sent.`); }
}
function object(value: unknown): value is Record<string, any> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
export function verifyCodexVersion(userAgent: unknown): string {
  const version = typeof userAgent === 'string' ? /^modern_codex_editor\/(\d+\.\d+\.\d+)(?:\s|$)/.exec(userAgent)?.[1] : undefined;
  if (!version || !verifiedCodexVersions.some(v => v === version)) throw new CodexPolicyError(`This build supports tested Codex CLI ${verifiedCodexVersions.join(', ')}; run the configuration probe before updating support.`);
  return version;
}
export function reviewThreadConfig(result: unknown, fastMode: boolean) {
  if (!object(result) || !object(result.config)) throw new CodexPolicyError('The effective configuration is unavailable.');
  const config = result.config;
  if (!object(config.features) || disabledCodexFeatures.some(name => config.features[name] !== false) || config.web_search !== 'disabled' || config.project_doc_max_bytes !== 0) throw new CodexPolicyError('A required tool restriction is unavailable.');
  const servers = config.mcp_servers === undefined ? {} : config.mcp_servers;
  if (!object(servers) || Object.keys(servers).length > 1000 || Object.values(servers).some(server => !object(server))) throw new CodexPolicyError('The MCP configuration cannot be checked.');
  // An empty TOML table merges with inherited servers. Disable each effective server instead.
  const mcp_servers = Object.fromEntries(Object.keys(servers).map(name => [name, { enabled: false }]));
  return { mcp_servers, features: { ...Object.fromEntries(disabledCodexFeatures.map(name => [name, false])), fast_mode: fastMode, skip_host_skill_discovery: true }, web_search: 'disabled', project_doc_max_bytes: 0 };
}
export function verifyMcpInventory(result: unknown, expected: Set<string>, seen: Set<string>): string | null {
  if (!object(result) || !Array.isArray(result.data) || !(result.nextCursor === null || typeof result.nextCursor === 'string')) throw new CodexPolicyError('The MCP tool inventory is unavailable.');
  for (const server of result.data) {
    if (!object(server) || typeof server.name !== 'string' || !expected.has(server.name) || seen.has(server.name) || server.runtimeStatus !== 'disabled' || !object(server.tools) || Object.keys(server.tools).length || !Array.isArray(server.resources) || server.resources.length || !Array.isArray(server.resourceTemplates) || server.resourceTemplates.length) throw new CodexPolicyError('An MCP integration is still active or cannot be checked.');
    seen.add(server.name);
  }
  if (result.nextCursor === null && seen.size !== expected.size) throw new CodexPolicyError('The MCP inventory is incomplete.');
  return result.nextCursor;
}
