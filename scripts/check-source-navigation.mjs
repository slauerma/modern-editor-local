// Isolated native navigation check: synthetic manuscript, real TeX/SyncTeX,
// no model/account calls, and no changes to the author's running editor.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(appRoot, 'package.json'));
const args = process.argv.slice(2);
assert(args.length === 2 && args[0] === '--playwright-package');
const { _electron } = createRequire(path.resolve(args[1]))('playwright');
const root = path.join(appRoot, '.test-runs', 'source-navigation-' + Date.now()), copy = path.join(root, 'desktop');
const evidence = process.env.ME_TEST_EVIDENCE || path.join(root, 'evidence');
await fs.mkdir(copy, { recursive: true }); await fs.mkdir(evidence, { recursive: true });
await fs.cp(path.join(appRoot, 'dist'), path.join(copy, 'dist'), { recursive: true });
await fs.symlink(path.join(appRoot, 'node_modules'), path.join(copy, 'node_modules'), 'dir');
await fs.writeFile(path.join(copy, 'package.json'), JSON.stringify({ name: 'navigation-check', version: JSON.parse(await fs.readFile(path.join(appRoot, 'package.json'), 'utf8')).version, main: 'dist/main.cjs', private: true }));
const injection = `
const navigationProbe={file:null,modelCalls:0,sourceCalls:0,hold:false,pending:null};
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[navigationProbe.file]});
codex.client.run=async()=>{navigationProbe.modelCalls++;throw Error('No model call allowed');};
const locateSource=compiler.locateSource.bind(compiler);
compiler.locateSource=async input=>{navigationProbe.sourceCalls++;if(navigationProbe.hold)await new Promise(resolve=>navigationProbe.pending=resolve);return locateSource(input);};
globalThis.__navigationProbe=navigationProbe;
`;
await build({ entryPoints: [path.join(appRoot, 'src/main/index.ts')], outfile: path.join(copy, 'dist/main.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'],
  plugins: [{ name: 'navigation-probe', setup(b) { b.onLoad({ filter: /src\/main\/index\.ts$/ }, async a => ({ contents: await fs.readFile(a.path, 'utf8') + injection, loader: 'ts' })); } }] });
const reader = await build({ stdin: { contents: `
import {EditorView} from '@codemirror/view';
import {undoDepth} from '@codemirror/commands';
window.navigationEditor=()=>EditorView.findFromDOM(document.querySelector('.source-pane .cm-content'));
window.navigationState=()=>{const e=window.navigationEditor();return {text:e.state.doc.toString(),from:e.state.selection.main.from,to:e.state.selection.main.to,top:e.scrollDOM.scrollTop,undo:undoDepth(e.state)};};
`, resolveDir: appRoot }, bundle: true, write: false, format: 'iife', platform: 'browser' });
const source = String.raw`\documentclass{article}
\usepackage{amsmath,amsthm}
\newtheorem{lemma}{Lemma}
\begin{document}
\section{Allocation}
The first distinct paragraph introduces the allocation problem.

\subsection{Basic assumptions}\label{sec:assumptions}
Every agent has a positive endowment.

\begin{lemma}[Existence]\label{lem:existence}
An optimal allocation exists.
\end{lemma}
\newpage
\section{Equilibrium}
A distinctive second-page passage explains the equilibrium condition.

\begin{equation}\label{eq:condition}
x^2+y^2=1
\end{equation}
\end{document}
`;
const file = path.join(root, 'paper', 'main.tex');
await fs.mkdir(path.join(root, 'paper', '.modern-editor'), { recursive: true }); await fs.writeFile(file, source);
const original = 'introduces the allocation problem', replacement = 'describes the allocation problem';
await fs.writeFile(path.join(root, 'paper', '.modern-editor', 'review.json'), JSON.stringify({
  schemaVersion: 1, rootFile: 'main.tex', sourceHash: createHash('sha256').update(source).digest('hex'), activeId: 'wording', updatedAt: new Date().toISOString(),
  comments: [{ id: 'wording', title: 'Describe the allocation', explanation: 'Make the opening more direct.', original, replacement, from: source.indexOf(original), to: source.indexOf(original) + original.length, validity: 'current', decision: 'open', packages: [], messages: [] }]
}));
let application, page;
const receipt = { root, synthetic: true, realTex: true, modelCalls: 0, checks: [], screenshots: [], processes: [], rendererErrors: [] };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function poll(fn, label, ms = 25000) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await pause(70); } throw Error('Timed out: ' + label); }
const button = name => page.getByRole('button', { name, exact: true });
const read = () => page.evaluate(() => window.navigationState());
const pdf = () => page.locator('#pdf-surface .pdf-reader:visible');
const state = () => pdf().locator('.pdf-scroll').evaluate(e => ({ top: e.scrollTop, left: e.scrollLeft, rect: e.getBoundingClientRect().toJSON() }));
const back = () => button('Back to previous position');
async function select(phrase) { await page.evaluate(phrase => { const e = window.navigationEditor(), at = e.state.doc.toString().indexOf(phrase); if (at < 0) throw Error('No phrase'); e.dispatch({ selection: { anchor: at, head: at + phrase.length } }); }, phrase); }
async function write(text) { await page.evaluate(text => { const e = window.navigationEditor(); e.dispatch({ changes: { from: 0, to: e.state.doc.length, insert: text } }); }, text); }
async function shot(name) {
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
  try { await page.screenshot({ path: path.join(evidence, name + '.png'), scale: 'css' }); receipt.screenshots.push(name + '.png'); }
  finally { await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide()); }
}
async function check(name) { assert.equal(await fs.readFile(file, 'utf8'), source); receipt.checks.push(name); console.log('PASS', name); }
const passage = () => pdf().locator('.textLayer span').filter({ hasText: /^A distinctive second-page/ }).first();
async function forward() {
  await select('A distinctive second-page'); await button('Show in PDF').click();
  await poll(() => pdf().locator('[data-pdf-jump="2"]').isVisible(), 'forward marker');
  await passage().waitFor();
}
try {
  application = await _electron.launch({ executablePath: require('electron'), args: [copy], cwd: appRoot, env: { ...process.env, MODERN_EDITOR_RUNTIME_DIR: path.join(root, 'runtime') }, chromiumSandbox: true, timeout: 25000 });
  const child = application.process(); receipt.processes.push({ pid: child.pid, exited: false }); console.log('Owned Electron PID', child.pid);
  page = await application.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', error => receipt.rendererErrors.push(String(error)));
  await application.evaluate(({ BrowserWindow }, file) => { const w = BrowserWindow.getAllWindows()[0]; w.setContentSize(1600, 1000); w.webContents.setBackgroundThrottling(false); w.hide(); globalThis.__navigationProbe.file = file; }, file);
  await button('Open a LaTeX or text file').click(); await page.getByLabel('Document source', { exact: true }).waitFor(); await page.evaluate(reader.outputFiles[0].text);
  if (await button('Dismiss notice').count()) await button('Dismiss notice').click();
  await button('Compile').click(); await pdf().locator('canvas[aria-label$=", rendered"]').first().waitFor({ timeout: 60000 });
  await poll(() => button('Compile').isEnabled(), 'compilation finished');
  await page.locator('#pdf-surface [aria-label="PDF zoom"]:visible').selectOption('1.25'); await pause(200);
  await select('A distinctive second-page'); const before = await state(), beforeSource = await read();
  await forward(); await back().click(); await poll(async () => Math.abs((await state()).top - before.top) < 2, 'Back restores PDF scroll');
  assert.equal(await page.locator('#pdf-surface [aria-label="PDF zoom"]:visible').inputValue(), '1.25');
  assert.equal((await read()).undo, beforeSource.undo);
  await check('Source → PDF → Back restores scroll and zoom without an Undo step.');

  await forward(); await select('The first distinct');
  const pdfBeforeReverse = await state(), undo = (await read()).undo;
  await passage().click({ modifiers: ['Meta'] });
  await poll(async () => (await read()).from === source.indexOf('A distinctive second-page'), 'reverse source line');
  assert.equal((await read()).undo, undo);
  assert.deepEqual((await state()).rect, pdfBeforeReverse.rect); assert(Math.abs((await state()).top - pdfBeforeReverse.top) < 2);
  await shot('01-two-way-jump'); await back().click();
  await poll(async () => (await read()).from === source.indexOf('The first distinct'), 'Back restores source selection');
  await passage().click({ button: 'right' }); await page.getByRole('menuitem', { name: 'Show in LaTeX' }).click();
  await poll(async () => (await read()).from === source.indexOf('A distinctive second-page'), 'right-click source line');
  await check('Command-click and right-click PDF find the real LaTeX line; the PDF stays in place.');

  await button('Outline').click();
  const outlineEntries = page.locator('.outline-entry'); await outlineEntries.first().focus();
  await page.keyboard.press('ArrowDown'); assert(await outlineEntries.nth(1).evaluate(e => e === document.activeElement));
  await page.keyboard.press('ArrowUp'); assert(await outlineEntries.first().evaluate(e => e === document.activeElement));
  await page.getByLabel('Search outline').fill('existence');
  assert.equal(await page.locator('.outline-entry').count(), 1); await shot('02-searchable-outline');
  await page.getByLabel('Search outline').press('Enter');
  await poll(async () => (await read()).from === source.indexOf('\\label{lem:existence}'), 'outline label jump');
  const rect = await page.evaluate(() => { const e = window.navigationEditor(); return e.coordsAtPos(e.state.doc.toString().indexOf('Every agent')); });
  assert(rect); await page.keyboard.down('Meta'); await page.mouse.click(rect.left + 4, rect.top + 4); await page.keyboard.up('Meta');
  await poll(() => pdf().locator('[data-pdf-jump="1"]').isVisible(), 'Command-click source');
  await check('Search finds labelled results; Enter jumps to source; Command-click source locates the PDF.');

  await forward();
  await write(source.replace('The first distinct', 'An inserted line.\nThe first distinct'));
  await passage().click({ modifiers: ['Meta'] });
  await poll(async () => (await read()).from === (await read()).text.indexOf('A distinctive second-page'), 'shifted reverse');
  const revised = source.replace('A distinctive second-page passage', 'A rewritten second-page passage');
  await write(revised); await select('The first distinct');
  const staleBefore = await state(), sourceBefore = await read();
  await passage().click({ modifiers: ['Meta'] });
  await page.getByRole('status').filter({ hasText: 'This PDF passage changed' }).waitFor();
  assert.equal((await read()).from, sourceBefore.from); assert.deepEqual((await state()).rect, staleBefore.rect); assert(Math.abs((await state()).top - staleBefore.top) < 2);
  await check('Older PDFs map unchanged shifted lines; edited passages show a quiet message without moving the panes.');

  await write(source); await forward(); await select('The first distinct');
  await application.evaluate(() => { globalThis.__navigationProbe.hold = true; });
  await passage().click({ modifiers: ['Meta'] });
  await poll(() => application.evaluate(() => !!globalThis.__navigationProbe.pending), 'held reverse lookup');
  await select('Every agent');
  await application.evaluate(() => { const p = globalThis.__navigationProbe; p.hold = false; p.pending(); p.pending = null; });
  await pause(300); assert.equal((await read()).from, source.indexOf('Every agent'));
  await check('An obsolete reverse lookup cannot override a newer source selection.');

  // Replacing the whole test buffer deliberately invalidated old anchors. Install a fresh synthetic comment for the independent PDF-mode check.
  const freshFile = path.join(root, 'fresh-comments.json');
  await fs.writeFile(freshFile, JSON.stringify({schemaVersion:2,comments:[{id:'fresh-wording',title:'State endowments directly',explanation:'Keep the assumption concise.',original:'Every agent has a positive endowment.',replacement:'Each agent has a positive endowment.'}]}));
  await application.evaluate((_,file)=>globalThis.__navigationProbe.file=file, freshFile);
  await button('Actions ▾').click(); await button('Import JSON…').click();
  await page.getByText('Imported 1 comments', {exact:true}).waitFor();
  await button('View ▾').click(); await button('PDF mode').click();
  await page.locator('.pdf-review-right canvas[aria-label$=", rendered"]').first().waitFor({ timeout: 60000 });
  await poll(() => button('Refresh PDF review').isEnabled(), 'PDF review ready', 60000);
  const pair = () => page.locator('.pdf-review-papers').evaluate(e => [...e.children].map(n => ({ rect: n.getBoundingClientRect().toJSON(), top: n.querySelector('.pdf-scroll').scrollTop })));
  const beforePeek = await pair();
  const proposed = page.locator('.pdf-review-right .textLayer span').filter({ hasText: /first distinct/ }).first();
  await proposed.click({ modifiers: ['Meta'] }); await page.getByRole('dialog', { name: 'LaTeX passage', exact: true }).waitFor();
  await page.getByText(/Proposed source · line/).waitFor();
  assert.equal(await button('Open in source editor').count(), 0);
  assert.deepEqual(await pair(), beforePeek); await shot('03-pdf-mode-source'); await back().click();
  await poll(() => page.getByRole('dialog', { name: 'LaTeX passage', exact: true }).count().then(n => n === 0), 'Back closes source popup');
  await button('Outline').click(); await page.getByLabel('Search outline').fill('assumptions'); await page.getByLabel('Search outline').press('Enter');
  await page.getByRole('dialog', { name: 'LaTeX passage', exact: true }).waitFor(); assert.deepEqual(await pair(), beforePeek);
  await button('Expand source passage').click(); assert.deepEqual(await pair(), beforePeek);
  await button('Close source passage').click();
  await application.evaluate(() => { globalThis.__navigationProbe.hold = true; });
  await proposed.click({ modifiers: ['Meta'] }); await poll(() => application.evaluate(() => !!globalThis.__navigationProbe.pending), 'held snapshot lookup');
  await button('Workspace').click();
  await application.evaluate(() => { const p = globalThis.__navigationProbe; p.hold = false; p.pending(); p.pending = null; });
  await pause(250); assert.equal(await page.getByRole('dialog', { name: 'LaTeX passage', exact: true }).count(), 0);
  await check('PDF-mode jumps preserve both readers; delayed snapshot lookup cannot reopen a popup after leaving review.');
  assert.equal((await read()).text, source);
  receipt.modelCalls = await application.evaluate(() => globalThis.__navigationProbe.modelCalls); assert.equal(receipt.modelCalls, 0);
  assert.deepEqual(receipt.rendererErrors, []); receipt.status = 'PASS';
} catch (error) {
  receipt.status = 'FAIL'; receipt.error = String(error.stack || error);
  if (page) { await shot('failure').catch(() => {}); await fs.writeFile(path.join(evidence, 'failure.html'), await page.content().catch(() => '')); }
  throw error;
} finally {
  if (application) {
    const child = application.process(); await application.close().catch(() => {});
    await poll(async () => child.exitCode !== null || child.signalCode !== null, 'owned Electron exit', 15000);
    receipt.processes[0].exited = true; receipt.processes[0].exitCode = child.exitCode;
  }
  await fs.writeFile(path.join(evidence, 'receipt.json'), JSON.stringify(receipt, null, 2)); console.log('Evidence:', evidence);
}
