import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { managedCodexLocation, managedCodexVersion, verifyManagedCodex } from '../src/main/managed-codex.ts';
import { ToolSettingsService } from '../src/main/tool-settings.ts';
import { verifiedCodexVersions } from '../src/main/codex-policy.ts';
import { CodexClient } from '../src/main/codex-client.ts';

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  await fs.mkdir('.test-runs', { recursive: true });
  const root = await fs.mkdtemp(path.resolve('.test-runs/managed-codex-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const application = path.join(root, 'Downloaded editor with spaces');
  const runtime = path.join(root, 'runtime'); await fs.mkdir(runtime);
  const location = managedCodexLocation(application);
  return { root, application, runtime, location, service: new ToolSettingsService(runtime, 1500, application) };
}
async function installFixture(application: string, version = managedCodexVersion) {
  const location = managedCodexLocation(application);
  for (const [file, packageVersion] of [[location.packageFile, version], [location.nativePackageFile, `${version}-${process.platform}-${process.arch}`]]) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ name: '@openai/codex', version: packageVersion }));
  }
  await fs.mkdir(path.dirname(location.path), { recursive: true });
  await fs.writeFile(location.path, `#!/bin/sh\nprintf 'codex-cli ${version}\\n'\n`, { mode: 0o700 });
  return location.path;
}

test('a fresh download defaults to its own pinned CLI and reports missing optional binaries without fallback', async t => {
  const f = await fixture(t), { settings } = await f.service.load();
  assert.equal(settings.codexSource, 'managed'); assert.equal(settings.codexPath, f.location.path);
  await assert.rejects(verifyManagedCodex(f.application), /npm ci --ignore-scripts/);
  assert.equal((await f.service.check(settings)).checks[0].ok, false);
  const executable = await installFixture(f.application);
  assert.equal(await verifyManagedCodex(f.application), executable);
  const checked = (await f.service.check(settings)).checks[0];
  assert(checked.ok, checked.message); assert.equal(checked.version, `codex-cli ${managedCodexVersion}`);
  await fs.unlink(executable);
  await assert.rejects(verifyManagedCodex(f.application), /missing or does not match/);
});

test('the pinned release is tested and lockfile integrity covers each native package', async () => {
  assert(verifiedCodexVersions.some(version => version === managedCodexVersion));
  const lock = JSON.parse(await fs.readFile('package-lock.json', 'utf8'));
  assert.equal(lock.packages[''].dependencies['@openai/codex'], managedCodexVersion);
  assert.equal(lock.packages['node_modules/@openai/codex'].version, managedCodexVersion);
  for (const platform of ['darwin', 'linux', 'win32']) for (const arch of ['x64', 'arm64']) {
    const entry = lock.packages[`node_modules/@openai/codex-${platform}-${arch}`];
    assert.equal(entry.version, `${managedCodexVersion}-${platform}-${arch}`);
    assert.match(entry.integrity, /^sha512-/); assert.match(entry.resolved, /^https:\/\/registry\.npmjs\.org\//);
    assert.equal(path.basename(managedCodexLocation('/example', platform, arch).path), platform === 'win32' ? 'codex.exe' : 'codex');
  }
});

test('managed settings relocate with a new checkout while custom executable and model choices persist', async t => {
  const f = await fixture(t); await installFixture(f.application);
  const managed = { ...(await f.service.load()).settings, codexModel: 'gpt-6-sol' };
  await f.service.save(managed);
  const moved = path.join(f.root, 'New download'), newService = new ToolSettingsService(f.runtime, 1500, moved);
  const loaded = await newService.load();
  assert.equal(loaded.settings.codexPath, managedCodexLocation(moved).path);
  assert.equal(loaded.settings.codexModel, 'gpt-6-sol');
  assert.deepEqual(JSON.parse(await fs.readFile(f.service.file, 'utf8')), managed, 'load must not overwrite saved state');
  assert.equal(newService.resolve({ ...managed, codexPath: '/injected/custom/path' }).codexPath, managedCodexLocation(moved).path);
  await f.service.save({ ...managed, codexSource: 'custom' });
  assert.equal((await newService.load()).settings.codexPath, managed.codexPath);
});

test('only the legacy automatic desktop path migrates; explicit custom and unrelated legacy paths are retained', async t => {
  const f = await fixture(t), base = { latexmkPath: '/Library/TeX/texbin/latexmk', codexModel: 'gpt-6-luna' };
  const legacy = { ...base, codexPath: '/Applications/ChatGPT.app/Contents/Resources/codex' };
  await fs.writeFile(f.service.file, JSON.stringify(legacy));
  const loaded = await f.service.load();
  assert.equal(loaded.settings.codexSource, 'managed'); assert.equal(loaded.settings.codexPath, f.location.path);
  assert.equal(loaded.settings.codexModel, 'gpt-6-luna'); assert.match(loaded.notices[0], /editor-managed/);
  assert.deepEqual(JSON.parse(await fs.readFile(f.service.file, 'utf8')), legacy);
  for (const custom of [{ ...legacy, codexSource: 'custom' }, { ...base, codexPath: '/custom/codex' }]) {
    await fs.writeFile(f.service.file, JSON.stringify(custom));
    assert.deepEqual((await f.service.load()).settings, custom);
  }
});

test('a changed package version is rejected even when it is another supported CLI', async t => {
  const f = await fixture(t); await installFixture(f.application, '0.153.4');
  await assert.rejects(verifyManagedCodex(f.application), /does not match/);
  const { settings } = await f.service.load();
  const checked = (await f.service.check(settings)).checks[0];
  assert.equal(checked.ok, false); assert.match(checked.message, /does not match/);
  // The manifest cannot hide a substituted executable reporting a different version.
  await installFixture(f.application);
  await fs.writeFile(f.location.path, "#!/bin/sh\nprintf 'codex-cli 0.153.4\\n'\n", { mode: 0o700 });
  assert.match((await f.service.check(settings)).checks[0].message, /must be version/);
});

test('managed review startup refuses missing or changed package metadata before spawning', async t => {
  const f = await fixture(t), directory = path.join(f.root, 'request');
  const client = new CodexClient(directory, f.location.path, managedCodexVersion, f.application);
  await installFixture(f.application);
  const marker = path.join(f.root, 'must-not-launch');
  await fs.writeFile(f.location.path, `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started');\n`, { mode: 0o700 });
  for (const metadata of [JSON.stringify({ name: '@openai/codex', version: '0.153.4' }), null]) {
    if (metadata) await fs.writeFile(f.location.packageFile, metadata);
    else await fs.unlink(f.location.packageFile);
    await assert.rejects(client.checkIsolation(), /missing or does not match/);
    assert.equal(client.isBusy, false);
    await assert.rejects(fs.access(marker), { code: 'ENOENT' });
    await assert.rejects(fs.access(directory), { code: 'ENOENT' });
  }
});
