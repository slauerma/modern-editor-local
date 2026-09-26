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
const root = path.join(appRoot, '.test-runs', 'writing-' + Date.now()), copy = path.join(root, 'desktop');
const evidence = process.env.ME_TEST_EVIDENCE || path.join(appRoot, 'test-evidence', 'writing-' + Date.now());
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
window.writeWriting=text=>v().dispatch({changes:{from:0,to:v().state.doc.length,insert:text},userEvent:'input.test'});
`,resolveDir:appRoot},bundle:true,write:false,format:'iife',platform:'browser'});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const source = '\\documentclass{article}\n\\begin{document}\n\\section{Synthetic paper}\nThe allocation are monotone.\n\nThe proof are short.\n\\end{document}\n';
const paperDir = path.join(root,'paper'); await fs.mkdir(path.join(paperDir,'.modern-editor'),{recursive:true});
const file = path.join(paperDir,'main.tex'); await fs.writeFile(file,source);
await fs.writeFile(path.join(paperDir,'.modern-editor/review.json'),JSON.stringify({schemaVersion:1,rootFile:'main.tex',sourceHash:hash(source),activeId:'first',updatedAt:new Date().toISOString(),comments:[
  {id:'first',title:'Use a singular verb',explanation:'Allocation is singular.',original:'The allocation are monotone.',replacement:'The allocation is monotone.'},
  {id:'second',title:'Correct the second verb',explanation:'Proof is singular.',original:'The proof are short.',replacement:'The proof is short.'}
].map(c=>({...c,from:source.indexOf(c.original),to:source.indexOf(c.original)+c.original.length,validity:'current',decision:'open',packages:[],messages:[]}))}));
let application,page;
const receipt={synthetic:true,realTex:true,liveCodex:false,checks:[],rendererErrors:[],processes:[]};
const button = name => page.getByRole('button',{name,exact:true});
const read = () => page.evaluate(()=>window.readWriting());
const probe = () => application.evaluate(()=>globalThis.__writingProbe);
async function poll(fn,label,ms=30000){const until=Date.now()+ms;while(Date.now()<until){if(await fn())return;await new Promise(r=>setTimeout(r,70));}throw Error('Timed out: '+label);}
async function screenshot(name){await page.screenshot({path:path.join(evidence,name+'.png'),timeout:5000});}
async function actions(name){await button('Actions ▾').click();await button(name).click();}
async function open(){await application.evaluate((_,file)=>globalThis.__writingProbe.file=file,file);await button('Open a LaTeX or text file').click();await page.locator('.source-pane .cm-content').waitFor();await page.evaluate(reader.outputFiles[0].text);if(await button('Dismiss notice').count())await button('Dismiss notice').click();}
async function classicGeometry(surface,notes){
  await page.waitForTimeout(150);
  const result=await page.locator('.workspace').evaluate((w,{surface})=>{
    const b=s=>{const r=w.querySelector(s).getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
    return {rail:b('.classic-tools'),paper:b(surface==='source'?'.source-pane':'.pdf-pane'),notes:b('.review-rail'),bounds:w.getBoundingClientRect().toJSON(),columns:getComputedStyle(w).gridTemplateColumns};
  },{surface});
  assert.equal(result.rail.width,68);assert(Math.abs(result.paper.x-result.rail.right)<2);
  assert(result.paper.width>700); assert(result.paper.right<=result.bounds.right+1);
  if(notes) assert(Math.abs(result.notes.y-result.paper.bottom)<2,'Suggestions must sit below the writing/view surface');
  else assert(Math.abs(result.paper.bottom-result.bounds.bottom)<2,'Hiding Notes restores paper height');
  return result;
}
try {
  application=await _electron.launch({executablePath:require('electron'),args:[copy],cwd:appRoot,env:{...process.env,MODERN_EDITOR_RUNTIME_DIR:path.join(root,'runtime')},chromiumSandbox:true,timeout:25000});
  const child=application.process();receipt.processes.push({pid:child.pid,exited:false});console.log('Owned Electron PID',child.pid);
  page=await application.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>receipt.rendererErrors.push(String(e)));
  await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1560,960));
  await open();
  await actions('Context and reference files…');await button('Paste context…').click();
  const context='  Synthetic reference notes Ω.\n'+('A long background paragraph.\n'.repeat(40000))+'Final context sentence.  \n';
  await page.getByLabel('Context name',{exact:true}).fill('Background notes');
  receipt.pasteGeometry=await page.getByLabel('Pasted context text',{exact:true}).evaluate(el=>({bounds:el.getBoundingClientRect().toJSON(),display:getComputedStyle(el).display,visibility:getComputedStyle(el).visibility,parents:[...function*(e){while(e){yield {tag:e.tagName,cls:e.className,bounds:e.getBoundingClientRect().toJSON()};e=e.parentElement;}}(el)]}));
  await screenshot('00-paste-form');
  await application.evaluate(({clipboard},text)=>{globalThis.__savedClipboard={text:clipboard.readText(),html:clipboard.readHTML(),rtf:clipboard.readRTF(),image:clipboard.readImage()};clipboard.writeText(text);},context);
  await page.getByLabel('Pasted context text',{exact:true}).click();
  await page.keyboard.press(process.platform==='darwin'?'Meta+V':'Control+V');
  await poll(async()=>await page.getByLabel('Pasted context text',{exact:true}).inputValue()===context,'native large paste');
  await button('Save and enable for this paper').click();
  await button('Inspect / copy').click();assert.equal(await page.getByLabel('Saved context text',{exact:true}).inputValue(),context);
  await button('Copy full text').click();assert.equal(await application.evaluate(({clipboard})=>clipboard.readText()),context);
  await screenshot('01-pasted-context');await button('Close inspection').click();
  const enabled=page.locator('.reference-roots input[type=checkbox]');await enabled.click();await poll(async()=>!(await enabled.isChecked()),'disable context');
  await enabled.click();await poll(async()=>await enabled.isChecked(),'enable context');await button('Close local references').click();
  assert.equal((await probe()).modelCalls,0);assert.equal((await read()).text,source);
  receipt.checks.push('1.12 MB native UI paste/name/save/inspect/copy/disable/enable; source unchanged; no model call');
  await actions('Paper instructions…');await page.getByLabel('Standing paper instructions',{exact:true}).fill('Keep the established notation.');
  await button('Save paper guidance').click();await poll(async()=>await button('Save paper guidance').isDisabled(),'guidance saved');
  await screenshot('02-paper-guidance');await button('Close paper instructions').click();
  await button('Codex Side Chat').click();await page.getByLabel('Message to Codex Side Chat',{exact:true}).fill('Explain this proof.');
  await page.locator('.chat-context-options > summary').click();await button('Preview what is sent').click();await page.locator('.chat-prepared').waitFor();assert.match(await page.locator('.chat-prepared').innerText(),/Keep the established notation/);
  await button('Paper instructions…').click();await page.getByLabel('Standing paper instructions',{exact:true}).fill('Keep notation and avoid stylistic rewrites.');
  await button('Save paper guidance').click();await poll(async()=>await button('Save paper guidance').isDisabled(),'changed guidance saved');await button('Close paper instructions').click();
  await button('Codex Side Chat').click();await button('Preview what is sent').click();
  assert.match(await page.locator('.chat-prepared').innerText(),/Keep notation and avoid stylistic rewrites/);
  await page.getByLabel('Close Codex Side Chat').click();
  assert.equal((await probe()).modelCalls,0);receipt.checks.push('Saved guidance inspection and Side Chat prepared-payload refresh without a model call');
  const proposal=page.getByLabel('Proposed replacement',{exact:true}), initial=await read();
  await proposal.fill('A deliberately different proposal.');await button('Use original').click();
  assert.equal(await proposal.inputValue(),'The allocation are monotone.');assert.equal((await read()).text,source);
  await button('Undo').click();assert.equal(await proposal.inputValue(),'A deliberately different proposal.');
  await proposal.fill('The allocation is monotone.');receipt.checks.push('Use original is proposal-only and Undo restores the previous proposal');
  await button('Accept & compile').click();await page.getByText('Applied · inspect the PDF',{exact:true}).waitFor({timeout:60000});
  await page.getByLabel('PDF matches the current unsaved source',{exact:true}).waitFor();await page.locator('.pdf-passage-marker').waitFor();
  assert.equal(await page.locator('.comment-card h1').innerText(),'Use a singular verb');
  assert((await read()).text.includes('The allocation is monotone.'));assert.equal(await fs.readFile(file,'utf8'),source);
  await screenshot('03-accept-compile-inspect');
  const accepted=await read();await button('Next comment →').click();assert.equal(await page.locator('.comment-card h1').innerText(),'Correct the second verb');assert.deepEqual(await read(),accepted);
  assert(!(await page.locator('footer').innerText()).includes('inspect the PDF, then Next'),'Next clears the previous inspection instruction');
  const reads=(await probe()).pdfReads;await page.waitForTimeout(900);assert.equal((await probe()).pdfReads,reads);
  assert.equal(await page.locator('#pdf-surface > .pdf-reader > .pdf-controls').count(),0);
  assert.equal(await page.locator('#pdf-surface > .viewer-controls .pdf-controls').count(),1);
  receipt.checks.push('Real Accept & compile stays on accepted comment, mapped highlight, explicit Next, unsaved source, one PDF toolbar, idle PDF stable');
  await button('Classic view').click();const classicBefore=await read();const rail=page.getByRole('navigation',{name:'Classic writing controls'});
  await rail.getByRole('button',{name:'Write',exact:true}).click();receipt.classic=await classicGeometry('source',true);await screenshot('04-classic-writing');
  await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1120,820));await classicGeometry('source',true);await screenshot('04b-classic-laptop');
  await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1560,960));
  await rail.getByRole('button',{name:'Notes',exact:true}).click();await classicGeometry('source',false);await screenshot('05-classic-writing-only');
  await rail.getByRole('button',{name:'View',exact:true}).click();await classicGeometry('pdf',false);
  await rail.getByRole('button',{name:'Notes',exact:true}).click();await classicGeometry('pdf',true);await screenshot('06-classic-pdf');
  assert.deepEqual(await read(),classicBefore);await button('Workspace view').click();assert.deepEqual(await read(),classicBefore);
  await button('Files').click();await page.getByRole('dialog',{name:'Files & history'}).waitFor();
  await page.getByText('Background notes',{exact:true}).waitFor();await screenshot('07-files-and-pdfs');
  const destination=path.join(root,'exported.pdf');await application.evaluate((_,file)=>globalThis.__writingProbe.save=file,destination);
  const expected=await fs.readFile(await application.evaluate(()=>globalThis.__writingCompiler.availablePdfs(globalThis.__writingProjects.current.id)[0].path));
  await button('Save displayed PDF…').click();await poll(async()=>{try{return(await fs.stat(destination)).size>0;}catch{return false;}},'PDF export');
  assert.deepEqual(await fs.readFile(destination),Buffer.from(expected));assert.equal(await fs.readFile(file,'utf8'),source);
  await button('Save').click();await poll(async()=>(await fs.readFile(file,'utf8')).includes('allocation is'),'source Save');
  await button('Classic view').click();await rail.getByRole('button',{name:'Write',exact:true}).click();
  await button('Close project').click();await button('Open a LaTeX or text file').waitFor();await open();await button('Workspace view').waitFor();await classicGeometry('source',true);
  await rail.getByRole('button',{name:'Context',exact:true}).click();await button('Inspect / copy').click();assert.equal(await page.getByLabel('Saved context text',{exact:true}).inputValue(),context);await button('Close local references').click();
  await rail.getByRole('button',{name:'Guide',exact:true}).click();assert.equal(await page.getByLabel('Standing paper instructions',{exact:true}).inputValue(),'Keep notation and avoid stylistic rewrites.');await button('Close paper instructions').click();
  receipt.checks.push('Classic shown/hidden Notes and Write/View preserve source/Undo; Files inventory; exact PDF export; context/guidance/Classic reopen');
  assert.equal((await probe()).modelCalls,0);assert.deepEqual(receipt.rendererErrors,[]);receipt.passed=true;
} catch(error){receipt.passed=false;receipt.failure=String(error.stack??error);try{await screenshot('failure');}catch{}throw error;}
finally {
  if(application){const child=application.process();await application.evaluate(({clipboard})=>{if(globalThis.__savedClipboard){clipboard.write(globalThis.__savedClipboard);}}).catch(()=>{});await application.close();await poll(async()=>child.exitCode!==null||child.signalCode!==null,'owned Electron exit');receipt.processes.find(p=>p.pid===child.pid).exited=true;console.log('Owned Electron exited',child.pid);}
  await fs.writeFile(path.join(evidence,'results.json'),JSON.stringify(receipt,null,2));console.log('Evidence',evidence);
  if(receipt.passed)await fs.rm(root,{recursive:true,force:true});
}
