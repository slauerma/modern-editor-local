// Native desktop regression: synthetic paper, controlled Codex responses, real persistence.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
assert(args.length === 0 || args.length === 2 && args[0] === '--playwright-package');
const require = createRequire(path.join(appRoot, 'package.json'));
const { _electron } = (args.length ? createRequire(path.resolve(args[1])) : require)('playwright');
const root = path.join(appRoot, '.test-runs', 'saved-alternatives-' + Date.now()), copy = path.join(root, 'desktop');
const evidence = process.env.ME_TEST_EVIDENCE || path.join(root, 'evidence');
await fs.mkdir(copy, { recursive: true }); await fs.mkdir(evidence, { recursive: true });
await fs.cp(path.join(appRoot, 'dist'), path.join(copy, 'dist'), { recursive: true });
await fs.symlink(path.join(appRoot, 'node_modules'), path.join(copy, 'node_modules'), 'dir');
await fs.writeFile(path.join(copy, 'package.json'), JSON.stringify({ name: 'saved-alternatives-check', version: '1.3.0', main: 'dist/main.cjs', private: true }));
const source = 'The allocation are monotone.\n\nA second claim needs qualification.\n';
const first = 'The allocation are monotone.', second = 'A second claim needs qualification.';
const paper = path.join(root, 'paper.txt'), imported = path.join(root, 'comments.json');
await fs.writeFile(paper, source);
await fs.writeFile(imported, JSON.stringify([
  { id: 'c1', title: 'Choose a concise wording', explanation: 'Use a singular verb and preserve the intended property.', original: first, replacement: 'The allocation is monotone.', alternatives: [
    { label: 'Concise', reason: 'A shorter statement of the same property.', replacement: 'Allocation is monotone.' },
    { label: 'Explicit', reason: 'Make the property explicit.', replacement: 'The allocation has the monotonicity property.' }] },
  { id: 'c2', title: 'Qualify the claim', explanation: 'Narrow the scope.', original: second, replacement: 'A qualified second claim.' }
]));
const injection = `
const choiceProbe = { file:null, hold:false, release:null, calls:[] };
dialog.showOpenDialog = async()=>({ canceled:false, filePaths:[choiceProbe.file] });
codex.client.run = async(prompt,schema,progress,effort,fast,reader,config)=>{
  const value=JSON.parse(prompt); choiceProbe.calls.push({value,effort,fast,reader:!!reader,config});
  if(choiceProbe.hold) { choiceProbe.hold=false; await new Promise(resolve=>{choiceProbe.release=resolve;}); }
  if(schema.properties.alternatives) return {reply:'One additional choice.',replacement:null,packages:[],alternatives:[{label:'Direct',reason:'A direct statement with the same meaning.',replacement:'Monotonicity holds for the allocation.',packages:[]}]};
  return {comments:[
    {category:'Clarity',title:'A new observation',explanation:'Consider this distinct wording.',original:'The allocation are monotone.',before:'',after:'',replacement:'The allocation is weakly monotone.',packages:[]},
    {category:'Clarity',title:'Qualify the claim',explanation:'Narrow the scope.',original:'A second claim needs qualification.',before:'',after:'',replacement:'A qualified second claim.',packages:[]}
  ]};
};
globalThis.__choiceProbe=choiceProbe; globalThis.__choiceProjects=projects;
`;
await build({ entryPoints: [path.join(appRoot, 'src/main/index.ts')], outfile: path.join(copy, 'dist/main.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'],
  plugins: [{ name: 'choice-probe', setup(b) { b.onLoad({ filter: /src\/main\/index\.ts$/ }, async a => ({ contents: await fs.readFile(a.path, 'utf8') + injection, loader: 'ts' })); } }] });
const helper = await build({ stdin: { contents: `
import {EditorView} from '@codemirror/view';
const view=()=>EditorView.findFromDOM(document.querySelector('.source-pane .cm-content'));
window.choiceRead=()=>view().state.doc.toString();
window.choiceSelectAll=()=>{const v=view();v.dispatch({selection:{anchor:0,head:v.state.doc.length}});};
`, resolveDir: appRoot }, bundle: true, write: false, format: 'iife', platform: 'browser' });
let application, page;
const receipt = { synthetic: true, liveCodex: false, checks: [], rendererErrors: [], processes: [] };
const button = name => page.getByRole('button', { name, exact: true });
async function poll(fn, label, timeout = 25000) { const until=Date.now()+timeout; while(Date.now()<until){if(await fn()) return;await new Promise(r=>setTimeout(r,70));}throw Error('Timed out: '+label); }
async function open() {
  await application.evaluate((_, file)=>{globalThis.__choiceProbe.file=file;},paper);
  await button('Open a LaTeX or text file').click(); await page.locator('.source-pane .cm-content').waitFor();
  if(await button('Dismiss notice').count()) await button('Dismiss notice').click();
}
async function actions(name) { await button('Actions ▾').click(); await button(name).click(); }
async function commentAction(name) { await page.locator('.comment-details > button').click(); await button(name).click(); }
async function arrival(value) { await page.locator('.comment-details > button').click(); const control=page.getByLabel('Add new comments as they arrive'); if(value!==undefined) await control.setChecked(value); const checked=await control.isChecked(); await page.keyboard.press('Escape'); return checked; }
async function snapshot(name) { await page.screenshot({ path:path.join(evidence,name+'.png') }); }
try {
  application = await _electron.launch({ executablePath:require('electron'),args:[copy],cwd:appRoot,env:{...process.env,MODERN_EDITOR_RUNTIME_DIR:path.join(root,'runtime')},chromiumSandbox:true,timeout:25000 });
  const child=application.process(); receipt.processes.push({pid:child.pid,exited:false}); console.log('Owned Electron PID',child.pid);
  page=await application.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror',e=>receipt.rendererErrors.push(String(e)));
  await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1500,1000));
  await page.evaluate(helper.outputFiles[0].text); await open();
  await application.evaluate((_,file)=>{globalThis.__choiceProbe.file=file;},imported);
  await button('Actions ▾').click(); await button('Import JSON…').click();
  await page.getByRole('heading',{name:'Choose a concise wording'}).waitFor();
  await button('Edit').click();
  const wording=page.getByLabel('Alternative wording'), draft=page.locator('#replacement');
  await draft.fill('My starting wording.');
  await wording.selectOption({label:'2. Concise'}); await draft.fill('My shorter wording.');
  await wording.selectOption({label:'1. Original suggestion · edited'}); assert.equal(await draft.inputValue(),'My starting wording.');
  await wording.selectOption({label:'2. Concise · edited'}); assert.equal(await draft.inputValue(),'My shorter wording.');
  await button('Quick alternative').click();
  await poll(async()=>await wording.locator('option').count()===4,'one new saved choice');
  assert.equal(await draft.inputValue(),'My shorter wording.');
  const calls=await application.evaluate(()=>globalThis.__choiceProbe.calls);
  assert.equal(calls[0].config.model,'gpt-6.1-sol'); assert.equal(calls[0].effort,'low'); assert.equal(calls[0].reader,false);
  await snapshot('01-saved-wordings');
  await button('Undo').click(); assert.equal(await draft.inputValue(),'My starting wording.'); assert.equal(await wording.locator('option').count(),4);
  await wording.selectOption({label:'2. Concise · edited'});
  await button('Accept').click(); await poll(async()=>(await page.evaluate(()=>window.choiceRead())).startsWith('My shorter wording.'),'accepted wording applied');
  await button('Undo').click(); assert.equal(await page.evaluate(()=>window.choiceRead()),source);
  receipt.checks.push('Import, per-choice edits, Quick alternative, Undo and acceptance preserve all wording choices and source.');
  await button('Next comment').click(); await button('Reject').click();
  await page.getByRole('heading',{name:'Choose a concise wording'}).waitFor();
  await page.evaluate(()=>window.choiceSelectAll());
  await application.evaluate(()=>{globalThis.__choiceProbe.hold=true;});
  await button('Review with Codex').click(); await button('Start review').click();
  await poll(()=>application.evaluate(()=>!!globalThis.__choiceProbe.release),'background review started');
  await arrival(false); await button('Edit').click(); await draft.fill('My draft while Codex works.');
  await application.evaluate(()=>{globalThis.__choiceProbe.release();globalThis.__choiceProbe.release=null;});
  await poll(()=>button('Review with Codex').isEnabled(),'background review finished');
  assert.match(await page.locator('.review-nav').innerText(),/1 \/ 1/);
  await arrival(true);
  await poll(async()=>/1 \/ 2/.test(await page.locator('.review-nav').innerText()),'waiting review integrated without the rejected duplicate');
  assert.equal(await draft.inputValue(),'My draft while Codex works.');
  assert.equal(await page.evaluate(()=>window.choiceRead()),source);
  const reviewCalls=await application.evaluate(()=>globalThis.__choiceProbe.calls);
  assert.equal(reviewCalls[1].value.rejectedSuggestions.totalRejected,1);
  await snapshot('02-background-arrival');
  receipt.checks.push('Current automatic-arrival switch controls an in-flight review; integration preserves selection/draft and suppresses rejected repeat.');
  await arrival(false); await actions('Close project'); await button('Open a LaTeX or text file').waitFor();
  await open(); await page.getByRole('heading',{name:'Choose a concise wording'}).waitFor(); await button('Edit').click();
  assert.equal(await draft.inputValue(),'My draft while Codex works.'); assert.equal(await arrival(),false);
  assert.equal(await wording.locator('option').count(),4);
  await commentAction('History'); await button('Next comment').click(); await page.getByRole('heading',{name:'Qualify the claim'}).waitFor(); await button('Reopen').count();
  receipt.checks.push('Close/reopen restores selected wording, edited drafts, all alternatives, rejected history and paper arrival preference.');
  assert.equal(await fs.readFile(paper,'utf8'),source); assert.deepEqual(receipt.rendererErrors,[]); receipt.passed=true;
} catch(error) { receipt.passed=false;receipt.failure=String(error.stack??error);try{await snapshot('failure');}catch{}throw error; }
finally {
  if(application){const child=application.process();try{await application.evaluate(()=>globalThis.__choiceProbe.release?.());await application.close();}finally{await poll(async()=>child.exitCode!==null||child.signalCode!==null,'owned process exit');receipt.processes.find(p=>p.pid===child.pid).exited=true;console.log('Owned Electron exited',child.pid);}}
  await fs.writeFile(path.join(evidence,'results.json'),JSON.stringify(receipt,null,2));console.log('Evidence',evidence);
  if(receipt.passed && !evidence.startsWith(root+path.sep)) await fs.rm(root,{recursive:true,force:true});
}
