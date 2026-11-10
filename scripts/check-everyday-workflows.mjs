// Synthetic files and isolated Electron profile; native UI, real IPC and storage.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(repo, 'package.json'));
assert(process.argv.length === 4 && process.argv[2] === '--playwright-package');
const { _electron } = createRequire(path.resolve(process.argv[3]))('playwright');
const root = path.join(repo, '.test-runs', 'everyday-workflows-' + Date.now()), copy = path.join(root, 'desktop'), paper = path.join(root, 'paper');
const evidence = process.env.ME_TEST_EVIDENCE || path.join(root, 'evidence'), runtime = path.join(root, 'runtime');
await fs.mkdir(copy, { recursive: true }); await fs.mkdir(paper); await fs.mkdir(evidence, { recursive: true });
await fs.cp(path.join(repo, 'dist'), path.join(copy, 'dist'), { recursive: true });
await fs.symlink(path.join(repo, 'node_modules'), path.join(copy, 'node_modules'), 'dir');
await fs.writeFile(path.join(copy, 'package.json'), JSON.stringify({ name: 'everyday-workflows-check', version: '1.7.0', main: 'dist/main.cjs', private: true }));
const windows = Buffer.from('93436166e99420636f7374732080352e0d0a', 'hex'), wording = '“Café” costs €5.\r\n';
const legacy = path.join(paper, 'legacy.txt'), converted = path.join(paper, 'legacy-utf8.txt'), latex = path.join(paper, 'main.tex');
await fs.writeFile(legacy, windows);
const source = '\\documentclass{article}\n\\begin{document}\nThe proof are short.\nThe allocation are feasible.\n\\end{document}\n';
await fs.writeFile(latex, source);
const documentHome = path.join(paper, '.modern-editor', 'documents', createHash('sha256').update('main.tex').digest('hex'));
await fs.mkdir(documentHome, { recursive: true });
await fs.writeFile(path.join(documentHome, 'document.json'), JSON.stringify({ schemaVersion: 1, rootFile: 'main.tex' }));
await fs.writeFile(path.join(documentHome, 'review.json'), JSON.stringify({ schemaVersion: 1, rootFile: 'main.tex', sourceHash: createHash('sha256').update(source).digest('hex'), activeId: 'grammar', updatedAt: new Date().toISOString(), comments: [
  ['grammar', 'Proof agreement', 'proof are', 'proof is'], ['allocation', 'Allocation agreement', 'allocation are', 'allocation is']
].map(([id, title, original, replacement]) => ({ id, title, original, replacement, explanation: 'Use singular agreement.', from: source.indexOf(original), to: source.indexOf(original) + original.length, validity: 'current', decision: 'open', packages: [], messages: [] })) }));
const injection = `
const probe={file:${JSON.stringify(legacy)},target:${JSON.stringify(converted)},cancelSave:false,requests:[]};
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[probe.file]});
dialog.showSaveDialog=async()=>({canceled:probe.cancelSave,filePath:probe.target});
CodexClient.prototype.listModels=async()=>[{id:'gpt-6.1-sol',name:'GPT-6.1 Sol',isDefault:true,efforts:['low','medium','high','xhigh','max','ultra'],fast:true,images:true}];
codex.client.run=async(prompt,schema,progress,effort,fast,reader,options)=>{if(options?.conversation)await options.conversation.onThread('synthetic-review');probe.requests.push(JSON.parse(prompt));return {comments:[]};};
probe.current=()=>projects.current;
probe.saved=async()=>{try{return JSON.parse(await fs.readFile(path.join(await projects.stateDirectory(projects.current.id),'recovery/session.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return {review:{comments:[]}};throw e;}};
globalThis.__workflowProbe=probe;`;
await build({ entryPoints: [path.join(repo, 'src/main/index.ts')], outfile: path.join(copy, 'dist/main.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'],
  plugins: [{ name: 'workflow-probe', setup(b) { b.onLoad({ filter: /src\/main\/index\.ts$/ }, async a => ({ contents: await fs.readFile(a.path, 'utf8') + '\n' + injection, loader: 'ts' })); } }] });
const accessor = await build({ stdin: { contents: "import {EditorView} from '@codemirror/view';const view=()=>EditorView.findFromDOM(document.querySelector('.source-pane .cm-content'));window.readSource=()=>view().state.doc.toString();window.appendSource=text=>view().dispatch({changes:{from:view().state.doc.length,insert:text},userEvent:'input'});", resolveDir: repo }, bundle: true, write: false, format: 'iife', platform: 'browser' });
const result = { runDirectory: root, synthetic: true, liveCodex: false, checks: [], rendererErrors: [], processes: [] };
let app, page;
const button = name => page.getByRole('button', { name, exact: true }).first();
const poll = async (fn, label) => { const end = Date.now() + 25000; while (Date.now() < end) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 80)); } throw new Error('Timed out: ' + label); };
const shot = name => page.screenshot({ path: path.join(evidence, name + '.png') });
const setFile = file => app.evaluate((_, file) => { globalThis.__workflowProbe.file = file; }, file);
const openFile = async file => { await setFile(file); await button('Actions ▾').click(); await button('Open paper…').click(); };
const loadAccessor = async () => { await page.locator('.source-pane .cm-content').waitFor(); await page.evaluate(accessor.outputFiles[0].text); };
const closeProject = async () => { await button('Actions ▾').click(); await button('Close project').click(); await button('Close and keep data').click(); await button('Open a LaTeX or text file').waitFor(); };
const saved = () => app.evaluate(() => globalThis.__workflowProbe.saved());
try {
  app = await _electron.launch({ executablePath: require('electron'), args: [copy], cwd: repo, env: { ...process.env, MODERN_EDITOR_RUNTIME_DIR: runtime }, chromiumSandbox: true, timeout: 25000 });
  result.processes.push({ pid: app.process().pid, exited: false }); console.log('Owned Electron PID', app.process().pid);
  page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', e => result.rendererErrors.push(String(e)));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1400, 900));
  await button('Open a LaTeX or text file').click();
  const importer = page.getByRole('dialog', { name: 'Open a UTF-8 copy' }); await importer.waitFor();
  assert((await importer.innerText()).includes('Some characters may be interpreted differently'));
  assert.equal(await page.getByLabel('Decoded text preview').inputValue(), wording.replaceAll('\r\n', '\n'));
  await page.getByLabel('Original encoding', { exact: true }).selectOption('macintosh');
  assert.notEqual(await page.getByLabel('Decoded text preview').inputValue(), wording.replaceAll('\r\n', '\n'));
  await page.getByLabel('Original encoding', { exact: true }).selectOption('windows-1252'); await shot('01-encoding-preview');
  await app.evaluate(() => { globalThis.__workflowProbe.cancelSave = true; });
  await button('Save UTF-8 copy and open…').click(); await poll(() => button('Save UTF-8 copy and open…').isEnabled(), 'Save As cancellation'); assert(await importer.isVisible());
  await app.evaluate(() => { globalThis.__workflowProbe.cancelSave = false; globalThis.__workflowProbe.target = globalThis.__workflowProbe.file; });
  await button('Save UTF-8 copy and open…').click(); await importer.getByRole('alert').filter({ hasText: 'already exists' }).waitFor(); assert.deepEqual(await fs.readFile(legacy), windows);
  await app.evaluate((_, target) => { globalThis.__workflowProbe.target = target; }, converted);
  await button('Save UTF-8 copy and open…').click(); await loadAccessor(); assert.equal(await page.evaluate(() => window.readSource()), wording.replaceAll('\r\n', '\n'));
  assert.equal(await fs.readFile(converted, 'utf8'), wording); assert.deepEqual(await fs.readFile(legacy), windows);
  result.checks.push('Ambiguous encoding preview, changed encoding, Save As cancellation, overwrite refusal and exact UTF-8 copy; original bytes preserved.');

  await openFile(latex); await loadAccessor(); assert((await button('Accept options').boundingBox()).width <= 36, 'Split arrow stays compact'); await button('Accept options').click();
  assert(await page.getByRole('menuitem', { name: 'Accept & compile', exact: true }).isVisible()); await page.keyboard.press('Escape');
  assert(await button('Accept options').evaluate(e => document.activeElement === e));
  await button('Reject options').click(); await shot('02-reject-options'); await page.getByRole('menuitem', { name: 'Keep my wording', exact: true }).click();
  await poll(async () => (await saved()).review.comments.find(c => c.id === 'grammar')?.rejectionReason === 'Keep my wording', 'reason persisted');
  assert.equal(await page.evaluate(() => window.readSource()), source);
  await button('Undo').click(); await poll(async () => (await saved()).review.comments.find(c => c.id === 'grammar')?.decision === 'open', 'reason Undo');
  await button('Reject options').click(); await page.getByRole('menuitem', { name: 'Reject with reason…', exact: true }).click();
  await page.getByLabel('Your rejection reason', { exact: true }).fill('This is an intentional quotation.'); await button('Reject with reason').click();
  await poll(async () => (await saved()).review.comments.find(c => c.id === 'grammar')?.rejectionReason === 'This is an intentional quotation.', 'custom reason persisted');
  await button('Discussion options').click(); assert(await page.getByRole('menuitem', { name: 'Three alternatives', exact: true }).isVisible()); await page.keyboard.press('Escape');
  result.checks.push('Split Accept/Reject/Discuss options, keyboard Escape/focus, preset and custom reasons, source preservation and Undo.');

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1100, 760));
  await button('Review with Codex').click(); await button('Paste material').click();
  const paste = page.locator('.references-drawer').getByLabel('Pasted context text', { exact: true });
  const material = 'External notes\n' + 'Keep the assumptions and clarify the argument.\n'.repeat(900);
  await paste.fill(material); await page.getByLabel('Context name', { exact: true }).fill('External notes');
  assert((await page.locator('.references-drawer').innerText()).includes('Not yet saved'));
  await button('Back to review').click(); await button('Paste material').click(); assert.equal(await paste.inputValue(), material);
  for (const label of ['Back to review', 'Save and enable for this paper']) {
    assert(await button(label).evaluate(e => { const r = e.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return r.top >= 0 && r.bottom <= innerHeight && (hit === e || e.contains(hit)); }), label + ' remains reachable');
  }
  await shot('03-long-paste'); await button('Save and enable for this paper').click(); await page.getByText('Saved “External notes” · available to the next review.', { exact: true }).waitFor();
  await shot('04-saved-context'); await button('Back to review').click();
  const review = page.getByLabel('Request Codex review', { exact: true });
  await review.getByRole('button', { name: 'Start review', exact: true }).click();
  await poll(() => app.evaluate(() => globalThis.__workflowProbe.requests.length === 1), 'review after context');
  await poll(() => button('Review with Codex').isEnabled(), 'review completion');
  await button('Review with Codex').click(); await button('Add material options').click(); await page.getByRole('menuitem', { name: /^Attach files/ }).click();
  await page.locator('.paste-saved').getByRole('button', { name: 'Turn into comments…' }).click();
  await page.getByRole('button', { name: 'Prepare items', exact: true }).waitFor(); await shot('05-feedback-route');
  await page.keyboard.press('Escape');
  result.checks.push('Long-paste draft retained, visible Save/Back at 1100×760, truthful save status, review afterward and saved-feedback conversion entry. Review reply controlled; no live model call.');

  await page.evaluate(() => window.appendSource('\n% Unsaved return test\n'));
  await button('Recent projects').click(); const recent = page.getByRole('dialog', { name: 'Continue a project' });
  await recent.getByRole('button').filter({ hasText: 'legacy-utf8.txt' }).click(); await poll(() => page.evaluate(() => window.readSource()).then(text => text === wording.replaceAll('\r\n', '\n')), 'recent project switch'); await loadAccessor();
  assert.equal(await page.evaluate(() => window.readSource()), wording.replaceAll('\r\n', '\n'));
  await closeProject(); await button('Continue a project…').click();
  await page.getByLabel('Find recent project').fill('main.tex');
  assert(await recent.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'Long recent paths must wrap inside the dialog');
  await shot('06-recent-projects');
  await page.getByRole('dialog', { name: 'Continue a project' }).getByRole('button').filter({ hasText: 'main.tex' }).click(); await loadAccessor(); await poll(() => page.evaluate(() => window.readSource()).then(text => text.includes('Unsaved return test')), 'recovered source');
  assert((await page.evaluate(() => window.readSource())).includes('Unsaved return test'));
  assert.equal((await saved()).review.comments.find(c => c.id === 'grammar').rejectionReason, 'This is an intentional quotation.');
  assert.equal(await fs.readFile(latex, 'utf8'), source);
  result.checks.push('Filename picker, Home continuation, filtering, unsaved recovery and rejected reason restored; on-disk source unchanged.');

  await openFile(legacy); await importer.waitFor(); await button('Cancel text import').click(); assert((await page.evaluate(() => window.readSource())).includes('Unsaved return test'));
  await button('Accept options').click(); await page.getByRole('menuitem', { name: 'Accept & compile', exact: true }).click();
  await poll(async () => (await saved()).review.comments.find(c => c.id === 'allocation')?.decision === 'applied', 'checked acceptance');
  assert((await page.evaluate(() => window.readSource())).includes('allocation is feasible'));
  assert.equal(await fs.readFile(latex, 'utf8'), source);
  await page.locator('.pdf-pane canvas:visible').first().waitFor();
  await page.getByText('Loading page 1…', { exact: true }).waitFor({ state: 'hidden' });
  await shot('07-checked-acceptance'); await button('Undo').click();
  await poll(() => page.evaluate(() => window.readSource()).then(text => text.includes('allocation are feasible')), 'checked acceptance Undo');
  result.checks.push('Accept & compile through its arrow runs real TeX, applies only after success, keeps disk source unchanged and supports Undo.');
  assert.deepEqual(result.rendererErrors, []); result.passed = true;
} catch (e) { result.passed = false; result.failure = String(e.stack ?? e); try { await shot('failure'); } catch {} throw e; }
finally {
  if (app) { const child = app.process(); await app.close(); await poll(async () => child.exitCode !== null || child.signalCode !== null, 'Electron exit'); Object.assign(result.processes[0], { exited: true, exitCode: child.exitCode }); console.log('Owned Electron exited', child.pid); }
  await fs.writeFile(path.join(evidence, 'results.json'), JSON.stringify(result, null, 2)); console.log('Evidence', evidence);
  if (result.passed && !evidence.startsWith(root + path.sep)) await fs.rm(root, { recursive: true, force: true });
}
