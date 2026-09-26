// Native feedback/review workflow. Model results are controlled; TeX and storage are real.
// ME_FEEDBACK_FIXTURE may point to a private trial manifest; it is read only and copied.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const appRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(appRoot,'package.json'));
const args=process.argv.slice(2); assert(args.length===2 && args[0]==='--playwright-package');
const {_electron}=createRequire(path.resolve(args[1]))('playwright');
const root=path.join(appRoot,'.test-runs','feedback-native-'+Date.now()),desktop=path.join(root,'desktop'),paper=path.join(root,'paper');
const evidence=process.env.ME_TEST_EVIDENCE || path.join(root,'evidence');
await fs.mkdir(desktop,{recursive:true});await fs.mkdir(paper,{recursive:true});await fs.mkdir(evidence,{recursive:true});
await fs.cp(path.join(appRoot,'dist'),path.join(desktop,'dist'),{recursive:true});
await fs.symlink(path.join(appRoot,'node_modules'),path.join(desktop,'node_modules'),'dir');
const version=JSON.parse(await fs.readFile(path.join(appRoot,'package.json'),'utf8')).version;
await fs.writeFile(path.join(desktop,'package.json'),JSON.stringify({name:'feedback-check',version,main:'dist/main.cjs'}));
const injection=`
const probe={file:null,save:null,calls:0,failAt:2,builds:0,arrangements:0};
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[probe.file]});
dialog.showSaveDialog=async()=>({canceled:!probe.save,filePath:probe.save});
const actualCompile=compiler.compile.bind(compiler);
compiler.compile=async(...args)=>{probe.builds++;const result=await actualCompile(...args);probe.lastBuild={success:result.success,verified:result.dependenciesVerified,diagnostics:result.diagnostics};return result;};
codex.client.run=async prompt=>{
  probe.calls++;const p=JSON.parse(prompt);
  if(!p.items)throw Error('Unexpected model call in controlled test');
  return {items:p.items.slice(0,probe.calls===probe.failAt?-1:undefined).map(item=>({itemId:item.itemId,comments:[JSON.parse(item.feedback)]}))};
};
codex.planChanges=async(id,prompt)=>{probe.arrangements++;const p=JSON.parse(prompt);return{inspect:[],groups:p.changes.map(c=>({ids:[c.id],layout:'keep',summary:'Controlled trial explanation.'}))};};
globalThis.__feedbackProbe=probe;globalThis.__feedbackProjects=projects;globalThis.__feedbackService=codex;globalThis.__feedbackCompiler=compiler;
`;
await build({entryPoints:[path.join(appRoot,'src/main/index.ts')],outfile:path.join(desktop,'dist/main.cjs'),bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron'],plugins:[{name:'feedback-probe',setup(b){b.onLoad({filter:/src\/main\/index\.ts$/},async a=>({contents:await fs.readFile(a.path,'utf8')+injection,loader:'ts'}));}}]});
const reader=await build({stdin:{contents:"import {EditorView} from '@codemirror/view';import {undoDepth} from '@codemirror/commands';window.feedbackRead=()=>{const v=EditorView.findFromDOM(document.querySelector('.source-pane .cm-content'));return{text:v.state.doc.toString(),undo:undoDepth(v.state)};};",resolveDir:appRoot},bundle:true,write:false,format:'iife',platform:'browser'});
const hash=v=>createHash('sha256').update(v).digest('hex');
const fixture=process.env.ME_FEEDBACK_FIXTURE ? JSON.parse(await fs.readFile(process.env.ME_FEEDBACK_FIXTURE,'utf8')):null;
let source='\\documentclass{article}\n\\begin{document}\n\\section{Synthetic example}\nThe allocation are monotone.\n\nThe proof are short.\n\\end{document}\n';
let comments=Array.from({length:42},(_,i)=>({number:i+1,category:'Clarity',title:i===0?'Correct the verb':'Trial discussion '+(i+1),explanation:i===0?'Allocation is singular.':'Synthetic test question; inspect this item without changing the paper.',original:i===0?'The allocation are monotone.':i===1?'The proof are short.':'',replacement:i===0?'The allocation is monotone.':i===1?'The proof is short.':null,before:'',after:'',packages:[]}));
if(fixture){
 source=await fs.readFile(fixture.source,'utf8');comments=fixture.comments;
 for(const input of fixture.inputs){assert(!path.isAbsolute(input.relative) && !input.relative.split('/').includes('..'));const out=path.join(paper,input.relative);await fs.mkdir(path.dirname(out),{recursive:true});await fs.copyFile(input.path,out);}
}
const file=path.join(paper,'main.tex');await fs.writeFile(file,source);
const raw=JSON.stringify({description:'Clearly labelled workflow trial, not an Astra review or proposed manuscript revision.',comments},null,2);
const receipt={private:!!fixture,version,realTex:true,liveCodex:false,sourceHash:hash(source),checks:[],rendererErrors:[],processes:[]};
let application,page;
const button=name=>page.getByRole('button',{name,exact:true});
const panel=()=>page.getByRole('dialog',{name:'Import outside feedback'});
const read=()=>page.evaluate(()=>window.feedbackRead());
const probe=()=>application.evaluate(()=>globalThis.__feedbackProbe);
async function poll(fn,label,ms=45000){const until=Date.now()+ms;while(Date.now()<until){if(await fn())return;await new Promise(r=>setTimeout(r,80));}throw Error('Timed out: '+label);}
async function screenshot(name){await page.screenshot({path:path.join(evidence,name+'.png')});}
async function actions(name){await button('Actions ▾').click();await button(name).click();}
async function open(){await application.evaluate((_,file)=>globalThis.__feedbackProbe.file=file,file);await button('Open a LaTeX or text file').click();await page.locator('.source-pane .cm-content').waitFor();await page.evaluate(reader.outputFiles[0].text);if(await button('Dismiss notice').count())await button('Dismiss notice').click();}
async function paste(name,text){await button('Paste context…').click();await page.getByLabel('Context name',{exact:true}).fill(name);await page.getByLabel('Pasted context text',{exact:true}).fill(text);await button('Save and enable for this paper').click();await page.locator('.reference-roots li').filter({hasText:name}).waitFor();}
try {
 application=await _electron.launch({executablePath:require('electron'),args:[desktop],cwd:appRoot,env:{...process.env,MODERN_EDITOR_RUNTIME_DIR:path.join(root,'runtime')},chromiumSandbox:true,timeout:25000});
 const child=application.process();receipt.processes.push({pid:child.pid,exited:false});console.log('Owned Electron PID',child.pid);
 page=await application.firstWindow();page.setDefaultTimeout(20000);page.on('pageerror',e=>receipt.rendererErrors.push(String(e)));
 await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1580,980));
 await open();await actions('Context and reference files…');await paste('Trial report A',raw);
 await button('Turn into comments…').click();await button('Prepare items').click();
 await panel().getByText('0 / '+comments.length+' review items converted · 0 comments saved · '+comments.length+' pending',{exact:true}).waitFor();
 assert.equal((await probe()).calls,0);assert.equal((await read()).text,source);
 const recordId=await page.getByLabel('Saved outside feedback').inputValue();
 assert(await panel().getByLabel('Add comments when ready',{exact:true}).isChecked());await panel().getByLabel('Add comments when ready',{exact:true}).uncheck();
 await button('Next batch (10)').click();await panel().getByText('10 / '+comments.length+' review items converted · 10 comments saved · '+(comments.length-10)+' pending',{exact:true}).waitFor();
 await button('Convert remaining with Codex').click();await panel().getByRole('alert').waitFor();
 assert.equal(await panel().locator('.feedback-comment').count(),10);
 await screenshot('01-partial-review-retained');
 await button('Convert remaining with Codex').click();await poll(async()=>await panel().getByText(comments.length+' / '+comments.length+' review items converted · '+comments.length+' comments saved · 0 pending',{exact:true}).count(),'all review items converted');
 assert.equal(await panel().locator('.feedback-comment').count(),comments.length);
 const saved=await application.evaluate(async(_,id)=>globalThis.__feedbackService.feedback.get(globalThis.__feedbackProjects.current.id,id),recordId);
 assert.equal(saved.feedback,raw);assert.equal(saved.comments.length,comments.length);
 assert.equal(await fs.readFile(file,'utf8'),source);await screenshot('02-complete-review');
 receipt.checks.push('Saved context prepares without Codex; failed second batch retains ten items; resume covers all '+comments.length+' original item numbers and raw text');
 await button('Select all available ('+comments.length+')').click();await button('Add selected comments').click();await button('Close outside feedback').click();
 await button('Undo').click();assert.equal((await read()).text,source);
 await actions('Import outside feedback…');await page.getByLabel('Saved outside feedback').selectOption(recordId);
 await button('Select all available ('+comments.length+')').click();await button('Add selected comments').click();
 await poll(async()=>await panel().getByText('All these comments are already in the queue. The original review remains here.',{exact:true}).count(),'idempotent import');
 await button('Close outside feedback').click();
 const firstTitle=await page.locator('.comment-card h1').innerText();await button('Accept').click();
 await poll(async()=>(await read()).text!==source && await page.locator('.comment-card h1').innerText()!==firstTitle,'accept completes before background arrival');
 const editedBeforeArrival=await read(), activeBeforeArrival=await page.locator('.comment-card h1').innerText();
 await actions('Context and reference files…');await paste('Trial report B',JSON.stringify([{...comments.at(-1),number:100,title:'A separate trial question',original:'',replacement:null}]));
 const bRow=page.locator('.reference-roots li').filter({hasText:'Trial report B'});await bRow.getByRole('button',{name:'Turn into comments…',exact:true}).click();
 await poll(async()=>await page.getByLabel('Saved outside feedback').inputValue()==='', 'explicit context clears previous record');assert(await page.getByLabel('Feedback context').inputValue());assert.equal(await panel().getByRole('button',{name:'Convert remaining with Codex',exact:true}).count(),0);
 await screenshot('03-report-switch');await button('Prepare items').click();
 await panel().getByText('0 / 1 review items converted · 0 comments saved · 1 pending',{exact:true}).waitFor();
 await panel().getByLabel('Add comments when ready',{exact:true}).check();await button('Convert remaining with Codex').click();
 await panel().getByText('1 / 1 review items converted · 1 comments saved · 0 pending',{exact:true}).waitFor();
 await panel().getByText('All these comments are already in the queue. The original review remains here.',{exact:true}).waitFor();
 await button('Close outside feedback').click();assert.equal(await page.locator('.comment-card h1').innerText(),activeBeforeArrival);
 assert.equal((await read()).text,editedBeforeArrival.text);await button('Undo').click();assert.equal((await read()).text,source);
 const afterAutoUndo=await application.evaluate(async()=>{const p=globalThis.__feedbackProjects.current;return (await globalThis.__feedbackService.feedback.list(p.id)).items;});
 assert.equal(afterAutoUndo.length,2);await actions('Import outside feedback…');await page.getByLabel('Saved outside feedback').selectOption(afterAutoUndo.find(r=>r.label==='Trial report B').id);
 await panel().getByText('All these comments are already in the queue. The original review remains here.',{exact:true}).waitFor();await button('Close outside feedback').click();
 receipt.checks.push('Automatic feedback arrival preserves selected old comment and source; Undo reverses the last acceptance while keeping the new comment');

 receipt.checks.push('Import is one undoable review action; repeating it adds no duplicates; switching to another context exposes its preparation instead of the previous report');
 await button('Classic view').click();await screenshot('04-classic-review');await button('Workspace view').click();
 assert.equal((await read()).text,source);
 await button('Accept').click();await poll(async()=>(await read()).text!==source,'ordinary accept');
 assert.equal((await probe()).builds,0);await button('Undo').click();assert.equal((await read()).text,source);
 await button('Accept & compile').click();
 await poll(async()=>await page.getByText('Applied · inspect the PDF',{exact:true}).count() || await button('Apply despite warnings').count(),'checked acceptance result',90000);
 if(await button('Apply despite warnings').count()){
  assert(fixture,'Synthetic check should compile without acceptance warnings');
  const checked=(await probe()).lastBuild;assert(checked.success && checked.verified);assert.equal((await read()).text,source);
  receipt.checkedWarning=checked;await screenshot('05-warning-before-override');await button('Apply despite warnings').click();
 }
 await page.getByText('Applied · inspect the PDF',{exact:true}).waitFor();
 await page.getByLabel('PDF page 1, rendered',{exact:true}).waitFor({timeout:30000});await screenshot('05-accepted-compiled');
 const after=(await read()).text;assert(after!==source);assert.equal(await fs.readFile(file,'utf8'),source);
 await button('Next comment →').click();assert.equal((await read()).text,after);
 await page.getByLabel('Viewer format',{exact:true}).selectOption('changes');
 const changes=page.locator('.changes-pdf-pane');
 await poll(async()=>await changes.getAttribute('aria-busy')==='false' && !!await changes.getAttribute('data-artifact'),'Changes PDF',90000);
 assert.equal(await changes.getByRole('alert').count(),0);await screenshot('06-changes-markup');
 await changes.getByLabel('Viewer format',{exact:true}).selectOption('changes-clean');
 await poll(async()=>await changes.getAttribute('aria-busy')==='false','clean Changes PDF',90000);await screenshot('07-changes-clean');
 await application.evaluate((_,out)=>globalThis.__feedbackProbe.save=out,path.join(evidence,'exported-comparison.pdf'));
 await button('Files').click();await button('Save displayed PDF…').click();
 await poll(async()=>{try{return(await fs.stat(path.join(evidence,'exported-comparison.pdf'))).size>0;}catch{return false;}},'PDF export');
 assert.equal(await fs.readFile(file,'utf8'),source);await button('Save').click();await poll(async()=>await fs.readFile(file,'utf8')===after,'Save');
 await button('Close project').click();await button('Open a LaTeX or text file').waitFor();await open();
 assert.equal((await read()).text,after);await actions('Import outside feedback…');await page.getByLabel('Saved outside feedback').selectOption(recordId);
 assert(await panel().getByText('All these comments are already in the queue. The original review remains here.',{exact:true}).count());
 receipt.checks.push('Classic/workspace preserve source; Accept skips compilation and Undo restores it; Accept & compile → inspect → Next; real markup/clean PDF/export/Save/reopen');
 receipt.counts=await probe();delete receipt.counts.file;delete receipt.counts.save;
 assert.deepEqual(receipt.rendererErrors,[]);receipt.passed=true;
} catch(error){receipt.passed=false;receipt.failure=String(error.stack??error);try{await screenshot('failure');}catch{}throw error;}
finally{
 if(application){const child=application.process();await application.close();await poll(async()=>child.exitCode!==null||child.signalCode!==null,'owned process exit');receipt.processes[0].exited=true;console.log('Owned Electron exited',child.pid);}
 await fs.writeFile(path.join(evidence,'results.json'),JSON.stringify(receipt,null,2));console.log('Evidence',evidence);
 if(receipt.passed && !evidence.startsWith(root+path.sep))await fs.rm(root,{recursive:true,force:true});
}
