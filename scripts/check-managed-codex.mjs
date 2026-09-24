// Isolated Electron setup check: no paper, sign-in, model request or user settings.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url)), require = createRequire(path.join(repo, 'package.json'));
const args = process.argv.slice(2);
assert(args.length === 0 || args.length === 2 && args[0] === '--playwright-package');
const { _electron } = (args.length ? createRequire(path.resolve(args[1])) : require)('playwright');
const root = path.join(repo, '.test-runs', 'managed-cli-desktop-' + Date.now()), copy = path.join(root, 'App copy with spaces');
await fs.mkdir(copy, { recursive: true });
await fs.cp(path.join(repo, 'dist'), path.join(copy, 'dist'), { recursive: true });
await fs.copyFile(path.join(repo, 'package.json'), path.join(copy, 'package.json'));
// Resolve dependencies from a relocated app root while the launch cwd stays different.
await fs.symlink(path.join(repo, 'node_modules'), path.join(copy, 'node_modules'), 'dir');
const receipt = { checks: [], errors: [], passed: false, noModelRequests: true };
let application;
const poll = async (fn, label) => { const until = Date.now() + 20000; while (Date.now() < until) { if (await fn()) return; await new Promise(r => setTimeout(r, 60)); } throw new Error('Timed out: ' + label); };
try {
  application = await _electron.launch({ executablePath: require('electron'), args: [copy], cwd: repo,
    env: { ...process.env, MODERN_EDITOR_RUNTIME_DIR: path.join(root, 'runtime') }, chromiumSandbox: true, timeout: 25000 });
  const child = application.process(); receipt.pid = child.pid;
  const page = await application.firstWindow(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => receipt.errors.push(String(error)));
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1450, 1000));
  await page.getByText(/By Stephan Lauermann.*Kevin Bryan/).waitFor();
  await page.screenshot({ path: path.join(root, 'home.png'), scale: 'css' });
  const setup = await page.evaluate(() => window.editor.getSetup());
  assert.equal(setup.settings.codexSource, 'managed');
  assert(setup.settings.codexPath.startsWith(copy + path.sep));
  assert.equal(setup.settings.codexPath, setup.managedCodex.path);
  receipt.checks.push('Relocated app uses its own managed binary; home credits visible');
  await application.evaluate(({ Menu, BrowserWindow }) => { const item = Menu.getApplicationMenu().items[0].submenu.items.find(item => item.label === 'Settings…'); item.click(item, BrowserWindow.getAllWindows()[0], {}); });
  const panel = page.getByRole('dialog', { name: 'Settings', exact: true });
  const installation = panel.getByLabel('Codex installation', { exact: true });
  await poll(() => installation.isEnabled(), 'settings loaded');
  assert.equal(await installation.inputValue(), 'managed');
  assert.equal(await panel.getByLabel('Codex executable', { exact: true }).count(), 0);
  await panel.getByRole('button', { name: 'Check setup', exact: true }).click();
  await poll(() => panel.getByRole('button', { name: 'Check setup', exact: true }).isEnabled(), 'setup version check');
  assert.match(await panel.locator('.settings-results li').first().innerText(), new RegExp('codex-cli ' + setup.managedCodex.version.replaceAll('.', '\\.')));
  assert.equal(await panel.locator('.settings-results li').first().locator('.settings-pass').count(), 1);
  receipt.checks.push('Managed CLI version check reaches the real native binary without a model call');
  await installation.selectOption('custom');
  assert.equal(await panel.getByLabel('Codex executable', { exact: true }).inputValue(), setup.managedCodex.path);
  await panel.getByRole('button', { name: 'Save settings', exact: true }).click();
  await panel.getByText('Settings saved.', { exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.editor.getSetup())).settings.codexSource, 'custom');
  await installation.selectOption('managed');
  await panel.getByRole('button', { name: 'Save settings', exact: true }).click();
  await panel.getByText('Settings saved.', { exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.editor.getSetup())).settings.codexSource, 'managed');
  receipt.checks.push('Custom/managed selection and save work through UI and IPC');
  await page.screenshot({ path: path.join(root, 'settings.png'), scale: 'css' });
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  await application.evaluate(({ Menu, BrowserWindow }) => { const item = Menu.getApplicationMenu().items.find(item => item.label === 'View').submenu.items.find(item => item.label === 'Help and shortcuts…'); item.click(item, BrowserWindow.getAllWindows()[0], {}); });
  const help = page.getByRole('dialog', { name: 'Help', exact: true });
  await help.getByText(/By Stephan Lauermann.*Kevin Bryan/).waitFor();
  await help.getByLabel('Search editor help').fill('managed');
  await help.getByRole('button', { name: /Configure Codex/ }).click();
  await help.getByRole('article', { name: 'Help section' }).getByText('npm run codex:version', { exact: false }).waitFor();
  await page.screenshot({ path: path.join(root, 'help.png'), scale: 'css' });
  receipt.checks.push('Help exposes current managed CLI installation and sign-in instructions');
  await help.getByRole('button', { name: 'Close', exact: true }).click();
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await poll(() => child.exitCode !== null || child.signalCode !== null, 'Electron exit');
  assert.equal(child.exitCode, 0); receipt.exited = true; application = undefined;
  assert.deepEqual(receipt.errors, []); receipt.passed = true;
} catch (error) { receipt.failure = String(error.stack ?? error); throw error; }
finally {
  if (application) { const child = application.process(); await application.close(); await poll(() => child.exitCode !== null || child.signalCode !== null, 'cleanup'); receipt.exited = true; }
  await fs.writeFile(path.join(root, 'results.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log('Evidence', root);
}
