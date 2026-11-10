// Real reader, IPC, recovery and UI; controlled model responses and synthetic files.
// No live Codex call and no access to the normal editor profile.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(repo, 'package.json'));
const args = process.argv.slice(2); assert(args.length === 2 && args[0] === '--playwright-package');
const { _electron } = createRequire(path.resolve(args[1]))('playwright');
const root = path.join(repo, '.test-runs', 'project-folder-access-' + Date.now()), copy = path.join(root, 'desktop');
const evidence = process.env.ME_TEST_EVIDENCE || path.join(root, 'evidence');
await fs.mkdir(copy, { recursive: true }); await fs.mkdir(evidence, { recursive: true });
await fs.cp(path.join(repo, 'dist'), path.join(copy, 'dist'), { recursive: true });
await fs.symlink(path.join(repo, 'node_modules'), path.join(copy, 'node_modules'), 'dir');
await fs.writeFile(path.join(copy, 'package.json'), JSON.stringify({ name: 'project-folder-access-check', version: '1.7.0', main: 'dist/main.cjs', private: true }));
const injection = [
"const probe={file:null,paperId:null,requests:[]};",
"dialog.showOpenDialog=async()=>({canceled:false,filePaths:[probe.file]});",
"const originalOpen=projects.open.bind(projects);",
"projects.open=async(...args)=>{const p=await originalOpen(...args);probe.paperId=p.id;return p;};",
"CodexClient.prototype.listModels=async()=>[{id:'gpt-6.1-sol',name:'GPT-6.1 Sol',isDefault:true,efforts:['low','medium','high','xhigh','max','ultra'],fast:true,images:true}];",
"codex.client.run=async(prompt,schema,progress,effort,fast,reader,options)=>{",
"  const request={purpose:options?.purpose??'review',context:JSON.parse(prompt),reader:!!reader,files:[],read:[]};",
"  if(reader){",
"    request.files=(await reader.call('references_list',{})).files;",
"    for(const file of request.files.filter(f=>f.id==='current-draft'||f.name.endsWith('assumptions.tex'))){",
"      const result=await reader.call('references_read',{fileId:file.id});",
"      request.read.push({id:file.id,name:file.name,text:result.excerpts.map(e=>e.text).join('')});",
"    }",
"  }",
"  probe.requests.push(request);",
"  return options?.purpose==='help'?{reply:'Checked available sources '+probe.requests.length+'.',suggestions:[]}:{comments:[]};",
"};",
"probe.seedResults=async(text)=>{",
"  const sourceHash=require('node:crypto').createHash('sha256').update(text).digest('hex');",
"  for(const [index,count] of [2,0,1].entries()){",
"    const comments=Array.from({length:count},(_,i)=>({id:'batch-'+index+'-'+i,title:'Batch '+(index+1)+' comment '+(i+1),explanation:'Synthetic waiting result.',original:'The allocation are monotone.',replacement:'The allocation is monotone.',from:text.indexOf('The allocation'),to:text.indexOf('The allocation')+'The allocation are monotone.'.length,validity:'current',decision:'open',packages:[],messages:[]}));",
"    await codex.results.retain(probe.paperId,{schemaVersion:1,id:randomUUID(),kind:'review',rootFile:projects.get(probe.paperId).name,sourceHash,createdAt:new Date(Date.now()+index).toISOString(),autoAddComments:false,comments});",
"  }",
"};",
"probe.saved=async()=>JSON.parse(await require('node:fs/promises').readFile(require('node:path').join(await projects.stateDirectory(probe.paperId),'recovery/session.json'),'utf8'));",
"globalThis.__folderProbe=probe;"
].join('\n');
await build({ entryPoints: [path.join(repo, 'src/main/index.ts')], outfile: path.join(copy, 'dist/main.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'],
  plugins: [{ name: 'folder-probe', setup(b) { b.onLoad({ filter: /src\/main\/index\.ts$/ }, async a => ({ contents: await fs.readFile(a.path, 'utf8') + '\n' + injection, loader: 'ts' })); } }] });
const reader = await build({ stdin: { contents: [
"import {EditorView} from '@codemirror/view';",
"const view=()=>EditorView.findFromDOM(document.querySelector('.source-pane .cm-content'));",
"window.readSource=()=>view().state.doc.toString();",
"window.sourceCursor=()=>view().state.selection.main.head;",
"window.pasteSource=text=>view().dispatch({changes:{from:0,to:view().state.doc.length,insert:text},selection:{anchor:text.length},userEvent:'input.paste'});"
].join('\n'), resolveDir: repo }, bundle: true, write: false, format: 'iife', platform: 'browser' });
const text = '\\documentclass{article}\n\\begin{document}\nThe allocation are monotone.\n\\input{sections/assumptions}\n\\end{document}\n';
const paper = path.join(root, 'paper'), file = path.join(paper, 'main.tex');
await fs.mkdir(path.join(paper, 'sections'), { recursive: true });
await fs.mkdir(path.join(paper, '.modern-editor'), { recursive: true });
await fs.writeFile(file, text); await fs.writeFile(path.join(paper, 'sections/assumptions.tex'), 'Nested assumption: preferences are complete.\n');
await fs.writeFile(path.join(root, 'outside.txt'), 'Outside sentinel.');
await fs.symlink(path.join(root, 'outside.txt'), path.join(paper, 'linked.txt'));
const original = 'The allocation are monotone.', from = text.indexOf(original);
await fs.writeFile(path.join(paper, '.modern-editor/review.json'), JSON.stringify({schemaVersion:1,rootFile:'main.tex',sourceHash:createHash('sha256').update(text).digest('hex'),activeId:'existing',updatedAt:new Date().toISOString(),comments:[{id:'existing',title:'Existing suggestion',explanation:'Keep this selected.',original,replacement:'The allocation is monotone.',from,to:from+original.length,validity:'current',decision:'open',packages:[],messages:[]}]}));
const receipt = { runDirectory: root, synthetic: true, liveCodex: false, checks: [], rendererErrors: [], processes: [] };
let application, page;
const button = name => page.getByRole('button', { name, exact: true });
const folderLabel = 'Codex can read this folder and subfolders';
const review = () => page.getByLabel('Request Codex review', { exact: true });
const chat = () => page.getByRole('complementary', { name: 'Codex Side Chat' });
async function poll(fn,label,ms=15000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,80));}throw Error('Timed out: '+label);}
async function shot(name){await page.screenshot({path:path.join(evidence,name+'.png')});}
async function requests(){return application.evaluate(()=>globalThis.__folderProbe.requests);}
async function setCheckbox(box,enabled){if(await box.isChecked()!==enabled)await box.click();await poll(async()=>await box.isChecked()===enabled&&await box.isEnabled(),'saved checkbox');}
async function open(){
  await application.evaluate((_,file)=>{globalThis.__folderProbe.file=file;},file);
  await button('Open a LaTeX or text file').click();await page.locator('.source-pane .cm-content').waitFor();await page.evaluate(reader.outputFiles[0].text);
  if(await button('Dismiss notice').count())await button('Dismiss notice').click();
}
async function runReview(){
  const count=(await requests()).length;
  await review().getByRole('button',{name:'Start review',exact:true}).click();
  await poll(async()=>(await requests()).length===count+1,'review request');
  await poll(()=>button('Review with Codex').isEnabled(),'review complete');
  return (await requests()).at(-1);
}
async function ask(message){
  const count=(await requests()).length;
  await page.getByLabel('Message to Codex Side Chat').fill(message);
  await chat().getByRole('button',{name:'Ask Codex',exact:true}).click();
  await chat().getByText('Checked available sources '+(count+1)+'.',{exact:true}).first().waitFor();
  await poll(()=>page.getByLabel('Message to Codex Side Chat').isEnabled(),'chat complete');
  return (await requests()).at(-1);
}
try {
  application=await _electron.launch({executablePath:require('electron'),args:[copy],cwd:repo,env:{...process.env,MODERN_EDITOR_RUNTIME_DIR:path.join(root,'runtime')},chromiumSandbox:true,timeout:25000});
  const child=application.process();receipt.processes.push({pid:child.pid,exited:false});console.log('Owned Electron PID',child.pid);
  page=await application.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>receipt.rendererErrors.push(String(e)));
  await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1450,960));
  await open();
  const unsaved=text.replace('\\begin{document}','\\begin{document}\nUnsaved current draft sentinel.');
  await page.evaluate(t=>window.pasteSource(t),unsaved);
  await button('Review with Codex').click();
  await poll(()=>review().getByLabel(folderLabel,{exact:true}).isEnabled(),'folder state');
  assert(await review().getByLabel(folderLabel,{exact:true}).isChecked());
  await shot('01-review-folder-access');
  let request=await runReview();
  assert(request.reader);assert(request.files.some(f=>f.name.endsWith('assumptions.tex')));
  assert(!request.files.some(f=>/outside|linked/.test(f.name)));
  assert.equal(request.read.find(f=>f.id==='current-draft').text,unsaved);
  assert.match(request.read.find(f=>f.name.endsWith('assumptions.tex')).text,/preferences are complete/);
  receipt.checks.push('Default-on Review reads the unsaved draft and nested TeX through the real reader, without manual attachments; outside/symlink targets excluded.');

  await button('Review with Codex').click();await setCheckbox(review().getByLabel(folderLabel,{exact:true}),false);
  await poll(()=>review().getByRole('button',{name:'Start review',exact:true}).isEnabled(),'folder opt-out saved');
  request=await runReview();assert.deepEqual(request.files.map(f=>f.id),['current-draft']);
  receipt.checks.push('Review opt-out persists and leaves the full unsaved draft available.');

  await button('Codex Side Chat').click();
  await chat().locator('.chat-context-options > summary').click();
  const readToggle=chat().getByLabel('Read full draft and enabled folders/references as needed',{exact:true});
  assert(await readToggle.isChecked());assert(!await chat().getByLabel(folderLabel,{exact:true}).isChecked());
  await setCheckbox(chat().getByLabel(folderLabel,{exact:true}),true);
  await poll(()=>page.getByLabel('Message to Codex Side Chat').isEnabled(),'chat folder setting saved');
  await shot('02-side-chat-folder-access');
  request=await ask('Read the relevant assumptions.');assert(request.reader);assert(request.files.some(f=>f.name.endsWith('assumptions.tex')));
  await chat().getByLabel('Paper context').selectOption('none');
  assert(!await readToggle.isChecked());
  request=await ask('Explain the editor without reading files.');assert.equal(request.reader,false);
  await page.getByLabel('Chat conversation',{exact:true}).selectOption('editor');
  request=await ask('Where is the review menu?');assert.equal(request.reader,false);
  receipt.checks.push('Paper Side Chat defaults to selective reading and shares the folder choice; No source text turns off reading, and editor-help requests have no file reader.');
  await chat().getByRole('button',{name:'Close Codex Side Chat',exact:true}).click();

  await button('Actions ▾').click();await button('Sources used…').click();
  await page.getByText(/assumptions\.tex/).first().waitFor();
  await shot('03-sources-used');await button('Close sources used').click();
  receipt.checks.push('Sources used lists actual nested-file reading.');

  await button('Review with Codex').click();
  await setCheckbox(review().getByLabel('Add comments when ready',{exact:true}),false);
  await button('Close review request').click();
  await application.evaluate((_,text)=>globalThis.__folderProbe.seedResults(text),unsaved);
  const cursor=await page.evaluate(()=>window.sourceCursor());
  await button('Actions ▾').click();await button('Waiting Codex results…').click();
  const waiting=page.getByLabel('Waiting Codex results',{exact:true});
  await poll(()=>waiting.locator('.waiting-result').count().then(n=>n===3),'three waiting results');
  assert.equal(await waiting.locator('details[open]').count(),0);
  assert.equal(await waiting.getByRole('button',{name:'Add',exact:true}).count(),3);
  assert(await waiting.getByRole('button',{name:'Add all comments (3)',exact:true}).isEnabled());
  await shot('04-waiting-results');
  await waiting.getByRole('button',{name:'Add',exact:true}).first().click();
  await poll(()=>waiting.locator('.waiting-result').count().then(n=>n===2),'one result added');
  await waiting.getByRole('button',{name:'Add all comments (1)',exact:true}).click();
  await waiting.getByText('No results waiting.',{exact:true}).waitFor();
  await button('Close waiting results').click();
  assert.equal(await page.evaluate(()=>window.readSource()),unsaved);assert.equal(await page.evaluate(()=>window.sourceCursor()),cursor);
  const comments=await application.evaluate(async()=>(await globalThis.__folderProbe.saved()).review.comments);assert.equal(comments.length,4);assert(comments.every(c=>c.decision==='open'));
  assert(await page.getByText('Existing suggestion',{exact:true}).isVisible());
  receipt.checks.push('Collapsed waiting results have visible Add controls; Add all imports remaining batches including an empty result without applying edits or changing the current comment/cursor.');

  await button('Review with Codex').click();await setCheckbox(review().getByLabel(folderLabel,{exact:true}),false);
  await poll(()=>review().getByRole('button',{name:'Start review',exact:true}).isEnabled(),'final opt-out saved');await button('Close review request').click();
  await button('Actions ▾').click();await button('Close project').click(); await button('Close and keep data').click();await button('Open a LaTeX or text file').waitFor();await open();
  await button('Review with Codex').click();await poll(()=>review().getByLabel(folderLabel,{exact:true}).isEnabled(),'reopened folder state');
  assert(!await review().getByLabel(folderLabel,{exact:true}).isChecked());
  assert.equal(await page.evaluate(()=>window.readSource()),unsaved);assert.equal((await application.evaluate(async()=>(await globalThis.__folderProbe.saved()).review.comments)).length,4);
  assert.equal(await fs.readFile(file,'utf8'),text);
  assert.deepEqual(receipt.rendererErrors,[]);receipt.passed=true;
  receipt.checks.push('Folder opt-out, imported comments and unsaved draft survive reopening; original manuscript unchanged; no renderer errors.');
} catch(error){receipt.passed=false;receipt.failure=String(error.stack??error);try{await shot('failure');}catch{}throw error;}
finally {
  if(application){const child=application.process();await application.close();await poll(async()=>child.exitCode!==null||child.signalCode!==null,'owned Electron exit');Object.assign(receipt.processes.find(p=>p.pid===child.pid),{exited:true,exitCode:child.exitCode});console.log('Owned Electron exited',child.pid);}
  await fs.writeFile(path.join(evidence,'results.json'),JSON.stringify(receipt,null,2));console.log('Evidence',evidence);
  if(receipt.passed&&!evidence.startsWith(root+path.sep))await fs.rm(root,{recursive:true,force:true});
}
