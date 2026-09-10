// Opt-in real Codex configuration test. Disposable config, no sign-in or model turn.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CodexClient } from '../src/main/codex-client.ts';

const script = fileURLToPath(import.meta.url), repo = path.resolve(path.dirname(script), '..');
const option = name => { const at = process.argv.indexOf(name); return at < 0 ? undefined : process.argv[at + 1]; };
const binary = option('--codex') ?? '/Applications/ChatGPT.app/Contents/Resources/codex';
const exists = file => fs.access(file).then(() => true, () => false);

if (option('--worker')) {
  const client = new CodexClient(option('--worker'), binary);
  process.once('SIGTERM', () => void client.stop().finally(() => process.exit(1)));
  try { console.log(JSON.stringify(await client.checkIsolation())); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
} else {
  const runId = randomUUID(), root = path.join(repo, '.test-runs', 'codex-isolation', runId);
  const evidence = path.join(repo, 'test-evidence', 'codex-isolation');
  await fs.mkdir(root, { recursive: true }); await fs.mkdir(evidence, { recursive: true });
  const probe = path.join(repo, 'tests', 'fixtures', 'harmless-mcp.mjs');
  const receipts = [];
  function launch(executable, args, directory, probeCodexHome, originator) {
    const child = spawn(executable, args, { cwd: directory, env: { PATH: process.env.PATH, HOME: process.env.HOME, CODEX_HOME: probeCodexHome, RUST_LOG: 'error', ...(originator ? { CODEX_INTERNAL_ORIGINATOR_OVERRIDE: originator } : {}) }, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const exited = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
    let output = '', errors = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', data => { output = (output + data).slice(-1000000); });
    child.stderr.on('data', data => { errors = (errors + data).slice(-4000); });
    const kill = signal => { try { process.kill(-child.pid, signal); } catch {} };
    const watchdog = setTimeout(() => kill('SIGTERM'), 30000);
    const hardStop = setTimeout(() => kill('SIGKILL'), 35000);
    const done = exited.then(result => { clearTimeout(watchdog); clearTimeout(hardStop); return { ...result, output, errors }; });
    return { child, done, async stop() { child.stdin.end(); const timer = setTimeout(() => kill('SIGTERM'), 1500); try { return await done; } finally { clearTimeout(timer); } } };
  }
  async function setup(name, projectServer = false) {
    const directory = path.join(root, name), project = path.join(directory, 'project'), probeCodexHome = path.join(directory, 'codex-home');
    await fs.mkdir(project, { recursive: true }); await fs.mkdir(probeCodexHome);
    const marker = path.join(directory, 'home-probe.txt'), secondMarker = path.join(directory, 'project-probe.txt');
    const server = (name, marker) => `[mcp_servers.${JSON.stringify(name)}]\ncommand = ${JSON.stringify(process.execPath)}\nargs = [${JSON.stringify(probe)}, ${JSON.stringify(marker)}]\nstartup_timeout_sec = 5\ndefault_tools_approval_mode = "auto"\n`;
    const config = `model = "gpt-5.6-sol"\n[projects.${JSON.stringify(project)}]\ntrust_level = "trusted"\n${server('home.probe', marker)}`;
    await fs.writeFile(path.join(probeCodexHome, 'config.toml'), config);
    if (projectServer) { await fs.mkdir(path.join(project, '.codex')); await fs.writeFile(path.join(project, '.codex', 'config.toml'), server('project_probe', secondMarker)); }
    return { project, probeCodexHome, marker, secondMarker, config };
  }
  try {
    const c = await setup('legacy-control');
    const disabled = ['apps', 'plugins', 'shell_tool', 'unified_exec', 'multi_agent', 'browser_use', 'computer_use', 'image_generation', 'view_image', 'hooks', 'code_mode_host'];
    const args = ['app-server', '--listen', 'stdio://', '-c', 'mcp_servers={}', '-c', 'project_doc_max_bytes=0', '-c', 'web_search="disabled"', ...disabled.flatMap(name => ['--disable', name])];
    const server = launch(binary, args, c.project, c.probeCodexHome), pending = new Map();
    let buffer = '', nextId = 0;
    server.child.stdout.on('data', chunk => {
      buffer += chunk; let split;
      while ((split = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, split); buffer = buffer.slice(split + 1);
        try { const message = JSON.parse(line), task = pending.get(message.id); if (task) { pending.delete(message.id); message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result); } }
        catch { for (const task of pending.values()) task.reject(new Error('Invalid probe protocol')); pending.clear(); }
      }
    });
    const rejectPending = () => { for (const task of pending.values()) task.reject(new Error('Probe server exited before reply')); pending.clear(); };
    server.child.once('error', rejectPending); server.child.once('close', rejectPending);
    const request = (method, params) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); server.child.stdin.write(JSON.stringify({ id, method, params }) + '\n'); });
    try {
      await request('initialize', { clientInfo: { name: 'editor_probe_control', version: '1' }, capabilities: { experimentalApi: true } });
      server.child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
      const effective = await request('config/read', { cwd: c.project, includeLayers: false });
      assert.equal(effective.config.mcp_servers['home.probe'].enabled, true);
      assert.equal(await exists(c.marker), false, 'configuration inspection must not start the probe');
      const thread = await request('thread/start', { cwd: c.project, ephemeral: true, approvalPolicy: 'never', sandbox: 'read-only' });
      const inventory = await request('mcpServerStatus/list', { threadId: thread.thread.id, limit: 100 });
      assert(inventory.data.some(item => item.runtimeStatus === 'connected' && item.tools.harmless_echo));
      const starts = (await fs.readFile(c.marker, 'utf8')).trim().split('\n');
      assert(starts.length > 0 && starts.every(line => line === 'started'), 'the control must start the server but never call its tool');
      receipts.push({ scenario: 'legacy-empty-table-positive-control', inheritedProbeStarted: true, approvalFreeToolAvailable: true, modelTurnStarted: false, toolCalled: false });
    } finally { const ended = await server.stop(); assert.equal(ended.code, 0, 'control app-server must exit normally'); }

    for (const [scenario, projectServer, originator] of [['home-only', false], ['home-and-trusted-project', true], ['inherited-launcher-identity', true, 'Codex Desktop']]) {
      const test = await setup(scenario, projectServer);
      const worker = launch(process.execPath, ['--experimental-strip-types', script, '--worker', test.project, '--codex', binary], test.project, test.probeCodexHome, originator);
      const ended = await worker.done;
      assert.equal(ended.code, 0, ended.errors || 'isolation worker failed');
      const checked = JSON.parse(ended.output.trim());
      assert.equal(checked.disabledServers, projectServer ? 2 : 1);
      assert.equal(await exists(test.marker), false); assert.equal(await exists(test.secondMarker), false);
      assert.equal(await fs.readFile(path.join(test.probeCodexHome, 'config.toml'), 'utf8'), test.config);
      receipts.push({ scenario, ...checked, probeStarted: false, toolAvailable: false, modelTurnStarted: false, configPreserved: true });
    }
  } catch (error) { receipts.push({ passed: false, error: error instanceof Error ? error.message : String(error) }); process.exitCode = 1; }
  const sourceHashes = {};
  for (const name of ['src/main/codex-client.ts', 'src/main/codex-policy.ts', 'scripts/check-codex-isolation.mjs', 'tests/fixtures/harmless-mcp.mjs']) sourceHashes[name] = createHash('sha256').update(await fs.readFile(path.join(repo, name))).digest('hex');
  const receipt = { passed: !process.exitCode, node: process.version, platform: process.platform, arch: process.arch, noAccountDataCopied: true, noModelTurnsStarted: true, sourceHashes, scenarios: receipts };
  await fs.writeFile(path.join(evidence, `${runId}.json`), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt, null, 2));
}
