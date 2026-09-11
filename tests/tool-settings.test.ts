import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ToolSettingsService, defaultToolSettings } from '../src/main/tool-settings.ts';
import { verifiedCodexVersions } from '../src/main/codex-policy.ts';
import { CodexClient } from '../src/main/codex-client.ts';
import { CompileService } from '../src/main/compile-service.ts';
import { ProjectService } from '../src/main/project-service.ts';
import { formatSetupDetails, type SetupCheck, type SetupTool, type ToolCheck } from '../src/shared/tool-settings.ts';

async function fixture() {
  const root = path.resolve('.test-runs', 'tool-settings-' + randomUUID()), bin = path.join(root, 'bin'), runtime = path.join(root, 'runtime');
  await fs.mkdir(bin, { recursive: true }); await fs.mkdir(runtime);
  const script = `#!/usr/bin/env node\nimport fs from 'node:fs'; import path from 'node:path';\nconst name=path.basename(process.argv[1]); fs.writeFileSync(path.join(process.cwd(),name+'-probe.json'),JSON.stringify({args:process.argv.slice(2),secret:process.env.TEST_SETUP_SECRET??null,home:process.env.HOME}));\nconsole.log(name==='codex'?'codex-cli ${verifiedCodexVersions[0]}':name+' version 1.2.3');\n`;
  for (const tool of ['codex', 'latexmk', 'pdflatex', 'lualatex', 'xelatex', 'kpsewhich', 'synctex']) await fs.writeFile(path.join(bin, tool), script, { mode: 0o700 });
  const settings = { codexPath: path.join(bin, 'codex'), latexmkPath: path.join(bin, 'latexmk') };
  return { root, bin, runtime, settings, service: new ToolSettingsService(runtime, 1500) };
}

test('tool settings preserve the previous readable file when a new path is missing or invalid', async () => {
  const f = await fixture(); assert.deepEqual((await f.service.load()).settings, defaultToolSettings);
  await f.service.save(f.settings); const before = await fs.readFile(f.service.file);
  await assert.rejects(f.service.save({ ...f.settings, codexPath: 'relative/codex' }), /absolute executable/);
  await assert.rejects(f.service.save({ ...f.settings, latexmkPath: path.join(f.bin, 'missing') }));
  await assert.rejects(f.service.save({ ...f.settings, codexPath: f.bin }), /executable file/);
  const locked = path.join(f.bin, 'not-executable'); await fs.writeFile(locked, 'text', { mode: 0o600 });
  await assert.rejects(f.service.save({ ...f.settings, codexPath: locked }));
  assert.deepEqual(await fs.readFile(f.service.file), before);
  assert.deepEqual((await f.service.load()).settings, f.settings);
});

test('corrupt settings are preserved and surfaced, and linked TeX binaries keep their sibling-directory path', async () => {
  const f = await fixture(); await fs.writeFile(f.service.file, '{unreadable');
  const loaded = await f.service.load(); assert.equal(loaded.notices.length, 1);
  assert.deepEqual(loaded.settings, defaultToolSettings); assert.equal(await fs.readFile(f.service.file, 'utf8'), '{unreadable');
  const link = path.join(f.bin, 'linked-latexmk'); await fs.symlink(f.settings.latexmkPath, link);
  await f.service.save({ ...f.settings, latexmkPath: link });
  assert.equal((await f.service.load()).settings.latexmkPath, link);
});

test('TeX settings can be corrected when the unchanged Codex executable is unavailable', async () => {
  const f = await fixture(); await f.service.save(f.settings);
  await fs.unlink(f.settings.codexPath);
  const moved = path.join(f.bin, 'moved-latexmk'); await fs.copyFile(f.settings.latexmkPath, moved); await fs.chmod(moved, 0o700);
  const next = { ...f.settings, latexmkPath: moved };
  assert.deepEqual(await f.service.save(next), next);
  assert.deepEqual((await f.service.load()).settings, next);
  await assert.rejects(fs.access(path.join(f.runtime, 'setup-check'))); // Saving launches no executable.
  const before = await fs.readFile(f.service.file);
  await assert.rejects(f.service.save({ ...next, codexPath: path.join(f.bin, 'another-missing-codex') }));
  assert.deepEqual(await fs.readFile(f.service.file), before);
});

test('Codex settings can be corrected when the unchanged TeX executable is unavailable', async () => {
  const f = await fixture(); await f.service.save(f.settings);
  await fs.unlink(f.settings.latexmkPath);
  const moved = path.join(f.bin, 'moved-codex'); await fs.copyFile(f.settings.codexPath, moved); await fs.chmod(moved, 0o700);
  const next = { ...f.settings, codexPath: moved };
  assert.deepEqual(await f.service.save(next), next);
  assert.deepEqual((await f.service.load()).settings, next);
  await assert.rejects(fs.access(path.join(f.runtime, 'setup-check')));
  const before = await fs.readFile(f.service.file);
  await assert.rejects(f.service.save({ ...next, latexmkPath: path.join(f.bin, 'another-missing-latexmk') }));
  assert.deepEqual(await fs.readFile(f.service.file), before);
});

test('Check setup runs only bounded version commands with no inherited account or secret environment', async () => {
  const f = await fixture(), previous = process.env.TEST_SETUP_SECRET; process.env.TEST_SETUP_SECRET = 'synthetic-do-not-inherit';
  try {
    const result = await f.service.check(f.settings); assert.equal(result.ready, true); assert.equal(result.checks.length, 7);
    const codex = JSON.parse(await fs.readFile(path.join(f.runtime, 'setup-check', 'codex-probe.json'), 'utf8'));
    assert.deepEqual(codex.args, ['--version']); assert.equal(codex.secret, null); assert.equal(codex.home, path.join(f.runtime, 'setup-check'));
    const tex = JSON.parse(await fs.readFile(path.join(f.runtime, 'setup-check', 'latexmk-probe.json'), 'utf8'));
    assert.deepEqual(tex.args, ['-norc', '-v']);
    await assert.rejects(fs.access(f.service.file)); // Checking does not save candidate paths.
  } finally { if (previous === undefined) delete process.env.TEST_SETUP_SECRET; else process.env.TEST_SETUP_SECRET = previous; }
});

test('unsupported Codex versions remain blocked; missing optional engines are distinguished from required tools', async () => {
  const f = await fixture(); await fs.writeFile(f.settings.codexPath, '#!/usr/bin/env node\nconsole.log("codex-cli 99.0.0");\n', { mode: 0o700 });
  let result = await f.service.check(f.settings); assert.equal(result.ready, false); assert.equal(result.checks[0].ok, false);
  assert.match(result.checks[0].message, /supports tested Codex/);
  assert.equal(result.checks[0].version, 'codex-cli 99.0.0');
  await fs.writeFile(f.settings.codexPath, `#!/usr/bin/env node\nconsole.log("codex-cli ${verifiedCodexVersions[0]}");\n`, { mode: 0o700 });
  await fs.unlink(path.join(f.bin, 'lualatex')); await fs.unlink(path.join(f.bin, 'xelatex'));
  result = await f.service.check(f.settings); assert.equal(result.ready, true);
  assert.equal(result.checks.find(c => c.tool === 'lualatex')?.required, false);
  await fs.unlink(path.join(f.bin, 'synctex'));
  result = await f.service.check(f.settings); assert.equal(result.ready, false);
});

test('copied setup details include recognisable tool versions and exclude free-form output, paths and account data', () => {
  const outputs: Record<SetupTool, string> = {
    codex: 'codex-cli 0.114.0',
    latexmk: 'Latexmk, John Collins, 15 June 2025. Version 4.87a',
    pdflatex: 'pdfTeX 3.141592653-2.6-1.40.28 (TeX Live 2026)',
    lualatex: 'This is LuaHBTeX, Version 1.22.0 (TeX Live 2026)',
    xelatex: 'XeTeX 3.141592653-2.6-0.999997 (TeX Live 2026)',
    kpsewhich: 'kpathsea version 6.4.1',
    synctex: 'This is SyncTeX command line utility, version 1.5'
  };
  const checks: ToolCheck[] = (Object.keys(outputs) as SetupTool[]).map(tool => ({ tool, path: '/Users/private-account/Papers/secret-paper/' + tool, required: true, ok: true, version: outputs[tool] + '\nAccount: private@example.invalid\n/private/manuscript.tex', message: 'Manuscript words and account=synthetic-secret' }));
  const details = formatSetupDetails({ editorVersion: '0.2.0', platform: 'darwin', osVersion: '26.0' }, { ready: true, checks });
  for (const expected of ['Editor version: 0.2.0', 'OS: macOS 26.0', 'Codex CLI: 0.114.0', 'latexmk: 4.87a', 'pdfLaTeX: 3.141592653-2.6-1.40.28 (TeX Live 2026)', 'LuaLaTeX: 1.22.0 (TeX Live 2026)', 'XeLaTeX: 3.141592653-2.6-0.999997 (TeX Live 2026)', 'kpsewhich: 6.4.1', 'SyncTeX: 1.5']) assert(details.includes(expected), expected);
  assert.doesNotMatch(details, /John Collins|June|Users|secret-paper|private|@|manuscript|synthetic-secret|[\\/]/i);
  assert.equal(details.split('\n').length, 10);
});

test('copied setup details report unavailable and unsupported tools without copying their failure diagnostics', () => {
  const result: SetupCheck = { ready: false, checks: [
    { tool: 'codex', path: '/private/codex', required: true, ok: false, version: 'codex-cli 99.0.0', message: 'Account private@example.invalid is unsupported' },
    { tool: 'latexmk', path: '/private/latexmk', required: true, ok: false, version: 'Read /Users/private-account/manuscript.tex', message: 'Read access denied: /Users/private-account' },
    { tool: 'xelatex', path: '/private/xelatex', required: false, ok: false, version: null, message: 'Missing /private/tex/bin' }
  ] };
  const details = formatSetupDetails({ editorVersion: '/private/0.2.0', platform: '/private/machine', osVersion: '26.0\nprivate@example.invalid' }, result);
  assert.match(details, /Editor version: unavailable/);
  assert.match(details, /OS: Other operating system unavailable/);
  assert.match(details, /Codex CLI: 99\.0\.0; needs attention/);
  assert.match(details, /latexmk: version unavailable; needs attention/);
  assert.match(details, /XeLaTeX: version unavailable; optional tool unavailable/);
  assert.doesNotMatch(details, /private|Users|manuscript|@|[\\/]/i);
});

test('a hanging setup executable is stopped before reporting its timeout', { timeout: 6000 }, async () => {
  const f = await fixture(); await fs.writeFile(f.settings.codexPath, '#!/usr/bin/env node\nsetInterval(()=>{},1000);\n', { mode: 0o700 });
  const result = await f.service.check(f.settings);
  assert.equal(result.checks[0].ok, false); assert.match(result.checks[0].message, /timed out.*stopped/);
});

test('live services refuse executable changes during work and retain existing PDFs after an idle update', { timeout: 6000 }, async () => {
  const f = await fixture(), codexBinary = path.join(f.bin, 'codex-fixture.mjs'), compilerBinary = path.join(f.bin, 'compiler-fixture.mjs');
  await fs.copyFile('tests/fixtures/fake-codex.mjs', codexBinary); await fs.chmod(codexBinary, 0o700);
  await fs.copyFile('tests/fixtures/stub-compiler.mjs', compilerBinary); await fs.chmod(compilerBinary, 0o700);
  const client = new CodexClient(path.join(f.runtime, 'codex'), codexBinary);
  const pendingCodex = client.checkIsolation();
  assert.equal(client.isBusy, true); assert.throws(() => client.setBinary(f.settings.codexPath), /Finish or stop Codex/);
  try { await pendingCodex; } finally { await client.stop(); }
  assert.equal(client.isBusy, false); client.setBinary(f.settings.codexPath); assert.equal(client.binary, f.settings.codexPath);
  const pid = Number(await fs.readFile(path.join(f.runtime, 'codex', 'server.pid'), 'utf8'));
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  const paper = path.join(f.root, 'paper'); await fs.mkdir(paper); await fs.writeFile(path.join(paper, 'main.tex'), 'Original source');
  const projects = new ProjectService(f.runtime), project = await projects.open(path.join(paper, 'main.tex'));
  const compiler = new CompileService(projects, path.join(f.runtime, 'builds'), compilerBinary, 2000);
  try {
    const pendingBuild = compiler.compile(project.id, 'OK', 'pdflatex');
    assert.equal(compiler.isBusy, true); assert.throws(() => compiler.setLatexmk(f.settings.latexmkPath), /Finish compilation/);
    const build = await pendingBuild; assert.equal(build.success, true);
    assert.equal(compiler.isBusy, false); compiler.setLatexmk(f.settings.latexmkPath);
    assert.equal(compiler.latexmk, f.settings.latexmkPath);
    assert.equal(Buffer.from(await compiler.pdf(build.id)).subarray(0, 5).toString(), '%PDF-');
    assert.equal(await fs.readFile(path.join(paper, 'main.tex'), 'utf8'), 'Original source');
  } finally { await compiler.stop(); }
});
