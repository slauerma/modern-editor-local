// Native desktop check: synthetic text, real TeX, controlled preamble answer.
// Run after npm run build; use --playwright-package for an installed Playwright.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
assert(args.length === 0 || args.length === 2 && args[0] === '--playwright-package');
const require = createRequire(path.join(appRoot, 'package.json'));
const { _electron } = (args.length ? createRequire(path.resolve(args[1])) : require)('playwright');
const root = path.join(appRoot, '.test-runs', 'viewer-' + Date.now()), copy = path.join(root, 'desktop');
const evidence = path.join(appRoot, 'test-evidence', 'viewer-' + Date.now());
await fs.mkdir(copy, { recursive: true }); await fs.mkdir(evidence, { recursive: true });
await fs.cp(path.join(appRoot, 'dist'), path.join(copy, 'dist'), { recursive: true });
await fs.symlink(path.join(appRoot, 'node_modules'), path.join(copy, 'node_modules'), 'dir');
await fs.writeFile(path.join(copy, 'package.json'), JSON.stringify({ name: 'viewer-check', version: '1.2.0', main: 'dist/main.cjs', private: true }));
const injection = `
const viewerProbe = { file:null, hold:false, release:null, builds:0, preambles:0, pdfReads:0 };
dialog.showOpenDialog = async()=>({ canceled:false, filePaths:[viewerProbe.file] });
const realPdf = compiler.pdf.bind(compiler);
compiler.pdf = async(...args)=>{viewerProbe.pdfReads++;return realPdf(...args);};
const realCompile = compiler.compile.bind(compiler);
compiler.compile = async(...args)=>{ viewerProbe.builds++; if(viewerProbe.hold) { viewerProbe.hold=false; await new Promise(resolve=>{viewerProbe.release=resolve;}); } return realCompile(...args); };
codex.preamble = async()=>{throw new Error('Use the controlled preamble method');};
globalThis.__viewerProbe = viewerProbe;
globalThis.__viewerProjects = projects;
`;
// Override the named preamble service at its public IPC boundary only.
const controlled = `
codex.preamble = async()=>{viewerProbe.preambles++;return {preamble:'\\\\documentclass{article}\\n\\\\begin{document}',ending:'\\\\end{document}',explanation:'Synthetic wrapper.',needsInput:null};};
`;
await build({ entryPoints: [path.join(appRoot, 'src/main/index.ts')], outfile: path.join(copy, 'dist/main.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'],
  plugins: [{ name: 'viewer-probe', setup(b) { b.onLoad({ filter: /src\/main\/index\.ts$/ }, async a => ({ contents: await fs.readFile(a.path, 'utf8') + injection + controlled, loader: 'ts' })); } }] });
const reader = await build({ stdin: { contents: `
import {EditorView} from '@codemirror/view';
import {undoDepth} from '@codemirror/commands';
const source=()=>EditorView.findFromDOM(document.querySelector('.source-pane .cm-content'));
const diff=()=>EditorView.findFromDOM(document.querySelector('.text-diff-host .cm-content'));
window.viewerRead=()=>{let v=source();return {text:v.state.doc.toString(),undo:undoDepth(v.state),selection:v.state.selection.main.toJSON()};};
window.viewerDiff=()=>{let v=diff();return {text:v.state.doc.toString(),selection:v.state.selection.main.toJSON()};};
window.viewerWrite=text=>{let v=source();v.dispatch({changes:{from:0,to:v.state.doc.length,insert:text},userEvent:'test.replace'});};
`, resolveDir: appRoot }, bundle: true, write: false, format: 'iife', platform: 'browser' });
const hash = text => createHash('sha256').update(text).digest('hex');
const quote = 'The allocation are monotone.';
const plain = 'A short synthetic note.\n\n' + quote + '\n\nThe proof follows by induction.\n';
const tex = '\\documentclass{article}\n\\begin{document}\n\\section{Synthetic example}\n' + quote + '\n\nFor each $n$, the claim follows by induction.\n\\input{part}\n\\end{document}\n';
async function paper(name, text) {
  const dir = path.join(root, name); await fs.mkdir(path.join(dir, '.modern-editor'), { recursive: true });
  const file = path.join(dir, name), from = text.indexOf(quote);
  await fs.writeFile(file, text);
  await fs.writeFile(path.join(dir, '.modern-editor/review.json'), JSON.stringify({ schemaVersion: 1, rootFile: name, sourceHash: hash(text), activeId: 'c1', updatedAt: new Date().toISOString(), comments: [{ id:'c1', title:'Correct the verb', category:'Grammar', explanation:'Use a singular verb.', original:quote, replacement:'The allocation is monotone.', from, to:from+quote.length, validity:'current', decision:'open', packages:[], messages:[] }] }));
  return file;
}
const txtFile = await paper('note.txt', plain), texFile = await paper('paper.tex', tex);
const includedFile = path.join(path.dirname(texFile), 'part.tex');
await fs.writeFile(includedFile, 'A synthetic included paragraph.\n');
let application, page;
const receipt = { synthetic: true, realTex: true, liveCodex: false, checks: [], rendererErrors: [], processes: [] };
const button = name => page.getByRole('button', { name, exact: true });
async function poll(fn, label, timeout = 30000) { const until = Date.now() + timeout; while (Date.now() < until) { if (await fn()) return; await new Promise(r => setTimeout(r, 60)); } throw new Error('Timed out: ' + label); }
async function read() { return page.evaluate(() => window.viewerRead()); }
async function probe() { return application.evaluate(() => ({ builds: globalThis.__viewerProbe.builds, pending: !!globalThis.__viewerProbe.release, preambles: globalThis.__viewerProbe.preambles })); }
async function open(file) {
  await application.evaluate((_, file) => { globalThis.__viewerProbe.file = file; }, file);
  await button('Open a LaTeX or text file').click(); await page.locator('.source-pane .cm-content').waitFor(); if (await button('Dismiss notice').count()) await button('Dismiss notice').click();
}
async function home() { if (!await button('Close project').isVisible()) await button('Actions ▾').click(); await button('Close project').click(); await button('Open a LaTeX or text file').waitFor(); await page.evaluate(reader.outputFiles[0].text); }
async function snapshot(name) { await page.screenshot({ path: path.join(evidence, name + '.png') }); }
async function pdfGeometry() {
  return page.locator('#pdf-surface > .pdf-reader .pdf-scroll').evaluate(el => {
    const r=el.getBoundingClientRect();
    return { x:r.x, y:r.y, width:r.width, height:r.height, top:el.scrollTop, left:el.scrollLeft, zoom:el.parentElement.querySelector('[aria-label="PDF zoom"]').value };
  });
}
async function nativeFind() {
  await application.evaluate(({Menu})=>{
    const item=Menu.getApplicationMenu().items.find(i=>i.label==='Find')?.submenu?.items.find(i=>i.label==='Find in focused pane…');
    if(!item) throw Error('Registered native Find command missing');
    item.click();
  });
}
async function pdfStaysRendered() {
  const reads=await application.evaluate(()=>globalThis.__viewerProbe.pdfReads);
  const style=await page.addStyleTag({content:'.pdf-scroll::-webkit-scrollbar{width:15px;height:15px}.pdf-scroll::-webkit-scrollbar-thumb{background:#999}'});
  const previousStyle=await page.locator('#pdf-surface').getAttribute('style');
  await page.locator('#pdf-surface').evaluate(p=>Object.assign(p.style,{position:'fixed',right:'15px',top:'80px',width:'550px',height:'900px',zIndex:'80'}));
  receipt.renderStability=[];
  for(const width of [480,550,660]) {
    await page.locator('#pdf-surface').evaluate((p,width)=>p.style.width=width+'px',width);
    await page.waitForTimeout(250);
    const threshold=await page.locator('#pdf-surface').evaluate(p=>{
      const s=p.querySelector(':scope > .pdf-reader .pdf-scroll'),css=getComputedStyle(s),paper=s.querySelector('.pdf-paper');
      return (s.offsetWidth-parseFloat(css.paddingLeft)-parseFloat(css.paddingRight)-7.5)*paper.clientHeight/paper.clientWidth+parseFloat(css.paddingTop)+parseFloat(css.paddingBottom)+(p.clientHeight-s.clientHeight);
    });
    await page.locator('#pdf-surface').evaluate((p,h)=>p.style.height=h+'px',threshold);
    await page.waitForTimeout(300);
    const scroller=page.locator('#pdf-surface > .pdf-reader .pdf-scroll');
    await scroller.getByLabel('PDF page 1, rendered',{exact:true}).waitFor();
    const measurement=await scroller.evaluate(s=>new Promise(resolve=>{
      const widths=new Set([s.clientWidth]);let renderChanges=0;
      const mutation=new MutationObserver(entries=>{renderChanges+=entries.length;});
      mutation.observe(s,{subtree:true,attributes:true,attributeFilter:['width','height','aria-label']});
      const resize=new ResizeObserver(()=>widths.add(s.clientWidth));resize.observe(s);
      setTimeout(()=>{mutation.disconnect();resize.disconnect();resolve({renderChanges,widths:[...widths],rendered:s.querySelector('canvas')?.getAttribute('aria-label')});},1600);
    }));
    receipt.renderStability.push({width,...measurement});
    assert.equal(measurement.renderChanges,0,'Idle page must not restart rendering at the scrollbar threshold');
    assert.equal(measurement.widths.length,1);assert.match(measurement.rendered,/, rendered$/);
  }
  await snapshot('pdf-stable-at-scrollbar-threshold');
  await page.locator('#pdf-surface').evaluate((p,old)=>old===null?p.removeAttribute('style'):p.setAttribute('style',old),previousStyle);
  await style.evaluate(s=>s.remove());await page.waitForTimeout(300);
  assert.equal(await application.evaluate(()=>globalThis.__viewerProbe.pdfReads),reads,'Resize never reloads PDF bytes');
  receipt.checks.push('Classic-scrollbar threshold at three widths / idle canvas remains rendered / no PDF reloads');
}
try {
  application = await _electron.launch({ executablePath: require('electron'), args: [copy], cwd: appRoot, env: { ...process.env, MODERN_EDITOR_RUNTIME_DIR: path.join(root, 'runtime') }, chromiumSandbox: true, timeout: 25000 });
  const child = application.process(); receipt.processes.push({ pid: child.pid, exited: false }); console.log('Owned Electron PID', child.pid);
  page = await application.firstWindow(); page.setDefaultTimeout(15000);
  page.on('pageerror', e => receipt.rendererErrors.push(String(e)));
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 980));
  await page.evaluate(reader.outputFiles[0].text);
  await open(txtFile);
  assert.equal(await page.getByLabel('Viewer format').inputValue(), 'text');
  assert.equal(await button('Accept & compile').count(), 0); await page.getByText('No text changes', { exact:true }).waitFor();
  const searchBefore=await read();
  await page.locator('.text-diff-host .cm-content').focus();await nativeFind();
  const textSearch=page.locator('.text-diff-host .cm-search input[name="search"]');await textSearch.waitFor();
  assert(await textSearch.evaluate(e=>e===document.activeElement));
  await textSearch.fill('');await textSearch.pressSequentially('allocation');await textSearch.press('Enter');
  await poll(async()=>{const v=await page.evaluate(()=>window.viewerDiff());return v.text.slice(v.selection.anchor,v.selection.head)==='allocation';},'Text diff search selects a match');
  assert.equal(await page.locator('.text-diff-host input[name="replace"]').count(),0,'Read-only Find has no replacement control');
  assert.deepEqual(await read(),searchBefore,'Searching Text diff leaves source and Undo alone');
  await textSearch.press('Escape');await page.locator('.text-diff-host .cm-search').waitFor({state:'hidden'});
  receipt.checks.push('Registered native Find searches revised Text diff / read-only search / Escape / source and Undo preserved');
  const initial = await read(); await button('Preview').click();
  await page.getByText('Preview · not applied', { exact: true }).waitFor();
  assert.equal((await read()).text, initial.text); assert.equal((await read()).undo, initial.undo); assert.equal((await probe()).builds, 0);
  await snapshot('01-text-proposal'); await button('Return to draft').click();
  await page.locator('.review-rail').focus(); await page.keyboard.press('Shift+A');
  await poll(async () => (await read()).text.includes('allocation is'), 'text acceptance');
  await button('Save').click(); await poll(async () => (await fs.readFile(txtFile, 'utf8')).includes('allocation is'), 'text Save');
  assert.equal(await page.getByLabel('Text diff baseline').inputValue(), 'session');
  assert(await page.locator('.text-diff-host .cm-deletedChunk').count() > 0 || await page.locator('.text-diff-host .cm-changedText').count() > 0);
  await snapshot('02-text-changes'); await button('Undo').click(); await poll(async () => (await read()).text === plain, 'text Undo');
  assert.equal((await probe()).builds, 0); receipt.checks.push('Text open / preview / Shift+A / fixed baseline after Save / Undo without TeX');
  // The explicit wrapper action is the only model-like request in this test.
  await button('Add preamble…').first().click();
  await poll(async () => (await read()).text.includes('\\begin{document}'), 'checked wrapper', 60000);
  await poll(async () => await page.getByLabel('Viewer format').inputValue() === 'pdf' && await button('Compile').isEnabled(), 'wrapper recovery and PDF mode');
  assert((await read()).text.includes(plain)); assert.equal((await probe()).preambles, 1);
  assert.equal(await page.getByLabel('Viewer format').inputValue(), 'pdf');
  await button('Undo').click(); await poll(async () => (await read()).text === plain, 'wrapper Undo');
  await poll(async () => await page.getByLabel('Viewer format').inputValue() === 'text', 'wrapper Undo mode');
  assert.equal(await page.getByLabel('Viewer format').inputValue(),'text'); assert.equal(await button('Accept & compile').count(),0);
  receipt.checks.push('One checked preamble attempt / unchanged text body / one-step Undo');
  await home(); await open(texFile);
  await button('Compile').click(); await page.getByLabel('PDF matches the current source', {exact:true}).waitFor({ timeout:60000 });
  await pdfStaysRendered();
  await page.getByRole('region', {name:'Compiled PDF',exact:true}).getByLabel('PDF zoom', {exact:true}).selectOption('1.25');
  const before = await read();
  await page.getByLabel('Proposed replacement', {exact:true}).fill('The allocation is weakly increasing.');
  const draftGeometry = await pdfGeometry();
  await button('Preview').click(); await page.locator('.preview-banner strong').filter({hasText:'Preview · not applied'}).waitFor({timeout:60000});
  await page.locator('.pdf-passage-marker').waitFor({timeout:15000});
  assert.equal((await read()).text, before.text); assert.equal((await read()).undo, before.undo);
  assert.equal(await fs.readFile(texFile,'utf8'),tex);
  const project = await application.evaluate(() => globalThis.__viewerProjects.current);
  assert.equal(project.text, tex);
  const previewGeometry=await pdfGeometry();
  for(const key of ['x','y','width','height']) assert.equal(previewGeometry[key],draftGeometry[key], 'Showing preview information keeps PDF geometry: '+key);
  for(const size of [[1600,980],[1120,760]]) {
    await application.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setContentSize(...size),size);
    await page.waitForTimeout(400);
    const stable=await pdfGeometry(), banner=await page.locator('.preview-banner').boundingBox(), viewer=await page.locator('#pdf-surface').boundingBox();
    assert(banner.height<70,'Preview bar is compact'); assert(Math.abs(banner.y+banner.height-viewer.y-viewer.height)<2,'Preview bar is at the bottom');
    await page.locator('.preview-details > summary').click(); await page.waitForTimeout(150);
    assert.deepEqual(await pdfGeometry(),stable,'Opening preview details preserves bounds, scroll and zoom');
    assert(await button('Refresh preview').isVisible()); assert(await button('Show text diff').isVisible());
    await snapshot(size[0]===1600?'03-preview-details':'03-preview-details-narrow');
    await page.locator('.preview-details > summary').click(); await page.waitForTimeout(100);
    assert.deepEqual(await pdfGeometry(),stable,'Closing preview details preserves the PDF');
  }
  await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1600,980));
  await page.waitForTimeout(400);
  receipt.checks.push('Bottom preview bar / expanded details preserve PDF bounds, scroll and zoom at wide and narrow widths');
  await snapshot('03-pdf-proposal');
  await button('Return to draft').click(); const cachedAttempts=(await probe()).builds; await button('Preview').click(); await page.locator('.preview-banner strong').filter({hasText:'Preview · not applied'}).waitFor(); assert.equal((await probe()).builds,cachedAttempts); await button('Return to draft').click(); assert.equal(await page.getByRole('region',{name:'Compiled PDF',exact:true}).getByLabel('PDF zoom',{exact:true}).inputValue(),'1.25');
  await page.getByLabel('PDF matches the current source', {exact:true}).waitFor();
  receipt.checks.push('Real candidate PDF / edited wording / own highlight / unchanged source, decisions and Undo / ordinary PDF and zoom restored');
  // The root and proposal are unchanged, but an external include changes after Preview.
  await button('Preview').click(); await page.locator('.preview-banner strong').filter({hasText:'Preview · not applied'}).waitFor();
  const beforeInputs = await read(), previewBuilds = (await probe()).builds;
  await fs.writeFile(includedFile, 'A revised synthetic included paragraph.\n');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.locator('.preview-banner strong').filter({hasText:'Preview out of date'}).waitFor();
  assert.equal(await page.locator('.pdf-reader:visible .pdf-state').innerText(), 'Preview out of date');
  assert.equal(await page.locator('.pdf-passage-marker:visible').count(), 0);
  assert.equal((await probe()).builds, previewBuilds);
  await page.locator('.preview-details > summary').click(); await button('Show text diff').click(); await page.locator('.preview-banner strong').filter({hasText:'Preview · not applied'}).waitFor();
  await page.getByLabel('Viewer format').selectOption('pdf');
  await page.locator('.preview-banner strong').filter({hasText:'Preview out of date'}).waitFor();
  await page.locator('.preview-details > summary').click(); await button('Refresh preview').click(); await page.locator('.preview-banner strong').filter({hasText:'Preview · not applied'}).waitFor({timeout:60000});
  await page.locator('.pdf-passage-marker').waitFor();
  assert.equal((await probe()).builds, previewBuilds + 1);
  assert.equal((await read()).text, beforeInputs.text); assert.equal((await read()).undo, beforeInputs.undo);
  await snapshot('03-preview-inputs-refreshed'); await button('Return to draft').click();
  await button('Compile').click(); await page.getByLabel('PDF matches the current source', {exact:true}).waitFor({timeout:60000});
  receipt.checks.push('Proposal input changes on focus / no stale highlight / exact text preview stays usable / return checks inputs / explicit refresh preserves source and Undo');
  const attempts=(await probe()).builds;
  await page.getByLabel('Proposed replacement',{exact:true}).fill(''); await button('Preview').click();
  await page.getByText('Preview not possible',{exact:true}).waitFor(); assert.equal((await probe()).builds,attempts);
  await page.locator('.preview-details > summary').click(); await button('Show text diff').click(); assert.equal((await read()).text,tex); await snapshot('04-deletion-text-diff'); await button('Return to draft').click();
  await page.getByLabel('Viewer format').selectOption('pdf');
  await page.getByLabel('Proposed replacement',{exact:true}).fill('\\undefinedSyntheticMacro'); await button('Preview').click();
  await page.getByText('Preview not possible',{exact:true}).waitFor({timeout:60000}); assert.equal((await read()).text,tex); await button('Return to draft').click();
  receipt.checks.push('Deletion refused before build / text deletion available / failed TeX preserves draft and ordinary PDF');
  // Delay the boundary, then change the proposal while its candidate is in flight.
  await page.getByLabel('Proposed replacement',{exact:true}).fill('The allocation is increasing.');
  await application.evaluate(()=>{globalThis.__viewerProbe.hold=true;}); await button('Preview').click(); await poll(async()=>(await probe()).pending,'delayed compile');
  await page.getByLabel('Proposed replacement',{exact:true}).fill('A different suggestion.');
  await page.getByText('Preview out of date',{exact:true}).waitFor();
  await application.evaluate(()=>{globalThis.__viewerProbe.release();globalThis.__viewerProbe.release=null;});
  await poll(async()=>await button('Preview').isEnabled(),'stale build settled',60000);
  assert.equal((await read()).text,tex); assert.equal(await page.locator('.pdf-passage-marker:visible').count(),0); await button('Return to draft').click();
  receipt.checks.push('Late candidate cannot install a highlight after proposal changes');
  // Mode/layout transitions retain the editing state.
  const layoutBefore=await read();
  for(const label of ['Source + comments','PDF + comments','Three panes','Source + PDF · writing','PDF below · stacked','Automatic']) {
    await button('View ▾').click(); await button(label).click(); assert.equal((await read()).text,layoutBefore.text); assert.equal((await read()).undo,layoutBefore.undo);
  }
  await page.getByLabel('Viewer format').selectOption('text'); await page.getByLabel('Text diff baseline').selectOption('saved'); await page.getByRole('region',{name:'Compare document versions'}).waitFor();
  await button('View ▾').click(); await button('Three panes').click(); await page.getByLabel('Viewer format').waitFor();
  await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1120,760));
  receipt.compactViewer = await page.locator('.viewer-pane').evaluate(el => { const caption=el.querySelector('.viewer-caption'), s=getComputedStyle(caption); return { viewerWidth:el.clientWidth, viewerRight:el.getBoundingClientRect().right, viewport:innerWidth, captionWidth:caption.clientWidth, captionScrollWidth:caption.scrollWidth, captionHeight:caption.clientHeight, captionScrollHeight:caption.scrollHeight, whiteSpace:s.whiteSpace, flexShrink:s.flexShrink }; });
  await snapshot('05-compact-viewer'); assert(await page.getByRole('separator',{name:'Resize comments and viewer'}).isVisible());
  receipt.checks.push('Six layouts / Compare → View / divider visible below old breakpoint');
  // A hidden, previously used diff keeps its snapshot while a large draft changes.
  await page.getByLabel('Viewer format').selectOption('pdf');
  const hiddenBefore=await page.evaluate(()=>window.viewerDiff()), editBefore=await read();
  const large=editBefore.text+'\n'+('An unchanged synthetic paragraph for a substantial editing session.\n\n'.repeat(4000));
  for(const value of [large,large+'One new sentence.\n',large+'A corrected new sentence.\n']) {
    await page.evaluate(text=>window.viewerWrite(text),value);await page.waitForTimeout(100);
    assert.deepEqual(await page.evaluate(()=>window.viewerDiff()),hiddenBefore,'Hidden diff must not replace its document or selection');
  }
  await page.getByLabel('Viewer format').selectOption('text');
  const latest=await read();
  await poll(async()=>(await page.evaluate(()=>window.viewerDiff())).text===latest.text,'deferred diff catches up on reveal');
  assert.equal((await read()).undo,latest.undo,'Revealing diff does not change source Undo');
  await page.locator('.text-diff-host .cm-content').focus();await nativeFind();
  await page.locator('.text-diff-host input[name="search"]').fill('');await page.locator('.text-diff-host input[name="search"]').pressSequentially('corrected');await page.locator('.text-diff-host input[name="search"]').press('Enter');
  const selected=await page.evaluate(()=>window.viewerDiff());
  await page.getByLabel('Viewer format').selectOption('pdf');await page.getByLabel('Viewer format').selectOption('text');
  assert.deepEqual(await page.evaluate(()=>window.viewerDiff()),selected,'Unchanged reveal preserves the diff selection');
  for(let i=0;i<3;i++) await button('Undo').click();
  assert.equal((await read()).text,editBefore.text);assert.equal((await read()).undo,editBefore.undo);
  receipt.checks.push('Large synthetic draft / no hidden diff updates / catch up on reveal / unchanged reveal preserves selection / source Undo remains intact');
  await home(); await open(texFile); await page.getByLabel('Viewer format').selectOption('pdf');
  assert.equal(await page.locator('.preview-banner').count(),0); assert.equal((await read()).text,tex); assert.equal(await page.locator('.pdf-passage-marker:visible').count(),0);
  receipt.checks.push('Reopen restores the ordinary PDF, never the proposal');
  assert.deepEqual(receipt.rendererErrors,[]); receipt.passed=true;
} catch(error) { receipt.passed=false; receipt.failure=String(error.stack??error); try{await snapshot('failure');}catch{} throw error; }
finally {
  if(application){const child=application.process();try{await application.evaluate(()=>{globalThis.__viewerProbe.release?.();});await application.close();}finally{await poll(async()=>child.exitCode!==null||child.signalCode!==null,'owned process exit');receipt.processes.find(p=>p.pid===child.pid).exited=true;console.log('Owned Electron exited',child.pid);}}
  await fs.writeFile(path.join(evidence,'results.json'),JSON.stringify(receipt,null,2)); console.log('Evidence',evidence);
  if(receipt.passed) await fs.rm(root,{recursive:true,force:true});
}
