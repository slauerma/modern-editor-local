// Isolated Electron UI/IPC/recovery check. Model responses are controlled.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(repo, 'package.json')), args = process.argv.slice(2);
assert(args.length === 2 && args[0] === '--playwright-package');
const { _electron } = createRequire(path.resolve(args[1]))('playwright');
const root = path.join(repo, '.test-runs', 'review-continuity-' + Date.now()), copy = path.join(root, 'desktop');
const evidence = process.env.ME_TEST_EVIDENCE || path.join(root, 'evidence');
await fs.mkdir(copy, { recursive: true }); await fs.mkdir(evidence, { recursive: true });
await fs.cp(path.join(repo, 'dist'), path.join(copy, 'dist'), { recursive: true });
await fs.symlink(path.join(repo, 'node_modules'), path.join(copy, 'node_modules'), 'dir');
await fs.writeFile(path.join(copy, 'package.json'), JSON.stringify({ name: 'review-continuity-check', version: '1.7.0', main: 'dist/main.cjs', private: true }));
const injection = [
  "const probe={file:null,paperId:null,requests:[],threads:0};",
  "dialog.showOpenDialog=async()=>({canceled:false,filePaths:[probe.file]});",
  "const originalOpen=projects.open.bind(projects);projects.open=async(...args)=>{const p=await originalOpen(...args);probe.paperId=p.id;return p;};",
  "CodexClient.prototype.listModels=async()=>[{id:'gpt-6.1-sol',name:'GPT-6.1 Sol',isDefault:true,efforts:['low','medium','high','xhigh','max','ultra'],fast:true,images:true}];",
  "codex.client.run=async(prompt,schema,progress,effort,fast,reader,options)=>{",
  "  const c=options?.conversation;const request={context:JSON.parse(prompt),thread:c?.threadId??null};",
  "  if(c)await c.onThread(c.threadId||'synthetic-thread-'+(++probe.threads));",
  "  if(reader){request.source=(await reader.call('references_read',{fileId:'current-draft'})).excerpts.map(e=>e.text).join('');request.instructions=(await reader.call('references_read',{fileId:'paper-instructions'})).excerpts.map(e=>e.text).join('');request.decisions=(await reader.call('references_read',{fileId:'review-decisions'})).excerpts.map(e=>e.text).join('');}",
  "  probe.requests.push(request);return {comments:[]};",
  "};",
  "probe.saved=async()=>JSON.parse(await require('node:fs/promises').readFile(require('node:path').join(await projects.stateDirectory(probe.paperId),'recovery/session.json'),'utf8'));",
  "globalThis.__continuityProbe=probe;"
].join('\n');
await build({ entryPoints: [path.join(repo, 'src/main/index.ts')], outfile: path.join(copy, 'dist/main.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'],
  plugins: [{ name: 'continuity-probe', setup(b) { b.onLoad({ filter: /src\/main\/index\.ts$/ }, async a => ({ contents: await fs.readFile(a.path, 'utf8') + '\n' + injection, loader: 'ts' })); } }] });
const accessor = await build({ stdin: { contents: "import {EditorView} from '@codemirror/view';const view=()=>EditorView.findFromDOM(document.querySelector('.source-pane .cm-content'));window.readSource=()=>view().state.doc.toString();window.pasteSource=text=>view().dispatch({changes:{from:0,to:view().state.doc.length,insert:text},userEvent:'input.paste'});", resolveDir: repo }, bundle: true, write: false, format: 'iife', platform: 'browser' });
const text = 'The allocation are monotone.\nThis is a synthetic review example.\n', file = path.join(root, 'paper/main.txt');
await fs.mkdir(path.join(root, 'paper/.modern-editor'), { recursive: true }); await fs.writeFile(file, text);
const original = 'The allocation are monotone.';
await fs.writeFile(path.join(root, 'paper/.modern-editor/review.json'), JSON.stringify({ schemaVersion: 1, rootFile: 'main.txt', sourceHash: createHash('sha256').update(text).digest('hex'), activeId: 'existing', updatedAt: new Date().toISOString(), comments: [{ id: 'existing', title: 'Existing suggestion', explanation: 'The model recommends singular wording.', original, replacement: 'The allocation is monotone.', from: 0, to: original.length, validity: 'current', decision: 'open', packages: [], messages: [] }] }));
const result = { runDirectory: root, synthetic: true, liveCodex: false, checks: [], rendererErrors: [], processes: [] };
let app, page;
const button = name => name === 'Review with Codex' ? page.getByLabel(name, { exact: true }) : page.getByRole('button', { name, exact: true });
const review = () => page.getByLabel('Request Codex review', { exact: true });
async function poll(fn, label, ms = 15000) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await new Promise(r => setTimeout(r, 80)); } throw Error('Timed out: ' + label); }
const requests = () => app.evaluate(() => globalThis.__continuityProbe.requests);
const saved = () => app.evaluate(() => globalThis.__continuityProbe.saved());
async function shot(name) { await page.screenshot({ path: path.join(evidence, name + '.png') }); }
async function open() { await app.evaluate((_, file) => { globalThis.__continuityProbe.file = file; }, file); await button('Open a LaTeX or text file').click(); await page.locator('.source-pane .cm-content').waitFor(); await page.evaluate(accessor.outputFiles[0].text); if (await button('Dismiss notice').count()) await button('Dismiss notice').click(); }
async function runReview() { const n = (await requests()).length; await review().getByRole('button', { name: /^(Start review|Continue review|Start fresh review)$/ }).click(); await poll(async () => (await requests()).length === n + 1, 'request captured'); await poll(() => button('Review with Codex').isEnabled(), 'review finished'); return (await requests()).at(-1); }
try {
  app = await _electron.launch({ executablePath: require('electron'), args: [copy], cwd: repo, env: { ...process.env, MODERN_EDITOR_RUNTIME_DIR: path.join(root, 'runtime') }, chromiumSandbox: true, timeout: 25000 });
  result.processes.push({ pid: app.process().pid, exited: false }); console.log('Owned Electron PID', app.process().pid);
  page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', e => result.rendererErrors.push(String(e)));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1450, 1000));
  await open(); await button('Review with Codex').click();
  await review().getByRole('button', { name: 'Start review', exact: true }).waitFor();
  await review().getByLabel('Instructions for this review').fill('Check this example.');
  await shot('01-first-review'); let request = await runReview(); assert.equal(request.thread, null);
  result.checks.push('Continue is the default; the first request starts one active conversation.');

  await button('Reject', { exact: true }).click();
  await poll(async () => (await saved()).review.comments[0].decision === 'dismissed', 'one-click rejection');
  assert.equal(await page.getByRole('dialog', { name: 'Rejection reason', exact: true }).count(), 0);
  await button('Undo').click(); await page.getByText('Existing suggestion', { exact: true }).waitFor();
  await button('Details').click(); await button('Rejection reason…').click();
  const reason = page.getByRole('dialog', { name: 'Rejection reason', exact: true });
  assert.notEqual(await reason.evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)');
  await reason.getByLabel('Your rejection reason').fill('This is an intentional quotation.');
  await shot('02-optional-rejection-reason'); await reason.getByRole('button', { name: 'Reject with reason', exact: true }).click();
  await poll(async () => (await saved()).review.comments[0].rejectionReason === 'This is an intentional quotation.', 'reason saved');
  result.checks.push('Ordinary Reject remains one click. Optional rejection reason is saved with the decision; Undo restores an ordinary rejection.');

  const newer = text + 'An unsaved sentence added between reviews.\n';
  await page.evaluate(t => window.pasteSource(t), newer);
  await button('Review with Codex').click(); await review().getByRole('button', { name: 'Continue review', exact: true }).waitFor();
  await button('More options').click(); await review().locator('.request-guidance > summary').click();
  await review().getByLabel('Paper instructions', { exact: true }).fill('Preserve technical terminology.');
  await review().getByRole('button', { name: 'Save paper instructions', exact: true }).click();
  await poll(() => review().getByRole('button', { name: /^(Start review|Continue review|Start fresh review)$/ }).isEnabled(), 'saved guidance');
  await review().locator('.request-guidance > summary').click();
  await review().getByLabel('Instructions for this review').fill('More comments, using our discussion.');
  await shot('03-continue-review'); request = await runReview();
  assert.equal(request.thread, 'synthetic-thread-1'); assert.equal(request.source, newer);
  assert.match(request.decisions, /This is an intentional quotation/);
  assert.match(request.instructions, /Preserve technical terminology/);
  assert.equal(await fs.readFile(file, 'utf8'), text);
  result.checks.push('Continue receives the latest unsaved draft, saved instructions and explicit author reason; disk source remains unchanged.');

  await button('Review with Codex').click(); await button('More options').click(); await review().locator('.review-conversation-history > summary').click();
  await review().getByRole('button', { name: 'Check this example.', exact: true }).click();
  await review().getByLabel('Saved review exchange').waitFor(); await shot('04-review-history');
  await button('Other review actions').click(); await page.getByRole('menuitem', { name: 'Use a fresh conversation', exact: true }).click();
  request = await runReview(); assert.equal(request.thread, null); assert.equal(request.context.reviewConversation.mode, 'fresh');
  await button('Review with Codex').click();
  await review().getByRole('button', { name: 'Continue review', exact: true }).waitFor(); await button('More options').click();
  await review().locator('.review-conversation-history > summary').click();
  assert.equal(await review().getByLabel('Saved review conversation').locator('option').count(), 2);
  await shot('05-fresh-keeps-history'); await button('Close review request').click();
  result.checks.push('Saved exchange is inspectable. Fresh starts separately, retains earlier history and resets the next choice to Continue.');

  await button('Actions ▾').click(); await button('Close project').click(); await button('Close and keep data').click(); await button('Open a LaTeX or text file').waitFor(); await open();
  await button('Review with Codex').click(); await review().getByRole('button', { name: 'Continue review', exact: true }).waitFor();
  request = await runReview(); assert.equal(request.thread, 'synthetic-thread-2'); assert.equal(await page.evaluate(() => window.readSource()), newer);
  assert.equal((await saved()).review.comments[0].rejectionReason, 'This is an intentional quotation.');
  assert.deepEqual(result.rendererErrors, []); result.passed = true;
  result.checks.push('Active review, reason and unsaved draft survive close/reopen. No renderer errors.');
} catch (e) { result.passed = false; result.failure = String(e.stack ?? e); try { await shot('failure'); } catch {} throw e; }
finally {
  if (app) { const child = app.process(); await app.close(); await poll(async () => child.exitCode !== null || child.signalCode !== null, 'Electron exit'); Object.assign(result.processes[0], { exited: true, exitCode: child.exitCode }); console.log('Owned Electron exited', child.pid); }
  await fs.writeFile(path.join(evidence, 'results.json'), JSON.stringify(result, null, 2)); console.log('Evidence', evidence);
  if (result.passed && !evidence.startsWith(root + path.sep)) await fs.rm(root, { recursive: true, force: true });
}
