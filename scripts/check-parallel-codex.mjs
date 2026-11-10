// Isolated native UI, real persistence, and independently held synthetic replies.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(repo, 'package.json'));
assert(process.argv.length === 4 && process.argv[2] === '--playwright-package');
const { _electron } = createRequire(path.resolve(process.argv[3]))('playwright');
const root = path.join(repo, '.test-runs', 'parallel-codex-' + Date.now()), copy = path.join(root, 'desktop');
const evidence = process.env.ME_TEST_EVIDENCE || path.join(root, 'evidence');
await fs.mkdir(copy, { recursive: true }); await fs.mkdir(evidence, { recursive: true });
await fs.cp(path.join(repo, 'dist'), path.join(copy, 'dist'), { recursive: true });
await fs.symlink(path.join(repo, 'node_modules'), path.join(copy, 'node_modules'), 'dir');
await fs.writeFile(path.join(copy, 'package.json'), JSON.stringify({ name: 'parallel-codex-check', version: '1.7.0', main: 'dist/main.cjs', private: true }));
const injection = `
const probe={file:null,review:null,chat:null,anchors:null,stops:{review:0,chat:0,anchors:0}};
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[probe.file]});
function hold(client,key) {
  client.run=async(prompt,schema,progress,effort,fast,reader,options)=>{
    const request={context:JSON.parse(prompt),effort,fast,options};
    await options?.conversation?.onThread('parallel-test-thread');
    progress(key==='review'?'Review in progress':'Working on '+key);
    try { return await new Promise((resolve,reject)=>{
      probe[key]={request,finish:resolve,stop:()=>reject(Error(key+' cancelled.')),
        publish:comments=>reader.call('publish_comments',{comments}),
        read:()=>reader.call('references_read',{fileId:'current-draft'})};
    }); } finally { await reader?.cancel(); probe[key]=null; }
  };
  client.cancel=async()=>{probe.stops[key]++;probe[key]?.stop();};
}
hold(codex.client,'review');hold(chatClient,'chat');hold(codex.anchorClient,'anchors');
CodexClient.prototype.listModels=async()=>['gpt-6.1-sol','gpt-6-astra'].map((id,i)=>({id,name:id,isDefault:i===0,efforts:['low','medium','high'],fast:true,images:true,hidden:false,upgrade:null}));
probe.comments=()=>projects.current.review.comments;
probe.active=()=>projects.current.review.activeId;
probe.history=async()=>{const p=projects.current,c=await codex.conversations.current(p.id);return c?codex.conversations.history(p.id,c.id):null;};
globalThis.__parallelProbe=probe;
`;
await build({ entryPoints: [path.join(repo, 'src/main/index.ts')], outfile: path.join(copy, 'dist/main.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'],
  plugins: [{ name: 'parallel-probe', setup(b) { b.onLoad({ filter: /src\/main\/index\.ts$/ }, async a => ({ contents: await fs.readFile(a.path, 'utf8') + injection, loader: 'ts' })); } }] });
const draft = 'The proof are short.\n\nThe result are useful.\n\nThe claim are clear.\n\nOur notation is fixed.';
const paper = path.join(root, 'paper'); await fs.mkdir(path.join(paper, '.modern-editor'), { recursive: true });
const file = path.join(paper, 'main.txt'); await fs.writeFile(file, draft);
const comment = (original, replacement) => ({ title: original, explanation: 'Use precise wording.', original, replacement, before: '', after: '', packages: [] });
await fs.writeFile(path.join(paper, '.modern-editor/review.json'), JSON.stringify({ schemaVersion: 1, rootFile: 'main.txt',
  sourceHash: createHash('sha256').update(draft).digest('hex'), activeId: 'seed', updatedAt: new Date().toISOString(),
  comments: [{ ...comment('proof are', 'proof is'), id: 'seed', from: 0, to: 0, validity: 'stale', decision: 'open', messages: [] }] }));
const receipt = { synthetic: true, liveCodex: false, checks: [], rendererErrors: [], processes: [] };
let application, page;
const button = name => page.getByRole('button', { name, exact: true }).first();
const poll = async (check, label) => { const end = Date.now() + 20000; while (Date.now() < end) { if (await check()) return; await new Promise(r => setTimeout(r, 80)); } throw Error('Timed out: ' + label); };
const source = async () => (await page.locator('.source-pane .cm-line').allTextContents()).join('\n');
const shot = name => page.screenshot({ path: path.join(evidence, name + '.png') });
const running = key => application.evaluate((_, key) => !!globalThis.__parallelProbe[key], key);
const dismiss = async () => { if (await button('Dismiss error').count()) await button('Dismiss error').click(); };
const startReview = async () => {
  await button('Review with Codex').click();
  await page.getByLabel('Instructions for this review').fill('Check the wording.');
  await poll(() => button('Start review').isEnabled(), 'review controls ready');
  await button('Start review').click(); await poll(() => running('review'), 'review running');
};
const startChat = async (suggest = true) => {
  await page.getByLabel('Message to Codex Side Chat', { exact: true }).fill(suggest ? 'Suggest small edits.' : 'Explain the notation.');
  await button(suggest ? 'Suggest edits' : 'Ask Codex').click(); await poll(() => running('chat'), 'chat running');
};
try {
  application = await _electron.launch({ executablePath: require('electron'), args: [copy], cwd: repo, env: { ...process.env, MODERN_EDITOR_RUNTIME_DIR: path.join(root, 'runtime') }, chromiumSandbox: true });
  receipt.processes.push({ pid: application.process().pid, exited: false }); console.log('Owned Electron PID', application.process().pid);
  page = await application.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', e => receipt.rendererErrors.push(String(e)));
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1680, 980));
  await application.evaluate((_, file) => { globalThis.__parallelProbe.file = file; }, file);
  await button('Open a LaTeX or text file').click(); await page.locator('.source-pane .cm-content').waitFor();
  if (await button('Dismiss notice').count()) await button('Dismiss notice').click();
  await startReview(); assert(await button('Repair anchors').isEnabled());
  await button('Codex Side Chat').click();
  // Keep Comments reachable without relying on desktop pointer position.
  await button('Move Side Chat').focus();
  for (let i = 0; i < 40; i++) await page.keyboard.press('Shift+ArrowLeft');
  assert((await page.getByRole('complementary', { name: 'Codex Side Chat' }).boundingBox()).x < 20);
  await page.getByLabel('Side Chat settings', { exact: true }).click();
  await poll(() => page.getByLabel('Side Chat model', { exact: true }).isEnabled(), 'model catalog during review');
  await page.getByLabel('Side Chat model', { exact: true }).selectOption('gpt-6-astra');
  await page.getByLabel('Side Chat effort', { exact: true }).selectOption('high');
  await page.getByLabel('Side Chat settings', { exact: true }).click();
  await startChat(false);
  const ordinary = await application.evaluate(() => globalThis.__parallelProbe.chat.request);
  assert.equal(ordinary.options.model, 'gpt-6-astra'); assert.equal(ordinary.effort, 'high');
  await application.evaluate(() => globalThis.__parallelProbe.chat.finish({ reply: 'Keep your notation.', suggestions: [] }));
  await poll(() => button('Suggest edits').isEnabled(), 'chat completes independently');
  assert(await running('review'));
  assert((await application.evaluate(() => globalThis.__parallelProbe.history())).items.some(t => t.kind === 'paper-chat' && t.status === 'complete'));
  receipt.checks.push('Side Chat opens, loads model choices and completes an Astra High answer during an ongoing review; its history is saved immediately.');

  await startChat(); await button('Repair anchors').click(); await poll(() => running('anchors'), 'all three running');
  const requests = await application.evaluate(() => [globalThis.__parallelProbe.chat.request, globalThis.__parallelProbe.anchors.request]);
  assert.deepEqual(requests.map(r => [r.options.model, r.effort, r.fast]), [['gpt-6.1-sol', 'low', true], ['gpt-6.1-sol', 'high', true]]);
  await shot('01-three-independent-requests');
  await application.evaluate(async (_, c) => globalThis.__parallelProbe.review.publish([c]), comment('result are', 'result is'));
  await application.evaluate(async (_, c) => globalThis.__parallelProbe.chat.publish([c]), comment('claim are', 'claim is'));
  await poll(() => application.evaluate(() => globalThis.__parallelProbe.comments().length === 3), 'both streams delivered');
  assert.equal(await application.evaluate(() => globalThis.__parallelProbe.active()), 'seed');
  await application.evaluate(() => { const a = globalThis.__parallelProbe.anchors; a.finish({ matches: a.request.context.comments.map(c => ({ id: c.id, candidateId: 1, reason: 'Same passage.' })) }); });
  await poll(() => button('Accept').isEnabled(), 'anchors repaired during review and chat');
  assert.equal(await source(), draft);
  await button('Accept').click(); await poll(() => source().then(t => t === draft.replace('proof are', 'proof is')), 'accept seed');
  await button('Reject').click();
  await button('Stop Side Chat').click(); await poll(() => button('Suggest edits').isEnabled(), 'only chat stopped');
  assert(await running('review'));
  assert((await application.evaluate(() => globalThis.__parallelProbe.review.read())).excerpts.length > 0);
  receipt.checks.push('Repair anchors uses Sol High Fast alongside Sol Low Fast suggestions and review; arrivals preserve selection and repaired anchors change no source. Accept/Reject remain usable; chat Stop leaves the review and its reader running.');
  await startChat();
  await button('Stop review').click(); await poll(async () => !await running('review'), 'only review stopped');
  assert(await running('chat'));
  assert((await application.evaluate(() => globalThis.__parallelProbe.chat.read())).excerpts.length > 0);
  await application.evaluate((_, c) => globalThis.__parallelProbe.chat.finish({ reply: 'Another edit.', suggestions: [c] }), comment('notation is fixed', 'notation is consistent'));
  await poll(() => button('Suggest edits').isEnabled(), 'chat survives review Stop');
  await poll(() => application.evaluate(() => globalThis.__parallelProbe.comments().length === 4), 'all comments retained');
  assert.deepEqual(await application.evaluate(() => globalThis.__parallelProbe.comments().map(c => c.decision)), ['applied', 'dismissed', 'open', 'open']);
  await dismiss(); await shot('02-streams-and-decisions-kept');
  await button('Undo').click(); await button('Undo').click(); await poll(() => source().then(t => t === draft), 'undo accept and reject');
  await button('Undo').click(); await poll(() => button('Repair anchors').isEnabled(), 'undo repair');
  assert.equal(await application.evaluate(() => globalThis.__parallelProbe.comments().length), 4);
  receipt.checks.push('Review Stop leaves Side Chat and its reader running; both streams keep all arrivals and decisions. Undo restores decisions and anchors without removing later comments.');

  await button('Close Codex Side Chat').click(); await startReview(); await button('Codex Side Chat').click(); await startChat();
  await button('Repair anchors').click(); await poll(() => running('anchors'), 'second repair');
  await button('Stop anchor repair').click(); await poll(async () => !await running('anchors'), 'only repair stopped');
  assert(await running('review')); assert(await running('chat')); assert(await button('Accept').isDisabled());
  await dismiss(); await button('Repair anchors').click(); await poll(() => running('anchors'), 'repair restarted');
  await shot('03-close-with-three-requests');
  // Closing cancels all owned work, saves arrivals and returns home.
  await button('Close Codex Side Chat').click(); await button('Actions ▾').click(); await button('Close project').click(); await button('Close and keep data').click();
  await button('Open a LaTeX or text file').waitFor();
  assert.deepEqual(await application.evaluate(() => ['review','chat','anchors'].map(k => !!globalThis.__parallelProbe[k])), [false, false, false]);
  await button('Open a LaTeX or text file').click(); await page.locator('.source-pane .cm-content').waitFor();
  assert.equal(await source(), draft); assert.equal(await fs.readFile(file, 'utf8'), draft);
  assert.equal(await application.evaluate(() => globalThis.__parallelProbe.comments().length), 4);
  await shot('04-reopened');
  receipt.checks.push('Stop anchor repair leaves review and chat running. Closing with all three active cancels each, preserves received comments and reopens the unchanged source.');
  assert.deepEqual(receipt.rendererErrors, []); receipt.passed = true;
} catch (error) { receipt.passed = false; receipt.failure = String(error.stack ?? error); try { await shot('failure'); } catch {} throw error; }
finally {
  if (application) { const child = application.process(); await application.close(); await poll(async () => child.exitCode !== null || child.signalCode !== null, 'owned Electron exit'); receipt.processes.at(-1).exited = true; }
  await fs.writeFile(path.join(evidence, 'results.json'), JSON.stringify(receipt, null, 2)); console.log('Evidence', evidence);
  if (receipt.passed && !evidence.startsWith(root + path.sep)) await fs.rm(root, { recursive: true, force: true });
}
