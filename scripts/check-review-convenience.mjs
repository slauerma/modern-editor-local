// Synthetic native UI regression; never opens a real paper or calls a model.
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
const root = path.join(repo, '.test-runs', 'review-convenience-' + Date.now()), copy = path.join(root, 'desktop');
const evidence = process.env.ME_TEST_EVIDENCE || path.join(repo, 'test-evidence', 'review-convenience-' + Date.now());
await fs.mkdir(copy, { recursive: true }); await fs.mkdir(evidence, { recursive: true });
await fs.cp(path.join(repo, 'dist'), path.join(copy, 'dist'), { recursive: true });
await fs.symlink(path.join(repo, 'node_modules'), path.join(copy, 'node_modules'), 'dir');
await fs.writeFile(path.join(copy, 'package.json'), JSON.stringify({ name: 'review-convenience-check', version: '1.7.0', main: 'dist/main.cjs', private: true }));
const injection = `
const probe={file:null,catalog:0,limits:0,calls:0,release:null};
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[probe.file]});
codex.client.run=async(prompt,schema,progress,effort,fast)=>{
  probe.calls++;probe.effort=effort;probe.fast=fast;progress('Synthetic review in progress');
  await new Promise(resolve=>{probe.release=resolve;});probe.release=null;
  return {comments:[]};
};
codex.client.cancel=async()=>{probe.release?.();};
CodexClient.prototype.listModels=async()=>{probe.catalog++;return ['gpt-6.1-sol','gpt-6-astra','gpt-6-luna'].map((id,i)=>({id,name:id,isDefault:i===0,efforts:['low','medium','high','xhigh','max','ultra'],fast:i!==2,images:true}));};
codex.client.accountLimits=async()=>{probe.limits++;return {checkedAt:new Date().toISOString(),windows:[{name:'Codex · Primary',usedPercent:25,minutes:300,resetsAt:2000000000}]};};
probe.seedUsage=async()=>{for(const known of [true,false])await usage.record({id:randomUUID(),createdAt:new Date().toISOString(),scope:usageScope(),purpose:'review',model:'gpt-6-astra',effort:'high',fastMode:true,outcome:known?'complete':'cancelled',elapsedMs:known?5200:900,firstAnswerMs:known?1800:null,connectMs:100,setupMs:300,tokens:known?{totalTokens:1200,inputTokens:1000,cachedInputTokens:600,outputTokens:200,reasoningOutputTokens:100}:null});};
globalThis.__convenienceProbe=probe;
`;
await build({ entryPoints: [path.join(repo, 'src/main/index.ts')], outfile: path.join(copy, 'dist/main.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'],
  plugins: [{ name: 'convenience-probe', setup(b) { b.onLoad({ filter: /src\/main\/index\.ts$/ }, async a => ({ contents: await fs.readFile(a.path, 'utf8') + injection, loader: 'ts' })); } }] });
const reader = await build({ stdin: { contents: `
import {EditorView} from '@codemirror/view';
const view=()=>EditorView.findFromDOM(document.querySelector('.source-pane .cm-content'));
window.readSource=()=>view().state.doc.toString();
window.pasteSource=text=>view().dispatch({changes:{from:0,to:view().state.doc.length,insert:text},userEvent:'input.paste'});
`, resolveDir: repo }, bundle: true, write: false, format: 'iife', platform: 'browser' });
const text = Array.from({length:40},(_,i)=>`Result ${i} gives background. The conclusion ${i} are valid. The next claim follows.`).join('\n');
const paper = path.join(root, 'paper'); await fs.mkdir(path.join(paper, '.modern-editor'), { recursive: true });
const file = path.join(paper, 'main.txt'); await fs.writeFile(file, text);
const original='conclusion 20 are', from=text.indexOf(original);
const comments = [{id:'verb',title:'Use the singular verb',explanation:'Conclusion is singular.',original,replacement:'conclusion 20 is',from,to:from+original.length,validity:'current',decision:'open',packages:[],messages:[]}];
await fs.writeFile(path.join(paper,'.modern-editor/review.json'),JSON.stringify({schemaVersion:1,rootFile:'main.txt',sourceHash:createHash('sha256').update(text).digest('hex'),activeId:'verb',updatedAt:new Date().toISOString(),comments}));
const receipt={synthetic:true,liveCodex:false,checks:[],rendererErrors:[],processes:[]};
let application,page;
const button=name=>page.getByRole('button',{name,exact:true});
async function poll(fn,label,ms=15000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,80));}throw Error('Timed out: '+label);}
async function shot(name){await page.screenshot({path:path.join(evidence,name+'.png')});}
async function open(){await application.evaluate((_,file)=>{globalThis.__convenienceProbe.file=file;},file);await button('Open a LaTeX or text file').click();await page.locator('.source-pane .cm-content').waitFor();await page.evaluate(reader.outputFiles[0].text);if(await button('Dismiss notice').count())await button('Dismiss notice').click();}
try {
  application=await _electron.launch({executablePath:require('electron'),args:[copy],cwd:repo,env:{...process.env,MODERN_EDITOR_RUNTIME_DIR:path.join(root,'runtime')},chromiumSandbox:true,timeout:25000});
  const child=application.process();receipt.processes.push({pid:child.pid,exited:false});console.log('Owned Electron PID',child.pid);
  page=await application.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>receipt.rendererErrors.push(String(e)));
  await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1440,920));
  await open(); const reading=page.getByLabel('Changes in context',{exact:true});
  assert((await reading.innerText()).length<350);await shot('01-compact-context');
  await button('More context').click();assert((await reading.innerText()).length>2500);await button('Less context').click();
  await button('Clean').click();assert.match(await page.getByLabel('Clean proposed text').innerText(),/conclusion 20 is/);
  await button('Edit').click();assert.equal(await page.getByLabel('Proposed replacement',{exact:true}).inputValue(),'conclusion 20 is');await button('Changes').click();
  receipt.checks.push('Tiny edit displays a few sentences; More/Less context, Clean and Edit preserve the exact full replacement.');
  const updated='A new opening sentence.\n'+text;
  await page.evaluate(t=>window.pasteSource(t),updated);assert(await button('Accept').isEnabled());
  await button('Accept').click();await poll(()=>page.evaluate(()=>window.readSource()).then(s=>s===updated.replace(original,'conclusion 20 is')),'accepted source');
  await button('Undo').click();await poll(()=>page.evaluate(()=>window.readSource()).then(s=>s===updated),'undo source');assert(await button('Accept').isEnabled());
  receipt.checks.push('Whole-document paste with one added sentence retains the intended anchor; Accept changes only the quoted span; Undo restores it.');

  const yBefore=(await page.locator('.review-content').boundingBox()).y;
  await button('Review with Codex').click();const instructions=page.getByLabel('Instructions for this review');await instructions.fill('Keep these instructions.');
  assert.equal(await application.evaluate(()=>globalThis.__convenienceProbe.catalog),0);
  await page.getByLabel('Model, effort and speed',{exact:true}).click();await poll(()=>page.getByLabel('Review model',{exact:true}).isEnabled(),'model controls');
  await page.getByLabel('Review model',{exact:true}).selectOption('gpt-6-astra');await poll(()=>page.getByLabel('Review effort',{exact:true}).isEnabled(),'saved model');
  await page.getByLabel('Review effort',{exact:true}).selectOption('high');await poll(()=>page.getByLabel('Review speed',{exact:true}).isEnabled(),'saved effort');
  await page.getByLabel('Review speed',{exact:true}).selectOption('fast');await poll(()=>button('Start review').isEnabled(),'saved speed');
  const hint=page.getByRole('button',{name:'About review model and speed',exact:true});
  await hint.focus();await page.getByRole('note',{name:'review model and speed',exact:true}).waitFor();
  await page.keyboard.press('Escape');await poll(()=>page.getByRole('note',{name:'review model and speed',exact:true}).count().then(n=>n===0),'hint dismissed');
  await page.getByLabel('Review effort',{exact:true}).focus();await hint.hover();await page.getByRole('note',{name:'review model and speed',exact:true}).waitFor();
  await page.mouse.move(20,20);await page.keyboard.press('Escape');
  await shot('02-review-controls');
  await page.getByLabel('Review model',{exact:true}).selectOption('gpt-6-luna');await poll(()=>page.getByLabel('Review speed',{exact:true}).isEnabled(),'Luna selected');assert(await button('Start review').isDisabled());
  await page.getByLabel('Review model',{exact:true}).selectOption('gpt-6-astra');await poll(()=>button('Start review').isEnabled(),'Astra restored');
  await button('Close review request').click();await button('Review with Codex').click();assert.equal(await instructions.inputValue(),'Keep these instructions.');
  await poll(()=>page.getByLabel('Model, effort and speed',{exact:true}).innerText().then(s=>/(?:GPT-6 Astra|gpt-6-astra).*High.*Fast/.test(s)),'restored model summary');
  await button('Start review').click();await page.getByLabel('Review progress and controls',{exact:true}).waitFor();
  assert.equal((await page.locator('.review-content').boundingBox()).y,yBefore);
  await page.getByLabel('Review progress and controls',{exact:true}).click();await button('Stop review').waitFor();await shot('03-quiet-progress');await button('Stop review').click();
  await poll(()=>button('Review with Codex').isEnabled(),'review cancelled');assert.equal((await page.locator('.review-content').boundingBox()).y,yBefore);
  assert.deepEqual(await application.evaluate(()=>({effort:globalThis.__convenienceProbe.effort,fast:globalThis.__convenienceProbe.fast})),{effort:'high',fast:true});
  receipt.checks.push('Review opens without catalog/model requests; direct model/effort/speed choices persist and reach the request; unsupported Fast blocks Start; instructions retained. Progress start/stop leaves comment geometry unchanged.');

  await application.evaluate(()=>globalThis.__convenienceProbe.seedUsage());await button('Actions ▾').click();await button('Usage & speed…').click();
  const usage=page.getByRole('dialog',{name:'Usage & speed',exact:true});await usage.waitFor();await poll(()=>usage.locator('tbody tr').count().then(n=>n===2),'usage rows');
  assert.match(await usage.innerText(),/1,200 reported tokens \(1\/2 requests\)/);assert.equal(await application.evaluate(()=>globalThis.__convenienceProbe.limits),0);
  await button('Refresh account limits').click();await page.getByText(/75% remaining/).waitFor();await shot('04-usage-and-account-limits');
  await page.getByLabel('Usage range').selectOption('paper');assert.equal(await usage.locator('tbody tr').count(),2);
  await page.getByLabel('Record local usage metadata').click();await poll(()=>page.evaluate(async()=>!(await window.editor.usageState()).enabled),'recording disabled');
  await page.getByLabel('Record local usage metadata').click();await poll(()=>page.evaluate(async()=>(await window.editor.usageState()).enabled),'recording enabled');
  await button('Close').click();
  receipt.checks.push('Usage history includes available/missing token reports, paper filter and recording toggle. Account limits load only on request and are distinct from token totals.');
  await button('Actions ▾').click();await button('Close project').click(); await button('Close and keep data').click();await button('Open a LaTeX or text file').waitFor();await open();
  assert.equal(await page.evaluate(()=>window.readSource()),updated);assert(await button('Accept').isEnabled());assert.equal(await fs.readFile(file,'utf8'),text);
  assert.deepEqual(receipt.rendererErrors,[]);receipt.passed=true;receipt.checks.push('Recovered unsaved draft and anchors survive close/reopen; disk manuscript unchanged; no renderer errors.');
} catch(error){receipt.passed=false;receipt.failure=String(error.stack??error);try{await shot('failure');}catch{}throw error;}
finally {
  if(application){const child=application.process();await application.close();await poll(async()=>child.exitCode!==null||child.signalCode!==null,'owned Electron exit');receipt.processes.find(p=>p.pid===child.pid).exited=true;console.log('Owned Electron exited',child.pid);}
  await fs.writeFile(path.join(evidence,'results.json'),JSON.stringify(receipt,null,2));console.log('Evidence',evidence);
  if(receipt.passed&&!evidence.startsWith(root+path.sep))await fs.rm(root,{recursive:true,force:true});
}
