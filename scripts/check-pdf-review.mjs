// Synthetic native workflow: real persistence/TeX/PDFs; model calls are disabled.
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
const root = path.join(appRoot, '.test-runs', 'pdf-review-' + Date.now()), copy = path.join(root, 'desktop');
const evidence = process.env.ME_TEST_EVIDENCE || path.join(appRoot, 'test-evidence', 'pdf-review-' + Date.now());
await fs.mkdir(copy, { recursive: true }); await fs.mkdir(evidence, { recursive: true });
await fs.cp(path.join(appRoot, 'dist'), path.join(copy, 'dist'), { recursive: true });
await fs.symlink(path.join(appRoot, 'node_modules'), path.join(copy, 'node_modules'), 'dir');
await fs.writeFile(path.join(copy, 'package.json'), JSON.stringify({ name:'writing-check', version:'1.2.1', main:'dist/main.cjs', private:true }));
const injection = `
ipcMain.removeHandler('setup:models');ipcMain.handle('setup:models',()=>[{id:'test-smart',name:'Test Smart',efforts:['low','medium','high','max'],images:true,fast:true,isDefault:true}]);
const probe={file:null,save:null,builds:0,modelCalls:0,pdfReads:0,pdfIds:[],completedBuilds:[],dialogs:0,artifacts:[]};
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[probe.file]});
dialog.showSaveDialog=async(_,options)=>{probe.dialogs++;probe.dialog=options;return {canceled:!probe.save,filePath:probe.save};};
shell.showItemInFolder=()=>{};
const originalCompile=compiler.compile.bind(compiler);
compiler.compile=async(...args)=>{probe.builds++;const result=await originalCompile(...args);probe.completedBuilds.push({input:{projectId:args[0],text:args[1],purpose:args[5]},id:result.id,success:result.success});return result;};
const originalPdf=compiler.pdf.bind(compiler);
compiler.pdf=async(...args)=>{probe.pdfReads++;probe.pdfIds.push(args[0]);return originalPdf(...args);};
codex.client.run=async()=>{probe.modelCalls++;throw Error('No model calls are allowed by this test');};
const persist=projects.persist.bind(projects);projects.persist=async input=>{probe.lastInput=input;return persist(input);};
codex.planChanges=async(projectId,prompt)=>{probe.modelCalls++;return {inspect:[],groups:JSON.parse(prompt).changes.map(c=>({ids:[c.id],layout:'keep',summary:'Synthetic explanation.'}))};};
const originalComparison=changesPdf.build.bind(changesPdf);
changesPdf.build=async input=>{const artifact=await originalComparison(input);probe.artifacts.push(artifact);return artifact;};
globalThis.__writingProbe=probe;globalThis.__writingProjects=projects;globalThis.__writingCompiler=compiler;globalThis.__writingChanges=changesPdf;
`;
await build({ entryPoints:[path.join(appRoot,'src/main/index.ts')], outfile:path.join(copy,'dist/main.cjs'), bundle:true, platform:'node', format:'cjs', target:'node22', external:['electron'],
  plugins:[{name:'writing-probe',setup(b){b.onLoad({filter:/src\/main\/index\.ts$/},async a=>({contents:await fs.readFile(a.path,'utf8')+injection,loader:'ts'}));}}] });
const reader = await build({stdin:{contents:`
import {EditorView} from '@codemirror/view';
import {undoDepth} from '@codemirror/commands';
const v=()=>EditorView.findFromDOM(document.querySelector('.source-pane .cm-content'));
window.readWriting=()=>({text:v().state.doc.toString(),undo:undoDepth(v().state)});
window.selectWriting=(from,to)=>{const w=v();w.dispatch({selection:{anchor:from,head:to}});};
window.writeWriting=text=>v().dispatch({changes:{from:0,to:v().state.doc.length,insert:text},userEvent:'input.test'});
`,resolveDir:appRoot},bundle:true,write:false,format:'iife',platform:'browser'});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const source = '\\documentclass{article}\n\\begin{document}\n\\section{Setup}\nThe allocation is increasing. The proof are short.\n\n\\subsection{Details}\nAgents trade often.\n\n\\section{Result}\nThis are the conclusion.\n\\end{document}\n';
const paperDir = path.join(root,'paper'); await fs.mkdir(path.join(paperDir,'.modern-editor'),{recursive:true});
const file = path.join(paperDir,'main.tex'); await fs.writeFile(file,source);
await fs.writeFile(path.join(paperDir,'.modern-editor/review.json'),JSON.stringify({schemaVersion:1,rootFile:'main.tex',sourceHash:hash(source),activeId:'first',updatedAt:new Date().toISOString(),comments:[
  {id:'first',title:'Qualify the allocation',explanation:'Only weak monotonicity is required.',original:'increasing',replacement:'weakly increasing'},
  {id:'second',title:'Correct the proof verb',explanation:'Proof is singular.',original:'The proof are short.',replacement:'The proof is short.'},
  {id:'third',title:'Clarify timing',explanation:'Trade takes place when agents meet.',original:'trade often',replacement:'trade upon meeting'},
  {id:'fourth',title:'Correct the conclusion verb',explanation:'This is singular.',original:'This are the conclusion.',replacement:'This is the conclusion.'},
  {id:'question',title:'Check the conclusion',explanation:'Is the qualification needed?',original:'conclusion',replacement:null}
].map(c=>({...c,from:source.indexOf(c.original),to:source.indexOf(c.original)+c.original.length,validity:'current',decision:'open',packages:[],messages:[]}))}));
let application,page;
const receipt={root,synthetic:true,realTex:true,liveCodex:false,checks:[],rendererErrors:[],processes:[]};
const button = name => page.getByRole('button',{name,exact:true});
const read = () => page.evaluate(()=>window.readWriting());
const probe = () => application.evaluate(()=>globalThis.__writingProbe);
async function poll(fn,label,ms=30000){const until=Date.now()+ms;while(Date.now()<until){if(await fn())return;await new Promise(r=>setTimeout(r,70));}throw Error('Timed out: '+label);}
async function screenshot(name){await page.screenshot({path:path.join(evidence,name+'.png'),timeout:5000});}
async function actions(name){await button('Actions ▾').click();await button(name).click();}
async function open(){await application.evaluate((_,file)=>globalThis.__writingProbe.file=file,file);await button('Open a LaTeX or text file').click();await page.locator('.source-pane .cm-content').waitFor();await page.evaluate(reader.outputFiles[0].text);if(await button('Dismiss notice').count())await button('Dismiss notice').click();}
const oldDetails = () => page.locator('.review-heading .comment-details > button');
const reading = () => page.locator('.proposal-reading');
async function geometry() { return page.evaluate(() => Object.fromEntries(['.workspace','.source-pane','.review-rail','#pdf-surface'].map(s => [s,document.querySelector(s).getBoundingClientRect().toJSON()]))); }
const mode = () => page.getByRole('region', { name: 'PDF review mode', exact: true });
const popup = () => page.getByRole('dialog', { name: 'PDF comment inspector', exact: true });
const choose = async id => { await page.getByLabel('PDF review comment', { exact: true }).selectOption(id); await popup().waitFor(); };
const ready = async () => {
  await page.locator('.pdf-review-right canvas[aria-label$=", rendered"]').first().waitFor({ timeout: 60000 });
  await poll(async () => await page.getByRole('button', {name:'Refresh PDF review',exact:true}).isEnabled(), 'review ready', 60000);
  assert.equal(await page.locator('.pdf-review-status[role=alert]').count(), 0);
};
const pairGeometry = () => page.locator('.pdf-review-papers').evaluate(e => [...e.children].map(n => ({rect:n.getBoundingClientRect().toJSON(), scrollTop:n.querySelector('.pdf-scroll').scrollTop, scrollLeft:n.querySelector('.pdf-scroll').scrollLeft})));
async function checkChatRole(label) {
  await button('Codex Side Chat').click();
  const chat=page.getByRole('complementary',{name:'Codex Side Chat'});
  await chat.getByLabel('Message to Codex Side Chat',{exact:true}).fill('Explain the displayed PDF and supplied source.');
  if(!await chat.locator('.chat-context-options').evaluate(e=>e.open))await chat.locator('.chat-context-options > summary').click();
  await chat.getByRole('button',{name:'Preview what is sent',exact:true}).click();
  // An earlier preview stays mounted while the next snapshot is prepared.
  // Wait for this request to finish before reading its context.
  await poll(async()=>await chat.getByRole('button',{name:'Preview what is sent',exact:true}).isEnabled(),'chat preview prepared');
  const prepared=chat.locator('.chat-prepared pre');await prepared.waitFor();
  const context=JSON.parse(await prepared.innerText());assert.match(context.editorState.visiblePdf,label);assert.equal(context.source.text,source);assert.match(context.editorState.suppliedSource,/current draft/i);
  await chat.getByRole('button',{name:'Close Codex Side Chat',exact:true}).click();
}
async function saveComparison(menuLabel, label) {
  const captured = await probe(), artifact = captured.artifacts.at(-1);
  assert(artifact.build?.success);
  const expected = await application.evaluate(async (_, id) => {
    const p = globalThis.__writingProjects.current;
    const source = globalThis.__writingChanges.exportSource(p.id, id);
    const a = globalThis.__writingProbe.artifacts.find(a => a.id === id);
    return { source: source.text, pdf: Array.from(await globalThis.__writingCompiler.pdf(a.build.id)) };
  }, artifact.id);
  const chooseSave = async (name, file) => {
    await application.evaluate((_, file) => globalThis.__writingProbe.save = file, file);
    await page.getByLabel(menuLabel, {exact:true}).click();
    await button(name).click();
  };
  await page.getByLabel(menuLabel, {exact:true}).click();
  await screenshot(label + '-save-menu');
  await page.getByLabel(menuLabel, {exact:true}).click();
  const pdf = path.join(root, label + '-changes.pdf'), tex = path.join(root, label + '-changes.tex');
  await chooseSave('Save Changes PDF…', pdf);
  await poll(async () => (await fs.stat(pdf).catch(() => null))?.size > 0, 'saved comparison PDF');
  assert.deepEqual(await fs.readFile(pdf), Buffer.from(expected.pdf));
  assert.equal((await probe()).dialog.defaultPath, 'main-changes.pdf');
  await chooseSave('Save comparison LaTeX…', tex);
  await poll(async () => (await fs.stat(tex).catch(() => null))?.size > 0, 'saved comparison source');
  assert.equal(await fs.readFile(tex, 'utf8'), expected.source);
  assert.equal((await probe()).dialog.defaultPath, 'main-changes.tex');
  for (const name of ['Save Changes PDF…', 'Save comparison LaTeX…']) {
    const dialogs = (await probe()).dialogs;
    await chooseSave(name, null);
    await poll(async () => (await probe()).dialogs === dialogs + 1, 'cancel export');
  }
  await chooseSave('Save comparison LaTeX…', file);
  await page.getByRole('alert').filter({hasText:'That file already exists'}).waitFor();
  assert.equal(await fs.readFile(file, 'utf8'), source);
  await button('Dismiss error').click();
  assert.equal((await probe()).builds, captured.builds);
  assert.equal((await probe()).modelCalls, captured.modelCalls);
  receipt.checks.push(label + ': both ⋯ saves match the captured PDF/TeX exactly, cancellation is a no-op, and source export refuses to overwrite the manuscript. No new compilation or model call.');
}
try {
  application=await _electron.launch({executablePath:require('electron'),args:[copy],cwd:appRoot,env:{...process.env,MODERN_EDITOR_RUNTIME_DIR:path.join(root,'runtime')},chromiumSandbox:true,timeout:25000});
  const child=application.process();receipt.processes.push({pid:child.pid,exited:false});console.log('Owned Electron PID',child.pid);
  page=await application.firstWindow();page.setDefaultTimeout(20000);page.on('pageerror',e=>receipt.rendererErrors.push(String(e)));
  await application.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setContentSize(1600,1000);w.webContents.setBackgroundThrottling(false);});
  await open();
  await button('Compile').click();
  await poll(async () => (await probe()).completedBuilds.some(b => b.success), 'workspace PDF');
  await poll(async () => await button('Compile').isEnabled(), 'workspace compilation settled');
  for (const checkedCompile of [false, true]) {
    const saved = path.join(root, checkedCompile ? 'workspace-recompiled.pdf' : 'workspace-displayed.pdf'), before = await probe();
    await actions('Files & history…');
    const files = page.getByRole('dialog', { name: 'Files & history', exact: true });
    assert.equal(await files.getByRole('button', { name: 'Save Changes PDF…', exact: true }).count(), 0);
    await application.evaluate((_, saved) => globalThis.__writingProbe.save = saved, saved);
    await files.getByRole('button', { name: checkedCompile ? 'Compile current draft & save PDF…' : 'Save displayed PDF…', exact: true }).click();
    await poll(async () => (await fs.stat(saved).catch(() => null))?.size > 0, 'workspace PDF saved', 60000);
    const after = await probe(), id = after.completedBuilds.at(-1).id;
    const expected = Buffer.from(await application.evaluate(async (_, id) => Array.from(await globalThis.__writingCompiler.pdf(id)), id));
    assert.deepEqual(await fs.readFile(saved), expected);
    assert.equal(after.builds, before.builds + (checkedCompile ? 1 : 0));
    assert.equal(after.modelCalls, 0); assert.equal((await read()).text, source);
    assert.equal(await fs.readFile(file, 'utf8'), source);
  }
  receipt.checks.push('Workspace Files exports the displayed PDF exactly; Compile current draft & save performs one build and exports that result without accepting suggestions or saving source.');
  const workspaceBuild = (await probe()).completedBuilds.at(-1).id;
  await button('View ▾').click(); await button('PDF mode').click();
  await mode().waitFor(); await ready();
  await page.locator('.pdf-review-left canvas[aria-label$=", rendered"]').first().waitFor();
  await page.locator('.pdf-review-region.tentative').first().waitFor();
  assert.equal((await read()).text,source); assert.equal(await fs.readFile(file,'utf8'),source);
  assert.equal((await probe()).modelCalls,0);
  assert.match(await page.locator('.pdf-review-right .textLayer').allTextContents().then(x=>x.join(' ')),/weakly increasing/);
  await screenshot('01-two-pdf-review');
  receipt.checks.push('Two real PDF panes preview all four pending suggestions without changing source or contacting a model; tentative edit regions are measured link annotations.');
  const available = await probe();
  const originalBuild = available.completedBuilds.find(b => b.input.purpose === 'proposal' && b.input.text === source).id;
  const proposedBuild = available.completedBuilds.find(b => b.input.purpose === 'proposal' && b.input.text.includes('weakly increasing')).id;
  const changesBuild = available.artifacts.at(-1).build.id;
  for (const [label, id, suffix] of [
    ['Save Changes PDF…', changesBuild, 'changes'],
    ['Save Proposed revision PDF…', proposedBuild, 'proposed'],
    ['Save Original PDF…', originalBuild, 'original']
  ]) {
    assert.notEqual(id, workspaceBuild, 'PDF-mode export must have its own artifact identity');
    const expected = Buffer.from(await application.evaluate(async (_, id) => Array.from(await globalThis.__writingCompiler.pdf(id)), id));
    const saved = path.join(root, 'files-' + suffix + '.pdf'), before = await probe();
    await actions('Files & history…');
    const files = page.getByRole('dialog', { name: 'Files & history', exact: true });
    assert.equal(await files.getByRole('button', { name: 'Save displayed PDF…', exact: true }).count(), 0);
    if (suffix === 'changes') await screenshot('09-named-pdf-exports');
    await application.evaluate((_, saved) => globalThis.__writingProbe.save = saved, saved);
    await files.getByRole('button', { name: label, exact: true }).click();
    await poll(async () => (await fs.stat(saved).catch(() => null))?.size > 0, 'named PDF saved');
    assert.deepEqual(await fs.readFile(saved), expected);
    const after = await probe();
    assert(after.pdfIds.slice(before.pdfIds.length).includes(id));
    assert(!after.pdfIds.slice(before.pdfIds.length).includes(workspaceBuild));
    assert.equal(after.builds, before.builds); assert.equal(after.modelCalls, before.modelCalls);
  }
  assert.equal((await read()).text, source);
  receipt.checks.push('Files & history exports the exact named Changes, Proposed and Original artifacts while a distinct workspace PDF is hidden; no fallback, compilation, acceptance or model call.');
  await saveComparison('PDF review options', '06-pdf-mode');

  await page.locator('.pdf-review-left .pdf-scroll').evaluate(e => e.scrollTop = 50);
  await page.locator('.pdf-review-right .pdf-scroll').evaluate(e => e.scrollTop = 100);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.waitForTimeout(200);
  const geometryBefore=await pairGeometry();
  const beforeChat=await probe();
  await button('Codex Side Chat').click();
  const chat=page.getByRole('complementary',{name:'Codex Side Chat'});
  await page.getByLabel('Message to Codex Side Chat',{exact:true}).fill('Keep this draft while reading the two PDFs.');
  // Pointer gestures are covered in check-help-chat; use the same placement
  // controls via keyboard here so desktop pointer activity cannot disturb PDFs.
  await chat.getByRole('button',{name:'Move Side Chat',exact:true}).focus();
  for(let i=0;i<10;i++)await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('Shift+ArrowDown');
  await chat.getByRole('button',{name:'Resize Side Chat',exact:true}).focus();
  await page.keyboard.press('Shift+ArrowRight');await page.keyboard.press('Shift+ArrowUp');
  assert.deepEqual(await pairGeometry(),geometryBefore);
  await screenshot('10-floating-chat-over-pdfs');
  await chat.getByRole('button',{name:'Collapse Side Chat',exact:true}).click();
  assert.deepEqual(await pairGeometry(),geometryBefore);
  await screenshot('11-collapsed-chat-over-pdfs');
  await chat.getByRole('button',{name:'Expand Side Chat',exact:true}).click();
  assert.equal(await page.getByLabel('Message to Codex Side Chat',{exact:true}).inputValue(),'Keep this draft while reading the two PDFs.');
  await chat.getByRole('button',{name:'Close Codex Side Chat',exact:true}).click();
  assert.deepEqual(await pairGeometry(),geometryBefore);
  const afterChat=await probe();assert.equal(afterChat.builds,beforeChat.builds);assert.equal(afterChat.pdfReads,beforeChat.pdfReads);assert.equal(afterChat.modelCalls,beforeChat.modelCalls);
  receipt.checks.push('Floating Side Chat moves, resizes and collapses over real PDFs without changing either geometry, reading scroll, PDF reads, builds or model requests; the unsent draft is retained.');
  await page.locator('.pdf-review-region.tentative').first().click();
  await popup().waitFor();
  assert.match(await popup().innerText(),/Only weak monotonicity/);
  assert.deepEqual(await pairGeometry(),geometryBefore);
  await screenshot('02-popup-inspector');
  await button('Expand inspector').click(); assert.deepEqual(await pairGeometry(),geometryBefore);
  await screenshot('03-expanded-inspector');
  await button('Shrink inspector').click();
  const heading=popup().locator('.pdf-review-inspector-heading'), box=await heading.boundingBox();
  await page.mouse.move(box.x+50,box.y+18);await page.mouse.down();await page.mouse.move(box.x-200,box.y+60,{steps:5});await page.mouse.up();
  assert.deepEqual(await pairGeometry(),geometryBefore);
  await button('Back to PDFs').click();
  receipt.checks.push('Click the actual changed text to open its reason and diff. Expand, move and dismiss the inspector without changing either PDF geometry or reading scroll position.');

  await choose('first');
  const beforeAccept=await probe();
  await popup().getByRole('button',{name:'Accept',exact:true}).click();
  await poll(async()=>(await read()).text.includes('weakly increasing'),'individual acceptance');
  await page.waitForTimeout(800);
  assert.equal((await probe()).builds,beforeAccept.builds);
  assert.equal((await probe()).pdfReads,beforeAccept.pdfReads);
  assert.equal(await page.getByRole('button',{name:'Accepted edit · change 1',exact:true}).count()>0,true);
  assert.equal(await fs.readFile(file,'utf8'),source);
  await screenshot('04-accepted-and-tentative');
  await page.getByLabel('PDF review presentation',{exact:true}).selectOption('clean');
  await page.waitForTimeout(500);await ready();
  await page.locator('.pdf-change-note.review-mixed').first().waitFor();
  await page.locator('.pdf-change-note.review-tentative').first().waitFor();
  await screenshot('04b-clean-state-markers');
  await page.getByLabel('PDF review presentation',{exact:true}).selectOption('markup');
  await page.waitForTimeout(500);await ready();
  await choose('first'); assert.match(await popup().innerText(),/Accepted/); assert(await popup().getByRole('button',{name:'Accept',exact:true}).isDisabled());
  await button('Close inspector').click();
  await button('Undo').click();await poll(async()=>(await read()).text===source,'undo individual');
  receipt.checks.push('Accept keeps the candidate PDF bytes/reader alive, removes the tentative cue for that edit, updates only the working draft; clean presentation has Mixed/Tentative markers; Undo restores tentative state.');

  await choose('second'); await popup().getByRole('button',{name:'Reject',exact:true}).click();
  await page.waitForTimeout(500);await ready();
  assert.equal((await read()).text,source);
  await poll(async()=>/proof are short/.test(await page.locator('.pdf-review-right .textLayer').allTextContents().then(x=>x.join(' '))), 'rejected PDF text');
  await choose('second');assert.match(await popup().innerText(),/Rejected/);await button('Back to PDFs').click();
  await button('Undo').click();await page.waitForTimeout(500);await ready();
  receipt.checks.push('Reject removes the pending edit from the proposed PDF, preserves it as Rejected, and is undoable.');

  await choose('third');await popup().getByRole('button',{name:'Edit',exact:true}).click();
  const edit=popup().getByLabel('Proposed replacement',{exact:true});const beforeTyping=(await probe()).builds;
  await edit.fill('trade at meetings');await page.waitForTimeout(600);
  assert.equal((await probe()).builds,beforeTyping);
  await popup().getByRole('button',{name:'Clean',exact:true}).click();await page.waitForTimeout(500);await ready();
  assert.equal((await read()).text,source);await poll(async()=>/trade at meetings/.test(await page.locator('.pdf-review-right .textLayer').allTextContents().then(x=>x.join(' '))), 'edited PDF text');
  await popup().getByRole('button',{name:'Discuss',exact:true}).click();
  await popup().locator('#reply').fill('Keep the manuscript notation.');
  await button('Back to PDFs').click();await choose('third');
  assert.equal(await popup().locator('#reply').inputValue(),'Keep the manuscript notation.');
  await button('Back to PDFs').click();
  receipt.checks.push('Edit updates the whole proposal after leaving the text field, without keystroke builds or source mutation; discussion drafts persist in the ordinary comment.');

  await page.getByLabel('Review scope',{exact:true}).selectOption({label:'↳ Details'});
  assert.equal(await page.getByLabel('PDF review comment',{exact:true}).locator('option').count(),2);
  await button('Inspect').click();assert.match(await popup().innerText(),/Clarify timing/);assert(await button('Previous review suggestion').isDisabled());assert(await button('Next review suggestion').isDisabled());
  await popup().getByRole('button', {name:'Edit',exact:true}).click();
  await edit.fill('trade at \\undefinedReleaseTestCommand{meetings}');
  await popup().getByRole('button', {name:'Clean',exact:true}).click();
  await page.locator('.pdf-review-status[role=alert]').filter({hasText:'Preview not possible'}).waitFor({timeout:60000});
  await poll(async () => await button('Accept all applicable (1)').isEnabled(), 'failed preview settled');
  const failedBefore = await probe(), undoBefore = (await read()).undo;
  await button('Accept all applicable (1)').click();
  await page.getByRole('alert').filter({hasText:'Compilation failed. No suggestion was applied'}).waitFor({timeout:60000});
  assert.equal((await read()).text, source); assert.equal((await read()).undo, undoBefore);
  assert.equal((await probe()).lastInput.review.comments.find(c => c.id === 'third').decision, 'open');
  assert.equal((await probe()).builds, failedBefore.builds + 1);
  assert.equal(await fs.readFile(file, 'utf8'), source);
  await screenshot('10-failed-single-bulk');
  await button('Dismiss error').click();
  assert.equal(await page.getByLabel('PDF review comment',{exact:true}).locator('option').count(),2);
  await button('Inspect').click();assert.match(await popup().innerText(),/Clarify timing/);assert(await button('Previous review suggestion').isDisabled());assert(await button('Next review suggestion').isDisabled());
  await popup().getByRole('button', {name:'Edit',exact:true}).click();
  await edit.fill('trade at meetings');
  await popup().getByRole('button', {name:'Clean',exact:true}).click(); await page.waitForTimeout(500); await ready();
  await button('Back to PDFs').click();
  const singleBefore = (await probe()).builds;
  await button('Accept all applicable (1)').click();await poll(async()=>(await read()).text.includes('trade at meetings'),'subsection accept');
  assert.equal((await probe()).builds, singleBefore + 1);
  assert.match((await read()).text,/proof are short/);assert.match((await read()).text,/allocation is increasing/);
  await button('Undo').click();await poll(async()=>(await read()).text===source,'subsection undo');
  await page.getByLabel('Review scope',{exact:true}).selectOption({label:'Setup'});
  await button('Accept all applicable (3)').click();await poll(async()=>(await read()).text.includes('proof is short'),'section bulk compile',60000);
  assert.match((await read()).text,/trade at meetings/);assert.match((await read()).text,/This are the conclusion/);
  assert.equal(await fs.readFile(file,'utf8'),source);
  await button('Undo').click();await poll(async()=>(await read()).text===source,'bulk undo');
  await page.getByLabel('Review scope',{exact:true}).selectOption({label:'Whole paper'});
  await button('Reject all remaining (4)').click();await page.waitForTimeout(500);await ready();
  await poll(async()=>!(await probe()).lastInput.review.comments.some(c=>c.replacement!==null&&c.decision==='open'),'all rejections saved');
  assert.equal((await probe()).lastInput.review.comments.find(c=>c.id==='question').decision,'open');
  assert.equal((await read()).text,source);
  await button('Undo').click();await page.waitForTimeout(500);await ready();
  receipt.checks.push('Single-item bulk acceptance compiles: invalid LaTeX leaves source, decisions and Undo unchanged; corrected wording is checked before applying. Subsection/section/whole-paper decisions use exact scopes and one Undo; reject-all preserves questions and the original disk file.');

  const readsBeforeToggle=(await probe()).pdfReads;
  await page.getByLabel('Right PDF',{exact:true}).selectOption('original');
  await poll(async()=>await page.locator('.pdf-review-right .textLayer').allTextContents().then(x=>x.join(' ').includes('allocation is increasing')),'original PDF');
  await checkChatRole(/Original at session start/);
  await page.getByLabel('Right PDF',{exact:true}).selectOption('proposed');await ready();
  await checkChatRole(/Proposed revision including tentative/);
  receipt.checks.push('Prepared chat context names the visible Original/Proposed snapshot while identifying its supplied source as the current draft; preview sends no model request.');
  assert.equal((await read()).text,source);
  await page.locator('.pdf-review-right .pdf-scroll').click({position:{x:10,y:10}});
  await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('menu:command','find'));
  await page.locator('.pdf-review-right input[aria-label="Find in PDF"]').waitFor();
  await page.locator('.pdf-review-right input[aria-label="Find in PDF"]').fill('weakly');
  await page.getByLabel('Close PDF search',{exact:true}).click();
  await page.getByLabel('PDF review options',{exact:true}).click();
  await button('Refine comparison with Sol').click();
  await page.getByLabel('PDF review options',{exact:true}).click();
  await poll(async()=>(await probe()).modelCalls===1,'controlled Sol request');
  await ready();
  await screenshot('05-pdf-review-refined');
  receipt.checks.push('Original/proposed switch and native Find target the correct pane. Optional Sol arrangement uses the existing validated pipeline (controlled dry run, no paid call).');
  await button('Workspace').click();await page.locator('.source-pane .cm-content').waitFor();
  assert.equal((await read()).text,source);
  await button('View ▾').click();await button('PDF mode').click();await ready();
  assert.equal((await read()).text,source);assert.equal(await fs.readFile(file,'utf8'),source);
  assert.equal(receipt.rendererErrors.length,0);
  receipt.checks.push('Leaving and returning preserves the PDF session and ordinary workspace; no renderer errors or manuscript writes.');
  await button('Workspace').click();
  await page.evaluate(() => window.writeWriting(window.readWriting().text.replace('The proof are short.', 'The proof is short.')));
  await button('View ▾').click(); await button('Three panes').click();
  await page.getByRole('combobox', {name:'Viewer format',exact:true}).selectOption('changes');
  await page.locator('.changes-pdf-pane[aria-busy="false"][data-artifact]').waitFor({timeout:60000});
  await page.locator('.changes-pdf-pane canvas[aria-label$=", rendered"]').first().waitFor({timeout:60000});
  await saveComparison('Comparison options', '07-workspace');
  await page.getByRole('combobox', {name:'Viewer format',exact:true}).selectOption('pdf');
  await page.evaluate(() => window.writeWriting('Every original comment passage is now absent.'));
  await oldDetails().click();
  assert(await button('Accept all applicable (0)').isDisabled());
  await screenshot('08-zero-applicable');
  await button('Reject all remaining (5)').click();
  await poll(async () => (await probe()).lastInput.review.comments.every(c => c.decision === 'dismissed'), 'unmatched comments retained as rejected');
  await oldDetails().click(); await button('History').click();
  await page.locator('.review-heading').filter({hasText:'History'}).waitFor();
  assert.equal(await button('Reopen').count(), 0, 'History actions stay inside Details');
  assert.match(await page.locator('.review-content').innerText(), /Only weak monotonicity/);
  await button('Undo').click();
  await poll(async () => (await probe()).lastInput.review.comments.every(c => c.decision === 'open'), 'undo bulk rejection');
  assert.equal((await read()).text, 'Every original comment passage is now absent.');
  assert.equal(await fs.readFile(file, 'utf8'), source);
  receipt.checks.push('With no applicable passages, Accept all is disabled and Reject all remains available. All comments remain in History; one Undo restores decisions without changing draft or disk.');
  receipt.probe=await probe();delete receipt.probe.lastInput;
  delete receipt.probe.artifacts;
  delete receipt.probe.completedBuilds;
  receipt.status='PASS';
} catch(error) {
  receipt.status='FAIL';receipt.error=String(error.stack||error);
  if(page){await screenshot('failure').catch(()=>{});await fs.writeFile(path.join(evidence,'failure.html'),await page.content().catch(()=>''));}
  throw error;
} finally {
  if(application){const child=application.process();await application.close().catch(()=>{});receipt.processes[0].exited=child.exitCode!==null||child.signalCode!==null;}
  await fs.writeFile(path.join(evidence,'receipt.json'),JSON.stringify(receipt,null,2));
  console.log('Evidence:',evidence);
}
