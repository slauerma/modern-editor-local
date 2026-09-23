// Real installed Codex, deterministic localhost provider, synthetic references.
// No account login or remote model call. Receipts omit prompts, tool output,
// inventories and filesystem paths. Run the separate MCP positive-control probe too.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(import.meta.url), repo = path.resolve(path.dirname(script), '..');
const hash = value => createHash('sha256').update(value).digest('hex');
const emit = value => console.log(JSON.stringify(value));
const exists = file => fs.access(file).then(() => true, () => false);
const groupExists = pid => { try { process.kill(-pid, 0); return true; } catch (e) { if (e.code === 'ESRCH') return false; throw e; } };
const signalGroup = (pid, signal) => { try { process.kill(-pid, signal); } catch (e) { if (e.code !== 'ESRCH') throw e; } };
const referenceNames = ['references_list', 'references_read', 'references_search'];
const schema = { type: 'object', properties: { token: { type: 'string' } }, required: ['token'], additionalProperties: false };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

if (process.argv[2] === '--worker') {
  const [mode, binary, directory] = process.argv.slice(3), enabled = mode === 'references';
  const { CodexClient } = await import('../src/main/codex-client.ts');
  const { disabledCodexFeatures } = await import('../src/main/codex-policy.ts');
  const { referenceTools } = await import('../src/main/reference-service.ts');
  const version = JSON.parse(await fs.readFile(path.join(repo, 'package.json'), 'utf8')).version;
  const client = new CodexClient(directory, binary), children = [], calls = [];
  const nonce = 'SYNTHETIC-' + randomUUID(), text = 'The reference protocol token is ' + nonce;
  let cancelled = false, stage = 'connection', skillsSeen = false, initialized = false, threadChecked = false;
  const reader = { tools: referenceTools, async cancel() { cancelled = true; }, async call(name, args) {
    calls.push(name); assert(referenceNames.includes(name));
    if (name === 'references_list') return { files: [{ id: 'current-draft', name: 'synthetic.txt', kind: 'text', bytes: text.length }], nextOffset: null, notices: [] };
    assert.equal(args.fileId, 'current-draft');
    const excerpt = { name: 'synthetic.txt', hash: hash(text), excerpts: [{ location: 'Text line 1', text }], notices: [] };
    return name === 'references_read' ? excerpt : { results: [{ fileId: 'current-draft', ...excerpt, complete: true }], nextOffset: null, notices: [] };
  } };
  const send = client.send.bind(client), request = client.request.bind(client);
  client.send = envelope => {
    const child = client.child;
    if (child && !children.some(p => p.pid === child.pid)) {
      const record = { pid: child.pid, closed: false }; children.push(record); emit({ spawned: child.pid });
      child.once('close', () => { record.closed = true; });
    }
    if (envelope.method === 'initialize') { assert.equal(envelope.params.clientInfo.version, version); initialized = true; }
    if (envelope.method === 'thread/start') {
      stage = 'thread restrictions'; const p = envelope.params;
      assert.deepEqual(p.dynamicTools, enabled ? referenceTools : []);
      assert.equal(p.ephemeral, true); assert.equal(p.approvalPolicy, 'never'); assert.equal(p.sandbox, 'read-only');
      assert.deepEqual(p.environments, []); assert.deepEqual(p.selectedCapabilityRoots, []);
      assert.equal(p.config.features.code_mode_host, enabled); assert.equal(p.config.agents.enabled, false);
      assert(disabledCodexFeatures.every(key => p.config.features[key] === false));
      assert(p.config.skills.config.every(skill => skill.enabled === false));
      assert(Object.values(p.config.mcp_servers).every(server => server.enabled === false)); threadChecked = true;
    }
    return send(envelope);
  };
  client.request = async (method, params, timeout) => {
    const result = await request(method, params, timeout);
    if (method === 'skills/list') skillsSeen = result.data.some(entry => entry.skills.some(skill => skill.name === 'synthetic-host-probe'));
    return result;
  };
  process.once('SIGTERM', () => { void client.cancel(); });
  let outcome;
  try {
    stage = 'synthetic turn';
    const result = await client.run(`SYNTHETIC_PROTOCOL_${enabled ? 'REFERENCES' : 'NONE'}. Use only synthetic reference tools if provided, then return the token.`, schema, () => {}, 'low', false, enabled ? reader : undefined);
    stage = 'result checks'; assert.equal(result.token, enabled ? nonce : 'NO_READER_VERIFIED');
    assert(initialized && threadChecked && skillsSeen);
    assert.deepEqual([...new Set(calls)].sort(), enabled ? [...referenceNames].sort() : []);
    if (enabled) assert(cancelled);
    outcome = { passed: true, mode, version: client.version, editorVersion: version, referenceCalls: calls, syntheticSkillDiscoveredAndDisabled: true };
  } catch { outcome = { passed: false, mode, failedStage: stage }; process.exitCode = 1; }
  finally {
    await client.cancel(); await pause(50);
    outcome.childrenClosed = children.length > 0 && children.every(child => child.closed);
    if (!outcome.childrenClosed) { outcome.passed = false; process.exitCode = 1; }
    emit({ outcome });
  }
} else {
  assert(process.argv.length === 3, 'Usage: node --experimental-strip-types scripts/check-reference-protocol.mjs /absolute/path/to/codex');
  const binary = path.resolve(process.argv[2]); await fs.access(binary);
  const parent = process.env.MODERN_EDITOR_PROBE_OUTPUT ?? path.join(repo, '.test-runs');
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, 'reference-protocol-')), home = path.join(root, 'home'), codexHome = path.join(home, '.codex');
  await fs.mkdir(path.join(codexHome, 'skills/synthetic-host-probe'), { recursive: true });
  await fs.writeFile(path.join(codexHome, 'skills/synthetic-host-probe/SKILL.md'), '---\nname: synthetic-host-probe\ndescription: Synthetic scope sentinel only.\n---\nSYNTHETIC HOST SKILL OUTSIDE REFERENCE GRANTS\n');
  const marker = path.join(root, 'mcp-started'), fixture = path.join(root, 'harmless-mcp.mjs');
  await fs.copyFile(path.join(repo, 'tests/fixtures/harmless-mcp.mjs'), fixture);
  const receipts = [], requests = []; let mode, step = 0, failure, lastOutputs = [], responseIndex = 0;
  const service = http.createServer(async (req, res) => {
    try {
      assert.equal(req.method, 'POST'); assert.equal(req.url, '/v1/responses'); assert.equal(req.headers.authorization, undefined);
      let body = ''; for await (const chunk of req) { body += chunk; assert(body.length <= 2_000_000); }
      const payload = JSON.parse(body);
      for (const sentinel of ['<skills_instructions>', 'synthetic-host-probe', 'Synthetic scope sentinel only.', 'SYNTHETIC HOST SKILL OUTSIDE REFERENCE GRANTS']) assert(!body.includes(sentinel));
      const extra = (payload.input ?? []).filter(item => item.type === 'additional_tools').flatMap(item => item.tools ?? []);
      const advertised = [...(payload.tools ?? []), ...extra];
      // Validate the entire model-facing surface, not just the reference subset.
      // The supported runtime advertises the code-mode controls even when its
      // host is disabled; the turn below separately verifies that denial.
      const controls = new Set(['functions.exec', 'functions.wait', 'functions.request_user_input']);
      for (const tool of advertised) {
        if (tool.type === 'namespace') {
          assert.equal(tool.name, 'functions'); assert(Array.isArray(tool.tools));
          for (const nested of tool.tools) { assert(['function', 'custom'].includes(nested.type)); assert(controls.has(`${tool.name}.${nested.name}`)); }
        } else { assert.equal(tool.type, 'function'); assert(mode === 'references' && referenceNames.includes(tool.name)); }
      }
      const exec = advertised.find(tool => tool.type === 'namespace' && tool.name === 'functions')?.tools?.find(tool => tool.name === 'exec');
      const names = advertised.flatMap(tool => tool.type === 'namespace' ? (tool.tools ?? []).map(nested => `${tool.name}.${nested.name}`) : [tool.name ?? tool.type]);
      assert(names.every(name => controls.has(name) || mode === 'references' && referenceNames.includes(name)));
      const refs = exec ? referenceNames.filter(name => exec.description.includes(`tools: { ${name}(`)) : names.filter(name => referenceNames.includes(name));
      assert.deepEqual([...refs].sort(), mode === 'references' ? [...referenceNames].sort() : []);
      lastOutputs = (payload.input ?? []).filter(item => ['function_call_output', 'custom_tool_call_output'].includes(item.type));
      requests.push({ mode, referenceCount: refs.length, authorizationAbsent: true, skillMetadataAbsent: true });
      assert(++responseIndex <= 16); step++;
      const custom = (id, input) => ({ id: `ctc_${id}`, type: 'custom_tool_call', status: 'completed', namespace: 'functions', name: 'exec', input, call_id: id });
      const skills = 'const results={toolNames:ALL_TOOLS.map(t=>t.name)};for(const kind of ["executor","orchestrator"]){try{results[kind]=await tools.skills__list({authority:{kind}});}catch(e){results[kind]=String(e);}}text(results);';
      let item;
      if (step === 1) item = custom('scope_skills', skills);
      else if (mode === 'references' && step === 2) item = custom('scope_read', 'try{text(await tools.skills__read({package:"synthetic-outside-grant",resource:"file:///synthetic-ungranted.txt"}));}catch(e){text(String(e));}');
      else if (mode === 'references' && step <= 4) item = { id: `fc_scope_${step}`, type: 'function_call', status: 'completed', namespace: 'collaboration', name: step === 3 ? 'spawn_agent' : 'list_agents', arguments: step === 3 ? JSON.stringify({ task_name: 'synthetic_probe', fork_turns: 'none', message: 'Return INERT without tools.' }) : '{}', call_id: `scope_agent_${step}` };
      else if (mode === 'references' && step <= 7) {
        const name = referenceNames[step - 5], args = step === 5 ? {} : step === 6 ? { fileId: 'current-draft' } : { fileId: 'current-draft', query: 'reference protocol token' };
        item = exec ? custom(`ref_${step}`, `text(await tools.${name}(${JSON.stringify(args)}));`) : { id: `fc_${step}`, type: 'function_call', status: 'completed', name, arguments: JSON.stringify(args), call_id: `ref_${step}` };
      } else {
        const token = mode === 'none' ? 'NO_READER_VERIFIED' : JSON.stringify(lastOutputs).match(/SYNTHETIC-[0-9a-f-]{36}/)?.[0]; assert(token);
        item = { id: 'msg_result', type: 'message', role: 'assistant', status: 'completed', phase: 'final_answer', content: [{ type: 'output_text', text: JSON.stringify({ token }), annotations: [] }] };
      }
      const response = { id: `resp_${responseIndex}`, object: 'response', created_at: Math.floor(Date.now() / 1000), model: payload.model, status: 'completed', output: [item], error: null, incomplete_details: null, usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'close' });
      const event = data => res.write(`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`);
      event({ type: 'response.created', sequence_number: 0, response: { ...response, status: 'in_progress', output: [] } });
      event({ type: 'response.output_item.added', sequence_number: 1, output_index: 0, item: { ...item, status: 'in_progress', ...(item.type === 'message' ? { content: [] } : { arguments: '' }) } });
      event({ type: 'response.output_item.done', sequence_number: 2, output_index: 0, item });
      event({ type: 'response.completed', sequence_number: 3, response }); res.end();
    } catch { failure = 'Synthetic provider assertion failed'; if (!res.headersSent) res.writeHead(500); res.end(failure); }
  });
  let result = { passed: false }, stage = 'local listener';
  try {
    await new Promise((resolve, reject) => { service.once('error', reject); service.listen(0, '127.0.0.1', resolve); });
    const config = `model = "gpt-5.6-sol"\nmodel_provider = "synthetic_protocol_probe"\n[model_providers.synthetic_protocol_probe]\nname = "Synthetic local protocol fixture"\nbase_url = "http://127.0.0.1:${service.address().port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\nsupports_websockets = false\nrequest_max_retries = 0\nstream_max_retries = 0\nstream_idle_timeout_ms = 10000\n[mcp_servers.synthetic_probe]\ncommand = ${JSON.stringify(process.execPath)}\nargs = [${JSON.stringify(fixture)}, ${JSON.stringify(marker)}]\ndefault_tools_approval_mode = "auto"\n`;
    await fs.writeFile(path.join(codexHome, 'config.toml'), config);
    for (mode of ['references', 'none']) {
      stage = mode; step = 0; lastOutputs = [];
      const directory = path.join(root, mode); await fs.mkdir(directory);
      const child = spawn(process.execPath, ['--experimental-strip-types', script, '--worker', mode, binary, directory], { cwd: directory, env: { PATH: process.env.PATH, HOME: home, CODEX_HOME: codexHome, RUST_LOG: 'error' }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
      const pids = new Set(); let pending = '', outcome, timedOut = false;
      console.log('Owned protocol worker PID', child.pid);
      child.stdout.setEncoding('utf8'); child.stdout.on('data', chunk => {
        pending += chunk; let end;
        while ((end = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, end); pending = pending.slice(end + 1);
          try { const item = JSON.parse(line); if (Number.isInteger(item.spawned) && item.spawned > 1) pids.add(item.spawned); if (item.outcome) outcome = item.outcome; } catch { /* Never echo raw subprocess output. */ }
        }
        if (pending.length > 100000) pending = '';
      });
      child.stderr.resume();
      const soft = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, 65000);
      const hard = setTimeout(() => { for (const pid of pids) signalGroup(pid, 'SIGKILL'); signalGroup(child.pid, 'SIGKILL'); }, 72000);
      const code = await new Promise(resolve => { child.once('close', resolve); child.once('error', () => resolve(-1)); }); clearTimeout(soft); clearTimeout(hard);
      for (const pid of pids) if (groupExists(pid)) signalGroup(pid, 'SIGKILL');
      await pause(50);
      const processesStopped = !groupExists(child.pid) && [...pids].every(pid => !groupExists(pid));
      receipts.push({ mode, code, timedOut, processesStopped, ...outcome });
      assert.equal(code, 0); assert(!timedOut && processesStopped && outcome?.passed && !failure);
      const output = id => lastOutputs.find(item => item.call_id === id)?.output;
      if (mode === 'references') {
        stage = 'reference skill outputs';
        const skillsOutput = output('scope_skills'), skills = JSON.parse(skillsOutput.find(item => item.text?.startsWith('{')).text);
        assert.deepEqual(skills.executor.skills, []); assert.deepEqual(skills.orchestrator.skills, []);
        stage = 'reference tool inventory';
        assert.deepEqual(skills.toolNames.sort(), [...referenceNames, 'skills__list', 'skills__read'].sort());
        stage = 'ungranted skill read';
        assert(JSON.stringify(output('scope_read')).includes('skill package is not available'));
        stage = 'blocked agent calls';
        for (const id of ['scope_agent_3', 'scope_agent_4']) assert.match(String(output(id)), /unsupported call/);
      } else {
        const blocked = output('scope_skills');
        assert.equal(typeof blocked === 'string' ? blocked : blocked?.map(item => item.text ?? '').join('\n'), 'code-mode host is disabled');
      }
      assert(!await exists(marker), 'Inherited MCP probe must not start');
    }
    assert.equal(await fs.readFile(path.join(codexHome, 'config.toml'), 'utf8'), config);
    const files = ['package.json', 'src/main/codex-client.ts', 'src/main/codex-policy.ts', 'src/main/reference-service.ts', 'src/shared/references.ts', 'scripts/check-reference-protocol.mjs'];
    result = { passed: true, node: process.version, checks: receipts, requests, inheritedMcpNeverStarted: true, syntheticConfigPreserved: true, sourceHashes: Object.fromEntries(await Promise.all(files.map(async name => [name, hash(await fs.readFile(path.join(repo, name)))]))) };
    console.log('PASS: exact advertised tool surface verified; reference tools round-trip; no-reader execution, host skills and agents are blocked. Synthetic localhost provider only.');
  } catch (error) { result = { passed: false, checks: receipts, requests, failedStage: failure ?? stage, errorCode: typeof error.code === 'string' ? error.code : undefined }; process.exitCode = 1; console.error('FAIL: inspect the sanitized result and verify the supported Codex version.'); }
  finally {
    service.closeAllConnections(); await new Promise(resolve => service.close(resolve));
    result.listenerClosed = !service.listening;
    await fs.writeFile(path.join(root, 'results.json'), JSON.stringify(result, null, 2) + '\n');
    if (result.passed) for (const name of ['home', 'references', 'none', 'harmless-mcp.mjs']) await fs.rm(path.join(root, name), { recursive: true, force: true });
    console.log('Sanitized evidence:', path.join(root, 'results.json'));
  }
}
