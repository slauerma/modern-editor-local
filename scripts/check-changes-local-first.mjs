// Native Electron + real TeX. Controlled Sol responses exercise publication order.
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
const root = path.join(appRoot, '.test-runs', 'local-first-' + Date.now()), copy = path.join(root, 'desktop');
const evidence = process.env.ME_TEST_EVIDENCE || path.join(appRoot, 'test-evidence', 'local-first-' + Date.now());
await fs.mkdir(copy, { recursive: true }); await fs.mkdir(evidence, { recursive: true });
await fs.cp(path.join(appRoot, 'dist'), path.join(copy, 'dist'), { recursive: true });
await fs.symlink(path.join(appRoot, 'node_modules'), path.join(copy, 'node_modules'), 'dir');
await fs.writeFile(path.join(copy, 'package.json'), JSON.stringify({ name: 'local-first-check', version: '1.3.0', main: 'dist/main.cjs', private: true }));
const injection = [
  "const probe={file:null,hold:false,release:null,invalid:false,builds:0,plans:0,artifacts:[]};",
  "dialog.showOpenDialog=async()=>({canceled:false,filePaths:[probe.file]});",
  "const realCompile=compiler.compile.bind(compiler);compiler.compile=async(...args)=>{probe.builds++;return realCompile(...args);};",
  "codex.planChanges=async(projectId,prompt)=>{probe.plans++;if(probe.hold){probe.hold=false;await new Promise(resolve=>probe.release=resolve);}const changes=JSON.parse(prompt).changes;return {inspect:[],groups:(probe.invalid?changes.slice(1):changes).map(c=>({ids:[c.id],layout:'keep',summary:'Controlled explanation for '+c.id+'.'}))};};",
  "const realComparison=changesPdf.build.bind(changesPdf);changesPdf.build=async(input)=>{const result=await realComparison(input);probe.artifacts.push({id:result.id,after:input.after,build:result.build?.id,reused:result.reused});return result;};",
  "globalThis.__localFirstProbe=probe;"
].join('\n');
await build({ entryPoints: [path.join(appRoot, 'src/main/index.ts')], outfile: path.join(copy, 'dist/main.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'],
  plugins: [{ name: 'local-first-probe', setup(b) { b.onLoad({ filter: /src\/main\/index\.ts$/ }, async a => ({ contents: await fs.readFile(a.path, 'utf8') + injection, loader: 'ts' })); } }] });
const reader = await build({ stdin: { contents: "import {EditorView} from '@codemirror/view';import {undoDepth} from '@codemirror/commands';window.checkRead=()=>{let v=EditorView.findFromDOM(document.querySelector('.source-pane .cm-content'));return {text:v.state.doc.toString(),undo:undoDepth(v.state)};};window.checkWrite=text=>{let v=EditorView.findFromDOM(document.querySelector('.source-pane .cm-content'));v.dispatch({changes:{from:0,to:v.state.doc.length,insert:text}});};", resolveDir: appRoot }, bundle: true, write: false, format: 'iife', platform: 'browser' });
const before = String.raw`\documentclass{article}
\title{A readable comparison}\author{Synthetic test}\date{}
\begin{document}
\maketitle
\input{support}

% Original source note.
The argument are correct.

The distribution of types does not affect this pointwise optimum.

\newpage
This second page keeps enough room to test a reader's position.

The original conclusion holds.
\end{document}
`;
const after = before.replace('argument are','argument is').replace('Original source note','Revised source note')
  .replace('The distribution of types does not affect this pointwise optimum.','The pointwise optimum is independent of the type distribution.')
  .replace('original conclusion','revised conclusion');
const paper = path.join(root, 'paper'); await fs.mkdir(paper);
const file = path.join(paper, 'paper.tex'), support = path.join(paper, 'support.tex');
await fs.writeFile(file, before); await fs.writeFile(support, 'A small local support file.\n');
const receipt = { synthetic:true, realTex:true, liveCodex:false, checks:[], rendererErrors:[], processes:[] };
let application, page;
const pane = () => page.locator('.changes-pdf-pane');
const button = name => page.getByRole('button',{name,exact:true});
async function poll(fn,label,timeout=60000) { const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out: '+label); }
const read = () => page.evaluate(()=>window.checkRead());
const write = text => page.evaluate(text=>window.checkWrite(text),text);
const counts = () => application.evaluate(()=>({builds:globalThis.__localFirstProbe.builds,plans:globalThis.__localFirstProbe.plans}));
async function release() { await application.evaluate(()=>{const p=globalThis.__localFirstProbe;p.release?.();p.release=null;}); }
async function hold() { await application.evaluate(()=>{globalThis.__localFirstProbe.hold=true;}); }
async function held() { await poll(()=>application.evaluate(()=>!!globalThis.__localFirstProbe.release),'Sol response held'); }
async function settled() { await poll(async()=>await pane().getAttribute('aria-busy')==='false','comparison settled');assert.equal(await pane().getByRole('alert').count(),0,await pane().innerText()); }
async function refresh() {
  const n=await application.evaluate(()=>globalThis.__localFirstProbe.artifacts.length);
  await pane().getByRole('button',{name:'Refresh Changes PDF',exact:true}).click();
  await poll(async()=>await pane().getAttribute('aria-busy')==='true' || await application.evaluate((_,n)=>globalThis.__localFirstProbe.artifacts.length>n,n),'refresh started or completed',5000);
}
async function screenshot(name) { await page.screenshot({path:path.join(evidence,name+'.png')}); }
async function rememberView() {
  return page.evaluate(()=>{
    const p=document.querySelector('.changes-pdf-pane'), s=p.querySelector('.pdf-scroll');
    window.heldCanvas=p.querySelector('canvas');window.heldPdf=s;
    return {top:s.scrollTop,left:s.scrollLeft,canvas:window.heldCanvas?.toDataURL(),selected:p.querySelector('[aria-label="Comparison change"]').value};
  });
}
async function sameView(state) {
  const value=await page.evaluate(()=>{
    const p=document.querySelector('.changes-pdf-pane'),s=p.querySelector('.pdf-scroll');
    return {sameCanvas:window.heldCanvas===p.querySelector('canvas'),sameScroll:window.heldPdf===s,top:s.scrollTop,left:s.scrollLeft,canvas:p.querySelector('canvas')?.toDataURL(),selected:p.querySelector('[aria-label="Comparison change"]').value};
  });
  assert(value.sameCanvas && value.sameScroll,'Sol explanations keep the existing PDF DOM');
  assert.equal(value.canvas,state.canvas,'The rendered PDF stays unchanged');
  assert(Math.abs(value.top-state.top)<2 && Math.abs(value.left-state.left)<2,'Scroll position survives enrichment');
  assert.equal(value.selected,state.selected,'Current selected change survives enrichment');
}
try {
  application=await _electron.launch({executablePath:require('electron'),args:[copy],cwd:appRoot,env:{...process.env,MODERN_EDITOR_RUNTIME_DIR:path.join(root,'runtime')},chromiumSandbox:true,timeout:25000});
  const child=application.process();receipt.processes.push({pid:child.pid,exited:false});console.log('Owned Electron PID',child.pid);
  page=await application.firstWindow();page.setDefaultTimeout(20000);page.on('pageerror',e=>receipt.rendererErrors.push(String(e)));
  await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1660,1100));
  await page.evaluate(reader.outputFiles[0].text);await application.evaluate((_,file)=>globalThis.__localFirstProbe.file=file,file);
  await button('Open a LaTeX or text file').click();await page.locator('.source-pane .cm-content').waitFor();
  if(await button('Dismiss notice').count())await button('Dismiss notice').click();
  await write(after);const initial=await read();assert.deepEqual(await counts(),{builds:0,plans:0});
  await hold();await button('View ▾').click();await button('Three panes').click();
  await page.getByLabel('Viewer format').selectOption('changes');await held();
  await pane().getByLabel('PDF page 1, rendered',{exact:true}).waitFor();
  assert.equal(await pane().getAttribute('aria-busy'),'true');
  assert.equal((await counts()).builds,1,'Exactly one local compilation before Sol responds');
  assert((await pane().innerText()).includes('Local PDF ready'));
  await poll(async()=>/· [1-9]\d*s/.test(await pane().locator('.changes-agent-status').innerText()),'elapsed stage indicator',6000);
  await pane().getByRole('button',{name:'Explain change',exact:true}).click();
  await pane().getByLabel('Comparison change').selectOption('3');
  await poll(async()=>await pane().getByLabel('PDF page 2, rendered',{exact:true}).count()>0,'second page ready');
  await pane().locator('.change-source-details > summary').click();
  await page.waitForTimeout(500);
  const localView=await rememberView(), localId=await pane().getAttribute('data-artifact');
  await screenshot('01-local-pdf-while-sol-works');
  await release();await settled();
  assert.notEqual(await pane().getAttribute('data-artifact'),localId);
  assert(await pane().getByRole('button',{name:'Hide explanation',exact:true}).isVisible());
  assert((await pane().locator('.change-detail').innerText()).includes('Sol summary:'));
  assert(await pane().locator('.change-source-details').evaluate(el=>el.open),'Expanded source details survive enrichment');
  await sameView(localView);assert.equal((await counts()).builds,1);
  assert.deepEqual(await read(),initial);assert.equal(await fs.readFile(file,'utf8'),before);
  receipt.checks.push('Local PDF before held Sol response; elapsed stage; navigation/Why/source details while pending; no PDF reload or scroll/selection loss on enrichment; source and Undo unchanged');

  const first=await counts();await hold();await refresh();await held();
  assert.deepEqual(await counts(),{builds:first.builds,plans:first.plans+1},'Refresh rechecks resources and requests Sol without another identical compile');
  assert((await pane().locator('.change-detail').innerText()).includes('Sol summary:'),'Old explanation stays while unchanged refresh is pending');
  const refreshedView=await rememberView();await release();await settled();await sameView(refreshedView);
  receipt.checks.push('Identical explicit refresh retains explanations and PDF while requesting fresh Sol analysis');

  const priorStyle=await counts();await pane().getByLabel('Viewer format').selectOption('changes-clean');await poll(async()=>await pane().getAttribute('data-presentation')==='clean' && await pane().getAttribute('aria-busy')==='false','clean presentation');
  assert.deepEqual(await counts(),{builds:priorStyle.builds+1,plans:priorStyle.plans});
  await pane().getByLabel('Viewer format').selectOption('changes');await settled();assert.equal((await counts()).builds,priorStyle.builds+1);
  receipt.checks.push('New presentation compiles locally once; returning to captured presentation requests no model or compile');

  const resourceBefore=await counts();await fs.writeFile(support,'Updated local support file.\n');
  await refresh();await settled();assert.equal((await counts()).builds,resourceBefore.builds+1,'Changed resource invalidates exact generated-TeX cache');
  receipt.checks.push('Real included-file change invalidates the cache and causes one fresh compilation');

  await application.evaluate(()=>globalThis.__localFirstProbe.invalid=true);
  await refresh();await settled();
  assert(await pane().getByRole('region',{name:'Compiled PDF',exact:true}).isVisible());
  if(await pane().getByRole('button',{name:'Explain change',exact:true}).count())await pane().getByRole('button',{name:'Explain change',exact:true}).click();
  assert((await pane().locator('.change-detail').innerText()).includes('Sol analysis unavailable'));
  assert(!(await pane().locator('.change-detail').innerText()).includes('Sol summary:'));
  await screenshot('02-local-pdf-after-rejected-sol');
  await application.evaluate(()=>globalThis.__localFirstProbe.invalid=false);
  receipt.checks.push('Invalid Sol arrangement leaves the verified local PDF with a clear notice; stale summaries are removed');

  await hold();await refresh();await held();
  const oldId=await pane().getAttribute('data-artifact');
  await write(after.replace('revised conclusion','more precise conclusion'));await release();await settled();
  assert.equal(await pane().getAttribute('data-artifact'),oldId,'Late Sol result is not published for an edited draft');
  assert((await pane().innerText()).includes('Older comparison'));
  receipt.checks.push('Editing while Sol is pending prevents late publication and labels the captured PDF older');

  await write(after);await hold();await refresh();await held();
  const stoppedId=await pane().getAttribute('data-artifact');
  await pane().getByRole('button',{name:'Stop',exact:true}).click();await release();await settled();
  assert.equal(await pane().getAttribute('data-artifact'),stoppedId);
  assert((await pane().innerText()).includes('Updates paused'));
  assert(await pane().getByRole('region',{name:'Compiled PDF',exact:true}).isVisible());
  receipt.checks.push('Stop retains the published local PDF and prevents late enrichment or automatic restart');

  await write(before.replace('Original source note','Revised source note'));
  const notesCount=await counts();await refresh();await settled();
  await pane().getByText('Source notes only',{exact:true}).waitFor();
  assert.deepEqual(await counts(),notesCount,'Source-only note updates make no compile or Sol request');
  assert(!(await pane().innerText()).includes('Preview not possible'));
  await screenshot('03-source-notes-only');
  receipt.checks.push('Source notes are distinct from failed visual changes; note-only updates avoid both compile and model');

  await write(after);await refresh();await settled();
  await pane().getByLabel('Comparison change').selectOption('2');
  await pane().locator('[data-change-note="change-3"].selected').waitFor({state:'attached'});
  await poll(()=>pane().locator('[data-change-note="change-3"]').evaluate(el=>{
    const marker=el.getBoundingClientRect(),view=el.closest('.pdf-scroll').getBoundingClientRect();
    return marker.top>=view.top && marker.bottom<=view.bottom;
  }),'dense prose navigation reached its page');
  if(await pane().getByRole('button',{name:'Hide explanation',exact:true}).count())await pane().getByRole('button',{name:'Hide explanation',exact:true}).click();
  await pane().getByLabel('PDF page 1, rendered',{exact:true}).waitFor();
  await poll(async()=>/Before/.test((await pane().locator('.textLayer').allTextContents()).join(' ')),'labelled dense prose rendered');
  await screenshot('04-readable-dense-prose');
  for(const size of [[1660,1100],[1180,850]]) {
    await application.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setContentSize(...size),size);await page.waitForTimeout(500);
    const header=await pane().locator('.changes-toolbar').boundingBox(),pdf=await pane().locator('.pdf-scroll').boundingBox();
    assert(pdf.y-header.y<=44,'One control row above PDF at both widths');
    const beforeWhy=await pane().locator('.pdf-scroll').evaluate(el=>({top:el.scrollTop,height:el.clientHeight}));
    await pane().getByRole('button',{name:'Explain change',exact:true}).click();
    const afterWhy=await pane().locator('.pdf-scroll').evaluate(el=>({top:el.scrollTop,height:el.clientHeight}));
    assert.deepEqual(afterWhy,beforeWhy,'Bottom explanation does not move or shrink the PDF');
    await pane().getByRole('button',{name:'Hide explanation',exact:true}).click();
  }
  await screenshot('05-compact-narrow');
  receipt.checks.push('Dense rewrite has rendered Before/After paragraphs; compact controls and bottom Why preserve PDF space at two window widths');
  assert.equal(await fs.readFile(file,'utf8'),before);assert.deepEqual(receipt.rendererErrors,[]);
  receipt.counts=await counts();receipt.passed=true;
} catch(e) { receipt.passed=false;receipt.error=String(e.stack??e);if(page)await screenshot('failure').catch(()=>{});await fs.writeFile(path.join(evidence,'results.json'),JSON.stringify(receipt,null,2));throw e; }
finally {
  if(application){const child=application.process();await release().catch(()=>{});const watchdog=setTimeout(()=>child.kill('SIGKILL'),8000);await application.close().catch(()=>{});if(child.exitCode===null && child.signalCode===null)await new Promise(resolve=>child.once('exit',resolve));clearTimeout(watchdog);receipt.processes[0].exited=child.exitCode!==null || child.signalCode!==null;}
  await fs.writeFile(path.join(evidence,'results.json'),JSON.stringify(receipt,null,2));console.log(evidence);
  if(receipt.passed && receipt.processes.every(p=>p.exited))await fs.rm(root,{recursive:true,force:true});
}
