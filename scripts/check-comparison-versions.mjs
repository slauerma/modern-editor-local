// Isolated desktop/profile and synthetic documents. Real paste, IPC and storage;
// controlled model replies. Does not open the author's paper or normal profile.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(repo, 'package.json')), args = process.argv.slice(2);
assert(args.length === 2 && args[0] === '--playwright-package');
const { _electron } = createRequire(path.resolve(args[1]))('playwright');
const root = path.join(repo, '.test-runs', 'comparison-versions-ui-' + Date.now()), copy = path.join(root, 'desktop');
const evidence = process.env.ME_TEST_EVIDENCE || path.join(root, 'evidence');
await fs.mkdir(copy, { recursive: true }); await fs.mkdir(evidence, { recursive: true });
await fs.cp(path.join(repo, 'dist'), path.join(copy, 'dist'), { recursive: true });
await fs.symlink(path.join(repo, 'node_modules'), path.join(copy, 'node_modules'), 'dir');
await fs.writeFile(path.join(copy, 'package.json'), JSON.stringify({ name: 'comparison-versions-check', version: '1.7.0', main: 'dist/main.cjs', private: true }));
const injection = [
  'const comparisonProbe={file:null,id:null,requests:0};',
  'dialog.showOpenDialog=async()=>({canceled:false,filePaths:[comparisonProbe.file]});',
  'const openOriginal=projects.open.bind(projects);projects.open=async(...args)=>{const p=await openOriginal(...args);comparisonProbe.id=p.id;return p;};',
  "CodexClient.prototype.listModels=async()=>[{id:'gpt-6.1-sol',name:'GPT-6.1 Sol',isDefault:true,efforts:['low','medium','high','xhigh','max','ultra'],fast:true,images:true}];",
  "codex.run=async()=>{comparisonProbe.requests++;return {comments:[]};};",
  'comparisonProbe.state=()=>projects.comparisonVersions(comparisonProbe.id);',
  'globalThis.__comparisonVersionsProbe=comparisonProbe;'
].join('\n');
await build({ entryPoints: [path.join(repo, 'src/main/index.ts')], outfile: path.join(copy, 'dist/main.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'],
  plugins: [{ name: 'comparison-probe', setup(b) { b.onLoad({ filter: /src\/main\/index\.ts$/ }, async a => ({ contents: await fs.readFile(a.path, 'utf8') + '\n' + injection, loader: 'ts' })); } }] });
const accessor = await build({ stdin: { contents: "import {EditorView} from '@codemirror/view';import {undoDepth} from '@codemirror/commands';const view=()=>EditorView.findFromDOM(document.querySelector('.source-pane .cm-content'));window.readSource=()=>({text:view().state.doc.toString(),undo:undoDepth(view().state)});", resolveDir: repo }, bundle: true, write: false, format: 'iife', platform: 'browser' });
const file = path.join(root, 'report.txt');
await fs.writeFile(file, '');
const original = 'Draft notes\n\nThe allocation are monotone. The argument is clear.\n\nThe proof needs one additional explanation.\n';
const beforeReview = original + '\nA preliminary note before asking for review.\n';
const nextReview = beforeReview.replace('are monotone', 'is monotone');
const final = nextReview + '\nA final paragraph added after the second review.\n';
const result = { runDirectory: root, synthetic: true, liveCodex: false, checks: [], rendererErrors: [], processes: [] };
let app, page;
const button = name => page.getByRole('button', { name, exact: true });
const state = () => app.evaluate(() => globalThis.__comparisonVersionsProbe.state());
const source = () => page.evaluate(() => window.readSource());
const picker = () => page.getByRole('dialog', { name: 'Comparison versions' });
async function poll(fn, label, ms = 15000) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await new Promise(r => setTimeout(r, 80)); } throw Error('Timed out: ' + label); }
async function shot(name) { await page.screenshot({ path: path.join(evidence, name + '.png') }); }
async function paste(text) {
  await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), text);
  await page.locator('.source-pane .cm-content').focus();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V');
  await poll(async () => (await source()).text === text, 'real paste');
}
async function runReview() {
  const count = await app.evaluate(() => globalThis.__comparisonVersionsProbe.requests);
  await page.getByLabel('Review with Codex', { exact: true }).click();
  await page.getByLabel('Request Codex review', { exact: true }).getByRole('button', { name: 'Start review', exact: true }).click();
  await poll(async () => await app.evaluate(() => globalThis.__comparisonVersionsProbe.requests) === count + 1, 'review sent');
  await poll(() => page.getByLabel('Review with Codex', { exact: true }).isEnabled(), 'review finished');
}
async function launch(resume = false) {
  app = await _electron.launch({ executablePath: require('electron'), args: [copy], cwd: repo, env: { ...process.env, MODERN_EDITOR_RUNTIME_DIR: path.join(root, 'runtime') }, chromiumSandbox: true, timeout: 25000 });
  result.processes.push({ pid: app.process().pid, exited: false });
  console.log('Owned Electron PID', app.process().pid);
  page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', e => result.rendererErrors.push(String(e)));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1450, 1000));
  if (!resume) { await app.evaluate((_, file) => { globalThis.__comparisonVersionsProbe.file = file; }, file); await button('Open a LaTeX or text file').click(); }
  await page.locator('.source-pane .cm-content').waitFor();
  await page.evaluate(accessor.outputFiles[0].text);
}
async function close() {
  const child = app.process(); await app.close();
  await poll(async () => child.exitCode !== null || child.signalCode !== null, 'Electron exit');
  Object.assign(result.processes.at(-1), { exited: true, exitCode: child.exitCode });
  console.log('Owned Electron exited', child.pid); app = null;
}
try {
  await launch();
  await paste(original); await poll(async () => (await state()).baseline?.text === original, 'original retained');
  assert.equal(await fs.readFile(file, 'utf8'), '');
  assert.equal(await page.locator('.text-diff-host .cm-deletedChunk').count(), 0);
  result.checks.push('A real clipboard paste into a blank .txt draft is retained and selected without Save.');
  await paste(beforeReview); await runReview(); await paste(nextReview); await runReview(); await paste(final);
  await poll(async () => (await state()).versions.length === 3, 'two review checkpoints');
  assert.equal((await state()).baseline.text, original);
  const beforePicking = await source();
  await button('Choose comparison version').click(); await picker().waitFor(); await shot('01-versions');
  await picker().locator('.comparison-version').filter({ hasText: 'Before first review' }).click();
  assert.equal((await state()).baseline.text, beforeReview); assert.deepEqual(await source(), beforePicking);
  await button('Choose comparison version').click();
  await picker().locator('.comparison-version').filter({ hasText: 'Before review 2' }).click();
  assert.equal((await state()).baseline.text, nextReview); assert.deepEqual(await source(), beforePicking);
  assert.match(await page.locator('.viewer-caption').textContent(), /Before review 2.*Current draft/);
  await shot('02-selected-review');
  result.checks.push('Original and both pre-review drafts are directly selectable; current source and Undo are unchanged.');
  await button('Choose comparison version').click(); await picker().getByLabel('Comparison version name').fill('Before shortening');
  await picker().getByRole('button', { name: 'Keep this version', exact: true }).click();
  assert.equal((await state()).baseline.text, final);
  await button('Choose comparison version').click(); await picker().locator('.comparison-version').filter({ hasText: 'Before review 2' }).click();
  await button('Save').click(); await poll(async () => await fs.readFile(file, 'utf8') === final, 'saved text');
  await button('Choose comparison version').click(); await picker().getByRole('button', { name: 'Saved versions…', exact: true }).click();
  await picker().getByLabel('Saved source version', { exact: true }).waitFor();
  await poll(async () => await picker().getByLabel('Saved source version', { exact: true }).locator('option').count() === 2, 'txt history');
  assert.equal(await picker().locator('.error').count(), 0);
  await shot('03-saved-history'); await button('Close comparison versions').click();
  result.checks.push('Named versions and .txt save history are available inside the column without a layout switch.');
  await close(); await launch(true);
  assert.equal((await state()).baseline.text, nextReview); assert.equal((await source()).text, final);
  await poll(async () => (await page.locator('.viewer-caption').textContent()).includes('Before review 2'), 'reopened comparison');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1120, 760));
  await page.getByRole('tab', { name: 'Text diff', exact: true }).click();
  await button('Choose comparison version').click(); await picker().waitFor();
  await shot('04-reopened-compact');
  const bounds = await picker().evaluate(el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, bottom: r.bottom, width: innerWidth, height: innerHeight, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }; });
  assert(bounds.left >= 0 && bounds.right <= bounds.width && bounds.bottom <= bounds.height && bounds.scrollWidth <= bounds.clientWidth);
  await page.keyboard.press('Escape'); assert.equal(await picker().count(), 0);
  assert(await button('Choose comparison version').evaluate(el => el === document.activeElement));
  result.checks.push('Selected reference survives a full app restart; compact picker fits, Escape closes it and restores focus.');
  assert.deepEqual(result.rendererErrors, []); result.passed = true;
} catch (error) { result.passed = false; result.failure = String(error.stack ?? error); try { await shot('failure'); } catch {} throw error; }
finally {
  if (app) await close();
  await fs.writeFile(path.join(evidence, 'results.json'), JSON.stringify(result, null, 2));
  if (result.passed && !evidence.startsWith(root + path.sep)) await fs.rm(root, { recursive: true, force: true });
}
