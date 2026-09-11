// Isolated Electron regression: real UI, IPC and persistence; synthetic paper,
// screenshots and controlled Codex responses. No account or network request.
// Run after the build. An existing Playwright install can be selected explicitly.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
assert(args.length === 0 || (args.length === 2 && args[0] === '--playwright-package'));
const appRequire = createRequire(path.join(appRoot, 'package.json'));
const { _electron } = (args.length ? createRequire(path.resolve(args[1])) : appRequire)('playwright');
const version = JSON.parse(await fs.readFile(path.join(appRoot, 'package.json'), 'utf8')).version;
const root = path.join(appRoot, '.test-runs', 'help-chat-desktop-' + Date.now());
const copy = path.join(root, 'desktop-copy'), evidence = path.join(root, 'evidence');
await fs.mkdir(copy, { recursive: true }); await fs.mkdir(evidence);
await fs.cp(path.join(appRoot, 'dist'), path.join(copy, 'dist'), { recursive: true });
await fs.writeFile(path.join(copy, 'package.json'), JSON.stringify({ name: 'help-chat-check', version, private: true, main: 'dist/main.cjs' }));
const injection = `
const chatProbe={requests:[],pending:null,compileAttempts:0};
codex.client.run=async(prompt,schema,progress,effort,fast,reader,options)=>{
  if(chatProbe.pending)throw new Error('Concurrent requests');
  chatProbe.requests.push({prompt:JSON.parse(prompt),effort,fast,images:options?.images??[]});
  return new Promise((resolve,reject)=>{chatProbe.pending={resolve,reject};});
};
codex.client.cancel=codex.client.stop=async()=>{const p=chatProbe.pending;chatProbe.pending=null;p?.reject(new Error('Synthetic cancellation'));};
compiler.compile=async()=>{chatProbe.compileAttempts++;throw new Error('Unexpected compilation from chat');};
globalThis.__chatProbe=chatProbe;
`;
await build({ entryPoints: [path.join(appRoot,'src/main/index.ts')], outfile: path.join(copy,'dist/main.cjs'), bundle: true, platform:'node', format:'cjs', target:'node22', external:['electron'], plugins:[{name:'synthetic-chat',setup(b){b.onLoad({filter:/src\/main\/index\.ts$/},async a=>({contents:await fs.readFile(a.path,'utf8')+injection,loader:'ts'}));}}] });
const reader = await build({ stdin:{contents:"import {EditorView} from '@codemirror/view';window.editorViewForTest=element=>EditorView.findFromDOM(element);",resolveDir:appRoot},bundle:true,write:false,format:'iife',platform:'browser' });
const source = '\\documentclass{article}\n\\begin{document}\nThe allocation are monotone.\nThis synthetic paper has no private content.\n\\end{document}\n';
const file = path.join(root,'main.tex'); await fs.writeFile(file,source);
const receipt = { version, source:'synthetic', model:'controlled; no account request', clipboard:'Synthetic DOM paste event; physical OS paste not claimed', checks:[], screenshots:[], processes:[], errors:[] };
let application, page;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function poll(fn,label,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await pause(60);}throw new Error('Timed out: '+label);}
const drawer=()=>page.getByRole('complementary',{name:'Help me chat'});
const button=name=>drawer().getByRole('button',{name,exact:true});
const question=()=>page.getByLabel('Message to Help me');
const scope=()=>page.getByLabel('Chat conversation');
async function probe(){return application.evaluate(()=>({requests:globalThis.__chatProbe.requests,pending:!!globalThis.__chatProbe.pending,compileAttempts:globalThis.__chatProbe.compileAttempts}));}
async function ask(text){const count=(await probe()).requests.length;await question().fill(text);await button('Ask Codex').click();await poll(async()=>{const p=await probe();return p.pending&&p.requests.length===count+1;},'chat request');}
async function complete(answer){await application.evaluate((_,answer)=>{const p=globalThis.__chatProbe.pending;globalThis.__chatProbe.pending=null;p.resolve(answer);},answer);await drawer().locator('.chat-answer').filter({hasText:answer.reply}).waitFor();await poll(()=>button('Ask Codex').isEnabled().then(x=>!x),'composer cleared');await poll(()=>question().isEnabled(),'reply complete');}
async function shot(name){await page.screenshot({path:path.join(evidence,name+'.png'),scale:'css'});receipt.screenshots.push(name+'.png');}
async function check(name){assert.equal((await probe()).compileAttempts,0);assert.equal(await fs.readFile(file,'utf8'),source);receipt.checks.push(name);console.log('PASS',name);}
async function buffer(){return page.getByLabel('LaTeX source',{exact:true}).evaluate(el=>window.editorViewForTest(el).state.doc.toString());}
async function launch(){application=await _electron.launch({executablePath:appRequire('electron'),args:[copy],cwd:appRoot,env:{...process.env,MODERN_EDITOR_RUNTIME_DIR:path.join(root,'runtime')},chromiumSandbox:true,timeout:25000});const child=application.process();receipt.processes.push({pid:child.pid,exited:false});console.log('Owned Electron PID',child.pid);page=await application.firstWindow();page.setDefaultTimeout(12000);page.on('pageerror',e=>receipt.errors.push(String(e)));await page.evaluate(reader.outputFiles[0].text);await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1450,960));}
async function close(){const child=application.process();await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await poll(async()=>child.exitCode!==null||child.signalCode!==null,'owned Electron exit');assert.equal(child.exitCode,0);Object.assign(receipt.processes.find(p=>p.pid===child.pid),{exited:true,exitCode:child.exitCode});application=null;}
async function openPaper(){await application.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);await page.getByRole('button',{name:'Actions ▾',exact:true}).click();await page.getByRole('button',{name:'Open paper…',exact:true}).click();await page.getByLabel('LaTeX source',{exact:true}).waitFor();assert.equal(await buffer(),source);}
async function pasteScreenshot(dataUrl,name){await question().evaluate((el,{dataUrl,name})=>{const bytes=Uint8Array.from(atob(dataUrl.split(',')[1]),c=>c.charCodeAt(0));const dt=new DataTransfer();dt.items.add(new File([bytes],name,{type:'image/png'}));el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));},{dataUrl,name});}
const answer={reply:'Allocation is singular. The proposed sentence keeps the meaning.',suggestion:{title:'Correct the verb',explanation:'Use a singular verb.',original:'The allocation are monotone.',before:'',after:'',replacement:'The allocation is monotone.',packages:[]}};
try{
  await launch();await page.getByRole('button',{name:'Help me',exact:true}).click();await question().waitFor();
  await ask('Which version is running, and how can I compile?');let request=(await probe()).requests.at(-1);assert.equal(request.prompt.application.version,version);assert(request.prompt.application.documentation.includes('Command+T'));assert(!request.prompt.source);assert.equal(request.effort,'medium');
  await complete({reply:`This is Modern Editor ${version}. Command+T compiles the current draft.`,suggestion:null});await shot('01-editor-help');await check('Editor help without a paper uses bundled docs and actual version');
  const image=await application.evaluate(({nativeImage})=>'data:image/png;base64,'+nativeImage.createFromBitmap(Buffer.alloc(240*120*4,180),{width:240,height:120}).toPNG().toString('base64'));
  await pasteScreenshot(image,'Pasted synthetic warning.png');await drawer().getByAltText('Pasted synthetic warning.png').waitFor();
  await drawer().getByTitle('Enlarge attached screenshot').click();await page.getByRole('dialog',{name:'Screenshot preview'}).waitFor();await page.getByLabel('Close screenshot preview').click();
  await button('Remove Pasted synthetic warning.png').click();assert.equal(await drawer().getByAltText('Pasted synthetic warning.png').count(),0);
  await question().evaluate((el,image)=>{const bytes=Uint8Array.from(atob(image.split(',')[1]),c=>c.charCodeAt(0)),dt=new DataTransfer();dt.items.add(new File([bytes],'Dropped synthetic screenshot.png',{type:'image/png'}));el.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));},image);
  await drawer().getByAltText('Dropped synthetic screenshot.png').waitFor();await button('Remove Dropped synthetic screenshot.png').click();
  const png=Buffer.from(image.split(',')[1],'base64'), imagePath=path.join(root,'Synthetic warning.png');await fs.writeFile(imagePath,Buffer.concat([png,Buffer.from('SYNTHETIC_METADATA_TO_REMOVE')]));
  await page.getByLabel('Choose chat screenshots').setInputFiles(imagePath);await drawer().getByAltText('Synthetic warning.png').waitFor();
  await ask('Explain this screenshot.');request=(await probe()).requests.at(-1);assert.equal(request.images.length,1);assert(!Buffer.from(request.images[0].split(',')[1],'base64').includes(Buffer.from('SYNTHETIC_METADATA_TO_REMOVE')));assert(!JSON.stringify(request.prompt).includes('data:image'));
  await complete({reply:'The attached synthetic image is available as an image input.',suggestion:null});await shot('02-screenshot-message');await check('Paste, drop, enlarge, remove, file attachment and main-process image normalization');
  await ask('Retry this same question after stopping.');await button('Stop').click();await poll(()=>question().isEnabled(),'cancel completion');assert.equal(await question().inputValue(),'Retry this same question after stopping.');await ask('Retry this same question after stopping.');await complete({reply:'The unchanged question can be retried after Stop.',suggestion:null});await check('Stop retains question and unchanged retry uses a fresh preview');
  await question().fill('Keep this unsent question.');await button('Close Help me chat').click();await page.getByRole('button',{name:'Help me',exact:true}).click();assert.equal(await question().inputValue(),'Keep this unsent question.');await button('Close Help me chat').click();
  await openPaper();await page.getByRole('button',{name:'Help me',exact:true}).click();assert.equal(await scope().inputValue(),'paper');assert.equal(await drawer().locator('.chat-turn').count(),0);
  await ask('Improve the grammar of the first sentence.');request=(await probe()).requests.at(-1);assert.equal(request.prompt.source.text,source);assert(!request.prompt.diagnostics);await complete(answer);assert.equal(await buffer(),source);assert.equal(await drawer().locator('.chat-suggestion').count(),1);await shot('03-paper-proposal');
  await button('Turn into comment').click();await poll(()=>drawer().isHidden(),'drawer closes for review');assert.equal(await buffer(),source);assert.equal(await page.getByLabel('Proposed replacement',{exact:true}).inputValue(),answer.suggestion.replacement);
  await application.evaluate(({Menu,BrowserWindow})=>{const item=Menu.getApplicationMenu().items.find(x=>x.label==='Edit').submenu.items.find(x=>x.label==='Undo');item.click(item,BrowserWindow.getAllWindows()[0],{});});await poll(()=>page.getByLabel('Proposed replacement',{exact:true}).count().then(n=>n===0),'undo added comment');await check('Adding a visible proposal is undoable and never changes source');
  await page.getByRole('button',{name:'Help me',exact:true}).click();await ask('Improve that sentence again while I edit.');
  await page.getByLabel('LaTeX source',{exact:true}).evaluate(el=>{const view=window.editorViewForTest(el);view.dispatch({changes:{from:0,insert:'% synthetic edit\n'}});});
  await complete({...answer,reply:'This answer was prepared against the earlier source.'});await button('Turn into comment').last().click();await poll(()=>drawer().isHidden(),'stale addition returns to review');await page.getByText(/passage needs confirmation|passage is unconfirmed|Confirm this passage|placement needs confirmation/).first().waitFor().catch(async()=>{assert(await page.getByText('Attach to selected text',{exact:true}).isVisible());});
  assert((await buffer()).startsWith('% synthetic edit'));await check('Source changes during chat require proposal attachment confirmation');
  await page.getByRole('button',{name:'Help me',exact:true}).click();await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(960,640));await question().scrollIntoViewIfNeeded();await shot('04-minimum-window');
  const bounds=await question().boundingBox();assert(bounds&&bounds.y>=0&&bounds.y+bounds.height<=640);await check('Question remains accessible at minimum window size');
  await close();await launch();await page.getByRole('button',{name:'Help me',exact:true}).click();await poll(()=>drawer().locator('.chat-turn').count().then(n=>n===2),'paper chat restored');
  await scope().selectOption('editor');await drawer().getByText('The unchanged question can be retried after Stop.',{exact:true}).waitFor();assert.equal(await drawer().getByAltText('Synthetic warning.png').count(),1);await shot('05-reopened-editor-conversation');await check('Restart restores separate paper/editor conversations and screenshots');
  await button('Clear chat…').click();await button('Keep').click();assert.equal(await drawer().locator('.chat-turn').count(),4);await button('Clear chat…').click();await button('Clear conversation').click();await poll(()=>drawer().locator('.chat-turn').count().then(n=>n===0),'editor chat cleared');await scope().selectOption('paper');await poll(()=>drawer().locator('.chat-turn').count().then(n=>n===2),'paper chat preserved');await check('Confirmed clearing deletes only the chosen conversation');
  await close();assert.deepEqual(receipt.errors,[]);receipt.passed=true;
}catch(e){receipt.failure=String(e.stack??e);if(page)await shot('failure').catch(()=>{});throw e;}
finally{if(application){await application.evaluate(()=>{globalThis.__chatProbe.pending?.reject(new Error('Test shutdown'));globalThis.__chatProbe.pending=null;}).catch(()=>{});await close().catch(async()=>{const child=application?.process();await application?.close().catch(()=>{});if(child)await poll(async()=>child.exitCode!==null||child.signalCode!==null,'test process cleanup');});}await fs.writeFile(path.join(evidence,'results.json'),JSON.stringify(receipt,null,2)+'\n');console.log('Evidence',evidence);}
