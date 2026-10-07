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
const copy = path.join(root, 'desktop-copy'), evidence = process.env.ME_TEST_EVIDENCE || path.join(root, 'evidence');
await fs.mkdir(copy, { recursive: true }); await fs.mkdir(evidence, { recursive: true });
await fs.cp(path.join(appRoot, 'dist'), path.join(copy, 'dist'), { recursive: true });
await fs.writeFile(path.join(copy, 'package.json'), JSON.stringify({ name: 'help-chat-check', version, private: true, main: 'dist/main.cjs' }));
const probeFile=path.join(root,'chat-probe.json');
const injection = `
const chatProbe={requests:[],pending:null,compileAttempts:0};
ipcMain.removeHandler('setup:models');ipcMain.handle('setup:models',()=>[{id:'test-smart',name:'Test Smart',efforts:['low','medium','high','xhigh','max','ultra'],images:true,fast:true,isDefault:true},{id:'test-quick',name:'Test Quick',efforts:['low','medium'],images:true,fast:false,isDefault:false}]);
const probePath=${JSON.stringify(probeFile)};
function writeChatProbe(){
  const fs=require('node:fs');
  fs.writeFileSync(probePath+'.tmp',JSON.stringify({count:chatProbe.requests.length,pending:!!chatProbe.pending,compileAttempts:chatProbe.compileAttempts,request:chatProbe.requests.at(-1)}));
  fs.renameSync(probePath+'.tmp',probePath);
}
codex.client.run=async(prompt,schema,progress,effort,fast,reader,options)=>{
  if(chatProbe.pending)throw new Error('Concurrent requests');
  chatProbe.requests.push({prompt:JSON.parse(prompt),model:options?.model,effort,fast,images:options?.images??[]});
  return new Promise((resolve,reject)=>{chatProbe.pending={resolve,reject};writeChatProbe();});
};
codex.client.cancel=codex.client.stop=async()=>{const p=chatProbe.pending;chatProbe.pending=null;writeChatProbe();p?.reject(new Error('Synthetic cancellation'));};
compiler.compile=async()=>{chatProbe.compileAttempts++;writeChatProbe();throw new Error('Unexpected compilation from chat');};
globalThis.__chatProbe=chatProbe;globalThis.__writeChatProbe=writeChatProbe;writeChatProbe();
`;
await build({ entryPoints: [path.join(appRoot,'src/main/index.ts')], outfile: path.join(copy,'dist/main.cjs'), bundle: true, platform:'node', format:'cjs', target:'node22', external:['electron'], plugins:[{name:'synthetic-chat',setup(b){b.onLoad({filter:/src\/main\/index\.ts$/},async a=>({contents:await fs.readFile(a.path,'utf8')+injection,loader:'ts'}));}}] });
const reader = await build({ stdin:{contents:"import {EditorView} from '@codemirror/view';window.editorViewForTest=element=>EditorView.findFromDOM(element);",resolveDir:appRoot},bundle:true,write:false,format:'iife',platform:'browser' });
const source = '\\documentclass{article}\n\\begin{document}\nThe allocation are monotone.\nThis synthetic paper has no private content.\n\\end{document}\n';
const file = path.join(root,'main.tex'); await fs.writeFile(file,source);
const receipt = { version, source:'synthetic', model:'controlled; no account request', clipboard:'Synthetic DOM paste event; physical OS paste not claimed', checks:[], screenshots:[], processes:[], errors:[] };
let application, page;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function poll(fn,label,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await pause(60);}throw new Error('Timed out: '+label);}
const drawer=()=>page.getByRole('complementary',{name:'Codex Side Chat'});
const button=name=>drawer().getByRole('button',{name,exact:true});
const question=()=>page.getByLabel('Message to Codex Side Chat');
const scope=()=>page.getByLabel('Chat conversation');
// Observe the injected fake client without polling Electron's inspector during image IPC.
// Atomic snapshots also keep large bundled prompts out of inspector serialization.
async function probe(){return JSON.parse(await fs.readFile(probeFile,'utf8'));}
async function lastRequest(){return (await probe()).request;}
async function openSettings(){const el=drawer().locator('.chat-settings');if(!await el.evaluate(e=>e.open))await el.locator('summary').click();}
async function openContext(){const el=drawer().locator('.chat-context-options');if(!await el.evaluate(e=>e.open))await el.locator('summary').first().click();}
async function ask(text){for(const selector of ['.chat-settings','.chat-context-options']){const el=drawer().locator(selector);if(await el.evaluate(e=>e.open))await el.locator('summary').first().click();}const count=(await probe()).count;await question().fill(text);await button('Ask Codex').click();await poll(async()=>{const p=await probe();return p.pending&&p.count===count+1;},'chat request');}
async function complete(answer,hidden=false){await application.evaluate((_,answer)=>{const p=globalThis.__chatProbe.pending;globalThis.__chatProbe.pending=null;globalThis.__writeChatProbe();p.resolve(answer);},answer);await drawer().locator('.chat-answer').filter({hasText:answer.reply}).waitFor({state:hidden?'attached':'visible'});await poll(()=>drawer().getByRole('button',{name:'Ask Codex',exact:true,includeHidden:true}).isEnabled().then(x=>!x),'composer cleared');await poll(()=>question().isEnabled(),'reply complete');}
async function shot(name){await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].showInactive());try{await page.screenshot({path:path.join(evidence,name+'.png'),scale:'css'});receipt.screenshots.push(name+'.png');}finally{await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].hide());}}
async function check(name){assert.equal((await probe()).compileAttempts,0);assert.equal(await fs.readFile(file,'utf8'),source);receipt.checks.push(name);console.log('PASS',name);}
async function buffer(){return page.getByLabel('Document source',{exact:true}).evaluate(el=>window.editorViewForTest(el).state.doc.toString());}
async function launch(){application=await _electron.launch({executablePath:appRequire('electron'),args:[copy],cwd:appRoot,env:{...process.env,MODERN_EDITOR_RUNTIME_DIR:path.join(root,'runtime')},chromiumSandbox:true,timeout:25000});const child=application.process();receipt.processes.push({pid:child.pid,exited:false});console.log('Owned Electron PID',child.pid);page=await application.firstWindow();page.setDefaultTimeout(12000);page.on('pageerror',e=>receipt.errors.push(String(e)));await page.evaluate(reader.outputFiles[0].text);await application.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setContentSize(1450,960);w.webContents.setBackgroundThrottling(false);w.hide();});}
async function close(){const child=application.process();await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await poll(async()=>child.exitCode!==null||child.signalCode!==null,'owned Electron exit');assert.equal(child.exitCode,0);Object.assign(receipt.processes.find(p=>p.pid===child.pid),{exited:true,exitCode:child.exitCode});application=null;}
async function openPaper(){await application.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);await page.getByRole('button',{name:'Actions ▾',exact:true}).click();await page.getByRole('button',{name:'Open paper…',exact:true}).click();await page.getByLabel('Document source',{exact:true}).waitFor();assert.equal(await buffer(),source);}
async function pasteScreenshot(dataUrl,name){await question().evaluate((el,{dataUrl,name})=>{const bytes=Uint8Array.from(atob(dataUrl.split(',')[1]),c=>c.charCodeAt(0));const dt=new DataTransfer();dt.items.add(new File([bytes],name,{type:'image/png'}));el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));},{dataUrl,name});}
async function dragControl(control,dx,dy){const b=await control.boundingBox();assert(b);await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+dx,b.y+b.height/2+dy,{steps:8});await page.mouse.up();}
async function withinWindow(){await poll(async()=>{const b=await drawer().boundingBox(),v=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));return b&&b.x>=7&&b.y>=7&&b.x+b.width<=v.width-7&&b.y+b.height<=v.height-7;},'chat fits resized viewport');}
async function resetPlacement(){await drawer().getByLabel('Side Chat options',{exact:true}).click();await button('Reset position and size').click();}
const answer={reply:'Allocation is singular. The proposed sentence keeps the meaning.',suggestion:{title:'Correct the verb',explanation:'Use a singular verb.',original:'The allocation are monotone.',before:'',after:'',replacement:'The allocation is monotone.',packages:[]}};
try{
  await launch();await page.getByRole('button',{name:'Codex Side Chat',exact:true}).click();await question().waitFor();
  const initialBounds=await drawer().boundingBox();
  await question().fill('Keep this while moving the chat.');
  await dragControl(button('Move Side Chat'),-440,50);
  let moved=await drawer().boundingBox();assert.equal(moved.x,initialBounds.x-440);assert.equal(moved.y,initialBounds.y+50);
  await dragControl(button('Resize Side Chat'),80,-120);
  let resized=await drawer().boundingBox();assert.equal(resized.width,initialBounds.width+80);assert.equal(resized.height,initialBounds.height-120);
  await dragControl(drawer().locator('.chat-resize.nw'),-30,-20);
  let corner=await drawer().boundingBox();assert.equal(corner.x,resized.x-30);assert.equal(corner.y,resized.y-20);assert.equal(corner.x+corner.width,resized.x+resized.width);assert.equal(corner.y+corner.height,resized.y+resized.height);
  await button('Move Side Chat').focus();await page.keyboard.press('ArrowLeft');assert.equal((await drawer().boundingBox()).x,corner.x-10);
  await button('Resize Side Chat').focus();await page.keyboard.press('ArrowRight');assert.equal((await drawer().boundingBox()).width,corner.width+10);
  await button('Collapse Side Chat').click();assert.equal((await drawer().boundingBox()).height,44);assert(await question().isHidden());
  await dragControl(button('Move Side Chat'),0,1200);await withinWindow();
  await drawer().getByLabel('Side Chat options',{exact:true}).click();assert(await button('Reset position and size').isVisible());
  const resetBounds=await button('Reset position and size').boundingBox();assert(resetBounds.y+resetBounds.height<960);
  await page.keyboard.press('Escape');assert(await button('Expand Side Chat').isVisible());
  await button('Expand Side Chat').click();await withinWindow();assert.equal(await question().inputValue(),'Keep this while moving the chat.');
  await resetPlacement();assert.deepEqual(await drawer().boundingBox(),initialBounds);
  await openSettings();await page.getByLabel('Side Chat model',{exact:true}).selectOption('test-smart');await openSettings();await page.getByLabel('Side Chat effort',{exact:true}).selectOption('ultra');await page.getByLabel('Side Chat speed',{exact:true}).selectOption('fast');
  await openSettings();await page.getByLabel('Side Chat model',{exact:true}).selectOption('test-quick');assert.equal(await page.getByLabel('Side Chat effort',{exact:true}).inputValue(),'medium');assert.equal(await page.getByLabel('Side Chat speed',{exact:true}).inputValue(),'standard');assert.equal(await page.getByLabel('Side Chat effort',{exact:true}).locator('option[value=high]').count(),0);assert(await page.getByLabel('Side Chat speed',{exact:true}).locator('option[value=fast]').evaluate(option=>option.disabled));
  await openSettings();await page.getByLabel('Side Chat model',{exact:true}).selectOption('test-smart');await openSettings();await page.getByLabel('Side Chat effort',{exact:true}).selectOption('ultra');await page.getByLabel('Side Chat speed',{exact:true}).selectOption('fast');
  await check('Drag, edge/corner resize, keyboard placement, collapse, reachable bottom menu and reset retain the unsent question');
  await ask('Which version is running, and how can I compile?');let request=await lastRequest();assert.equal(request.prompt.application.version,version);assert(request.prompt.application.documentation.includes('Command+T'));assert(!request.prompt.source);assert.equal(request.model,'test-smart');assert.equal(request.effort,'ultra');assert.equal(request.fast,true);assert.deepEqual(request.prompt.requestSettings,{model:'test-smart',effort:'ultra',speed:'Fast'});
  await dragControl(button('Move Side Chat'),-140,30);await button('Collapse Side Chat').click();
  await complete({reply:`This is Modern Editor ${version}. Command+T compiles the current draft.`,suggestion:null},true);
  assert(await button('Expand Side Chat').isVisible());await button('Expand Side Chat').click();
  await shot('01-editor-help');await check('A pending reply completes while chat is moved and collapsed; editor help uses bundled docs and actual version');
  const image=await application.evaluate(({nativeImage})=>'data:image/png;base64,'+nativeImage.createFromBitmap(Buffer.alloc(240*120*4,180),{width:240,height:120}).toPNG().toString('base64'));
  await pasteScreenshot(image,'Pasted synthetic warning.png');await drawer().getByAltText('Pasted synthetic warning.png').waitFor();
  await drawer().getByTitle('Enlarge attached screenshot').click();await page.getByRole('dialog',{name:'Screenshot preview'}).waitFor();await page.getByLabel('Close screenshot preview').click();
  await button('Remove Pasted synthetic warning.png').click();assert.equal(await drawer().getByAltText('Pasted synthetic warning.png').count(),0);
  await question().evaluate((el,image)=>{const bytes=Uint8Array.from(atob(image.split(',')[1]),c=>c.charCodeAt(0)),dt=new DataTransfer();dt.items.add(new File([bytes],'Dropped synthetic screenshot.png',{type:'image/png'}));el.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));},image);
  await drawer().getByAltText('Dropped synthetic screenshot.png').waitFor();await button('Remove Dropped synthetic screenshot.png').click();
  const png=Buffer.from(image.split(',')[1],'base64'), imagePath=path.join(root,'Synthetic warning.png');await fs.writeFile(imagePath,Buffer.concat([png,Buffer.from('SYNTHETIC_METADATA_TO_REMOVE')]));
  await page.getByLabel('Choose chat screenshots').setInputFiles(imagePath);await drawer().getByAltText('Synthetic warning.png').waitFor();
  await question().fill('Draft with an attachment');await button('Collapse Side Chat').click();await button('Expand Side Chat').click();
  assert.equal(await question().inputValue(),'Draft with an attachment');assert(await drawer().getByAltText('Synthetic warning.png').isVisible());
  await ask('Explain this screenshot.');request=await lastRequest();assert.equal(request.images.length,1);assert(!Buffer.from(request.images[0].split(',')[1],'base64').includes(Buffer.from('SYNTHETIC_METADATA_TO_REMOVE')));assert(!JSON.stringify(request.prompt).includes('data:image'));
  await complete({reply:'The attached synthetic image is available as an image input.',suggestion:null});await shot('02-screenshot-message');await check('Paste, drop, enlarge, remove, file attachment and main-process image normalization');
  await ask('Retry this same question after stopping.');await button('Stop').click();await poll(()=>question().isEnabled(),'cancel completion');assert.equal(await question().inputValue(),'Retry this same question after stopping.');await ask('Retry this same question after stopping.');await complete({reply:'The unchanged question can be retried after Stop.',suggestion:null});await check('Stop retains question and unchanged retry uses a fresh preview');
  await question().fill('Keep this unsent question.');await button('Close Codex Side Chat').click();await page.getByRole('button',{name:'Codex Side Chat',exact:true}).click();assert.equal(await question().inputValue(),'Keep this unsent question.');await button('Close Codex Side Chat').click();
  await openPaper();
  await page.getByRole('button',{name:'Actions ▾',exact:true}).click();
  await page.locator('summary').filter({hasText:/^Codex effort ·/}).click();
  const paperEffort=page.getByLabel('Codex effort',{exact:true});await poll(()=>paperEffort.isEnabled(),'paper effort catalog');
  assert.equal(await paperEffort.locator('option[value=xhigh]').count(),1);assert.equal(await paperEffort.locator('option[value=ultra]').count(),1);
  await paperEffort.selectOption('xhigh');await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Actions ▾',exact:true}).click();await page.locator('summary').filter({hasText:/^Codex effort ·/}).click();await poll(()=>paperEffort.isEnabled(),'paper effort reload');assert.equal(await paperEffort.inputValue(),'xhigh');await page.keyboard.press('Escape');
  await check('Paper effort uses the catalog and saves Extra deep independently of Side Chat Ultra');
  await page.getByRole('button',{name:'Codex Side Chat',exact:true}).click();assert.equal(await scope().inputValue(),'paper');assert.equal(await drawer().locator('.chat-turn').count(),0);
  await question().fill('Keep this paper question.');await pasteScreenshot(image,'Unsent paper.png');await drawer().getByAltText('Unsent paper.png').waitFor();await scope().selectOption('editor');assert.equal(await question().inputValue(),'Keep this unsent question.');await scope().selectOption('paper');assert.equal(await question().inputValue(),'Keep this paper question.');assert(await drawer().getByAltText('Unsent paper.png').isVisible());await button('Remove Unsent paper.png').click();await check('Switching conversations preserves separate unsent messages and attachments');
  await ask('Improve the grammar of the first sentence.');request=await lastRequest();assert.equal(request.prompt.source.text,source);assert(!request.prompt.diagnostics);assert.equal(request.model,'test-smart');assert.equal(request.effort,'ultra');assert.equal(request.fast,true);await complete(answer);assert.equal(await buffer(),source);assert.equal(await drawer().locator('.chat-suggestion').count(),1);await shot('03-paper-proposal');
  await button('Add comment').click();assert(await drawer().isVisible());await poll(()=>button('Added').isDisabled(),'individual addition remains visible');await button('Close Codex Side Chat').click();assert.equal(await buffer(),source);await page.getByRole('button',{name:'Edit',exact:true}).click();assert.equal(await page.getByLabel('Proposed replacement',{exact:true}).inputValue(),answer.suggestion.replacement);
  await application.evaluate(({Menu,BrowserWindow})=>{const item=Menu.getApplicationMenu().items.find(x=>x.label==='Edit').submenu.items.find(x=>x.label==='Undo');item.click(item,BrowserWindow.getAllWindows()[0],{});});await poll(()=>page.getByLabel('Proposed replacement',{exact:true}).count().then(n=>n===0),'undo added comment');await check('Adding a visible proposal is undoable and never changes source');
  await page.getByRole('button',{name:'Codex Side Chat',exact:true}).click();await ask('Give me three independent comments.');
  const batch={reply:'Three separate comments. Add whichever you want to review.',suggestions:[answer.suggestion,
    {...answer.suggestion,title:'Shorten the description',explanation:'Remove a redundant adjective.',original:'This synthetic paper has no private content.',replacement:'This paper has no private content.'},
    {...answer.suggestion,title:'Explain monotonicity',explanation:'Specify the variable with respect to which the allocation is monotone.',original:'monotone',replacement:null}
  ]};
  await complete(batch);const batchTurn=drawer().locator('.chat-turn').last();assert.equal(await batchTurn.locator('.chat-suggestion').count(),3);
  await shot('06-multiple-comments');await batchTurn.getByRole('button',{name:'Add comment',exact:true}).first().click();assert(await drawer().isVisible());await button('Close Codex Side Chat').click();
  await page.getByRole('button',{name:'Reject',exact:true}).click();
  await page.getByRole('button',{name:'Codex Side Chat',exact:true}).click();assert(await batchTurn.getByRole('button',{name:'Added',exact:true}).isDisabled());assert(await button('Add all and review (2)').isEnabled());
  await button('Add all and review (2)').click();await poll(()=>drawer().isHidden(),'batch addition');assert.equal(await buffer(),source);
  await page.locator('footer').getByText('2 open · 0 applied',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Codex Side Chat',exact:true}).click();assert(await button('All added').isDisabled());assert.equal(await batchTurn.getByRole('button',{name:'Added',exact:true}).count(),3);await button('Close Codex Side Chat').click();
  await application.evaluate(({Menu,BrowserWindow})=>{const item=Menu.getApplicationMenu().items.find(x=>x.label==='Edit').submenu.items.find(x=>x.label==='Undo');item.click(item,BrowserWindow.getAllWindows()[0],{});});
  await page.locator('footer').getByText('0 open · 0 applied',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Codex Side Chat',exact:true}).click();assert.equal(await batchTurn.getByRole('button',{name:'Added',exact:true}).count(),1);assert(await button('Add all and review (2)').isEnabled());
  await batchTurn.getByRole('button',{name:'Discuss this',exact:true}).nth(1).click();await ask('What does comment 2 propose?');request=await lastRequest();assert.equal(request.prompt.history.exchanges.at(-1).comments[1].original,batch.suggestions[1].original);assert.equal(request.prompt.history.selectedSuggestion.number,2);assert.equal(request.prompt.history.selectedSuggestion.original,batch.suggestions[1].original);
  await complete({reply:'Comment 2 removes a redundant adjective.',suggestions:[]});await check('Three comments can be added individually or together; rejected comments stay in History, batch Undo is atomic, and follow-ups include numbered proposals');
  await ask('Improve that sentence again while I edit.');
  await page.getByLabel('Document source',{exact:true}).evaluate(el=>{const view=window.editorViewForTest(el);view.dispatch({changes:{from:0,insert:'% synthetic edit\n'}});});
  await complete({...answer,reply:'This answer was prepared against the earlier source.'});await button('Add comment').last().click();assert(await drawer().isVisible());await button('Close Codex Side Chat').click();await page.getByText(/passage needs confirmation|passage is unconfirmed|Confirm this passage|placement needs confirmation/).first().waitFor().catch(async()=>{assert(await page.getByText('Attach to selected text',{exact:true}).isVisible());});
  assert((await buffer()).startsWith('% synthetic edit'));await check('Source changes during chat require proposal attachment confirmation');
  await page.getByRole('button',{name:'Codex Side Chat',exact:true}).click();
  const restoredPlacement=await drawer().boundingBox();
  await button('Resize Side Chat').focus();for(let i=0;i<16;i++)await page.keyboard.press('Shift+ArrowUp');
  assert.equal((await drawer().boundingBox()).height,420);
  const compact=await drawer().evaluate(el=>{const panel=el.getBoundingClientRect(),composer=el.querySelector('.chat-composer').getBoundingClientRect();return {panelBottom:panel.bottom,composerBottom:composer.bottom};});
  assert(compact.composerBottom<=compact.panelBottom);
  for(let i=1;i<=3;i++){await pasteScreenshot(image,'Compact '+i+'.png');await drawer().getByAltText('Compact '+i+'.png').waitFor();}
  await question().fill('Keep the writing field and Send visible.');await openContext();
  const writing=await drawer().evaluate(el=>{const panel=el.getBoundingClientRect(),q=el.querySelector('textarea').getBoundingClientRect(),send=[...el.querySelectorAll('button')].find(b=>b.textContent==='Ask Codex').getBoundingClientRect();return {bottom:panel.bottom,q,send};});
  assert(writing.q.height>=60);assert(writing.send.bottom<=writing.bottom-5);assert(writing.q.bottom<=writing.send.top);await shot('07-compact-chat');
  const contextBounds=await drawer().locator('.chat-context-panel').boundingBox(), headingBounds=await drawer().locator('.chat-heading').boundingBox();assert(contextBounds.y>=headingBounds.y+headingBounds.height);assert(contextBounds.y+contextBounds.height<=writing.q.top);
  await drawer().locator('.chat-context-options > summary').click();for(let i=1;i<=3;i++)await button('Remove Compact '+i+'.png').click();
  await button('Resize Side Chat').focus();for(let i=0;i<(restoredPlacement.height-420)/10;i++)await page.keyboard.press('ArrowDown');
  await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(960,640));await withinWindow();await question().scrollIntoViewIfNeeded();await shot('04-minimum-window');
  const bounds=await question().boundingBox();assert(bounds&&bounds.y>=0&&bounds.y+bounds.height<=640);await check('Question remains accessible at minimum window size');
  await close();await launch();await page.getByRole('button',{name:'Codex Side Chat',exact:true}).click();assert.deepEqual(await drawer().boundingBox(),restoredPlacement);assert.equal(await page.getByLabel('Side Chat model',{exact:true}).inputValue(),'test-smart');assert.equal(await page.getByLabel('Side Chat effort',{exact:true}).inputValue(),'ultra');assert.equal(await page.getByLabel('Side Chat speed',{exact:true}).inputValue(),'fast');
  if(await scope().inputValue()==='editor'){await button('Close Codex Side Chat').click();await openPaper();
  await page.getByRole('button',{name:'Actions ▾',exact:true}).click();
  await page.locator('summary').filter({hasText:/^Codex effort ·/}).click();
  const paperEffort=page.getByLabel('Codex effort',{exact:true});await poll(()=>paperEffort.isEnabled(),'paper effort catalog');
  assert.equal(await paperEffort.locator('option[value=xhigh]').count(),1);assert.equal(await paperEffort.locator('option[value=ultra]').count(),1);
  await paperEffort.selectOption('xhigh');await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Actions ▾',exact:true}).click();await page.locator('summary').filter({hasText:/^Codex effort ·/}).click();await poll(()=>paperEffort.isEnabled(),'paper effort reload');assert.equal(await paperEffort.inputValue(),'xhigh');await page.keyboard.press('Escape');
  await check('Paper effort uses the catalog and saves Extra deep independently of Side Chat Ultra');
  await page.getByRole('button',{name:'Codex Side Chat',exact:true}).click();}
  await poll(()=>drawer().locator('.chat-turn').count().then(n=>n===4),'paper chat restored');
  await scope().selectOption('editor');await drawer().getByText('The unchanged question can be retried after Stop.',{exact:true}).waitFor();assert.equal(await drawer().getByAltText('Synthetic warning.png').count(),1);await shot('05-reopened-editor-conversation');await check('Restart restores placement, independent chat model/effort/speed, separate conversations and screenshots');
  await openContext();await button('Clear chat…').click();await button('Keep').click();assert.equal(await drawer().locator('.chat-turn').count(),4);await openContext();await button('Clear chat…').click();await button('Clear conversation').click();await poll(()=>drawer().locator('.chat-turn').count().then(n=>n===0),'editor chat cleared');await scope().selectOption('paper');await poll(()=>drawer().locator('.chat-turn').count().then(n=>n===4),'paper chat preserved');await check('Confirmed clearing deletes only the chosen conversation');
  await close();assert.deepEqual(receipt.errors,[]);receipt.passed=true;
}catch(e){receipt.failure=String(e.stack??e);if(page)await shot('failure').catch(()=>{});throw e;}
finally{if(application){await application.evaluate(()=>{globalThis.__chatProbe.pending?.reject(new Error('Test shutdown'));globalThis.__chatProbe.pending=null;}).catch(()=>{});await close().catch(async()=>{const child=application?.process();await application?.close().catch(()=>{});if(child)await poll(async()=>child.exitCode!==null||child.signalCode!==null,'test process cleanup');});}await fs.writeFile(path.join(evidence,'results.json'),JSON.stringify(receipt,null,2)+'\n');console.log('Evidence',evidence);}
