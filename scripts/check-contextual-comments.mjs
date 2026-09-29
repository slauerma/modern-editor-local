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
const root = path.join(appRoot, '.test-runs', 'contextual-comments-' + Date.now()), copy = path.join(root, 'desktop');
const evidence = process.env.ME_TEST_EVIDENCE || path.join(appRoot, 'test-evidence', 'contextual-comments-' + Date.now());
await fs.mkdir(copy, { recursive: true }); await fs.mkdir(evidence, { recursive: true });
await fs.cp(path.join(appRoot, 'dist'), path.join(copy, 'dist'), { recursive: true });
await fs.symlink(path.join(appRoot, 'node_modules'), path.join(copy, 'node_modules'), 'dir');
await fs.writeFile(path.join(copy, 'package.json'), JSON.stringify({ name:'writing-check', version:'1.2.1', main:'dist/main.cjs', private:true }));
const injection = `
const probe={file:null,save:null,builds:0,modelCalls:0,pdfReads:0};
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[probe.file]});
dialog.showSaveDialog=async()=>({canceled:!probe.save,filePath:probe.save});
shell.showItemInFolder=()=>{};
const originalCompile=compiler.compile.bind(compiler);
compiler.compile=async(...args)=>{probe.builds++;return originalCompile(...args);};
const originalPdf=compiler.pdf.bind(compiler);
compiler.pdf=async(...args)=>{probe.pdfReads++;return originalPdf(...args);};
codex.client.run=async()=>{probe.modelCalls++;throw Error('No model calls are allowed by this test');};
globalThis.__writingProbe=probe;globalThis.__writingProjects=projects;globalThis.__writingCompiler=compiler;
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
const source = '\\documentclass{article}\n\\begin{document}\n\\section{Synthetic paper}\nWe compare two matching patterns. Agents accept any positive-value match. Each pattern determines the stocks and implied payoffs.\n\nThe proof are short.\n\\end{document}\n';
const paperDir = path.join(root,'paper'); await fs.mkdir(path.join(paperDir,'.modern-editor'),{recursive:true});
const file = path.join(paperDir,'main.tex'); await fs.writeFile(file,source);
await fs.writeFile(path.join(paperDir,'.modern-editor/review.json'),JSON.stringify({schemaVersion:1,rootFile:'main.tex',sourceHash:hash(source),activeId:'first',updatedAt:new Date().toISOString(),comments:[
  {id:'first',title:'Describe matching in both roles',explanation:'Matching on meeting describes the pattern without assigning every agent the responder role.',original:'accept any positive-value match',replacement:'match upon meeting any partner with positive match value'},
  {id:'second',title:'Correct the second verb',explanation:'Proof is singular.',original:'The proof are short.',replacement:'The proof is short.'}
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
const details = () => page.locator('.comment-details > button');
const reading = () => page.locator('.proposal-reading');
async function geometry() { return page.evaluate(() => Object.fromEntries(['.workspace','.source-pane','.review-rail','#pdf-surface'].map(s => [s,document.querySelector(s).getBoundingClientRect().toJSON()]))); }
try {
  application=await _electron.launch({executablePath:require('electron'),args:[copy],cwd:appRoot,env:{...process.env,MODERN_EDITOR_RUNTIME_DIR:path.join(root,'runtime')},chromiumSandbox:true,timeout:25000});
  const child=application.process();receipt.processes.push({pid:child.pid,exited:false});console.log('Owned Electron PID',child.pid);
  page=await application.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>receipt.rendererErrors.push(String(e)));
  await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1560,960));
  await open();
  assert.equal(await page.locator('.discussion').count(),0);
  assert.equal(await page.locator('#replacement').count(),0);
  assert.equal(await page.locator('.original-passage').count(),0);
  assert.match(await reading().innerText(),/We compare two matching patterns\./);
  assert.match(await reading().innerText(),/Each pattern determines/);
  assert.match(await reading().locator('del').allTextContents().then(a=>a.join('')),/accept/);
  assert(Number(await reading().locator('ins').first().evaluate(e=>getComputedStyle(e).fontWeight))>=600);
  const controls = await page.evaluate(() => ({
    headers: ['.source-pane > .pane-heading','.review-heading.review-nav'].map(selector => {
      const e=document.querySelector(selector), box=e.getBoundingClientRect(), css=getComputedStyle(e);
      return {y:box.y,height:box.height,font:css.fontSize,background:css.backgroundColor};
    }),
    actions: [...document.querySelectorAll('.review-decisions .comment-actions > button,.review-decisions .decision-secondary > button')].map(e => {
      const box=e.getBoundingClientRect(),css=getComputedStyle(e);
      return {width:box.width,height:box.height,font:css.fontSize,background:css.backgroundColor,border:css.border,color:css.color};
    }),
    headingWeight:getComputedStyle(document.querySelector('.review-heading .pane-title')).fontWeight,
    selectedShadow:getComputedStyle(document.querySelector('.proposal-views [aria-pressed=true]')).boxShadow
  }));
  assert.equal(controls.actions.length,6);
  assert(controls.actions.every(a=>Math.abs(a.width-controls.actions[0].width)<1 && a.height===38));
  assert(controls.actions.every(a=>a.font===controls.actions[0].font && a.background===controls.actions[0].background && a.border===controls.actions[0].border && a.color===controls.actions[0].color));
  assert(controls.headers.every(h=>h.y===controls.headers[0].y && h.height===44 && h.font===controls.headers[0].font && h.background===controls.headers[0].background),JSON.stringify(controls.headers));
  assert.equal(controls.headingWeight,'400'); assert.equal(controls.selectedShadow,'none');
  receipt.uniformControls=controls;
  await button('Clean').click();
  assert.equal(await reading().innerText(),'We compare two matching patterns. Agents match upon meeting any partner with positive match value. Each pattern determines the stocks and implied payoffs.');
  await button('Edit').click();
  const proposal=page.getByLabel('Proposed replacement',{exact:true});
  assert.equal(await proposal.inputValue(),'match upon meeting any partner with positive match value');
  await proposal.fill('My short edited wording');await button('Use original').click();
  assert.equal(await proposal.inputValue(),'accept any positive-value match');
  await button('Undo').click();assert.equal(await proposal.inputValue(),'My short edited wording');
  assert.equal((await read()).text,source);
  await proposal.fill('match upon meeting any partner with positive match value');
  await button('Changes').click();
  receipt.checks.push('One contextual diff; clean paragraph toggle; edit only exact span; Use original and Undo preserve source.');

  await button('Discuss').click();await page.locator('#reply').fill('Keep this unfinished question.');
  await button('Next comment').click();assert.equal(await page.locator('.discussion').count(),0);
  await button('Previous comment').click();assert.equal(await page.locator('.discussion').count(),0);
  await button('Discuss').click();assert.equal(await page.locator('#reply').inputValue(),'Keep this unfinished question.');
  await button('Hide discussion').click();
  const beforeDetails=await geometry();
  await details().hover();await page.waitForTimeout(350);
  await page.getByLabel('Comment details',{exact:true}).waitFor();
  assert.deepEqual(await geometry(),beforeDetails);
  await page.mouse.move(30,200);await poll(async()=>await page.getByLabel('Comment details',{exact:true}).count()===0,'hover closes');
  await details().focus();await page.keyboard.press('Enter');await page.getByLabel('Comment details',{exact:true}).waitFor();
  const automatic=page.getByLabel('Add new comments as they arrive');
  await automatic.uncheck();assert.equal(await automatic.isChecked(),false);
  await page.keyboard.press('Escape');assert.equal(await details().getAttribute('aria-expanded'),'false');
  receipt.checks.push('Discussion opens on request, closes for the next comment, preserves drafts; Details works on hover/keyboard without moving panes.');

  await button('Review with Codex').click();
  const review=page.getByLabel('Request Codex review',{exact:true});
  await review.waitFor();
  assert.equal(await review.locator('.review-policy-note').count(),0);
  await screenshot('05-review-request');
  const requestBox=await review.boundingBox(), panes=await geometry();
  await button('About smallest local edits').hover();
  await page.getByRole('note',{name:'smallest local edits',exact:true}).waitFor();
  assert.deepEqual(await geometry(),panes);assert.deepEqual(await review.boundingBox(),requestBox);
  const hintBox=await page.getByRole('note',{name:'smallest local edits',exact:true}).boundingBox();
  assert(hintBox.x>=0 && hintBox.y>=0 && hintBox.x+hintBox.width<=1560 && hintBox.y+hintBox.height<=960);
  await screenshot('06-review-info');
  await page.mouse.move(30,200);await poll(async()=>await page.getByRole('note',{name:'smallest local edits',exact:true}).count()===0,'info hover closes');
  await button('About comment arrivals').focus();await page.keyboard.press('Enter');
  await page.getByRole('note',{name:'comment arrivals',exact:true}).waitFor();
  await page.keyboard.press('Escape');assert.equal(await button('About comment arrivals').getAttribute('aria-expanded'),'false');
  await button('Close review request').focus();
  for(const name of ['smallest local edits','comment arrivals','section review','smallest local edits']){
    await page.mouse.move(30,200);
    await button('About '+name).hover();
    await page.getByRole('note',{name,exact:true}).waitFor();
    await page.mouse.move(30,200);
    await poll(async()=>await page.getByRole('note',{name,exact:true}).count()===0,'repeated help hover closes');
  }
  await button('Close review request').click();
  receipt.checks.push('Six equal neutral actions and aligned 44px pane headers; selected mode has no underline; review help is optional and keyboard/hover accessible without moving content.');

  await button('Compile').click();await page.getByLabel('PDF page 1, rendered',{exact:true}).waitFor({timeout:60000});
  const allHeaders=await page.evaluate(()=>['.source-pane > .pane-heading','.review-heading.review-nav','#pdf-surface > .viewer-controls'].map(selector=>{
    const e=document.querySelector(selector),box=e.getBoundingClientRect(),css=getComputedStyle(e);return {y:box.y,height:box.height,font:css.fontSize,background:css.backgroundColor};
  }));
  assert(allHeaders.every(h=>h.y===allHeaders[0].y && h.height===44 && h.font===allHeaders[0].font && h.background===allHeaders[0].background),JSON.stringify(allHeaders));
  receipt.uniformControls.headers=allHeaders;
  await screenshot('01-contextual-diff');
  await button('Preview').click();
  await page.locator('.preview-banner [role="status"]').filter({hasText:'Preview · not applied'}).waitFor({timeout:60000});
  await page.locator('.pdf-passage-marker').waitFor();
  const previewStyle=await page.evaluate(()=>({
    bar:getComputedStyle(document.querySelector('.preview-banner')).backgroundColor,
    weight:getComputedStyle(document.querySelector('.preview-banner [role="status"]')).fontWeight,
    sideMarker:getComputedStyle(document.querySelector('.pdf-passage-marker'),'::after').content,
    highlight:getComputedStyle(document.querySelector('.pdf-passage-marker'),'::before').backgroundColor
  }));
  assert.equal(previewStyle.bar,'rgb(255, 255, 255)');assert.equal(previewStyle.weight,'400');assert.equal(previewStyle.sideMarker,'none');assert.notEqual(previewStyle.highlight,'rgba(0, 0, 0, 0)');
  assert.equal((await read()).text,source);
  await screenshot('07-neutral-preview');
  const previewGeometry=await geometry();
  await page.getByLabel('Preview details',{exact:true}).click();
  assert.deepEqual(await geometry(),previewGeometry);
  await screenshot('08-preview-details');
  await button('Return to draft').click();
  receipt.checks.push('Real proposal preview keeps source unchanged, shows only the yellow passage highlight and neutral status, and opens details without moving panes.');
  await button('Accept').click();await poll(async()=>(await read()).text.includes('match upon meeting'),'accepted replacement');
  const accepted=(await read()).text;
  assert.equal(accepted,source.replace('accept any positive-value match','match upon meeting any partner with positive match value'));
  assert.equal(await fs.readFile(file,'utf8'),source);
  await page.evaluate(() => {const text=window.readWriting().text,from=text.indexOf('match upon meeting');window.selectWriting(from,from+18);});
  const pdf=page.locator('#pdf-surface > .pdf-reader .pdf-scroll');
  const beforeWarning=await geometry(), top=await pdf.evaluate(e=>e.scrollTop), reads=(await probe()).pdfReads;
  await button('Show in PDF').click();
  await page.locator('.pdf-navigation').waitFor();
  assert.match(await page.locator('.pdf-navigation').innerText(),/passage changed/);
  assert.deepEqual(await geometry(),beforeWarning);
  assert.equal(await pdf.evaluate(e=>e.scrollTop),top);
  assert.equal(await page.locator('#pdf-surface > .pdf-navigation').count(),1);
  await screenshot('02-pdf-warning-overlay');
  await button('Dismiss PDF navigation').click();assert.deepEqual(await geometry(),beforeWarning);
  await page.waitForTimeout(600);assert.equal((await probe()).pdfReads,reads);
  receipt.checks.push('Accept changes only the requested atom; outdated-passage warning appears/dismisses without changing pane geometry, PDF scroll or PDF reads.');

  await button('Undo').click();assert.equal((await read()).text,source);
  await button('View ▾').click();await button('Classic view').click();
  await button('Changes').click();
  assert.equal(await reading().isVisible(),true);
  const classicButtons=await page.locator('.review-decisions .comment-actions > button,.review-decisions .decision-secondary > button').evaluateAll(buttons=>buttons.map(e=>{
    const r=e.getBoundingClientRect();return {width:r.width,height:r.height};
  }));
  assert.equal(classicButtons.length,6);
  assert(classicButtons.every(b=>Math.abs(b.width-classicButtons[0].width)<1 && b.height===38));
  await details().click();await page.getByLabel('Comment details',{exact:true}).waitFor();
  const popup=await page.getByLabel('Comment details',{exact:true}).boundingBox();
  assert(popup.y>=0 && popup.y+popup.height<=960);
  await screenshot('03-classic-contextual-review');
  await page.keyboard.press('Escape');await actions('Workspace view');
  await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1120,820));
  await page.waitForTimeout(200);
  assert(await button('Accept').isVisible());assert(await details().isVisible());
  const narrowControls=await page.locator('#pdf-surface > .viewer-controls').evaluate(header=>{
    const h=header.getBoundingClientRect();
    return [...header.querySelectorAll('.pdf-controls > *')].filter(e=>e.getBoundingClientRect().width>0).map(e=>{
      const r=e.getBoundingClientRect();return {label:e.textContent,inside:r.top>=h.top && r.bottom<=h.bottom && r.left>=h.left && r.right<=h.right};
    });
  });
  assert(narrowControls.every(c=>c.inside),JSON.stringify(narrowControls));
  receipt.narrowControls=narrowControls;
  await screenshot('04-laptop-contextual-review');
  await details().click();await button('Hide comments').click();
  await button('Show comments (2)').click();await details().click();assert.equal(await automatic.isChecked(),false);await page.keyboard.press('Escape');
  await actions('Close project');await button('Open a LaTeX or text file').waitFor();await open();
  assert.equal(await page.locator('.discussion').count(),0);
  await details().click();assert.equal(await automatic.isChecked(),false);await page.keyboard.press('Escape');
  assert.equal(await fs.readFile(file,'utf8'),source);
  assert.equal((await probe()).modelCalls,0);assert.deepEqual(receipt.rendererErrors,[]);
  receipt.checks.push('Classic and laptop controls remain usable; hidden controls reachable; preferences and review recover on reopening; no model calls.');
  receipt.passed=true;
} catch(error){receipt.passed=false;receipt.failure=String(error.stack??error);try{await screenshot('failure');}catch{}throw error;}
finally {
  if(application){const child=application.process();await application.close();await poll(async()=>child.exitCode!==null||child.signalCode!==null,'owned Electron exit');receipt.processes.find(p=>p.pid===child.pid).exited=true;console.log('Owned Electron exited',child.pid);}
  await fs.writeFile(path.join(evidence,'results.json'),JSON.stringify(receipt,null,2));console.log('Evidence',evidence);
  if(receipt.passed && !evidence.startsWith(root+path.sep))await fs.rm(root,{recursive:true,force:true});
}
