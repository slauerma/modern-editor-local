// Real Electron UI and persistence with controlled, synthetic streamed replies.
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
const root = path.join(repo, '.test-runs', 'chat-suggest-native-' + Date.now()), copy = path.join(root, 'desktop');
const evidence = process.env.ME_TEST_EVIDENCE || path.join(root, 'evidence');
await fs.mkdir(copy, { recursive: true }); await fs.mkdir(evidence, { recursive: true });
await fs.cp(path.join(repo, 'dist'), path.join(copy, 'dist'), { recursive: true });
await fs.symlink(path.join(repo, 'node_modules'), path.join(copy, 'node_modules'), 'dir');
await fs.writeFile(path.join(copy, 'package.json'), JSON.stringify({ name: 'chat-suggest-check', version: '1.7.0', main: 'dist/main.cjs', private: true }));
const injection = `
const probe={file:null,publish:null,finish:null,stop:null,request:null,projectId:null};
const openPaper=projects.open.bind(projects);
projects.open=async(...args)=>{const paper=await openPaper(...args);probe.projectId=paper.id;return paper;};
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[probe.file]});
chatClient.run=async(prompt,schema,progress,effort,fast,reader,options)=>{
  probe.request={context:JSON.parse(prompt),effort,fast,options};
  probe.publish=comments=>reader.call('publish_comments',{comments});
  try {return await new Promise((resolve,reject)=>{probe.finish=suggestions=>resolve({reply:'Ready to review.',suggestions});probe.stop=()=>reject(Error('Chat request cancelled.'));});}
  finally {await reader?.cancel();probe.publish=null;probe.finish=null;probe.stop=null;}
};
chatClient.cancel=async()=>{probe.stop?.();};
CodexClient.prototype.listModels=async()=>['gpt-6.1-sol','gpt-6-astra'].map((id,i)=>({id,name:id,isDefault:i===0,efforts:['low','medium','high'],fast:true,images:true,hidden:false,upgrade:null}));
probe.comments=()=>projects.get(probe.projectId).review.comments;
probe.active=()=>projects.get(probe.projectId).review.activeId;
globalThis.__suggestProbe=probe;
`;
await build({ entryPoints: [path.join(repo, 'src/main/index.ts')], outfile: path.join(copy, 'dist/main.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'],
  plugins: [{ name: 'chat-suggest-probe', setup(b) { b.onLoad({ filter: /src\/main\/index\.ts$/ }, async a => ({ contents: await fs.readFile(a.path, 'utf8') + injection, loader: 'ts' })); } }] });
const draft = 'The proof are short.\n\nThe result are useful.\n\nThe claim are clear.';
const paper = path.join(root, 'paper'); await fs.mkdir(paper, { recursive: true });
const file = path.join(paper, 'main.txt'); await fs.writeFile(file, draft);
const comment = (original, replacement) => ({ title: original, explanation: 'Use singular agreement.', original, replacement, before: '', after: '', packages: [] });
const first = comment('proof are', 'proof is'), second = comment('result are', 'result is'), third = comment('claim are', 'claim is');
const receipt = { synthetic: true, liveCodex: false, checks: [], rendererErrors: [], processes: [] };
let application, page;
const button = name => page.getByRole('button', { name, exact: true }).first();
const poll = async (check, label) => { const end = Date.now() + 15000; while (Date.now() < end) { if (await check()) return; await new Promise(r => setTimeout(r, 80)); } throw Error('Timed out: ' + label); };
const source = async () => (await page.locator('.source-pane .cm-line').allTextContents()).join('\n');
const shot = name => page.screenshot({ path: path.join(evidence, name + '.png') });
const launch = async () => {
  application = await _electron.launch({ executablePath: require('electron'), args: [copy], cwd: repo, env: { ...process.env, MODERN_EDITOR_RUNTIME_DIR: path.join(root, 'runtime') }, chromiumSandbox: true });
  receipt.processes.push({ pid: application.process().pid, exited: false }); console.log('Owned Electron PID', application.process().pid);
  page = await application.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', e => receipt.rendererErrors.push(String(e)));
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1680, 980));
  await application.evaluate((_, file) => { globalThis.__suggestProbe.file = file; }, file);
};
const close = async () => {
  const child = application.process(); await application.close();
  await poll(async () => child.exitCode !== null || child.signalCode !== null, 'owned Electron exit');
  receipt.processes.at(-1).exited = true; application = null;
};
try {
  await launch();
  await button('Open a LaTeX or text file').click(); await page.locator('.source-pane .cm-content').waitFor();
  if (await button('Dismiss notice').count()) await button('Dismiss notice').click();
  // Turn regular review auto-add off: the explicit quick action still adds edits.
  await button('Review with Codex').click();
  await button('Add suggestions as they arrive').click();
  assert.equal(await button('Add suggestions as they arrive').getAttribute('aria-pressed'), 'false');
  await button('Close review request').click();
  await button('Codex Side Chat').click();
  const drawer = page.getByRole('complementary', { name: 'Codex Side Chat', exact: true });
  const handle = await button('Move Side Chat').boundingBox();
  await page.mouse.move(handle.x + 70, handle.y + 12); await page.mouse.down(); await page.mouse.move(100, handle.y + 12, { steps: 8 }); await page.mouse.up();
  await page.getByLabel('Side Chat settings', { exact: true }).click();
  await poll(() => page.getByLabel('Side Chat model', { exact: true }).isEnabled(), 'chat models');
  await page.getByLabel('Side Chat model', { exact: true }).selectOption('gpt-6-astra');
  await page.getByLabel('Side Chat effort', { exact: true }).selectOption('high');
  await page.getByLabel('Side Chat speed', { exact: true }).selectOption('standard');
  await page.getByLabel('Side Chat settings', { exact: true }).click();
  await page.getByLabel('Message to Codex Side Chat', { exact: true }).fill('Correct the three verbs.');
  await button('Suggest edits').click();
  await poll(() => application.evaluate(() => typeof globalThis.__suggestProbe.publish === 'function'), 'quick action ready');
  const request = await application.evaluate(() => globalThis.__suggestProbe.request);
  assert.equal(request.options.model, 'gpt-6.1-sol'); assert.equal(request.effort, 'low'); assert.equal(request.fast, true);
  assert.equal(request.context.application.documentation, undefined);
  await application.evaluate(async (_, c) => { await globalThis.__suggestProbe.publish([c]); }, first);
  await poll(() => button('Accept').isEnabled(), 'first comment usable before completion');
  assert.equal(await source(), draft);
  assert(await drawer.isVisible()); assert(await button('Stop Side Chat').isVisible());
  await shot('01-early-suggestion');
  await application.evaluate(async (_, c) => { await globalThis.__suggestProbe.publish([c]); }, second);
  await poll(() => application.evaluate(() => globalThis.__suggestProbe.comments().length === 2), 'second arrival');
  assert(await application.evaluate(() => globalThis.__suggestProbe.active() === globalThis.__suggestProbe.comments()[0].id));
  await button('Accept').click();
  await poll(() => source().then(t => t === draft.replace('proof are', 'proof is')), 'accept while chat continues');
  await button('Reject').click();
  await application.evaluate(async (_, c) => { await globalThis.__suggestProbe.publish([c]); }, third);
  await button('Stop Side Chat').click(); await poll(() => button('Suggest edits').isEnabled(), 'stop completed');
  await poll(() => application.evaluate(() => globalThis.__suggestProbe.comments().length === 3), 'all partial comments saved');
  assert.deepEqual(await application.evaluate(() => globalThis.__suggestProbe.comments().map(c => c.decision)), ['applied', 'dismissed', 'open']);
  assert.equal(await source(), draft.replace('proof are', 'proof is'));
  assert.equal(await fs.readFile(file, 'utf8'), draft);
  await shot('02-stopped-suggestions-kept');
  // A subsequent final-only reply adds once, preserving the old decisions.
  await page.getByLabel('Message to Codex Side Chat', { exact: true }).fill('Another small edit.');
  await button('Suggest edits').click(); await poll(() => application.evaluate(() => typeof globalThis.__suggestProbe.finish === 'function'), 'second request');
  await application.evaluate((_, comments) => globalThis.__suggestProbe.finish(comments), [comment('short.', 'concise.')]);
  await poll(() => button('Suggest edits').isEnabled(), 'final-only completed');
  await page.getByLabel('Side Chat settings', { exact: true }).click();
  assert.equal(await page.getByLabel('Side Chat model', { exact: true }).inputValue(), 'gpt-6-astra');
  assert.equal(await page.getByLabel('Side Chat effort', { exact: true }).inputValue(), 'high');
  assert.equal(await page.getByLabel('Side Chat speed', { exact: true }).inputValue(), 'standard');
  await page.getByLabel('Side Chat settings', { exact: true }).click();
  await button('Close Codex Side Chat').click();
  await button('Undo').click(); // Undo rejection, then acceptance; arrivals add no Undo steps.
  await poll(() => application.evaluate(() => globalThis.__suggestProbe.comments()[1].decision === 'open'), 'undo rejection');
  await button('Undo').click();
  await poll(() => source().then(t => t === draft), 'undo acceptance');
  await poll(() => application.evaluate(() => globalThis.__suggestProbe.comments().length === 4), 'all arrivals retained after Undo');
  await shot('03-undo-preserves-arrivals');
  await close(); await launch();
  await page.locator('.source-pane .cm-content').waitFor(); // The saved profile resumes its paper automatically.
  assert.equal(await source(), draft);
  assert.equal(await application.evaluate(() => globalThis.__suggestProbe.comments().length), 4);
  await button('Codex Side Chat').click();
  await page.getByRole('complementary', { name: 'Codex Side Chat', exact: true }).getByText('Chat request cancelled.', { exact: true }).waitFor();
  await shot('04-reopened-partial-chat');
  receipt.checks.push('Sol Low Fast quick action, compact request, ordinary Astra High Standard preferences unchanged.',
    'Comments usable before final reply with continuous review updates off; source changes only on Accept.',
    'Accept/Reject and Stop work while chat continues; received batches persist and later arrivals preserve Undo.',
    'Final-only suggestion delivery also works; comments and interrupted chat survive reopening, and the original disk file stays unchanged.');
  assert.deepEqual(receipt.rendererErrors, []); receipt.passed = true;
} catch (error) {
  receipt.passed = false; receipt.failure = String(error.stack ?? error); try { await shot('failure'); } catch {}
  throw error;
} finally {
  if (application) await close();
  await fs.writeFile(path.join(evidence, 'results.json'), JSON.stringify(receipt, null, 2)); console.log('Evidence', evidence);
  if (receipt.passed && !evidence.startsWith(root + path.sep)) await fs.rm(root, { recursive: true, force: true });
}
