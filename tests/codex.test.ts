import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CodexClient, InvalidCodexResponse } from '../src/main/codex-client.ts';
import { replyOutputSchema } from '../src/main/codex-service.ts';

async function fixture() {
  const directory = path.resolve('.test-runs', 'codex-' + randomUUID());
  const binary = path.resolve('tests/fixtures/fake-codex.mjs');
  await fs.chmod(binary, 0o755);
  return { directory, client: new CodexClient(directory, binary) };
}
async function assertExited(directory: string) {
  const pid = Number(await fs.readFile(path.join(directory, 'server.pid'), 'utf8'));
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
}
async function within<T>(operation: Promise<T>, milliseconds = 5000): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Test timed out waiting for Codex cleanup.')), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}
function notification(client: CodexClient, method: string, requestMethod?: string) {
  return new Promise<void>(resolve => {
    const received = (event: any) => {
      if (event.method !== method || requestMethod && event.params?.method !== requestMethod) return;
      client.off('notification', received); resolve();
    };
    client.on('notification', received);
  });
}
test('Codex JSONL handles fragmented messages and stops its child after a structured response', async () => {
  const { directory, client } = await fixture(), progress: string[] = [];
  const result = await client.run('normal', replyOutputSchema, message => progress.push(message));
  assert.deepEqual(result, { reply: 'Precise θ advice', replacement: null, packages: [] });
  assert(progress.some(message => message.includes('Connecting')));
  const requests = JSON.parse(await fs.readFile(path.join(directory, 'requests.json'), 'utf8'));
  const thread = requests.find((r: any) => r.method === 'thread/start').params;
  assert.equal(thread.ephemeral, true); assert.equal(thread.sandbox, 'read-only'); assert.equal(thread.approvalPolicy, 'never');
  const turn = requests.find((r: any) => r.method === 'turn/start').params;
  assert.deepEqual(turn.sandboxPolicy, { type: 'readOnly', networkAccess: false });
  assert.deepEqual(turn.outputSchema, replyOutputSchema);
  const args = JSON.parse(await fs.readFile(path.join(directory, 'arguments.json'), 'utf8'));
  assert(!args.includes('mcp_servers={}')); assert(args.includes('shell_tool')); assert(args.includes('plugins'));
  assert.deepEqual(thread.config.mcp_servers, { 'probe.with.dots': { enabled: false }, 'probe-two': { enabled: false } });
  assert.deepEqual(thread.environments, []); assert.deepEqual(thread.selectedCapabilityRoots, []); assert.deepEqual(thread.dynamicTools, []);
  assert(requests.findIndex((r: any) => r.method === 'config/read') < requests.findIndex((r: any) => r.method === 'thread/start'));
  assert(requests.findIndex((r: any) => r.method === 'mcpServerStatus/list') < requests.findIndex((r: any) => r.method === 'turn/start'));
  await assertExited(directory);
});

test('real-runtime isolation check uses the same preflight without sending a model prompt', async () => {
  const { directory, client } = await fixture();
  await fs.mkdir(directory, { recursive: true }); await fs.writeFile(path.join(directory, 'paginate'), '');
  assert.deepEqual(await client.checkIsolation(), { version: '0.153.4', disabledServers: 2 });
  const requests = JSON.parse(await fs.readFile(path.join(directory, 'requests.json'), 'utf8'));
  assert.equal(requests.filter((r: any) => r.method === 'mcpServerStatus/list').length, 2);
  assert(!requests.some((r: any) => r.method === 'turn/start' || r.method === 'model/list'));
  await assertExited(directory);
});

test('launcher branding is normalized only for the child and does not bypass the version gate', async () => {
  const previous = process.env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE;
  process.env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE = 'Codex Desktop';
  try {
    const { directory, client } = await fixture();
    assert.deepEqual(await client.checkIsolation(), { version: '0.153.4', disabledServers: 2 });
    assert.equal(process.env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE, 'Codex Desktop');
    await fs.writeFile(path.join(directory, 'unknown-version'), '');
    await assert.rejects(client.checkIsolation(), /supports tested Codex CLI/);
    const requests = JSON.parse(await fs.readFile(path.join(directory, 'requests.json'), 'utf8'));
    assert(!requests.some((r: any) => r.method === 'thread/start' || r.method === 'turn/start'));
    await assertExited(directory);
  } finally {
    if (previous === undefined) delete process.env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE;
    else process.env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE = previous;
  }
});

test('unknown runtime and unverifiable configuration stop before a thread or manuscript is sent', async () => {
  for (const failure of ['unknown-version', 'config-unavailable', 'unsafe-feature']) {
    const { directory, client } = await fixture();
    await fs.mkdir(directory, { recursive: true }); await fs.writeFile(path.join(directory, failure), '');
    await assert.rejects(client.run('SYNTHETIC_PRIVATE_SENTINEL', replyOutputSchema, () => {}));
    const requests = JSON.parse(await fs.readFile(path.join(directory, 'requests.json'), 'utf8'));
    assert(!requests.some((r: any) => r.method === 'thread/start' || r.method === 'turn/start'));
    assert(!JSON.stringify(requests).includes('SYNTHETIC_PRIVATE_SENTINEL'));
    await assertExited(directory);
  }
});

test('active, unexpected, incomplete or unverifiable MCP inventories stop before generation', async () => {
  for (const failure of ['wrong-policy', 'enabled-mcp', 'available-tool', 'available-resource', 'unexpected-mcp', 'missing-mcp', 'malformed-inventory', 'repeated-cursor']) {
    const { directory, client } = await fixture();
    await fs.mkdir(directory, { recursive: true }); await fs.writeFile(path.join(directory, failure), '');
    await assert.rejects(client.run('SYNTHETIC_PRIVATE_SENTINEL', replyOutputSchema, () => {}), /restrictions could not be verified/);
    const requests = JSON.parse(await fs.readFile(path.join(directory, 'requests.json'), 'utf8'));
    assert(!requests.some((r: any) => r.method === 'turn/start'));
    assert(!JSON.stringify(requests).includes('SYNTHETIC_PRIVATE_SENTINEL'));
    await assertExited(directory);
  }
});
test('Codex accepts the final completed item when the terminal turn omits its items', async () => {
  const { directory, client } = await fixture();
  assert.equal((await client.run('fallback', replyOutputSchema, () => {}) as any).reply, 'Precise θ advice');
  await assertExited(directory);
});
test('invalid model JSON and failed turns leave no background server', async () => {
  const { directory, client } = await fixture();
  await assert.rejects(client.run('invalid', replyOutputSchema, () => {}), (error: unknown) => error instanceof InvalidCodexResponse && error.responseText === 'not-json');
  await assertExited(directory);
  await assert.rejects(client.run('failure', replyOutputSchema, () => {}), /Fixture model failure/);
  await assertExited(directory);
});
test('cancellation interrupts a live turn, stops its process, and permits a fresh review', async () => {
  const { directory, client } = await fixture();
  const started = new Promise<void>(resolve => client.on('notification', event => { if (event.method === 'turn/started') resolve(); }));
  const run = client.run('wait', replyOutputSchema, () => {});
  const rejected = assert.rejects(run, /cancelled/);
  await started;
  await assert.rejects(client.run('normal', replyOutputSchema, () => {}), /already reviewing/);
  await client.cancel(); await rejected; await assertExited(directory);
  assert.equal((await client.run('normal', replyOutputSchema, () => {}) as any).reply, 'Precise θ advice');
  await assertExited(directory);
});
test('an acknowledged interrupt without completion still cancels, reaps its child, and permits a fresh review', { timeout: 15000 }, async t => {
  const { directory, client } = await fixture();
  await fs.mkdir(directory, { recursive: true });
  const flags = ['ack-only-interrupt', 'ignore-eof', 'delay-turn-response'];
  for (const flag of flags) await fs.writeFile(path.join(directory, flag), '');
  const started = notification(client, 'turn/started');
  const rejected = assert.rejects(client.run('wait', replyOutputSchema, () => {}), /cancelled/);
  t.after(async () => { await client.stop(); await rejected; await assertExited(directory); });
  await within(started);
  await within(Promise.all([client.cancel(), rejected]));
  await assertExited(directory);
  await fs.access(path.join(directory, 'turn-response-sent'));
  for (const flag of flags) await fs.unlink(path.join(directory, flag));
  assert.equal((await within(client.run('normal', replyOutputSchema, () => {})) as any).reply, 'Precise θ advice');
  await assertExited(directory);
});
test('concurrent stop and cancellation callers all wait for the owned server to exit', { timeout: 15000 }, async t => {
  const { directory, client } = await fixture();
  await fs.mkdir(directory, { recursive: true }); await fs.writeFile(path.join(directory, 'ignore-eof'), '');
  const started = notification(client, 'turn/started');
  const rejected = assert.rejects(client.run('wait', replyOutputSchema, () => {}), /cancelled/);
  t.after(async () => { await client.stop(); await rejected; await assertExited(directory); });
  await within(started);
  const cancelling = client.cancel(), stopping = client.stop();
  await within(client.stop());
  await assertExited(directory);
  await within(Promise.all([cancelling, stopping, client.cancel(), rejected]));
  await fs.unlink(path.join(directory, 'ignore-eof'));
  assert.equal((await within(client.run('normal', replyOutputSchema, () => {})) as any).reply, 'Precise θ advice');
  await assertExited(directory);
});
test('cancellation during setup or before the turn-start response leaves a fresh client available', { timeout: 15000 }, async t => {
  for (const method of ['initialize', 'config/read', 'thread/start', 'mcpServerStatus/list', 'model/list', 'turn/start']) {
    const { directory, client } = await fixture(), flag = 'pause-' + method.replaceAll('/', '-');
    await fs.mkdir(directory, { recursive: true }); await fs.writeFile(path.join(directory, flag), '');
    const paused = notification(client, 'fixture/paused', method);
    const rejected = assert.rejects(client.run('wait', replyOutputSchema, () => {}), /cancelled/);
    t.after(async () => { await client.stop(); await rejected; await assertExited(directory); });
    await within(paused);
    await within(Promise.all([client.cancel(), rejected]));
    await assertExited(directory);
    const requests = JSON.parse(await fs.readFile(path.join(directory, 'requests.json'), 'utf8'));
    assert.equal(requests.filter((request: any) => request.method === 'turn/start').length, method === 'turn/start' ? 1 : 0);
    await fs.unlink(path.join(directory, flag));
    assert.equal((await within(client.run('normal', replyOutputSchema, () => {})) as any).reply, 'Precise θ advice');
    await assertExited(directory);
  }
});
test('cancelling before connection finishes prevents a late child from starting', { timeout: 10000 }, async t => {
  const { directory, client } = await fixture();
  const rejected = assert.rejects(client.run('normal', replyOutputSchema, () => {}), /cancelled/);
  t.after(async () => { await client.stop(); await rejected; });
  await within(Promise.all([client.cancel(), rejected]));
  await assert.rejects(fs.access(path.join(directory, 'server.pid')), { code: 'ENOENT' });
  assert.equal((await within(client.run('normal', replyOutputSchema, () => {})) as any).reply, 'Precise θ advice');
  await assertExited(directory);
});
test('the chosen effort reaches the turn; unsupported effort stops before generation and leaves no server', async () => {
  const { directory, client } = await fixture();
  for (const effort of ['low', 'medium', 'high', 'max'] as const) {
    await client.run('normal', replyOutputSchema, () => {}, effort);
    const requests = JSON.parse(await fs.readFile(path.join(directory, 'requests.json'), 'utf8'));
    assert.equal(requests.find((r: any) => r.method === 'turn/start').params.effort, effort);
    assert(requests.find((r: any) => r.method === 'model/list'));
    await assertExited(directory);
  }
  await fs.writeFile(path.join(directory, 'only-medium'), '');
  await assert.rejects(client.run('normal', replyOutputSchema, () => {}, 'high'), /does not support high effort/);
  const requests = JSON.parse(await fs.readFile(path.join(directory, 'requests.json'), 'utf8'));
  assert(!requests.some((r: any) => r.method === 'turn/start')); await assertExited(directory);
});

test('Fast tier and Max effort remain independent, and Fast refusal stops before generation', async () => {
  const { directory, client } = await fixture(), progress: string[] = [];
  for (const fast of [true, false]) {
    await client.run('normal', replyOutputSchema, s => progress.push(s), 'max', fast);
    const requests = JSON.parse(await fs.readFile(path.join(directory, 'requests.json'), 'utf8'));
    assert.equal(requests.find((r: any) => r.method === 'thread/start').params.serviceTier, fast ? 'fast' : 'default');
    const turn = requests.find((r: any) => r.method === 'turn/start').params;
    assert.equal(turn.effort, 'max'); assert.equal(turn.serviceTierForTurn, fast ? 'fast' : 'default');
    await assertExited(directory);
  }
  assert(progress.some(s => s.includes('Max · Fast')));
  for (const refusal of ['no-fast', 'reject-fast']) {
    await fs.writeFile(path.join(directory, refusal), '');
    await assert.rejects(client.run('normal', replyOutputSchema, () => {}, 'max', true), /Fast mode was not enabled/);
    const requests = JSON.parse(await fs.readFile(path.join(directory, 'requests.json'), 'utf8'));
    assert(!requests.some((r: any) => r.method === 'turn/start')); await assertExited(directory);
    await fs.unlink(path.join(directory, refusal));
  }
});
