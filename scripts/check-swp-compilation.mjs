// Isolated native Electron + real TeX; no real paper and no live model request.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2); assert(args.length === 2 && args[0] === '--playwright-package');
const { _electron } = createRequire(path.resolve(args[1]))('playwright');
const require = createRequire(path.join(repo, 'package.json'));
const root = path.join(repo, '.test-runs', 'swp-compilation-' + Date.now()), copy = path.join(root, 'desktop');
const evidence = process.env.ME_TEST_EVIDENCE || path.join(repo, 'test-evidence', 'swp-compilation-' + Date.now());
await fs.mkdir(copy, { recursive:true }); await fs.mkdir(evidence, { recursive:true });
await fs.cp(path.join(repo, 'dist'), path.join(copy, 'dist'), { recursive:true });
await fs.symlink(path.join(repo, 'node_modules'), path.join(copy, 'node_modules'), 'dir');
await fs.writeFile(path.join(copy, 'package.json'), JSON.stringify({ name:'swp-compilation-check', version:'1.7.0', main:'dist/main.cjs', private:true }));
const injection = [
 "const probe={file:null,builds:[],modelRequests:0,plans:0};",
 "dialog.showOpenDialog=async()=>({canceled:false,filePaths:[probe.file]});",
 "const realCompile=compiler.compile.bind(compiler);compiler.compile=async(...args)=>{const result=await realCompile(...args);probe.builds.push(result);return result;};",
 "codex.client.run=async()=>{probe.modelRequests++;throw Error('Unexpected model request');};",
 "codex.planChanges=async(_id,prompt)=>{probe.plans++;return {inspect:[],groups:JSON.parse(prompt).changes.map(c=>({ids:[c.id],layout:'keep',summary:'Synthetic comparison explanation.'}))};};",
 "globalThis.__swpProbe=probe;"
].join('\n');
await build({entryPoints:[path.join(repo,'src/main/index.ts')],outfile:path.join(copy,'dist/main.cjs'),bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron'],
 plugins:[{name:'swp-probe',setup(b){b.onLoad({filter:/src\/main\/index\.ts$/},async a=>({contents:await fs.readFile(a.path,'utf8')+injection,loader:'ts'}));}}]});
const helper=await build({stdin:{contents:"import {EditorView} from '@codemirror/view';window.readSource=()=>EditorView.findFromDOM(document.querySelector('.source-pane .cm-content')).state.doc.toString();",resolveDir:repo},bundle:true,write:false,format:'iife',platform:'browser'});
const fixture=await build({entryPoints:[path.join(repo,'tests/fixtures/sample-bitmap.ts')],bundle:true,write:false,format:'cjs',platform:'node'});
const loaded={exports:{}};new Function('module','exports','Buffer',fixture.outputFiles[0].text)(loaded,loaded.exports,Buffer);
const bitmap=loaded.exports.sampleBitmap();
const text=String.raw`\documentclass{beamer}
\graphicspath{{figures/}{//Mac/Dropbox/lecture/figures/}}
\begin{document}
\begin{frame}{Rational preferences}
The ordering are complete.

\includegraphics[
natheight=1in,
natwidth=2in,
height=1cm,
width=2cm
]%
{picture.bmp}
\end{frame}
\end{document}
`;
const paper=path.join(root,'paper');await fs.mkdir(path.join(paper,'figures'),{recursive:true});await fs.mkdir(path.join(paper,'.modern-editor'));
const file=path.join(paper,'main.tex');await fs.writeFile(file,text);await fs.writeFile(path.join(paper,'figures/picture.bmp'),bitmap);
const original='ordering are',from=text.indexOf(original);
const comment={id:'verb',title:'Use the singular verb',explanation:'Ordering is singular.',original,replacement:'ordering is',from,to:from+original.length,validity:'current',decision:'open',packages:[],messages:[]};
await fs.writeFile(path.join(paper,'.modern-editor/review.json'),JSON.stringify({schemaVersion:1,rootFile:'main.tex',sourceHash:createHash('sha256').update(text).digest('hex'),activeId:'verb',updatedAt:new Date().toISOString(),comments:[comment]}));
const receipt={synthetic:true,realTex:true,liveCodex:false,checks:[],rendererErrors:[],processes:[]};
let application,page;
const button=name=>page.getByRole('button',{name,exact:true});
async function poll(fn,label,timeout=45000){const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out: '+label);}
const shot=async name=>page.screenshot({path:path.join(evidence,name+'.png')});
const builds=()=>application.evaluate(()=>globalThis.__swpProbe.builds);
const read=()=>page.evaluate(()=>window.readSource());
async function replaceSource(value){const content=page.locator('.source-pane .cm-content');await content.click();await page.keyboard.press('Meta+A');await page.keyboard.insertText(value);assert.equal(await read(),value);}
try {
 application=await _electron.launch({executablePath:require('electron'),args:[copy],cwd:repo,env:{...process.env,MODERN_EDITOR_RUNTIME_DIR:path.join(root,'runtime')},chromiumSandbox:true,timeout:25000});
 const child=application.process();receipt.processes.push({pid:child.pid,exited:false});console.log('Owned Electron PID',child.pid);
 page=await application.firstWindow();page.setDefaultTimeout(20000);page.on('pageerror',e=>receipt.rendererErrors.push(String(e)));
 await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1440,900));
 await application.evaluate((_,file)=>globalThis.__swpProbe.file=file,file);await button('Open a LaTeX or text file').click();
 await page.locator('.source-pane .cm-content').waitFor();await page.evaluate(helper.outputFiles[0].text);
 if(await button('Dismiss notice').count())await button('Dismiss notice').click();
 await button('Compile').click();await poll(async()=>(await builds()).length===1,'first compile');await poll(()=>button('Compile').isEnabled(),'compile settled');
 assert((await builds())[0].clean);assert.equal(await page.getByLabel('Compilation inputs',{exact:true}).count(),0);
 await page.locator('.pdf-pane canvas:visible').first().waitFor();await shot('01-single-compile');
 receipt.checks.push('One Compile produces a verified Beamer PDF with a local BMP and Parallels fallback; no preparation panel or model request.');
 await button('Accept options').click();await page.getByRole('menuitem',{name:'Accept & compile',exact:true}).click();await poll(async()=>(await read())===text.replace(original,'ordering is'),'checked acceptance');
 assert((await builds())[1].clean);await shot('02-checked-acceptance');
 await button('Undo').click();await poll(async()=>(await read())===text,'undo acceptance');assert(await button('Accept').isEnabled());
 await button('Accept').click();
 await button('View ▾').click();await button('Three panes').click();await page.getByLabel('Viewer format').selectOption('changes');
 const changes=page.locator('.changes-pdf-pane');await poll(async()=>await changes.getAttribute('aria-busy')==='false'&&await changes.locator('canvas').count()>0,'Changes PDF');
 assert.equal(await changes.getByRole('alert').count(),0,await changes.innerText());await shot('03-changes-pdf');
 receipt.checks.push('Accept & compile applies only the intended edit; Undo restores it. Changes PDF renders alongside source/comments using the same BMP preparation.');
 await page.getByLabel('Viewer format').selectOption('pdf');
 await page.locator('.pdf-pane canvas:visible').first().waitFor();
 const previousId=(await builds())[1].id;
 const previous=await page.evaluate(async id=>Array.from(await window.editor.getPdf(id)),previousId);
 const visibleText=await page.locator('.pdf-pane:visible .textLayer').last().innerText();
 await replaceSource(text.replace('{picture.bmp}','{missing.bmp}'));
 const n=(await builds()).length;await button('Compile').click();await poll(async()=>(await builds()).length>n,'missing input');
 const panel=page.getByLabel('Compilation inputs',{exact:true});await panel.waitFor();
 assert.match(await panel.innerText(),/missing.bmp/);assert.equal(await panel.locator('details[open]').count(),0);
 assert.equal(await panel.getByRole('button',{name:'Prepare file-list request…',exact:true}).count(),0);
 assert((await panel.boundingBox()).height<190);await shot('04-compact-input-problem');
 const retained=await page.evaluate(async id=>Array.from(await window.editor.getPdf(id)),previousId);
 assert.equal(createHash('sha256').update(Buffer.from(retained)).digest('hex'),createHash('sha256').update(Buffer.from(previous)).digest('hex'),'Previous PDF bytes are preserved');
 assert.equal(await page.locator('.pdf-pane:visible .textLayer').last().innerText(),visibleText,'Previous PDF stays visible');
 await button('Dismiss compilation inputs').click();assert.equal(await panel.count(),0);
 assert.equal(await fs.readFile(file,'utf8'),text);assert.deepEqual(await fs.readFile(path.join(paper,'figures/picture.bmp')),bitmap);
 assert.equal(await application.evaluate(()=>globalThis.__swpProbe.modelRequests),0);
 assert.deepEqual(receipt.rendererErrors,[]);
 receipt.checks.push('Missing image reports a compact exact filename with collapsed details and no ineffective AI file-list action; dismiss works; previous PDF and disk files remain intact.');
 receipt.builds=(await builds()).map(({id,success,clean,dependenciesVerified,inputPreparation})=>({id,success,clean,dependenciesVerified,reason:inputPreparation?.reason}));
 receipt.passed=true;
} catch(e){receipt.passed=false;receipt.failure=String(e.stack??e);try{await shot('failure');}catch{}throw e;}
finally {
 if(application){const child=application.process();await application.close();await poll(async()=>child.exitCode!==null||child.signalCode!==null,'owned Electron exit');receipt.processes.find(p=>p.pid===child.pid).exited=true;console.log('Owned Electron exited',child.pid);}
 await fs.writeFile(path.join(evidence,'results.json'),JSON.stringify(receipt,null,2));
 if(receipt.passed&&!evidence.startsWith(root+path.sep))await fs.rm(root,{recursive:true,force:true});
}
