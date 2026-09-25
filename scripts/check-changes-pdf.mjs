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
await fs.symlink(path.join(appRoot, 'node_modules'), path.join(copy, 'node_modules'), 'dir');
await fs.writeFile(path.join(copy, 'package.json'), JSON.stringify({ name: 'comparison-check', version: '1.2.0', main: 'dist/main.cjs', private: true }));
const injection = `
const comparisonProbe = { file:null, hold:false, release:null, holdPersist:false, releasePersist:null, holdLocation:false, releaseLocation:null, skipVisual:false, builds:0, reviewPrompts:[], ids:[], resourceInvalid:false, arrangements:0, invalid:false, visuals:0, plans:[], artifacts:[] };
dialog.showOpenDialog = async()=>({ canceled:false, filePaths:[comparisonProbe.file] });
const originalPersist = projects.persist.bind(projects);
projects.persist = async(...args)=>{ if(comparisonProbe.holdPersist) { comparisonProbe.holdPersist=false; await new Promise(resolve=>{comparisonProbe.releasePersist=resolve;}); } return originalPersist(...args); };
const originalInspect = compiler.inspect.bind(compiler);
compiler.inspect = async(...args)=>comparisonProbe.resourceInvalid ? {status:'changed'} : originalInspect(...args);
const originalCompile = compiler.compile.bind(compiler);
compiler.compile = async(...args)=>{ comparisonProbe.builds++; if(comparisonProbe.hold) { comparisonProbe.hold=false; await new Promise(resolve=>{comparisonProbe.release=resolve;}); } const result=await originalCompile(...args);comparisonProbe.ids.push({id:result.id,purpose:args[5]??'paper'});return result; };
codex.planChanges = async(projectId, prompt)=>{ comparisonProbe.arrangements++; const changes=JSON.parse(prompt).changes; comparisonProbe.plans.push(changes.length); return { inspect: comparisonProbe.skipVisual ? [] : changes.filter(c=>c.shownIn[JSON.parse(prompt).presentation]).slice(0,1).map(c=>c.id), groups: (comparisonProbe.invalid ? changes.slice(1) : changes).map(c=>({ids:[c.id],layout:'keep',summary:'Controlled summary of this difference.'})) }; };
codex.checkChanges = async(projectId,prompt,images)=>{ comparisonProbe.visuals++; if(!images.length || !images.every(s=>s.startsWith('data:image/png;base64,'))) throw Error('Missing real screenshot'); return {readable:true,issues:[]}; };
const originalComparisonBuild = changesPdf.build.bind(changesPdf);
changesPdf.build = async(input)=>{const artifact=await originalComparisonBuild(input);comparisonProbe.artifacts.push({after:input.after,id:artifact.id,presentation:artifact.presentation});return artifact;};
const originalPresentation = changesPdf.present.bind(changesPdf);
changesPdf.present = async(projectId,id,presentation)=>{const previous=comparisonProbe.artifacts.find(a=>a.id===id), artifact=await originalPresentation(projectId,id,presentation);comparisonProbe.artifacts.push({after:previous?.after,id:artifact.id,presentation:artifact.presentation});return artifact;};
const originalLocation = changesPdf.locate.bind(changesPdf);
changesPdf.locate = async(...args)=>{const result=await originalLocation(...args);if(comparisonProbe.holdLocation){comparisonProbe.holdLocation=false;await new Promise(resolve=>{comparisonProbe.releaseLocation=resolve;});}return result;};
codex.client.run = async(prompt)=>{ comparisonProbe.reviewPrompts.push(JSON.parse(prompt));return {comments:[]}; };
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
async function pdfGeometry() {
  return pane().locator('.pdf-scroll').evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,top:el.scrollTop,left:el.scrollLeft,zoom:el.parentElement.querySelector('[aria-label="PDF zoom"]').value};});
}
async function nativeFind() {
  await application.evaluate(({Menu})=>{
    const item=Menu.getApplicationMenu().items.find(i=>i.label==='Find')?.submenu?.items.find(i=>i.label==='Find in focused pane…');
    if(!item) throw Error('Registered native Find command missing');
    item.click();
  });
}
try {
  application = await _electron.launch({ executablePath: require('electron'), args: [copy], cwd: appRoot, env: { ...process.env, MODERN_EDITOR_RUNTIME_DIR: path.join(root, 'runtime') }, chromiumSandbox: true, timeout: 25000 });
  const child = application.process(); receipt.processes.push({ pid: child.pid, exited: false }); console.log('Owned Electron PID', child.pid);
  page = await application.firstWindow(); page.setDefaultTimeout(18000); page.on('pageerror', e => receipt.rendererErrors.push(String(e)));
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1660, 1100));
  await page.evaluate(reader.outputFiles[0].text); await application.evaluate((_, file) => { globalThis.__comparisonProbe.file = file; }, file);
  await button('Open a LaTeX or text file').click(); await page.locator('.source-pane .cm-content').waitFor();
  if (await button('Dismiss notice').count()) await button('Dismiss notice').click();
  const reviewStart = await read();
  await button('Review with Codex').click();
  const reviewDialog = page.getByRole('region', {name:'Request Codex review'}), localEdits = reviewDialog.getByLabel('Smallest local edits only');
  assert(await localEdits.isChecked());
  for (const preset of ['literary','creative','academic']) {
    await reviewDialog.getByLabel('Review template',{exact:true}).selectOption(preset);
    assert((await reviewDialog.getByLabel('Instructions for this review').inputValue()).length>100);
    assert(await localEdits.isChecked(),'Choosing a template retains the local-edit choice');
  }
  await reviewDialog.getByLabel('Instructions for this review').fill('Keep my notation. Correct one word at a time.');
  assert.equal(await reviewDialog.getByLabel('Review template',{exact:true}).inputValue(),'custom');
  await snapshot('00-review-templates');
  await button('Preview context sent to Codex').click();
  const previewed = JSON.parse(await page.locator('.context-preview pre').innerText());
  assert(previewed.editPolicy.includes('shortest safe exact source quotation'));
  assert.equal(previewed.authorInstructions,'Keep my notation. Correct one word at a time.');
  await button('Close Codex context').click(); await button('Start review').click();
  await poll(async()=>await application.evaluate(()=>globalThis.__comparisonProbe.reviewPrompts.length)===1 && await button('Review with Codex').isEnabled(),'local review completed');
  assert.deepEqual(await application.evaluate(()=>globalThis.__comparisonProbe.reviewPrompts[0]),previewed,'The exact previewed template and local-edit policy reach Codex through IPC');
  await button('Review with Codex').click(); await localEdits.uncheck();
  await button('Start review').click();
  await poll(async()=>await application.evaluate(()=>globalThis.__comparisonProbe.reviewPrompts.length)===2 && await button('Review with Codex').isEnabled(),'ordinary review completed');
  assert.equal(await application.evaluate(()=>globalThis.__comparisonProbe.reviewPrompts[1].editPolicy),undefined,'The option can be disabled without losing author instructions');
  await button('Review with Codex').click(); await localEdits.check();
  await button('Review section by section').click();
  await page.getByText(/Section review complete/).waitFor();
  await button('Dismiss section progress').click();
  const sections=await application.evaluate(()=>globalThis.__comparisonProbe.reviewPrompts.slice(2));
  assert.equal(sections.length,2); assert(sections.every(p=>p.editPolicy===previewed.editPolicy && p.authorInstructions===previewed.authorInstructions));
  assert.deepEqual(await read(),reviewStart,'Review controls preserve source and Undo');
  receipt.checks.push('Editable Kevin Bryan style presets / smallest local edits enabled by default and switchable / exact preview reaches ordinary and every section request / no source edits');
  await button('Compile').click(); await page.getByLabel('PDF matches the current source', { exact:true }).waitFor({ timeout:60000 });
  const ordinaryId = await application.evaluate(() => globalThis.__comparisonProbe.ids.find(b=>b.purpose==='paper').id);
  await page.getByLabel('Viewer format').selectOption('changes');
  await pane().getByText('No source changes.', { exact: true }).waitFor();
  const initial = await read(); await button('Preview').click();
  await poll(async () => await pane().getByLabel('Comparison change').count() > 0 && await pane().getByRole('button',{name:'Refresh Changes PDF',exact:true}).isEnabled(), 'automatic marked preview');
  assert.equal(await pane().getByRole('alert').count(),0,await pane().innerText());
  assert.deepEqual(await read(),initial); assert.equal(await fs.readFile(file,'utf8'),before);
  assert.equal(await pane().locator('.change-detail').count(), 0, 'Details stay collapsed after preparing');
  await pane().locator('.pdf-change-note').first().waitFor({state:'attached'});
  assert.equal(await pane().locator('.pdf-change-note:visible').count(),0,'Margin buttons start hidden');
  await pane().locator('.pdf-scroll').focus();await nativeFind();
  const changesSearch=pane().getByLabel('Find in PDF',{exact:true});await changesSearch.waitFor();
  await poll(()=>changesSearch.evaluate(e=>e===document.activeElement),'Changes PDF Find receives focus',3000);await changesSearch.fill('synthetic');
  await pane().getByLabel('Viewer format').selectOption('pdf');
  const ordinary=page.locator('#pdf-surface > .pdf-reader');
  await ordinary.locator('.pdf-scroll').focus();await nativeFind();
  const ordinarySearch=ordinary.getByLabel('Find in PDF',{exact:true});await ordinarySearch.waitFor();
  await poll(()=>ordinarySearch.evaluate(e=>e===document.activeElement),'Native Find reaches the visible ordinary PDF',3000);
  await ordinarySearch.fill('allocation');
  assert.equal(await changesSearch.inputValue(),'synthetic','The hidden search retains its own query');
  await ordinary.getByRole('button',{name:'Close PDF search',exact:true}).click();
  await ordinary.locator('.pdf-scroll').focus();await nativeFind();
  await poll(()=>ordinarySearch.evaluate(e=>e===document.activeElement),'Visible PDF keeps Find when hidden search remains open',3000);
  await ordinary.getByRole('button',{name:'Close PDF search',exact:true}).click();
  await page.getByLabel('Viewer format').selectOption('text');
  await page.locator('.text-diff-host .cm-content').focus();await nativeFind();
  const textSearch=page.locator('.text-diff-host input[name="search"]');await textSearch.waitFor();
  await poll(()=>textSearch.evaluate(e=>e===document.activeElement),'Text diff Find does not activate a hidden PDF',3000);
  assert.equal(await changesSearch.inputValue(),'synthetic');await textSearch.press('Escape');
  await page.getByLabel('Viewer format').selectOption('changes');
  await poll(async()=>await pane().getAttribute('aria-busy')==='false' && await pane().getAttribute('data-artifact'),'comparison after re-entry');
  await pane().locator('.pdf-scroll').focus();await nativeFind();
  await poll(()=>changesSearch.evaluate(e=>e===document.activeElement),'Changes PDF Find receives focus',3000);
  await pane().getByRole('button',{name:'Close PDF search',exact:true}).click();
  receipt.checks.push('Registered native Find reaches each visible viewer with both PDF readers mounted and hidden search retained');
  await pane().locator('.change-details-toggle').click();
  await pane().locator('.pdf-change-note').first().click();
  assert((await pane().innerText()).includes('Proposal explanation'));
  await pane().locator('.change-details-toggle').click();
  await snapshot('01-marked-proposal'); receipt.checks.push('Marked proposal / exact candidate / no source or Undo mutation / clickable margin marker');
  await button('Return to draft').click();
  await poll(async()=>await pane().getAttribute('aria-busy')==='false' && await page.locator('.app-shell').getAttribute('aria-busy')==='false','returned draft settled');
  await button('Accept').click();
  await poll(async () => (await read()).text.includes('sentence has'), 'accepted correction');
  await write(after); await refresh();
  assert.equal(await pane().getByLabel('Comparison change').locator('option').count(), 6);
  assert.equal(await pane().getByLabel('Comparison change').inputValue(), '1', 'Skip preamble omission on initial selection');
  assert.equal(await pane().locator('.change-detail').count(), 0);
  const viewBox = await page.locator('#pdf-surface').boundingBox(), pdfBox = await pane().getByRole('region', {name:'Compiled PDF', exact:true}).boundingBox();
  assert(pdfBox.height / viewBox.height > .9, 'PDF keeps at least 90% of viewer height');
  assert(pdfBox.y - viewBox.y <= 44, 'Only one compact row above the PDF');
  await snapshot('02-compact-default');
  await page.locator('#pdf-surface').screenshot({path:path.join(evidence,'viewer-revision-markup.png')});
  await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1180,850));
  await snapshot('02-compact-narrow');
  await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1660,1100));
  for(const size of [[1660,1100],[1180,850]]) {
    await application.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setContentSize(...size),size);
    await page.waitForTimeout(400); const stable=await pdfGeometry();
    assert.equal(await pane().locator('.pdf-change-note:visible').count(),0);
    const toggleCounts=await application.evaluate(()=>({builds:globalThis.__comparisonProbe.builds,plans:globalThis.__comparisonProbe.arrangements}));
    const canvasBefore=await pane().locator('canvas').evaluateAll(nodes=>nodes.map(n=>n.toDataURL()));
    const toolbar=pane().locator('.changes-toolbar'), header=await toolbar.boundingBox(), reader=await pane().locator('.pdf-scroll').boundingBox();
    assert(reader.y-header.y<=44,'Wide and narrow views keep a single header row');
    assert(await toolbar.evaluate(el=>el.scrollWidth<=el.clientWidth),'All header controls fit without horizontal overflow');
    await pane().locator('.changes-options > summary').click();
    assert(await pane().getByLabel('Text diff baseline').isVisible());
    assert(await pane().getByLabel('Accepted changes per update').isVisible());
    assert.deepEqual(await pdfGeometry(),stable,'Opening baseline/settings leaves PDF bounds and position unchanged');
    await pane().locator('.changes-options > summary').press('Escape');
    assert(!await pane().getByLabel('Text diff baseline').isVisible());
    await pane().getByRole('button',{name:'Find',exact:true}).click();
    assert(await pane().getByLabel('Find in PDF').isVisible());
    assert.deepEqual(await pdfGeometry(),stable,'Opening PDF search never moves the page');
    await pane().getByRole('button',{name:'Close PDF search',exact:true}).click();
    await pane().locator('.change-details-toggle').click(); await page.waitForTimeout(150);
    assert.deepEqual(await pdfGeometry(),stable,'Opening the reason does not move the PDF');
    assert(await pane().locator('.pdf-change-note:visible').count()>0,'Why reveals the margin buttons');
    assert.equal(await pane().getByRole('button',{name:'Explain change 2',exact:true}).innerText(),'[2]');
    assert(!/\[\d+\]/.test(await pane().locator('.textLayer').allTextContents().then(t=>t.join(''))),'PDF has no baked-in numbered labels');
    const explanation=pane().locator('.change-detail');
    assert((await explanation.innerText()).includes('The singular subject needs a singular verb.'));
    assert((await explanation.innerText()).includes('Recorded acceptance reason'));
    assert(!await explanation.locator('.change-wording').isVisible(),'Raw LaTeX is collapsed by default');
    const reason=await explanation.locator('.change-reason').boundingBox(), disclosure=await explanation.locator('.change-source-details > summary').boundingBox();
    assert(reason.y<disclosure.y,'The recorded reason comes before source comparison');
    await snapshot(size[0]===1660?'02-reason-first':'02-reason-first-narrow');
    await explanation.locator('.change-source-details > summary').click(); await page.waitForTimeout(100);
    assert(await explanation.locator('.change-wording').isVisible()); assert.deepEqual(await pdfGeometry(),stable,'Expanding LaTeX leaves PDF bounds, scroll and zoom unchanged');
    await explanation.getByRole('button',{name:'Close explanation',exact:true}).click(); await page.waitForTimeout(100);
    assert.deepEqual(await pdfGeometry(),stable,'Closing the reason leaves the PDF unchanged');
    assert.equal(await pane().locator('.pdf-change-note:visible').count(),0,'Closing Why hides the buttons');
    assert.deepEqual(await pane().locator('canvas').evaluateAll(nodes=>nodes.map(n=>n.toDataURL())),canvasBefore,'Why never changes the rendered page');
    assert.deepEqual(await application.evaluate(()=>({builds:globalThis.__comparisonProbe.builds,plans:globalThis.__comparisonProbe.arrangements})),toggleCounts,'Why makes no compile or Codex request');
  }
  await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1660,1100));
  receipt.checks.push('One-row header / bottom page controls / options, search and reason overlays preserve PDF bounds, scroll and zoom at wide and narrow widths / raw LaTeX collapsed');
  // A simultaneous mode choice and explicit update must not restart after Stop.
  const cancelCount = await application.evaluate(()=>{globalThis.__comparisonProbe.holdPersist=true;return globalThis.__comparisonProbe.builds;});
  await page.evaluate(()=>{const pane=document.querySelector('.changes-pdf-pane'),format=pane.querySelector('[aria-label="Viewer format"]');format.value='changes-clean';format.dispatchEvent(new Event('change',{bubbles:true}));pane.querySelector('[aria-label="Refresh Changes PDF"]').click();});
  await poll(()=>application.evaluate(()=>!!globalThis.__comparisonProbe.releasePersist),'held full update with absent clean style');
  await pane().getByRole('button',{name:'Stop',exact:true}).click();
  await application.evaluate(()=>{globalThis.__comparisonProbe.releasePersist();globalThis.__comparisonProbe.releasePersist=null;});
  await poll(async()=>await pane().getAttribute('aria-busy')==='false','stopped absent-style update');
  await page.waitForTimeout(400);
  assert.equal(await application.evaluate(()=>globalThis.__comparisonProbe.builds),cancelCount,'Stop must not fall through into local style compilation');
  await pane().getByLabel('Viewer format').selectOption('changes'); await refresh();
  receipt.checks.push('Stop cancels a scheduled update even when the selected presentation has not been built');
  const modeSource = await read();
  const modeCounts = await application.evaluate(() => ({plans:globalThis.__comparisonProbe.arrangements, visuals:globalThis.__comparisonProbe.visuals}));
  const markupId = await pane().getAttribute('data-artifact');
  await pane().getByLabel('Viewer format').selectOption('changes-clean');
  await poll(async()=>await pane().getAttribute('data-presentation')==='clean' && await pane().getAttribute('aria-busy')==='false','clean presentation');
  assert.equal(await pane().getByRole('alert').count(),0,await pane().innerText());
  assert.deepEqual(await read(),modeSource,'Switching presentation leaves source and Undo unchanged');
  assert.deepEqual(await application.evaluate(()=>({plans:globalThis.__comparisonProbe.arrangements,visuals:globalThis.__comparisonProbe.visuals})),modeCounts,'Style switch makes no model or visual request');
  await snapshot('03-clean-paper');
  await page.locator('#pdf-surface').screenshot({path:path.join(evidence,'viewer-clean-paper.png')});
  await pane().getByLabel('Comparison change').selectOption('4');
  await pane().locator('.pdf-change-note.selected').waitFor({state:'attached'});
  assert.equal(await pane().locator('.pdf-change-note:visible').count(),0,'Deletion navigation works with hidden markers');
  assert.equal(await pane().locator('.pdf-passage-marker').count(),0,'A clean deletion highlights its exact marker, never a nearby text line');
  await pane().getByRole('button',{name:'Explain change',exact:true}).click();
  assert(await pane().locator('.pdf-change-note.selected').isVisible(),'Why reveals the selected deletion marker');
  assert(!await pane().locator('.change-wording').isVisible());
  await pane().locator('.change-source-details > summary').click();
  assert((await pane().locator('.change-wording').innerText()).includes('This entire paragraph will be removed.'));
  assert((await pane().locator('.change-wording').innerText()).includes('Passage deleted.'));
  await snapshot('04-clean-deletion-explanation');
  await page.locator('#pdf-surface').screenshot({path:path.join(evidence,'viewer-change-explanation.png')});
  await pane().locator('.change-details-toggle').click();
  await pane().getByLabel('Viewer format').selectOption('changes');
  await poll(async()=>await pane().getAttribute('data-artifact')===markupId,'cached markup');
  assert.deepEqual(await application.evaluate(()=>({plans:globalThis.__comparisonProbe.arrangements,visuals:globalThis.__comparisonProbe.visuals})),modeCounts);
  await pane().getByLabel('Comparison change').selectOption('2'); await pane().locator('[data-change-note="change-3"].selected').waitFor({state:'attached'}); await snapshot('05-paragraph-rewrite');
  await pane().getByLabel('Comparison change').selectOption('3'); await pane().locator('[data-change-note="change-4"].selected').waitFor({state:'attached'}); await snapshot('06-mathematics');
  await pane().getByRole('button',{name:'2 not shown',exact:true}).click();
  assert((await pane().innerText()).includes('Change not shown.'));
  // At fit width this one-page fixture is too short to scroll the marker
  // behind the panel. A normal reader zoom gives the regression room.
  await pane().getByLabel('PDF zoom').selectOption('1.5');
  await pane().getByLabel('Comparison change').selectOption('0');
  await pane().locator('[data-change-note="change-1"].selected').waitFor({state:'attached'});
  const selectedNote = pane().locator('[data-change-note="change-1"].selected');
  const noteUncovered = () => selectedNote.evaluate(el => {
    const r=el.getBoundingClientRect(), overlay=el.closest('.changes-pdf-pane').querySelector('.changes-bottom').getBoundingClientRect();
    return r.bottom<=overlay.top && document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===el;
  });
  await selectedNote.evaluate(el => {
    const scroll=el.closest('.pdf-scroll'), marker=el.getBoundingClientRect();
    const overlay=el.closest('.changes-pdf-pane').querySelector('.changes-bottom').getBoundingClientRect();
    scroll.scrollTop += marker.top-overlay.top-20;
  });
  await poll(async()=>!await noteUncovered(),'marker deliberately behind explanation');
  await pane().getByLabel('Comparison change').selectOption('0');
  await poll(noteUncovered,'reselect reveals marker above explanation without closing Why');
  assert(await pane().getByRole('button',{name:'Hide explanation',exact:true}).isVisible());
  // Exercise the final-page scroll boundary independently of fixture wording.
  // The exact marker remains on its measured page; only this test's DOM
  // position is moved to the lower edge to simulate a final-line annotation.
  const originalMarkerTop = await selectedNote.evaluate(el => {
    const top=el.style.top, paper=el.closest('.pdf-paper'), scroll=el.closest('.pdf-scroll');
    el.style.top=(paper.clientHeight-el.offsetHeight-24)+'px';
    scroll.scrollTop=scroll.scrollHeight;
    return top;
  });
  await poll(async()=>!await noteUncovered(),'final marker covered at maximum scroll');
  await pane().getByLabel('Comparison change').selectOption('0');
  await poll(noteUncovered,'final-page navigation gains enough scroll room');
  const allowance = await pane().locator('.pdf-scroll').evaluate(el=>el.style.paddingBottom);
  await pane().getByLabel('Comparison change').selectOption('0');
  await poll(noteUncovered,'repeated final-page navigation stays visible');
  assert.equal(await pane().locator('.pdf-scroll').evaluate(el=>el.style.paddingBottom),allowance,'Repeated navigation does not accumulate scroll padding');
  const withAllowance = await pdfGeometry();
  await pane().getByRole('button',{name:'Hide explanation',exact:true}).click();
  await page.waitForTimeout(100);
  await pane().getByRole('button',{name:'Explain change',exact:true}).click();
  await page.waitForTimeout(100);
  assert.deepEqual(await pdfGeometry(),withAllowance,'Why toggles stay stationary with final-page scroll allowance');
  await selectedNote.evaluate((el,top)=>{el.style.top=top;},originalMarkerTop);
  await pane().getByLabel('PDF zoom').selectOption('1');
  await pane().getByLabel('Comparison change').selectOption('0');
  await poll(noteUncovered,'fit-width marker remains unobscured');
  await snapshot('07-omitted-changes');
  assert((await pane().innerText()).includes('Controlled summary'));
  await pane().locator('.changes-options summary').click();
  assert((await pane().innerText()).includes('Sol visually checked pages'));
  await pane().locator('.changes-options summary').click();
  await pane().locator('.change-details-toggle').click();
  assert((await application.evaluate(() => globalThis.__comparisonProbe.visuals)) > 0);
  receipt.checks.push('Markup and clean paper share source, IDs and explanations / clean deletion marker / local style switch and cached return use no model / explicit omitted-change control');
  await application.evaluate(()=>{globalThis.__comparisonProbe.holdLocation=true;globalThis.__comparisonProbe.skipVisual=false;});
  await pane().getByRole('button',{name:'Refresh Changes PDF',exact:true}).click();
  await poll(()=>application.evaluate(()=>!!globalThis.__comparisonProbe.releaseLocation),'held post-build navigation');
  await pane().getByRole('button',{name:'Stop',exact:true}).click();
  await application.evaluate(()=>{globalThis.__comparisonProbe.releaseLocation();globalThis.__comparisonProbe.releaseLocation=null;globalThis.__comparisonProbe.skipVisual=false;});
  await poll(async()=>await pane().getAttribute('aria-busy')==='false','stopped navigation settled');
  assert.equal(await pane().locator('.pdf-change-note.selected').count(),0,'Stop prevents a late exact-marker response from moving the viewer');
  await refresh();
  receipt.checks.push('Stop after compilation suppresses delayed marker navigation and does not restart work');
  // Refresh creates a new captured comparison; cache its second presentation
  // before exercising invalidation of both cached styles below.
  await pane().getByLabel('Viewer format').selectOption('changes-clean');
  await poll(async()=>await pane().getAttribute('data-presentation')==='clean' && await pane().getAttribute('aria-busy')==='false','clean cached after Stop regression');
  await pane().getByLabel('Viewer format').selectOption('changes');
  // Invalid resources invalidate BOTH cached styles, including quick toggles.
  await application.evaluate(()=>{globalThis.__comparisonProbe.resourceInvalid=true;});
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await poll(async()=>(await pane().innerText()).includes('Older comparison'),'resource invalidation');
  for(const style of ['Clean paper','Revision markup','Clean paper','Revision markup']) {
    await pane().getByLabel('Viewer format').selectOption(style === 'Clean paper' ? 'changes-clean' : 'changes');
    assert.equal(await pane().getByLabel('Comparison change').isEnabled(),false,'Known-invalid snapshot never regains navigation on style toggle');
    assert((await pane().innerText()).includes('Older comparison'));
  }
  await application.evaluate(()=>{globalThis.__comparisonProbe.resourceInvalid=false;});
  await refresh();
  // Cache the second presentation again for the following typing-only check.
  await pane().getByLabel('Viewer format').selectOption('changes-clean');
  await poll(async()=>await pane().getAttribute('data-presentation')==='clean' && await pane().getAttribute('aria-busy')==='false','clean rebuilt after invalidation');
  await pane().getByLabel('Viewer format').selectOption('changes');
  receipt.checks.push('Resource invalidation stays attached to both cached styles until explicit regeneration');
  const countBefore = await application.evaluate(() => globalThis.__comparisonProbe.arrangements);
  await write(after.replace('otherwise reads well','otherwise reads smoothly'));
  await page.waitForTimeout(500);
  assert.equal(await application.evaluate(() => globalThis.__comparisonProbe.arrangements), countBefore, 'Typing alone never starts Sol');
  await pane().getByLabel('Viewer format').selectOption('changes-clean');
  await poll(async()=>await pane().getAttribute('data-presentation')==='clean','older cached clean view');
  assert((await pane().innerText()).includes('Older comparison'));
  assert.equal(await pane().getByLabel('Comparison change').isEnabled(),false);
  assert.equal(await application.evaluate(()=>globalThis.__comparisonProbe.arrangements),countBefore,'Switching after typing does not send the new draft');
  await button('Save').click();
  await poll(() => application.evaluate((_,n)=>globalThis.__comparisonProbe.arrangements>n,countBefore),'Save triggers Sol');
  await poll(async () => await pane().getByRole('button',{name:'Refresh Changes PDF',exact:true}).isEnabled(), 'Save-triggered update finished');
  // Reopening or saving the same captured comparison does not call Sol or TeX.
  await pane().getByLabel('Comparison change').selectOption('2');
  if(await pane().getByRole('button',{name:'Explain change',exact:true}).count()) await pane().getByRole('button',{name:'Explain change',exact:true}).click();
  await page.waitForTimeout(400);
  const unchanged=await application.evaluate(()=>({builds:globalThis.__comparisonProbe.builds,plans:globalThis.__comparisonProbe.arrangements}));
  const stableGeometry=await pdfGeometry(), selectedBefore=await pane().getByLabel('Comparison change').inputValue();
  await button('Save').click();
  await poll(async()=>await button('Save').isEnabled() && await pane().getAttribute('aria-busy')==='false','unchanged Save settled');
  await page.waitForTimeout(250);
  assert.deepEqual(await application.evaluate(()=>({builds:globalThis.__comparisonProbe.builds,plans:globalThis.__comparisonProbe.arrangements})),unchanged);
  await pane().getByLabel('Viewer format').selectOption('pdf'); await page.getByLabel('Viewer format').selectOption('changes');
  await poll(async()=>await pane().getAttribute('aria-busy')==='false','unchanged reopen settled');
  await page.waitForTimeout(250);
  assert.deepEqual(await application.evaluate(()=>({builds:globalThis.__comparisonProbe.builds,plans:globalThis.__comparisonProbe.arrangements})),unchanged);
  assert.equal(await pane().getByLabel('Comparison change').inputValue(),selectedBefore);
  assert(await pane().getByRole('button',{name:'Hide explanation',exact:true}).isVisible());
  assert.deepEqual(await pdfGeometry(),stableGeometry);
  // Earlier edits renumber IDs. Preserve the actual selected source pair, Why,
  // and the reading position rather than navigating to the new first change.
  const selectedPair=await pane().locator('.change-wording').allTextContents();
  await write((await read()).text.replace('A synthetic comparison','A synthetic comparison, revised'));
  await button('Save').click();
  await poll(()=>application.evaluate((_,n)=>globalThis.__comparisonProbe.arrangements>n,unchanged.plans),'changed Save requests Sol');
  await poll(async()=>await pane().getAttribute('aria-busy')==='false','changed Save settled');
  assert(await pane().getByRole('button',{name:'Hide explanation',exact:true}).isVisible());
  assert.deepEqual(await pane().locator('.change-wording').allTextContents(),selectedPair);
  await snapshot('08-preserved-reading');
  receipt.checks.push('Unchanged Save/reopen reuse verified PDF with no Sol/build; changed Save preserves the selected source pair and open Why');
  // The old comparison remains navigable during a refresh. Publication must
  // retain the latest selection, not the selection captured at request start.
  await pane().getByLabel('Comparison change').selectOption('0');
  await application.evaluate(()=>{globalThis.__comparisonProbe.hold=true;});
  await pane().getByRole('button',{name:'Refresh Changes PDF',exact:true}).click();
  await poll(()=>application.evaluate(()=>!!globalThis.__comparisonProbe.release),'held refresh for live navigation');
  await pane().getByLabel('Comparison change').selectOption('2');
  const livePair=await pane().locator('.change-wording').allTextContents();
  await application.evaluate(()=>{globalThis.__comparisonProbe.release();globalThis.__comparisonProbe.release=null;});
  await poll(async()=>await pane().getAttribute('aria-busy')==='false','live-navigation refresh settled');
  assert.equal(await pane().getByLabel('Comparison change').inputValue(),'2');
  assert.deepEqual(await pane().locator('.change-wording').allTextContents(),livePair);
  assert(await pane().getByRole('button',{name:'Hide explanation',exact:true}).isVisible());
  receipt.checks.push('Navigation during a held refresh preserves the latest selected source pair and open Why after publication');
  await application.evaluate(() => { globalThis.__comparisonProbe.invalid = true; });
  await pane().getByRole('button',{name:'Refresh Changes PDF',exact:true}).click();
  await poll(async () => (await pane().innerText()).includes('Sol analysis unavailable') && await pane().getAttribute('aria-busy')==='false', 'local comparison after rejected arrangement');
  assert.equal(await pane().getByRole('alert').count(),0);
  assert(await pane().getByRole('region',{name:'Compiled PDF',exact:true}).isVisible());
  assert(!(await pane().innerText()).includes('Sol summary:'),'A rejected arrangement cannot leave an old summary on the local result');
  await snapshot('09-local-fallback');
  await application.evaluate(() => { globalThis.__comparisonProbe.invalid = false; });
  const beforeLocal=await application.evaluate(()=>globalThis.__comparisonProbe.arrangements);
  await pane().locator('.changes-options > summary').click();
  await pane().getByRole('button',{name:'Build locally without Sol',exact:true}).click();
  await poll(async()=>await pane().getAttribute('aria-busy')==='false','explicit local build completed');
  assert.equal(await application.evaluate(()=>globalThis.__comparisonProbe.arrangements),beforeLocal);
  await pane().locator('.changes-options > summary').click();
  receipt.checks.push('Explicit Refresh retries Sol; malformed Sol falls back to verified local PDF; explicit local build makes no model call');
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
  const batchText = '\\documentclass{article}\n\\begin{document}\n\n' + Array.from({length:6},(_,i)=>`Paragraph ${i+1} have a small error. % old source note ${i+1}\nThe next sentence is unchanged.\n\n`).join('') + '\\end{document}\n';
  const batchComments = Array.from({length:6},(_,i)=>{const original=`Paragraph ${i+1} have a small error. % old source note ${i+1}`,from=batchText.indexOf(original);return {id:`batch-${i}`,title:`Correct paragraph ${i+1}`,explanation:'Use the singular verb.',category:'Grammar',original,replacement:original.replace('have','has').replace('old source note','updated source note'),from,to:from+original.length,validity:'current',decision:'open',packages:[],messages:[]};});
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
  assert.equal(await pane().getByLabel('Comparison change').locator('option').count(),10,'Five prose edits and five source-note edits are accounted for separately');
  assert(await pane().getByRole('button',{name:'5 not shown',exact:true}).isVisible(),'Only the source-note edits are unshown');
  await pane().getByLabel('PDF page 1, rendered',{exact:true}).waitFor();
  await snapshot('08-comment-prose-markup');
  await page.locator('#pdf-surface').screenshot({path:path.join(evidence,'viewer-comment-prose-markup.png')});
  const commentsSnapshot = await read();
  await pane().getByLabel('Viewer format').selectOption('changes-clean');
  await poll(async()=>await pane().getAttribute('data-presentation')==='clean' && await pane().getAttribute('aria-busy')==='false','clean comment-aware comparison');
  await poll(async()=>/Paragraph\s+1\s+has\s+a\s+small\s+error/.test((await pane().locator('.textLayer').allTextContents()).join(' ')),'clean PDF contains the corrected prose');
  assert.deepEqual(await read(),commentsSnapshot,'Comment-aware comparisons preserve source and Undo');
  await snapshot('09-comment-prose-clean');
  receipt.checks.push('Changed percent notes are separated from all five prose corrections / real markup and clean PDFs render / source and Undo preserved');
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
