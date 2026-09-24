// Native Electron / real-TeX comparison check. The only model response is controlled.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
assert(args.length === 0 || args.length === 2 && args[0] === '--playwright-package');
const require = createRequire(path.join(appRoot, 'package.json'));
const { _electron } = (args.length ? createRequire(path.resolve(args[1])) : require)('playwright');
const root = path.join(appRoot, '.test-runs', 'changes-desktop-' + Date.now()), copy = path.join(root, 'desktop');
const evidence = path.join(appRoot, 'test-evidence', 'changes-desktop-' + Date.now());
await fs.mkdir(copy, { recursive: true }); await fs.mkdir(evidence, { recursive: true });
await fs.cp(path.join(appRoot, 'dist'), path.join(copy, 'dist'), { recursive: true });
await fs.writeFile(path.join(copy, 'package.json'), JSON.stringify({ name: 'comparison-check', version: '1.2.0', main: 'dist/main.cjs', private: true }));
const injection = `
const comparisonProbe = { file:null, hold:false, release:null, holdPersist:false, releasePersist:null, builds:0, ids:[], resourceInvalid:false, arrangements:0, invalid:false, visuals:0, plans:[], artifacts:[] };
dialog.showOpenDialog = async()=>({ canceled:false, filePaths:[comparisonProbe.file] });
const originalPersist = projects.persist.bind(projects);
projects.persist = async(...args)=>{ if(comparisonProbe.holdPersist) { comparisonProbe.holdPersist=false; await new Promise(resolve=>{comparisonProbe.releasePersist=resolve;}); } return originalPersist(...args); };
const originalInspect = compiler.inspect.bind(compiler);
compiler.inspect = async(...args)=>comparisonProbe.resourceInvalid ? {status:'changed'} : originalInspect(...args);
const originalCompile = compiler.compile.bind(compiler);
compiler.compile = async(...args)=>{ comparisonProbe.builds++; if(comparisonProbe.hold) { comparisonProbe.hold=false; await new Promise(resolve=>{comparisonProbe.release=resolve;}); } const result=await originalCompile(...args);comparisonProbe.ids.push({id:result.id,purpose:args[5]??'paper'});return result; };
codex.planChanges = async(projectId, prompt)=>{ comparisonProbe.arrangements++; const changes=JSON.parse(prompt).changes; comparisonProbe.plans.push(changes.length); return { inspect: changes.filter(c=>c.layout!=='omitted').slice(0,1).map(c=>c.id), groups: (comparisonProbe.invalid ? changes.slice(1) : changes).map(c=>({ids:[c.id],layout:'keep',summary:'Controlled summary of this difference.'})) }; };
codex.checkChanges = async(projectId,prompt,images)=>{ comparisonProbe.visuals++; if(!images.length || !images.every(s=>s.startsWith('data:image/png;base64,'))) throw Error('Missing real screenshot'); return {readable:true,issues:[]}; };
const originalComparisonBuild = changesPdf.build.bind(changesPdf);
changesPdf.build = async(input)=>{const artifact=await originalComparisonBuild(input);comparisonProbe.artifacts.push({after:input.after,id:artifact.id,presentation:artifact.presentation});return artifact;};
const originalPresentation = changesPdf.present.bind(changesPdf);
changesPdf.present = async(projectId,id,presentation)=>{const previous=comparisonProbe.artifacts.find(a=>a.id===id), artifact=await originalPresentation(projectId,id,presentation);comparisonProbe.artifacts.push({after:previous?.after,id:artifact.id,presentation:artifact.presentation});return artifact;};
globalThis.__comparisonProbe = comparisonProbe; globalThis.__comparisonProjects=projects;
`;
await build({ entryPoints: [path.join(appRoot, 'src/main/index.ts')], outfile: path.join(copy, 'dist/main.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'],
  plugins: [{ name: 'comparison-probe', setup(b) { b.onLoad({ filter: /src\/main\/index\.ts$/ }, async a => ({ contents: await fs.readFile(a.path, 'utf8') + injection, loader: 'ts' })); } }] });
const reader = await build({ stdin: { contents: "import {EditorView} from '@codemirror/view';import {undoDepth} from '@codemirror/commands';window.comparisonRead=()=>{let v=EditorView.findFromDOM(document.querySelector('.source-pane .cm-content'));return {text:v.state.doc.toString(),undo:undoDepth(v.state)};};window.comparisonWrite=text=>{let v=EditorView.findFromDOM(document.querySelector('.source-pane .cm-content'));v.dispatch({changes:{from:0,to:v.state.doc.length,insert:text}});};", resolveDir: appRoot }, bundle: true, write: false, format: 'iife', platform: 'browser' });
const original = 'This sentence have a small mistake and otherwise reads well.';
const before = String.raw`\documentclass{article}
\usepackage{amsmath}
\begin{document}

\section*{A synthetic comparison}
This sentence have a small mistake and otherwise reads well.

The old proof leaves the induction step implicit.

\[ x + 1 = 2. \]

This entire paragraph will be removed.

\section{Conclusion}\label{old}
This unchanged paragraph closes the note.

\end{document}
`;
const after = before.replace('\\usepackage{amsmath}', '% A source-only note.\n\\usepackage{amsmath}').replace('have', 'has').replace('The old proof leaves the induction step implicit.', 'For the induction step, apply the hypothesis at the preceding index. Substitution into the displayed identity establishes the claim at the next index, completing the proof.').replace('x + 1 = 2.', 'x + 2 = 3.').replace('This entire paragraph will be removed.\n\n', '').replace('label{old}', 'label{new}');
const paper = path.join(root, 'paper'); await fs.mkdir(path.join(paper, '.modern-editor'), { recursive: true });
const file = path.join(paper, 'paper.tex'), from = before.indexOf(original);
await fs.writeFile(file, before);
await fs.writeFile(path.join(paper, '.modern-editor/review.json'), JSON.stringify({ schemaVersion: 1, rootFile: 'paper.tex', sourceHash: createHash('sha256').update(before).digest('hex'), activeId: 'grammar', updatedAt: new Date().toISOString(), comments: [{ id: 'grammar', title: 'Correct the verb', explanation: 'The singular subject needs a singular verb.', category: 'Grammar', original, replacement: original.replace('have','has'), from, to: from + original.length, validity: 'current', decision: 'open', packages: [], messages: [] }] }));
const receipt = { synthetic: true, realTex: true, liveCodex: false, checks: [], rendererErrors: [], processes: [] };
let application, page;
async function poll(fn, label, timeout = 45000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return; await new Promise(r => setTimeout(r, 80)); } throw new Error('Timed out: ' + label); }
const button = name => page.getByRole('button', { name, exact: true });
const pane = () => page.locator('.changes-pdf-pane');
async function read() { return page.evaluate(() => window.comparisonRead()); }
async function write(text) { await page.evaluate(text => window.comparisonWrite(text), text); }
async function refresh() {
  const after=(await read()).text, count=await application.evaluate(()=>globalThis.__comparisonProbe.artifacts.length);
  await pane().getByRole('button', {name:'Refresh Changes PDF',exact:true}).click();
  await poll(async()=>{if(await pane().getByRole('alert').count())return true;const matches=await application.evaluate((_,v)=>globalThis.__comparisonProbe.artifacts.slice(v.count).filter(a=>a.after===v.after).map(a=>a.id),{after,count});return matches.includes(await pane().getAttribute('data-artifact')) && await pane().getAttribute('aria-busy')==='false';},'current comparison completed');
  assert.equal(await pane().getByRole('alert').count(),0,await pane().innerText());
}
async function snapshot(name) { await page.waitForTimeout(400); await page.screenshot({ path: path.join(evidence, name + '.png') }); }
try {
  application = await _electron.launch({ executablePath: require('electron'), args: [copy], cwd: appRoot, env: { ...process.env, MODERN_EDITOR_RUNTIME_DIR: path.join(root, 'runtime') }, chromiumSandbox: true, timeout: 25000 });
  const child = application.process(); receipt.processes.push({ pid: child.pid, exited: false }); console.log('Owned Electron PID', child.pid);
  page = await application.firstWindow(); page.setDefaultTimeout(18000); page.on('pageerror', e => receipt.rendererErrors.push(String(e)));
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1660, 1100));
  await page.evaluate(reader.outputFiles[0].text); await application.evaluate((_, file) => { globalThis.__comparisonProbe.file = file; }, file);
  await button('Open a LaTeX or text file').click(); await page.locator('.source-pane .cm-content').waitFor();
  if (await button('Dismiss notice').count()) await button('Dismiss notice').click();
  await button('Compile').click(); await page.getByLabel('PDF matches the current source', { exact:true }).waitFor({ timeout:60000 });
  const ordinaryId = await application.evaluate(() => globalThis.__comparisonProbe.ids.find(b=>b.purpose==='paper').id);
  await page.getByLabel('Viewer format').selectOption('changes');
  await pane().getByText('No source changes.', { exact: true }).waitFor();
  const initial = await read(); await button('Preview').click();
  await poll(async () => await pane().getByLabel('Comparison change').count() > 0 && await pane().getByRole('button',{name:'Refresh Changes PDF',exact:true}).isEnabled(), 'automatic marked preview');
  assert.equal(await pane().getByRole('alert').count(),0,await pane().innerText());
  assert.deepEqual(await read(),initial); assert.equal(await fs.readFile(file,'utf8'),before);
  assert.equal(await pane().locator('.change-detail').count(), 0, 'Details stay collapsed after preparing');
  await pane().locator('.pdf-change-note').first().waitFor(); await pane().locator('.pdf-change-note').first().click();
  assert((await pane().innerText()).includes('Proposal explanation'));
  await pane().locator('.change-details-toggle').click();
  await snapshot('01-marked-proposal'); receipt.checks.push('Marked proposal / exact candidate / no source or Undo mutation / clickable margin marker');
  await button('Return to draft').click(); await page.locator('.review-rail').focus(); await page.keyboard.press('Shift+A');
  await poll(async () => (await read()).text.includes('sentence has'), 'accepted correction');
  await write(after); await refresh();
  assert.equal(await pane().getByLabel('Comparison change').locator('option').count(), 6);
  assert.equal(await pane().getByLabel('Comparison change').inputValue(), '1', 'Skip preamble omission on initial selection');
  assert.equal(await pane().locator('.change-detail').count(), 0);
  const viewBox = await page.locator('#pdf-surface').boundingBox(), pdfBox = await pane().getByRole('region', {name:'Compiled PDF', exact:true}).boundingBox();
  assert(pdfBox.height / viewBox.height > .7, 'PDF keeps at least 70% of viewer height');
  await snapshot('02-compact-default');
  await page.locator('#pdf-surface').screenshot({path:path.join(evidence,'viewer-revision-markup.png')});
  await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1180,850));
  await snapshot('02-compact-narrow');
  await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1660,1100));
  await pane().locator('.change-details-toggle').click();
  assert((await pane().innerText()).includes('Recorded acceptance reason'));
  await pane().locator('.change-details-toggle').click();
  // A simultaneous mode choice and explicit update must not restart after Stop.
  const cancelCount = await application.evaluate(()=>{globalThis.__comparisonProbe.holdPersist=true;return globalThis.__comparisonProbe.builds;});
  await page.evaluate(()=>{const buttons=[...document.querySelectorAll('.changes-pdf-pane button')];buttons.find(b=>b.textContent==='Clean paper').click();buttons.find(b=>b.getAttribute('aria-label')==='Refresh Changes PDF').click();});
  await poll(()=>application.evaluate(()=>!!globalThis.__comparisonProbe.releasePersist),'held full update with absent clean style');
  await pane().getByRole('button',{name:'Stop',exact:true}).click();
  await application.evaluate(()=>{globalThis.__comparisonProbe.releasePersist();globalThis.__comparisonProbe.releasePersist=null;});
  await poll(async()=>await pane().getAttribute('aria-busy')==='false','stopped absent-style update');
  await page.waitForTimeout(400);
  assert.equal(await application.evaluate(()=>globalThis.__comparisonProbe.builds),cancelCount,'Stop must not fall through into local style compilation');
  await pane().getByRole('button',{name:'Revision markup',exact:true}).click(); await refresh();
  receipt.checks.push('Stop cancels a scheduled update even when the selected presentation has not been built');
  const modeSource = await read();
  const modeCounts = await application.evaluate(() => ({plans:globalThis.__comparisonProbe.arrangements, visuals:globalThis.__comparisonProbe.visuals}));
  const markupId = await pane().getAttribute('data-artifact');
  await pane().getByRole('button',{name:'Clean paper',exact:true}).click();
  await poll(async()=>await pane().getAttribute('data-presentation')==='clean' && await pane().getAttribute('aria-busy')==='false','clean presentation');
  assert.equal(await pane().getByRole('alert').count(),0,await pane().innerText());
  assert.deepEqual(await read(),modeSource,'Switching presentation leaves source and Undo unchanged');
  assert.deepEqual(await application.evaluate(()=>({plans:globalThis.__comparisonProbe.arrangements,visuals:globalThis.__comparisonProbe.visuals})),modeCounts,'Style switch makes no model or visual request');
  await snapshot('03-clean-paper');
  await page.locator('#pdf-surface').screenshot({path:path.join(evidence,'viewer-clean-paper.png')});
  await pane().getByLabel('Comparison change').selectOption('4');
  await pane().locator('.pdf-change-note.selected').waitFor();
  assert.equal(await pane().locator('.pdf-passage-marker').count(),0,'A clean deletion highlights its exact marker, never a nearby text line');
  await pane().getByRole('button',{name:'Explain change',exact:true}).click();
  assert((await pane().locator('.change-wording').innerText()).includes('This entire paragraph will be removed.'));
  assert((await pane().locator('.change-wording').innerText()).includes('Passage deleted.'));
  await snapshot('04-clean-deletion-explanation');
  await page.locator('#pdf-surface').screenshot({path:path.join(evidence,'viewer-change-explanation.png')});
  await pane().locator('.change-details-toggle').click();
  await pane().getByRole('button',{name:'Revision markup',exact:true}).click();
  await poll(async()=>await pane().getAttribute('data-artifact')===markupId,'cached markup');
  assert.deepEqual(await application.evaluate(()=>({plans:globalThis.__comparisonProbe.arrangements,visuals:globalThis.__comparisonProbe.visuals})),modeCounts);
  await pane().getByLabel('Comparison change').selectOption('2'); await pane().locator('.pdf-passage-marker').waitFor(); await snapshot('05-paragraph-rewrite');
  await pane().getByLabel('Comparison change').selectOption('3'); await pane().locator('.pdf-passage-marker').waitFor(); await snapshot('06-mathematics');
  await pane().getByRole('button',{name:'2 not shown',exact:true}).click();
  assert((await pane().innerText()).includes('Change not shown.'));
  await snapshot('07-omitted-changes');
  assert((await pane().innerText()).includes('Controlled summary'));
  await pane().locator('.changes-options summary').click();
  assert((await pane().innerText()).includes('Sol visually checked pages'));
  await pane().locator('.changes-options summary').click();
  await pane().locator('.change-details-toggle').click();
  assert((await application.evaluate(() => globalThis.__comparisonProbe.visuals)) > 0);
  receipt.checks.push('Markup and clean paper share source, IDs and explanations / clean deletion marker / local style switch and cached return use no model / explicit omitted-change control');
  // Invalid resources invalidate BOTH cached styles, including quick toggles.
  await application.evaluate(()=>{globalThis.__comparisonProbe.resourceInvalid=true;});
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await poll(async()=>(await pane().innerText()).includes('Older comparison'),'resource invalidation');
  for(const style of ['Clean paper','Revision markup','Clean paper','Revision markup']) {
    await pane().getByRole('button',{name:style,exact:true}).click();
    assert.equal(await pane().getByLabel('Comparison change').isEnabled(),false,'Known-invalid snapshot never regains navigation on style toggle');
    assert((await pane().innerText()).includes('Older comparison'));
  }
  await application.evaluate(()=>{globalThis.__comparisonProbe.resourceInvalid=false;});
  await refresh();
  // Cache the second presentation again for the following typing-only check.
  await pane().getByRole('button',{name:'Clean paper',exact:true}).click();
  await poll(async()=>await pane().getAttribute('data-presentation')==='clean' && await pane().getAttribute('aria-busy')==='false','clean rebuilt after invalidation');
  await pane().getByRole('button',{name:'Revision markup',exact:true}).click();
  receipt.checks.push('Resource invalidation stays attached to both cached styles until explicit regeneration');
  const countBefore = await application.evaluate(() => globalThis.__comparisonProbe.arrangements);
  await write(after.replace('otherwise reads well','otherwise reads smoothly'));
  await page.waitForTimeout(500);
  assert.equal(await application.evaluate(() => globalThis.__comparisonProbe.arrangements), countBefore, 'Typing alone never starts Sol');
  await pane().getByRole('button',{name:'Clean paper',exact:true}).click();
  await poll(async()=>await pane().getAttribute('data-presentation')==='clean','older cached clean view');
  assert((await pane().innerText()).includes('Older comparison'));
  assert.equal(await pane().getByLabel('Comparison change').isEnabled(),false);
  assert.equal(await application.evaluate(()=>globalThis.__comparisonProbe.arrangements),countBefore,'Switching after typing does not send the new draft');
  await button('Save').click();
  await poll(() => application.evaluate((_,n)=>globalThis.__comparisonProbe.arrangements>n,countBefore),'Save triggers Sol');
  await poll(async () => await pane().getByRole('button',{name:'Refresh Changes PDF',exact:true}).isEnabled(), 'Save-triggered update finished');
  await application.evaluate(() => { globalThis.__comparisonProbe.invalid = true; });
  await pane().getByRole('button',{name:'Refresh Changes PDF',exact:true}).click();
  await poll(async () => (await pane().innerText()).includes('does not cover every change'), 'rejected incomplete arrangement');
  await application.evaluate(() => { globalThis.__comparisonProbe.invalid = false; });
  receipt.checks.push('Sol only after view request / no typing trigger / Save and Refresh update / actual rendered images checked / invalid arrangement rejected');
  // Cancel while source recovery is still being flushed, before any build starts.
  const buildCount = await application.evaluate(() => { globalThis.__comparisonProbe.holdPersist = true; return globalThis.__comparisonProbe.builds; });
  await write(after.replace('otherwise reads well','otherwise reads naturally'));
  await pane().getByRole('button',{name:'Refresh Changes PDF',exact:true}).click();
  await poll(() => application.evaluate(() => !!globalThis.__comparisonProbe.releasePersist), 'held source flush');
  await pane().getByRole('button',{name:'Stop',exact:true}).click();
  await application.evaluate(() => { globalThis.__comparisonProbe.releasePersist(); globalThis.__comparisonProbe.releasePersist = null; });
  await poll(async () => await pane().getByRole('button',{name:'Refresh Changes PDF',exact:true}).isEnabled(), 'cancelled comparison settled');
  assert.equal(await application.evaluate(() => globalThis.__comparisonProbe.builds), buildCount, 'Cancel prevents a build waiting for recovery from starting');
  receipt.checks.push('Cancel during recovery flush prevents compilation from starting');
  await write(after);
  // A pending result cannot become current after the author edits.
  await application.evaluate(() => { globalThis.__comparisonProbe.hold = true; });
  await pane().getByRole('button',{name:'Refresh Changes PDF',exact:true}).click();
  await poll(() => application.evaluate(() => !!globalThis.__comparisonProbe.release), 'held build');
  await write(after.replace('otherwise reads well','otherwise reads clearly'));
  await application.evaluate(() => { globalThis.__comparisonProbe.release(); globalThis.__comparisonProbe.release = null; });
  await poll(async () => await pane().getByRole('button',{name:'Refresh Changes PDF',exact:true}).isEnabled(),'late build settled');
  assert((await pane().innerText()).includes('Older comparison'));
  await write(before); await refresh(); assert((await pane().innerText()).includes('No source changes.'));
  assert.equal(await pane().getByLabel('Comparison change').count(),0);
  receipt.checks.push('Late result rejected after typing / returning to baseline leaves no changes');
  const noBuildCount = await application.evaluate(()=>globalThis.__comparisonProbe.builds);
  await write(before.replace('article', 'report')); await refresh();
  assert.equal(await application.evaluate(()=>globalThis.__comparisonProbe.builds),noBuildCount);
  await pane().getByText('Preview not possible',{exact:true}).waitFor();
  assert.equal(await pane().getByRole('region',{name:'Compiled PDF',exact:true}).count(),0);
  await snapshot('06-unavailable');
  receipt.checks.push('Entirely unsupported changes stay visible as text-only without compiling an unmarked paper');
  await write(before);
  await page.getByLabel('Viewer format').selectOption('pdf'); await page.getByLabel('PDF page 1, rendered',{exact:true}).waitFor();
  await button('Save').click();
  await poll(async()=>await fs.readFile(file,'utf8')===before,'save restored synthetic source');
  const state = await application.evaluate(() => globalThis.__comparisonProjects.current);
  if (!await button('Close project').isVisible()) await button('Actions ▾').click();
  await button('Close project').click(); await button('Open a LaTeX or text file').waitFor();
  await button('Open a LaTeX or text file').click(); await page.locator('.source-pane .cm-content').waitFor();
  const workspace = await application.evaluate(() => globalThis.__comparisonProjects.current.workspace);
  assert(workspace.pdfBuildId); assert.equal(workspace.pdfBuildId,ordinaryId);
  await page.getByLabel('PDF inputs need verification',{exact:true}).waitFor();
  await page.getByLabel('PDF page 1, rendered',{exact:true}).waitFor();
  assert.equal(await fs.readFile(file,'utf8'),before);
  receipt.checks.push('Close/reopen restores ordinary paper PDF; manuscript bytes unchanged');
  // Five ordinary accepts trigger one update, but only after requesting this view.
  const batchFile = path.join(paper, 'batch.tex');
  const batchText = '\\documentclass{article}\n\\begin{document}\n\n' + Array.from({length:6},(_,i)=>`Paragraph ${i+1} have a small error.\n\n`).join('') + '\\end{document}\n';
  const batchComments = Array.from({length:6},(_,i)=>{const original=`Paragraph ${i+1} have a small error.`,from=batchText.indexOf(original);return {id:`batch-${i}`,title:`Correct paragraph ${i+1}`,explanation:'Use the singular verb.',category:'Grammar',original,replacement:original.replace('have','has'),from,to:from+original.length,validity:'current',decision:'open',packages:[],messages:[]};});
  await fs.writeFile(batchFile,batchText);
  await fs.writeFile(path.join(paper,'.modern-editor/review.json'),JSON.stringify({schemaVersion:1,rootFile:'batch.tex',sourceHash:createHash('sha256').update(batchText).digest('hex'),activeId:'batch-0',updatedAt:new Date().toISOString(),comments:batchComments}));
  await button('Close project').click(); await button('Open a LaTeX or text file').waitFor();
  await page.evaluate(reader.outputFiles[0].text);
  await application.evaluate((_,file)=>{globalThis.__comparisonProbe.file=file;},batchFile);
  const beforeRequest = await application.evaluate(()=>globalThis.__comparisonProbe.arrangements);
  await button('Open a LaTeX or text file').click(); await page.locator('.source-pane .cm-content').waitFor();
  assert.equal(await application.evaluate(()=>globalThis.__comparisonProbe.arrangements),beforeRequest);
  await button('View ▾').click(); await button('Three panes').click();
  await page.getByLabel('Viewer format').selectOption('changes');
  await pane().getByText('No source changes.',{exact:true}).waitFor();
  const debugInitial=await page.evaluate(()=>window.editor.debugState());
  assert.equal(debugInitial.settings.enabled,false); assert.equal(debugInitial.entries.length,0);
  await page.evaluate(()=>window.editor.configureDebug({enabled:true,screenshots:true,screenshotSeconds:60}));
  for(let i=1;i<=5;i++){
    await page.locator('.review-rail').focus();await page.keyboard.press('Shift+A');
    await poll(async()=>(await read()).text.split(' has ').length-1===i,`accepted ${i} corrections`);
    if(i<5) {await page.waitForTimeout(150);assert.equal(await application.evaluate(()=>globalThis.__comparisonProbe.arrangements),beforeRequest);}
  }
  await poll(()=>application.evaluate((_,n)=>globalThis.__comparisonProbe.arrangements===n+1,beforeRequest),'fifth acceptance starts one Sol update');
  await poll(async()=>await pane().getAttribute('aria-busy')==='false','batch update and visual check finished');
  await poll(async()=>(await page.evaluate(()=>window.editor.debugState())).entries.some(e=>e.kind==='screenshot'),'periodic private editor screenshot',20000);
  const debugState=await page.evaluate(()=>window.editor.debugState()); assert(debugState.directory.startsWith(root));
  assert(debugState.entries.some(e=>e.kind==='event'));
  await snapshot('07-five-accepts');
  const removed=await page.evaluate(()=>window.editor.deleteDebug('all'));
  assert.equal(removed.settings.enabled,false);assert.equal(removed.entries.length,0);
  assert((await read()).text.includes('Paragraph 5 has'));assert.equal(await fs.readFile(batchFile,'utf8'),batchText);
  const beforeHidden=await application.evaluate(()=>globalThis.__comparisonProbe.arrangements);
  await page.getByLabel('Viewer format').selectOption('text');await button('Save').click();
  await poll(async()=>await fs.readFile(batchFile,'utf8')===(await read()).text,'saved while Changes PDF hidden');
  assert.equal(await application.evaluate(()=>globalThis.__comparisonProbe.arrangements),beforeHidden);
  receipt.checks.push('Five accepts start exactly one Sol update / Save while hidden starts none / private debugging defaults off / editor screenshot and register / clearing switches logging off without changing source');
  assert.deepEqual(receipt.rendererErrors,[]); receipt.passed = true;
} catch(e) { receipt.passed=false; receipt.error=String(e.stack??e); if(page) await snapshot('failure').catch(()=>{}); throw e; }
finally {
  if (application) { const child=application.process(); await application.evaluate(()=>{globalThis.__comparisonProbe.release?.();globalThis.__comparisonProbe.releasePersist?.();}).catch(()=>{}); await application.close().catch(()=>{}); if(child.exitCode===null && child.signalCode===null) await new Promise(resolve=>child.once('exit',resolve)); receipt.processes[0].exited=child.exitCode!==null||child.signalCode!==null; }
  await fs.writeFile(path.join(evidence,'results.json'),JSON.stringify(receipt,null,2)); console.log(evidence);
  if(receipt.passed && receipt.processes.every(p=>p.exited)) await fs.rm(root,{recursive:true,force:true});
}
