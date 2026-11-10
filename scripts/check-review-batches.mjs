// Native UI regression with controlled batches; no account or real paper.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(repo, 'package.json'));
assert(process.argv.length === 4 && process.argv[2] === '--playwright-package');
const { _electron } = createRequire(path.resolve(process.argv[3]))('playwright');
const root = path.join(repo, '.test-runs', 'review-batches-' + Date.now()), copy = path.join(root, 'desktop');
const evidence = process.env.ME_TEST_EVIDENCE || path.join(root, 'evidence');
await fs.mkdir(copy, { recursive: true }); await fs.mkdir(evidence, { recursive: true });
await fs.cp(path.join(repo, 'dist'), path.join(copy, 'dist'), { recursive: true });
await fs.symlink(path.join(repo, 'node_modules'), path.join(copy, 'node_modules'), 'dir');
await fs.writeFile(path.join(copy, 'package.json'), JSON.stringify({ name: 'review-batch-check', version: '1.7.0', main: 'dist/main.cjs', private: true }));
const injection = `
const probe={file:null,calls:0,publish:null,finish:null,stop:null,catalog:0,upgrade:false,failCatalog:false};
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[probe.file]});
codex.client.run=async(prompt,schema,progress,effort,fast,reader)=>{
  probe.calls++;probe.publish=comments=>reader.call('publish_comments',{comments});
  try {return await new Promise((resolve,reject)=>{probe.finish=comments=>resolve({comments});probe.stop=()=>reject(Error('Codex review cancelled.'));});}
  finally {await reader.cancel();probe.publish=null;probe.finish=null;probe.stop=null;}
};
codex.client.cancel=async()=>{probe.stop?.();};
CodexClient.prototype.listModels=async()=>{
  probe.catalog++;if(probe.failCatalog)throw Error('Synthetic catalog unavailable');
  return ['gpt-6.1-sol','gpt-6-astra','gpt-6-luna'].map((id,i)=>({id,name:id,isDefault:i===0,efforts:['low','medium','high'],fast:true,images:true,hidden:probe.upgrade&&i===1,upgrade:probe.upgrade&&i===1?'gpt-6.1-sol':null}));
};
globalThis.__batchProbe=probe;
`;
await build({ entryPoints: [path.join(repo, 'src/main/index.ts')], outfile: path.join(copy, 'dist/main.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'],
  plugins: [{ name: 'batch-probe', setup(b) { b.onLoad({ filter: /src\/main\/index\.ts$/ }, async a => ({ contents: await fs.readFile(a.path, 'utf8') + injection, loader: 'ts' })); } }] });
const draft = 'The proof are short. The result are useful. The claim are clear.';
const paper = path.join(root, 'paper'); await fs.mkdir(paper, { recursive: true });
const file = path.join(paper, 'main.txt'); await fs.writeFile(file, draft);
const comment = (original, replacement) => ({ category: 'Grammar', title: original, explanation: 'Use singular agreement.', original, replacement, before: '', after: '', packages: [] });
const first = comment('proof are', 'proof is'), second = comment('result are', 'result is'), third = comment('claim are', 'claim is');
const receipt = { synthetic: true, liveCodex: false, checks: [], rendererErrors: [], processes: [] };
let application, page;
const button = name => page.getByRole('button', { name, exact: true }).first();
const poll = async (check, label) => { const end = Date.now() + 15000; while (Date.now() < end) { if (await check()) return; await new Promise(r => setTimeout(r, 80)); } throw Error('Timed out: ' + label); };
const source = () => page.locator('.source-pane .cm-content').innerText();
const shot = name => page.screenshot({ path: path.join(evidence, name + '.png') });
try {
  application = await _electron.launch({ executablePath: require('electron'), args: [copy], cwd: repo, env: { ...process.env, MODERN_EDITOR_RUNTIME_DIR: path.join(root, 'runtime') }, chromiumSandbox: true });
  const child = application.process(); receipt.processes.push({ pid: child.pid, exited: false }); console.log('Owned Electron PID', child.pid);
  page = await application.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', e => receipt.rendererErrors.push(String(e)));
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 920));
  await application.evaluate((_, file) => { globalThis.__batchProbe.file = file; }, file);
  await button('Open a LaTeX or text file').click(); await page.locator('.source-pane .cm-content').waitFor();
  if (await button('Dismiss notice').count()) await button('Dismiss notice').click();
  await button('Review with Codex').click(); await page.getByLabel('Instructions for this review').fill('Keep my wording.');
  const updates = button('Add suggestions as they arrive'); assert.equal(await updates.getAttribute('aria-pressed'), 'true');
  await page.getByLabel('Model, effort and speed', { exact: true }).click();
  await poll(() => page.getByLabel('Review model', { exact: true }).isEnabled(), 'catalog');
  await page.getByLabel('Review model', { exact: true }).selectOption('gpt-6-astra');
  await poll(() => button('Refresh models').isEnabled(), 'saved selection');
  await application.evaluate(() => { globalThis.__batchProbe.upgrade = true; });
  await button('Refresh models').click(); await button('Choose gpt-6.1-sol').waitFor();
  assert.equal(await page.getByLabel('Review model', { exact: true }).inputValue(), 'gpt-6-astra');
  assert.equal(await page.getByLabel('Instructions for this review').inputValue(), 'Keep my wording.');
  await shot('01-model-refresh-notice');
  await button('Choose gpt-6.1-sol').click();
  await poll(() => page.getByLabel('Review model', { exact: true }).inputValue().then(v => v === 'gpt-6.1-sol'), 'explicit replacement');
  await poll(() => button('Refresh models').isEnabled(), 'replacement saved');
  assert.equal(await page.getByLabel('Review model', { exact: true }).locator('option[value="gpt-6-astra"]').count(), 0);
  await application.evaluate(() => { globalThis.__batchProbe.failCatalog = true; });
  await button('Refresh models').click(); await page.getByText('Synthetic catalog unavailable', { exact: false }).waitFor();
  assert.equal(await page.getByLabel('Review model', { exact: true }).inputValue(), 'gpt-6.1-sol');
  await application.evaluate(() => { globalThis.__batchProbe.failCatalog = false; });
  await button('Retry').click(); await poll(() => button('Start review').isEnabled(), 'refreshed');
  receipt.checks.push('Refresh shows migration metadata without changing model or instructions; explicit replacement persists; hidden alternatives stay hidden; failed refresh preserves selection.');
  await button('Start review').click(); await page.getByLabel('Review progress and controls', { exact: true }).waitFor();
  await poll(() => application.evaluate(() => typeof globalThis.__batchProbe.publish === 'function'), 'review tool ready');
  await application.evaluate(async (_, c) => { await globalThis.__batchProbe.publish([c]); }, first);
  await page.getByText('proof are', { exact: true }).first().waitFor();
  assert.equal(await source(), draft);
  await page.getByLabel('Review progress and controls', { exact: true }).click();
  const runningUpdates = page.locator('.review-progress-popover').getByRole('button', { name: 'Add suggestions as they arrive', exact: true });
  await runningUpdates.click(); assert.equal(await runningUpdates.getAttribute('aria-pressed'), 'false');
  await application.evaluate(async (_, c) => { await globalThis.__batchProbe.publish([c]); }, second);
  await poll(() => page.getByRole('button', { name: /1 Codex results waiting/ }).count().then(n => n > 0), 'waiting batch while off');
  assert(await button('Accept').isEnabled());
  await runningUpdates.click();
  await poll(() => page.locator('.waiting-alert').count().then(n => n === 0), 'batch adopted');
  assert(await page.getByText('proof are', { exact: true }).first().isVisible());
  await button('Accept').click(); await poll(() => source().then(t => t === draft.replace('proof are', 'proof is')), 'accepted early suggestion');
  await page.getByText('result are', { exact: true }).first().waitFor();
  await page.locator('.review-progress-popover').getByRole('button', { name: 'Stop review', exact: true }).waitFor();
  await shot('02-live-batch-toggle');
  await button('Reject').click();
  await application.evaluate(async (_, c) => { await globalThis.__batchProbe.publish([c]); }, third);
  await page.getByText('claim are', { exact: true }).first().waitFor();
  await button('Stop review').click(); await poll(() => button('Review with Codex').isEnabled(), 'stopped');
  assert(await button('Accept').isDisabled());
  assert(await page.getByText('This suggestion needs its passage confirmed before Accept.').isVisible());
  assert.equal(await source(), draft.replace('proof are', 'proof is'));
  assert.equal(await fs.readFile(file, 'utf8'), draft);
  await shot('03-stopped-batches-retained');
  receipt.checks.push('First batch is usable before final response; toggle-off holds results, toggle-on adds them without moving selection; accepted/rejected decisions survive later arrivals; Stop preserves received comments. Later batches against the earlier draft require confirmation, and source stays unsaved.');
  assert.deepEqual(receipt.rendererErrors, []); receipt.passed = true;
} catch (error) {
  receipt.passed = false; receipt.failure = String(error.stack ?? error); try { await shot('failure'); } catch {}
  throw error;
} finally {
  if (application) { const child = application.process(); await application.close(); await poll(async () => child.exitCode !== null || child.signalCode !== null, 'owned Electron exit'); receipt.processes[0].exited = true; }
  await fs.writeFile(path.join(evidence, 'results.json'), JSON.stringify(receipt, null, 2)); console.log('Evidence', evidence);
  if (receipt.passed && !evidence.startsWith(root + path.sep)) await fs.rm(root, { recursive: true, force: true });
}
