// Native Electron regression with synthetic files and controlled Codex answers.
// Run after npm run build. Playwright is resolved from this project's package by
// default; --playwright-package /path/to/package.json selects an installed copy.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
assert(args.length === 0 || (args.length === 2 && args[0] === '--playwright-package'),
  'Usage: node scripts/check-discussion-proposals.mjs [--playwright-package /path/to/package.json]');
const appRequire = createRequire(path.join(appRoot, 'package.json'));
const playwrightRequire = args.length ? createRequire(path.resolve(args[1])) : appRequire;
const { _electron } = playwrightRequire('playwright');
const executablePath = appRequire('electron');
const stamp = Date.now();
const root = path.join(appRoot, '.test-runs', `discussion-proposals-${stamp}`);
const copy = path.join(root, 'desktop-copy');
const evidence = path.join(appRoot, 'test-evidence/discussion-proposals-2026-09-09', `native-${stamp}`);
await fs.mkdir(copy, { recursive: true });
await fs.mkdir(evidence, { recursive: true });
await fs.cp(path.join(appRoot, 'dist'), path.join(copy, 'dist'), { recursive: true });
await fs.writeFile(path.join(copy, 'package.json'), JSON.stringify({ name: 'discussion-proposals-check', private: true, main: 'dist/main.cjs' }));

const injection = `
const proposalProbe={requests:[],pending:null,compileAttempts:0};
codex.client.run=async(prompt,schema,progress,effort)=>{
  if(proposalProbe.pending)throw new Error('Concurrent model requests');
  proposalProbe.requests.push({prompt:JSON.parse(prompt),effort});
  return new Promise((resolve,reject)=>{proposalProbe.pending={resolve,reject};});
};
codex.client.cancel=codex.client.stop=async()=>{
  const pending=proposalProbe.pending;proposalProbe.pending=null;
  pending?.reject(new Error('Test request cancelled'));
};
compiler.compile=async()=>{proposalProbe.compileAttempts++;throw new Error('Unexpected compilation in discussion-only regression');};
globalThis.__proposalProbe=proposalProbe;
`;
await build({
  entryPoints: [path.join(appRoot, 'src/main/index.ts')], outfile: path.join(copy, 'dist/main.cjs'),
  bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'],
  plugins: [{ name: 'controlled-discussion-boundary', setup(b) {
    b.onLoad({ filter: /src\/main\/index\.ts$/ }, async args => ({
      contents: await fs.readFile(args.path, 'utf8') + injection, loader: 'ts'
    }));
  } }]
});
const reader = await build({
  stdin: { contents: "import {EditorView} from '@codemirror/view';window.editorViewForTest=element=>EditorView.findFromDOM(element);", resolveDir: appRoot },
  bundle: true, write: false, format: 'iife', platform: 'browser'
});
const paper = path.join(root, 'paper');
await fs.mkdir(path.join(paper, '.modern-editor'), { recursive: true });
const original = 'The allocation are monotone.';
const initialReplacement = 'The allocation is monotone.';
const manualDraft = 'The author kept a newer manual draft while Codex was answering.';
const newerNote = 'Keep this newer unsent note for the next question.';
const source = '\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}\n\\section{Synthetic example}\n'
  + original + '\nThis synthetic document contains no private paper text.\n\\end{document}\n';
const hash = text => createHash('sha256').update(text).digest('hex');
const file = path.join(paper, 'main.tex');
await fs.writeFile(file, source);
const from = source.indexOf(original);
const comment = {
  id: 'discussion-c1', title: 'Synthetic monotonicity wording', category: 'Clarity', original,
  replacement: initialReplacement, from, to: from + original.length,
  before: source.slice(Math.max(0, from - 80), from), after: source.slice(from + original.length, from + original.length + 80),
  explanation: 'Inspect each alternative before changing the current proposal.', decision: 'open', validity: 'current',
  packages: ['amsmath'], messages: [], replyDraft: ''
};
await fs.writeFile(path.join(paper, '.modern-editor/review.json'), JSON.stringify({
  schemaVersion: 1, rootFile: 'main.tex', sourceHash: hash(source), activeId: comment.id,
  updatedAt: new Date().toISOString(), comments: [comment]
}));
const state = path.join(paper, '.modern-editor/documents', hash('main.tex'));
const answerA = {
  reply: 'Alternative one keeps the formula and literal source characters visible.',
  replacement: String.raw`The allocation is weakly increasing in $x$.
\[
  f(x) = \frac{x_1}{1+x^2}.
\]
Literal source: <b>angle brackets</b> & a backslash \ remain text.`,
  packages: ['mathtools', 'xcolor']
};
const answerB = {
  reply: 'Alternative two offers a shorter sentence with a different package list.',
  replacement: String.raw`The allocation is nondecreasing: $f(x) \geq 0$.
The conclusion follows from the maintained assumptions.`,
  packages: ['mathtools']
};
const explanationOnly = { reply: 'The existing wording already states the needed conclusion; this answer only explains it.', replacement: null, packages: [] };
const deletion = { reply: 'This passage duplicates the preceding claim and can be removed.', replacement: '', packages: [] };
const longEnding = 'END OF COMPLETE SUGGESTED WORDING.';
const longAnswer = {
  reply: 'This longer alternative should be readable to its final line at the minimum window size.',
  replacement: Array.from({ length: 65 }, (_, i) => `Line ${i + 1}: preserve $x_${i + 1}$ and \\alpha exactly while the author reads the full proposal.`).join('\n')
    + '\n' + 'A_long_unbroken_source_token_'.repeat(9) + '\n' + longEnding,
  packages: []
};
const receipt = {
  startedAt: new Date().toISOString(), root, evidence, syntheticSource: true, liveModelCalls: false,
  controlledModelBoundary: true, compilationDisabled: true, osPickerSupplied: true,
  checks: [], screenshots: [], processes: [], rendererErrors: []
};
let application, page;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function poll(fn, label, timeout = 20000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (await fn()) return; await pause(60); }
  throw new Error(`Timed out: ${label}`);
}
const button = name => page.getByRole('button', { name, exact: true });
const replacement = () => page.getByLabel('Proposed replacement', { exact: true });
const note = () => page.getByLabel('Your reply or note', { exact: true });
const message = text => page.locator('.discussion .message').filter({ hasText: text });
const use = text => message(text).getByRole('button', { name: 'Use this wording', exact: true });
const wording = text => message(text).getByLabel('Suggested wording', { exact: true });
async function buffer() {
  return page.getByLabel('LaTeX source', { exact: true }).evaluate(el => window.editorViewForTest(el).state.doc.toString());
}
async function sourceUnchanged() {
  assert.equal(await buffer(), source, 'The source buffer must stay unchanged');
  assert.equal(await fs.readFile(file, 'utf8'), source, 'The source file must stay unchanged');
  assert.equal((await probe()).compileAttempts, 0, 'Discussion must not trigger compilation');
}
async function record() {
  try { return JSON.parse(await fs.readFile(path.join(state, 'review.json'), 'utf8')).comments.find(c => c.id === comment.id); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function proposalIs(text, packages) {
  await poll(async () => await replacement().inputValue() === text, 'proposal field');
  await poll(async () => {
    const saved = await record();
    return saved && (saved.draft ?? saved.replacement) === text && JSON.stringify(saved.packages) === JSON.stringify(packages);
  }, 'persisted proposal and exact packages');
}
async function revealedProposal() {
  await poll(() => page.locator('.review-rail').evaluate(el => document.activeElement === el), 'review focus after explicit selection');
  const view = await replacement().evaluate(el => {
    const box = el.getBoundingClientRect(), rail = el.closest('.review-rail').getBoundingClientRect();
    return { top: box.top, bottom: box.bottom, railTop: rail.top, railBottom: rail.bottom };
  });
  assert(view.top >= view.railTop && view.bottom <= view.railBottom, 'Selected proposal should be scrolled into view');
}
async function probe() {
  return application.evaluate(() => ({
    requests: globalThis.__proposalProbe.requests, pending: !!globalThis.__proposalProbe.pending,
    compileAttempts: globalThis.__proposalProbe.compileAttempts
  }));
}
async function ask(text) {
  const count = (await probe()).requests.length;
  await note().fill(text);
  await button('Ask Codex').click();
  await poll(async () => { const p = await probe(); return p.pending && p.requests.length === count + 1; }, 'controlled Codex request');
  assert.equal((await probe()).requests.at(-1).prompt.authorReply, text);
}
async function complete(answer) {
  await application.evaluate((_electron, answer) => {
    const pending = globalThis.__proposalProbe.pending;
    if (!pending) throw new Error('No controlled reply pending');
    globalThis.__proposalProbe.pending = null;
    pending.resolve(answer);
  }, answer);
  await message(answer.reply).waitFor();
  await poll(async () => await button('Question in progress…').count() === 0, 'discussion completion');
}
async function shot(name) {
  await page.screenshot({ path: path.join(evidence, name + '.png'), scale: 'css' });
  receipt.screenshots.push(name + '.png');
}
async function check(name) { await sourceUnchanged(); receipt.checks.push(name); console.log('PASS', name); }
async function undoFromMenu() {
  const accelerator = await application.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu().items.find(item => item.label === 'Edit').submenu.items.find(item => item.label === 'Undo');
    const click = item.click;
    globalThis.__proposalProbe.undoDispatches = 0;
    item.click = (...args) => { globalThis.__proposalProbe.undoDispatches++; return click(...args); };
    return item.accelerator;
  });
  assert.equal(accelerator, 'CmdOrCtrl+Z');
  // CDP key events bypassed the macOS application menu in the initial probe.
  // Exercise the registered command without browser-native form undo or test IPC.
  receipt.undoInput = 'Invoked the registered CmdOrCtrl+Z menu command directly. Physical key delivery remains unverified.';
  await application.evaluate(({ Menu, BrowserWindow }) => {
    const item = Menu.getApplicationMenu().items.find(item => item.label === 'Edit').submenu.items.find(item => item.label === 'Undo');
    item.click(item, BrowserWindow.getAllWindows()[0], {});
  });
  assert.equal(await application.evaluate(() => globalThis.__proposalProbe.undoDispatches), 1);
}
async function launch() {
  application = await _electron.launch({ executablePath, args: [copy], cwd: appRoot, chromiumSandbox: true, timeout: 25000 });
  const child = application.process();
  receipt.processes.push({ pid: child.pid, exited: false });
  console.log('Owned Electron PID', child.pid);
  page = await application.firstWindow();
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => receipt.rendererErrors.push(String(error)));
  await page.evaluate(reader.outputFiles[0].text);
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1450, 900));
}
async function closeOwned() {
  const child = application.process();
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await poll(() => Promise.resolve(child.exitCode !== null || child.signalCode !== null), 'owned Electron exit');
  assert.equal(child.exitCode, 0);
  receipt.processes.find(p => p.pid === child.pid).exited = true;
  receipt.processes.find(p => p.pid === child.pid).exitCode = child.exitCode;
  application = null;
  console.log('Owned Electron exited', child.pid);
}

try {
  await launch();
  await application.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, file);
  await button('Actions ▾').click();
  await button('Open paper…').click();
  await page.getByRole('heading', { name: comment.title, exact: true }).waitFor();
  if (await button('Dismiss notice').count()) await button('Dismiss notice').click();
  await button('Discuss').click();
  await ask('Please propose precise wording, keeping the literal LaTeX available for inspection.');
  await replacement().fill(manualDraft);
  await note().fill(newerNote);
  await complete(answerA);
  await proposalIs(manualDraft, ['amsmath']);
  assert.equal(await note().inputValue(), newerNote);
  assert.equal(await wording(answerA.reply).textContent(), answerA.replacement);
  assert.equal(await wording(answerA.reply).locator('b').count(), 0, 'Suggested markup must remain literal text');
  assert.equal(await message(answerA.reply).getByLabel('Suggested packages').textContent(), '\\usepackage{mathtools}\n\\usepackage{xcolor}');
  assert(await use(answerA.reply).isEnabled());
  await wording(answerA.reply).focus();
  await message(answerA.reply).scrollIntoViewIfNeeded();
  await shot('01-visible-reply-before-selection');
  await check('Late reply displays exact source and packages without overwriting the newer proposal or note');

  await use(answerA.reply).click();
  await proposalIs(answerA.replacement, answerA.packages);
  await revealedProposal();
  assert(await use(answerA.reply).isDisabled());
  assert.equal(await message(answerA.reply).locator('.reply-current').textContent(), 'Matches the current proposal');
  assert.equal(await page.locator('.preamble-note pre').textContent(), '\\usepackage{mathtools}\n\\usepackage{xcolor}\n');
  await shot('02-selected-proposal-review-focus');
  await sourceUnchanged();
  await undoFromMenu();
  await proposalIs(manualDraft, ['amsmath']);
  assert(await use(answerA.reply).isEnabled());
  assert.equal(await note().inputValue(), newerNote);
  assert.equal(await wording(answerA.reply).textContent(), answerA.replacement);
  await check('Use this wording selects exact text/packages, reveals the proposal with review focus, and the CmdOrCtrl+Z menu command restores the manual draft');

  await ask('Give a second alternative with a shorter explanation.');
  await complete(answerB);
  assert.equal(await wording(answerA.reply).textContent(), answerA.replacement);
  assert.equal(await wording(answerB.reply).textContent(), answerB.replacement);
  await proposalIs(manualDraft, ['amsmath']);
  await use(answerB.reply).click();
  await proposalIs(answerB.replacement, answerB.packages);
  assert(await use(answerA.reply).isEnabled());
  assert(await use(answerB.reply).isDisabled());
  await use(answerA.reply).click();
  await proposalIs(answerA.replacement, answerA.packages);
  assert(await use(answerB.reply).isEnabled());
  await button('Undo').click();
  await proposalIs(answerB.replacement, answerB.packages);
  await button('Undo').click();
  await proposalIs(manualDraft, ['amsmath']);
  await check('Independent alternatives retain their text/packages and can be selected and undone in order');

  await ask('Explain the conclusion without proposing a change.');
  await complete(explanationOnly);
  assert.equal(await message(explanationOnly.reply).locator('.reply-proposal').count(), 0);
  assert.equal(await page.locator('.reply-proposal').count(), 2);
  await proposalIs(manualDraft, ['amsmath']);
  await check('Explanation-only replies add no replacement control and leave the current proposal unchanged');

  await ask('Would deleting the repeated passage be clearer?');
  await complete(deletion);
  assert.equal(await message(deletion.reply).locator('.reply-deletion').textContent(), 'Remove this passage.');
  assert.equal(await wording(deletion.reply).count(), 0);
  await message(deletion.reply).scrollIntoViewIfNeeded();
  await shot('03-explicit-deletion-proposal');
  await use(deletion.reply).click();
  await proposalIs('', []);
  await revealedProposal();
  assert(await use(deletion.reply).isDisabled());
  await sourceUnchanged();
  await button('Undo').click();
  await proposalIs(manualDraft, ['amsmath']);
  await check('Deletion is explicit, selects an empty proposal only, and remains undoable');

  await button('Dismiss').click();
  await button('History').click();
  await page.getByRole('heading', { name: comment.title, exact: true }).waitFor();
  assert(await replacement().isDisabled());
  for (const answer of [answerA, answerB, deletion]) assert(await use(answer.reply).isDisabled());
  assert.equal(await page.locator('.reply-current').count(), 0);
  assert.equal(await wording(answerA.reply).textContent(), answerA.replacement);
  await button('Reopen').click();
  await proposalIs(manualDraft, ['amsmath']);
  for (const answer of [answerA, answerB, deletion]) assert(await use(answer.reply).isEnabled());
  await check('Completed comments preserve readable alternatives and disable selection until reopened');

  await ask('Provide a long alternative so I can inspect its complete final line.');
  await complete(longAnswer);
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(960, 720));
  await button('PDF').click();
  await wording(longAnswer.reply).scrollIntoViewIfNeeded();
  assert.equal(await wording(longAnswer.reply).textContent(), longAnswer.replacement);
  const dimensions = await wording(longAnswer.reply).evaluate(el => ({
    height: el.clientHeight, contentHeight: el.scrollHeight, width: el.clientWidth,
    contentWidth: el.scrollWidth, maxHeight: getComputedStyle(el).maxHeight
  }));
  assert(dimensions.height > 1500, 'Long suggestion must occupy its full height');
  assert(dimensions.contentHeight <= dimensions.height + 1, 'The suggestion must not hide its ending in an inner scroll area');
  assert(dimensions.contentWidth <= dimensions.width + 1, 'Long source tokens must wrap in the narrow comment pane');
  assert.equal(dimensions.maxHeight, 'none');
  await use(longAnswer.reply).scrollIntoViewIfNeeded();
  const ending = await wording(longAnswer.reply).evaluate((el, text) => {
    const node = el.firstChild, range = document.createRange();
    range.setStart(node, node.textContent.length - text.length);
    range.setEnd(node, node.textContent.length);
    const box = range.getBoundingClientRect(), rail = el.closest('.review-rail').getBoundingClientRect();
    return { top: box.top, bottom: box.bottom, railTop: rail.top, railBottom: rail.bottom };
  }, longEnding);
  assert(ending.top >= ending.railTop && ending.bottom <= ending.railBottom, 'The complete final line must be reachable in the outer discussion scroll');
  await shot('04-minimum-window-complete-ending');
  await sourceUnchanged();
  await use(longAnswer.reply).click();
  await proposalIs(longAnswer.replacement, []);
  await revealedProposal();
  await shot('05-minimum-window-selected-proposal');
  await button('Undo').click();
  await proposalIs(manualDraft, ['amsmath']);
  receipt.narrowSuggestionDimensions = dimensions;
  await check('Minimum-width layout shows the complete long suggestion with wrapping and no clipped inner ending');

  await button('Save').click();
  await page.locator('footer [role="status"]').filter({ hasText: 'Source and review saved' }).waitFor();
  assert.equal((await probe()).requests.length, 5);
  receipt.controlledRequests = (await probe()).requests.length;
  await closeOwned();
  assert.equal(await fs.readFile(file, 'utf8'), source);
  await launch();
  await page.getByRole('heading', { name: comment.title, exact: true }).waitFor();
  await proposalIs(manualDraft, ['amsmath']);
  for (const answer of [answerA, answerB, longAnswer]) assert.equal(await wording(answer.reply).textContent(), answer.replacement);
  assert.equal(await message(explanationOnly.reply).locator('.reply-proposal').count(), 0);
  assert.equal((await probe()).requests.length, 0);
  await check('Saved discussion and manual proposal survive restart with source byte-for-byte unchanged and no model call');
  await closeOwned();
  assert.deepEqual(receipt.rendererErrors, []);
  receipt.passed = true;
} catch (error) {
  receipt.error = String(error.stack ?? error);
  process.exitCode = 1;
  console.error(receipt.error);
  if (page) try { await shot('failure'); } catch {}
} finally {
  if (application) {
    const child = application.process();
    await Promise.race([application.close().catch(() => {}), pause(7000)]);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await poll(() => Promise.resolve(child.exitCode !== null || child.signalCode !== null), 'failed-run Electron cleanup');
    Object.assign(receipt.processes.find(p => p.pid === child.pid), { exited: true, exitCode: child.exitCode, signal: child.signalCode });
    receipt.failureCleanup = true;
    console.log('Owned Electron cleanup confirmed', child.pid);
  }
  receipt.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(evidence, 'receipt.json'), JSON.stringify(receipt, null, 2));
  console.log('Evidence:', evidence);
  console.log('Checks:', receipt.checks.length, 'Passed:', !!receipt.passed);
}
