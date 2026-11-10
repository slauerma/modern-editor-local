// Isolated native UI test. Synthetic text, real persistence, controlled model replies.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(repo, 'package.json'));
const args = process.argv.slice(2); assert(args.length === 2 && args[0] === '--playwright-package');
const { _electron } = createRequire(path.resolve(args[1]))('playwright');
const root = path.join(repo, '.test-runs', 'anchor-repair-' + Date.now()), copy = path.join(root, 'desktop');
const evidence = process.env.ME_TEST_EVIDENCE || path.join(repo, 'test-evidence', 'anchor-repair-' + Date.now());
await fs.mkdir(copy, { recursive: true }); await fs.mkdir(evidence, { recursive: true });
await fs.cp(path.join(repo, 'dist'), path.join(copy, 'dist'), { recursive: true });
await fs.symlink(path.join(repo, 'node_modules'), path.join(copy, 'node_modules'), 'dir');
await fs.writeFile(path.join(copy, 'package.json'), JSON.stringify({ name: 'anchor-repair-check', version: '1.7.0', main: 'dist/main.cjs', private: true }));
const injection = `
const probe={file:null,calls:[],hold:false,release:null,cancelled:0};
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[probe.file]});
codex.anchorClient.run=async(prompt,schema,progress,effort,fast,reader,config)=>{
  const request=JSON.parse(prompt);probe.calls.push({effort,fast,config,comments:request.comments.length});
  if(probe.hold)await new Promise(resolve=>{probe.release=resolve;});
  return {matches:request.comments.map(c=>({id:c.id,candidateId:1,reason:'Same unchanged passage.'}))};
};
codex.anchorClient.cancel=async()=>{probe.cancelled++;};
CodexClient.prototype.listModels=async()=>['gpt-6-astra','gpt-6-luna'].map(id=>({id,name:id,efforts:['low','medium','high','xhigh','max','ultra'],fast:true,images:true}));
globalThis.__anchorProbe=probe;
`;
await build({ entryPoints: [path.join(repo, 'src/main/index.ts')], outfile: path.join(copy, 'dist/main.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'],
  plugins: [{ name: 'anchor-probe', setup(b) { b.onLoad({ filter: /src\/main\/index\.ts$/ }, async a => ({ contents: await fs.readFile(a.path, 'utf8') + injection, loader: 'ts' })); } }] });
const reader = await build({ stdin: { contents: `
import {EditorView} from '@codemirror/view';
const view=()=>EditorView.findFromDOM(document.querySelector('.source-pane .cm-content'));
window.readAnchorSource=()=>view().state.doc.toString();
window.editAnchorSource=()=>view().dispatch({changes:{from:0,insert:'Changed during repair. '},userEvent:'input.test'});
`, resolveDir: repo }, bundle: true, write: false, format: 'iife', platform: 'browser' });
const text = 'An added introduction. We cite Mesatri for this result.\nThe proof are short.';
const paper = path.join(root, 'paper'); await fs.mkdir(path.join(paper, '.modern-editor'), { recursive: true });
const file = path.join(paper, 'main.txt'); await fs.writeFile(file, text);
const comments = [
  { id: 'name', title: 'Correct the name', explanation: 'The bibliography spells it Maestri.', original: 'Mesatri', replacement: 'Maestri' },
  { id: 'verb', title: 'Use the singular verb', explanation: 'Proof is singular.', original: 'The proof are short.', replacement: 'The proof is short.' },
  { id: 'missing', title: 'Earlier sentence', explanation: 'The original sentence was rewritten.', original: 'A sentence no longer here.', replacement: 'An earlier proposal.' }
].map(c => ({ ...c, from: 0, to: 0, before: '', after: '', validity: 'stale', decision: 'open', packages: [], messages: [] }));
await fs.writeFile(path.join(paper, '.modern-editor/review.json'), JSON.stringify({ schemaVersion: 1, rootFile: 'main.txt', sourceHash: createHash('sha256').update(text).digest('hex'), activeId: 'name', updatedAt: new Date().toISOString(), comments }));
const receipt = { synthetic: true, liveCodex: false, checks: [], rendererErrors: [], processes: [] };
let application, page;
const button = name => page.getByRole('button', { name, exact: true });
const repair = () => button('Repair anchors');
async function poll(fn, label, ms = 20000) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await new Promise(r => setTimeout(r, 80)); } throw Error('Timed out: ' + label); }
async function shot(name) { await page.screenshot({ path: path.join(evidence, name + '.png') }); }
async function open() {
  await application.evaluate((_, file) => { globalThis.__anchorProbe.file = file; }, file);
  await button('Open a LaTeX or text file').click(); await page.locator('.source-pane .cm-content').waitFor();
  await page.evaluate(reader.outputFiles[0].text);
  if (await button('Dismiss notice').count()) await button('Dismiss notice').click();
}
try {
  application = await _electron.launch({ executablePath: require('electron'), args: [copy], cwd: repo, env: { ...process.env, MODERN_EDITOR_RUNTIME_DIR: path.join(root, 'runtime') }, chromiumSandbox: true, timeout: 25000 });
  const child = application.process(); receipt.processes.push({ pid: child.pid, exited: false }); console.log('Owned Electron PID', child.pid);
  page = await application.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', e => receipt.rendererErrors.push(String(e)));
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 920));
  await open(); assert(await button('Accept').isDisabled()); await shot('01-repair-anchors');
  await repair().click(); await poll(() => button('Accept').isEnabled(), 'repaired placement');
  await poll(() => page.locator('footer').innerText().then(s => /2 anchors repaired.*1 still need checking/.test(s)), 'repair persisted and status settled');
  assert.equal(await page.evaluate(() => window.readAnchorSource()), text);
  assert.deepEqual(await application.evaluate(() => globalThis.__anchorProbe.calls[0]), { effort: 'high', fast: true, config: { purpose: 'anchors', model: 'gpt-6.1-sol' }, comments: 2 });
  await shot('02-repaired'); await button('Undo').click(); await repair().waitFor(); assert(await button('Accept').isDisabled());
  receipt.checks.push('Repair is beside the warning, restores exact placements in one batch with Sol High Fast, leaves source unchanged, and Undo restores disabled acceptance.');

  await application.evaluate(() => { globalThis.__anchorProbe.hold = true; });
  await repair().click(); await poll(() => application.evaluate(() => !!globalThis.__anchorProbe.release), 'held request');
  await page.evaluate(() => window.editAnchorSource());
  await application.evaluate(() => { globalThis.__anchorProbe.release(); globalThis.__anchorProbe.release = null; });
  await page.getByRole('alert').filter({ hasText: 'source changed during anchor repair' }).waitFor();
  assert(await button('Accept').isDisabled()); await button('Dismiss error').click(); await button('Undo').click();
  await repair().click(); await poll(() => application.evaluate(() => !!globalThis.__anchorProbe.release), 'second held request');
  await button('Stop anchor repair').click();
  await application.evaluate(() => { globalThis.__anchorProbe.release(); globalThis.__anchorProbe.release = null; globalThis.__anchorProbe.hold = false; });
  await poll(() => repair().isEnabled(), 'cancelled request settled'); assert(await button('Accept').isDisabled());
  receipt.checks.push('An edit during repair rejects the old result; Stop anchor repair discards a late successful reply.');
  await page.locator('.review-nav .comment-details > button').click(); await button('Repair anchors (3)').click();
  await poll(() => button('Accept').isEnabled(), 'repair from Details');
  await button('Next comment').click(); await button('Next comment').click();
  assert.match(await page.locator('.stale-notice').innerText(), /original words have changed or are missing/);
  assert(await button('Accept').isDisabled());
  await button('Previous comment').click(); await button('Previous comment').click();

  await button('Review with Codex').click(); const instructions = page.getByLabel('Instructions for this review'); await instructions.fill('Keep this unfinished review request.');
  await page.getByLabel('Model, effort and speed', {exact:true}).click();
  await poll(() => page.getByLabel('Review model', {exact:true}).isEnabled(), 'review model catalog');
  await button('Choose review model').click(); await page.getByRole('dialog', { name: 'Settings', exact: true }).waitFor();
  await poll(() => page.locator('#codex-model').evaluate(e => document.activeElement === e), 'focused model selector');
  await button('Load models').click(); await poll(() => page.locator('#codex-model option').count().then(n => n === 3), 'controlled model catalog');
  await page.locator('#codex-model').selectOption('gpt-6-astra'); await button('Save settings').click();
  await page.getByText('Settings saved.', { exact: true }).waitFor(); await shot('03-review-model-choice');
  await button('Close').click(); assert.equal(await instructions.inputValue(), 'Keep this unfinished review request.');
  await poll(() => page.getByLabel('Model, effort and speed', {exact:true}).innerText().then(s => s.includes('gpt-6-astra')), 'current model label');
  await button('Choose review model').click(); await poll(() => page.locator('#codex-model').inputValue().then(v => v === 'gpt-6-astra'), 'saved model');
  await button('Close').click(); await button('Close review request').click();
  await button('Actions ▾').click();
  await poll(() => button('Choose review model').innerText().then(s => s.includes('gpt-6-astra')), 'Actions model label');
  await page.locator('summary').filter({hasText:'Codex effort'}).click();
  await poll(() => page.getByLabel('Codex effort',{exact:true}).isEnabled(), 'effort catalog');
  assert.deepEqual(await page.getByLabel('Codex effort',{exact:true}).locator('option').allTextContents(), ['Low','Medium','High','Extra high','Max','Ultra']);
  assert.match(await page.getByLabel('Codex effort',{exact:true}).locator('..').innerText(), /gpt-6-astra/);
  await shot('04-model-and-standard-effort'); await page.keyboard.press('Escape');
  receipt.checks.push('Review → Model opens and focuses the existing selector. Choosing and saving Astra preserves the review instructions and persists the choice. Actions displays the model and standard effort labels. Catalog is controlled, no live model lookup.');

  await button('Actions ▾').click(); await button('Close project').click(); await button('Close and keep data').click(); await button('Open a LaTeX or text file').waitFor(); await open();
  assert(await button('Accept').isEnabled()); assert.equal(await fs.readFile(file, 'utf8'), text);
  assert.deepEqual(receipt.rendererErrors, []); receipt.passed = true;
  receipt.checks.push('Repaired anchors survive close/reopen, with the disk manuscript unchanged and no renderer exceptions.');
} catch (error) { receipt.passed = false; receipt.failure = String(error.stack ?? error); try { await shot('failure'); } catch {} throw error; }
finally {
  if (application) { const child = application.process(); await application.close(); await poll(async () => child.exitCode !== null || child.signalCode !== null, 'owned Electron exit'); receipt.processes.find(p => p.pid === child.pid).exited = true; console.log('Owned Electron exited', child.pid); }
  await fs.writeFile(path.join(evidence, 'results.json'), JSON.stringify(receipt, null, 2)); console.log('Evidence', evidence);
  if (receipt.passed && !evidence.startsWith(root + path.sep)) await fs.rm(root, { recursive: true, force: true });
}
