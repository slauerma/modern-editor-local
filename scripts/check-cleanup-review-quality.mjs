// Real Electron/IPC/storage with synthetic papers and controlled review replies.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(repo, 'package.json'));
assert(process.argv.length === 4 && process.argv[2] === '--playwright-package');
const { _electron } = createRequire(path.resolve(process.argv[3]))('playwright');
const root = path.join(repo, '.test-runs', 'cleanup-review-quality-' + Date.now()), copy = path.join(root, 'desktop'), runtime = path.join(root, 'runtime');
const evidence = process.env.ME_TEST_EVIDENCE || path.join(root, 'evidence');
const file = path.join(root, 'current.txt'), oldFile = path.join(root, 'old.txt');
const draft = 'Each admissible bundle satisfies the budget constraint. The proof is short.\n\nAn obsolete transition.\n\n' + 'Unchanged background. '.repeat(70);
const revised = draft.replace('proof is', 'proof are').replace('An obsolete transition.\n\n', '');
const hash = data => createHash('sha256').update(data).digest('hex');
const oldHome = path.join(root, '.modern-editor/documents', hash('old.txt'));
const buildId = randomUUID(), buildDir = path.join(runtime, 'builds', buildId);
await fs.mkdir(copy, { recursive: true }); await fs.mkdir(evidence, { recursive: true });
await fs.writeFile(file, draft); await fs.writeFile(oldFile, 'Old synthetic paper.'); await fs.writeFile(path.join(root, 'export.pdf'), 'Keep this export.');
await fs.cp(path.join(repo, 'dist'), path.join(copy, 'dist'), { recursive: true });
await fs.symlink(path.join(repo, 'node_modules'), path.join(copy, 'node_modules'), 'dir');
await fs.writeFile(path.join(copy, 'package.json'), JSON.stringify({ name: 'cleanup-review-check', version: '1.7.0', main: 'dist/main.cjs', private: true }));
const injection = `
const probe={file:${JSON.stringify(file)},calls:0,publish:null,stop:null,prompt:'',reader:null};
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[probe.file]});
probe.seed=async()=>{const p=await projects.open(${JSON.stringify(oldFile)});await projects.persist({projectId:p.id,text:p.text,review:p.review});await projects.close(p.id)};
probe.current=()=>projects.current;probe.locked=()=>cleanupLocked;
codex.client.run=async(prompt,schema,progress,effort,fast,reader)=>{
 probe.calls++;probe.prompt=prompt;probe.reader=reader;probe.publish=comments=>reader.call('publish_comments',{comments});
 try{return await new Promise((resolve,reject)=>{probe.stop=()=>reject(Error('Codex review cancelled.'));});}
 finally{await reader.cancel();probe.publish=null;probe.stop=null;}
};
codex.client.cancel=async()=>{probe.stop?.();};
CodexClient.prototype.listModels=async()=>[{id:'gpt-6.1-sol',name:'GPT-6.1 Sol',isDefault:true,efforts:['low','medium','high','xhigh','max','ultra'],fast:true,images:true}];
globalThis.__qualityProbe=probe;`;
await build({ entryPoints: [path.join(repo, 'src/main/index.ts')], outfile: path.join(copy, 'dist/main.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'],
 plugins: [{ name: 'quality-probe', setup(b) { b.onLoad({ filter: /src\/main\/index\.ts$/ }, async a => ({ contents: await fs.readFile(a.path, 'utf8') + injection, loader: 'ts' })); } }] });
const accessor = await build({ stdin: { contents: "import {EditorView} from '@codemirror/view';const view=()=>EditorView.findFromDOM(document.querySelector('.source-pane .cm-content'));window.readSource=()=>view().state.doc.toString();window.replaceSource=text=>view().dispatch({changes:{from:0,to:view().state.doc.length,insert:text}});", resolveDir: repo }, bundle: true, write: false, format: 'iife', platform: 'browser' });
const receipt = { runDirectory: root, synthetic: true, liveCodex: false, checks: [], rendererErrors: [], processes: [] };
let app, page;
const button = name => page.getByRole('button', { name, exact: true }).first();
const source = () => page.evaluate(() => window.readSource());
const poll = async (fn, label) => { const end = Date.now() + 20000; while (Date.now() < end) { if (await fn()) return; await new Promise(r => setTimeout(r, 80)); } throw Error('Timed out: ' + label); };
const shot = name => page.screenshot({ path: path.join(evidence, name + '.png') });
const openCleanup = async () => { await button('Actions ▾').click(); await button('Settings and Check setup…').click(); await button('Data & cleanup…').click(); await page.getByLabel('Select ' + oldFile, { exact: true }).waitFor(); await poll(() => button('Refresh').isEnabled(), 'inspection finished'); };
const selectOld = () => page.getByLabel('Select ' + oldFile, { exact: true }).check();
const confirm = async () => { await page.locator('.cleanup-confirm input').check(); await button('Archive and clear').click(); await button('Show recovery archive').waitFor(); };
const verifyArchive = async () => {
 const archive = await page.locator('.cleanup-dialog code.cleanup-path').innerText();
 const manifest = JSON.parse(await fs.readFile(path.join(archive, 'manifest.json'), 'utf8'));
 for (const item of manifest.files) assert.equal(hash(await fs.readFile(path.join(archive, item.archivedAs))), item.hash);
 return manifest;
};
try {
 app = await _electron.launch({ executablePath: require('electron'), args: [copy], cwd: repo, env: { ...process.env, MODERN_EDITOR_RUNTIME_DIR: runtime }, chromiumSandbox: true, timeout: 25000 });
 receipt.processes.push({ pid: app.process().pid, exited: false }); console.log('Owned Electron PID', app.process().pid);
 page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', e => receipt.rendererErrors.push(String(e)));
 await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 1000));
 await button('Open a LaTeX or text file').waitFor();
 await app.evaluate(() => globalThis.__qualityProbe.seed());
 await fs.mkdir(buildDir, { recursive: true });
await fs.writeFile(path.join(buildDir, '.editor-build.json'), JSON.stringify({ schemaVersion: 1, id: buildId, owner: oldFile }));
await fs.writeFile(path.join(buildDir, 'main.log'), 'Old build log.');
for (const name of await fs.readdir(buildDir)) await fs.utimes(path.join(buildDir, name), 1, 1);

 await button('Open a LaTeX or text file').click(); await page.locator('.source-pane .cm-content').waitFor();
 await page.evaluate(accessor.outputFiles[0].text); await page.evaluate(text => window.replaceSource(text), revised);
 const currentId = await app.evaluate(() => globalThis.__qualityProbe.current().id);
 await openCleanup();
 assert(await page.getByLabel('Select ' + file, { exact: true }).isDisabled());
 assert.equal(await page.locator('.cleanup-papers input:checked').count(), 0);
 assert(!await page.getByRole('dialog', { name: 'Data & cleanup', exact: true }).evaluate(el => !!el.closest('[inert]')));
 await shot('01-papers-and-protected-current');
 await selectOld(); await button('Review files (1)').click(); await page.getByLabel('Files to clear', { exact: true }).waitFor();
 assert(await button('Archive and clear').isDisabled()); assert.equal(await page.locator('.cleanup-files tbody tr').count(), 2);
 await button('Cancel').click(); assert.equal(await source(), revised); assert((await fs.stat(buildDir)).isDirectory());
 assert(!await app.evaluate(() => globalThis.__qualityProbe.locked()));
 await openCleanup(); await selectOld(); await button('Review files (1)').click(); await page.getByLabel('Files to clear', { exact: true }).waitFor();
 await shot('02-temporary-file-preview'); await confirm();
 const temporary = await verifyArchive(); assert.equal(temporary.mode, 'temporary'); assert.equal(temporary.files.length, 2);
 await assert.rejects(fs.stat(buildDir), { code: 'ENOENT' }); assert((await fs.stat(path.join(oldHome, 'review.json'))).isFile());
 await button('Done').click(); assert.equal(await source(), revised);
 receipt.checks.push('Temporary cleanup lists dates/full paths and protects open unsaved work. Cancel changes nothing; clearing an old build verifies a dated archive and keeps history.');
 await openCleanup(); await button('Forget selected papers').click(); await poll(() => button('Refresh').isEnabled(), 'forget inspection');
 await selectOld(); await button('Review files (1)').click(); await page.getByLabel('Files to clear', { exact: true }).waitFor();
 await fs.appendFile(path.join(oldHome, 'review.json'), ' ');
 await page.locator('.cleanup-confirm input').check(); await button('Archive and clear').click();
 await page.getByRole('alert').filter({ hasText: 'No editing files were removed' }).waitFor();
 assert((await fs.stat(path.join(oldHome, 'review.json'))).isFile());
 await button('Refresh').click(); await poll(() => button('Refresh').isEnabled(), 'refreshed files');
 await selectOld(); await button('Review files (1)').click(); await page.getByLabel('Files to clear', { exact: true }).waitFor();
 assert(await button('Archive and clear').isDisabled()); await shot('03-forget-paper-preview'); await confirm();
 const forgotten = await verifyArchive(); assert.equal(forgotten.mode, 'forget'); assert(forgotten.files.some(f => f.path.endsWith('review.json')));
 await button('Done').click();
 assert.equal(await fs.readFile(file, 'utf8'), draft); assert.equal(await fs.readFile(oldFile, 'utf8'), 'Old synthetic paper.');
 assert.equal(await fs.readFile(path.join(root, 'export.pdf'), 'utf8'), 'Keep this export.');
 assert.equal(await source(), revised); assert.equal(await app.evaluate(() => globalThis.__qualityProbe.current().id), currentId);
 receipt.checks.push('Changed files stop forgetting before removal; a refreshed preview requires a new confirmation. Archived bytes verify, old source/export stay, current source and project identity stay.');
 await button('Review with Codex').click(); const review = page.getByLabel('Request Codex review', { exact: true });
 await page.getByLabel('Review template', { exact: true }).selectOption('language');
 assert.match(await page.getByLabel('Instructions for this review').inputValue(), /Meaning question/);
 await page.getByLabel('Review scope', { exact: true }).selectOption('changes');
 assert.equal(await page.getByRole('button', { name: 'Other review actions', exact: true }).count(), 0);
 await review.getByRole('button', { name: 'Choose comparison version', exact: true }).click();
 await page.getByRole('dialog', { name: 'Comparison versions', exact: true }).locator('.comparison-version').filter({ hasText: 'When opened' }).click();
 await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1120, 820)); await shot('04-language-and-changed-passages');
 await button('More options').click(); await button('Inspect request').click();
 const prompt = await page.locator('.context-preview pre').innerText(); assert(prompt.includes('review-changes')); assert(!prompt.includes(revised));
 await button('Close Codex context').click(); await button('Start review').click();
 await poll(() => app.evaluate(() => !!globalThis.__qualityProbe.publish), 'review running');
 const readable = await app.evaluate(() => globalThis.__qualityProbe.reader.call('references_read', { fileId: 'review-changes' }));
 assert(JSON.stringify(readable).includes('An obsolete transition'));
 await app.evaluate(async () => { await globalThis.__qualityProbe.publish([{ category: 'Grammar', title: 'Singular proof', explanation: 'Use singular agreement.', original: 'proof are', replacement: 'proof is', before: '', after: '', packages: [] }]); });
 await page.getByText('Singular proof', { exact: true }).waitFor(); assert.equal(await source(), revised);
 assert(await button('Accept').isEnabled()); await shot('05-early-suggestion'); await button('Accept').click();
 await poll(() => source().then(s => s.includes('proof is')), 'accepted early suggestion');
 await page.getByLabel('Review progress and controls', { exact: true }).click(); await button('Stop review').click();
 await poll(() => button('Review with Codex').isEnabled(), 'stopped review'); await button('Undo').click();
 await poll(() => source().then(s => s === revised), 'Undo accepted suggestion');
 assert.equal(await fs.readFile(file, 'utf8'), draft);
 receipt.checks.push('Language purpose and selected baseline are visible in Review. The request excludes the paper; the readable change document includes deletions. One early suggestion can be accepted during review, Stop keeps work, Undo restores the unsaved source.');
 await button('Review with Codex').click(); await page.getByLabel('Review scope', { exact: true }).selectOption('document');
 await button('Other review actions').click(); assert(await page.getByRole('menuitem', { name: 'Review section by section', exact: true }).isEnabled()); await page.keyboard.press('Escape');
 assert.deepEqual(receipt.rendererErrors, []); receipt.passed = true;
} catch (error) { receipt.passed = false; receipt.failure = String(error.stack ?? error); if (page) await shot('failure').catch(() => {}); throw error; }
finally {
 if (app) { const child = app.process(); await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app.close(); receipt.processes.at(-1).exited = child.exitCode !== null || child.signalCode !== null; }
 await fs.writeFile(path.join(evidence, 'results.json'), JSON.stringify(receipt, null, 2)); console.log(JSON.stringify(receipt));
 if (receipt.passed && !evidence.startsWith(root + path.sep)) await fs.rm(root, { recursive: true, force: true });
}
