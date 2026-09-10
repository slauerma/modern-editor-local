/*
 * Personal project for LaTeX writing and Codex-assisted revision.
 * Keep it simple, lean, and clean. Production-level completeness is not a goal;
 * unusual edge cases may be handled manually. Always preserve the manuscript.
 */
import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ProjectService } from './project-service.ts';
import { CompileService } from './compile-service.ts';
import { reviewSchema, commentSchema, engineSchema, effortSchema, fastModeSchema, historyBudgetSchema, preambleRequestSchema, paperInstructionsSchema, pdfRequestSchema, workspaceSchema, type Project } from '../shared/contracts.ts';
import { CodexService } from './codex-service.ts';
import { inspectSourceRecovery, writeSourceCopy } from './source-export.ts';

app.setName('Modern Codex Editor');
const runtime = app.isPackaged ? app.getPath('userData') : path.join(app.getAppPath(), '.runtime');
app.setPath('userData', runtime);
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
const projects = new ProjectService(runtime), compiler = new CompileService(projects, path.join(runtime, 'builds'), undefined, undefined, path.join(__dirname, 'tex-support', 'tcilatex.tex'));
const codex = new CodexService(projects, path.join(runtime, 'codex-context'));
let window: BrowserWindow | null = null, closing = false, rendererGone = false;
app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.show(); window?.focus(); });
const documentFile = path.join(__dirname, 'renderer/index.html');
const documentURL = pathToFileURL(documentFile).href;
const textInput = z.object({ projectId: z.string(), text: z.string().max(2000000) });
function handle(channel: string, action: (...args: any[]) => unknown) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (event.sender !== window?.webContents || event.senderFrame?.url.split('#')[0] !== documentURL) throw new Error('Untrusted application request.');
    try { return await action(...args); }
    catch (error) {
      if (error instanceof z.ZodError) throw new Error('Invalid review or request data: ' + error.issues.slice(0, 3).map(issue => `${issue.path.join('.') || 'value'}: ${issue.message}`).join(' '));
      if (error instanceof SyntaxError) throw new Error('The JSON file could not be read. Check its syntax; the original file was preserved.');
      throw error;
    }
  });
}
const send = (command: string) => window?.webContents.send('menu:command', command);
async function restoreWorkspace(p: Project | null) {
  if (p?.workspace?.pdfBuildId) try { p.restoredPdf = await compiler.restore(p.id, p.workspace.pdfBuildId); }
  catch { p.notices.push('The previous PDF is no longer available or could not be verified. Compile to rebuild it; your saved reading position is kept.'); }
  return p;
}
handle('project:open', async () => {
  const result = await dialog.showOpenDialog(window!, { title: 'Open the root LaTeX document', properties: ['openFile'], filters: [{ name: 'LaTeX document', extensions: ['tex'] }] });
  return result.canceled ? null : restoreWorkspace(await projects.open(result.filePaths[0]));
});
handle('project:resume', async () => restoreWorkspace(await projects.resume()));
handle('project:draft', async () => {
  const dir = path.join(runtime, 'papers', `draft-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'draft.tex');
  await fs.writeFile(file, '', { flag: 'wx' });
  return projects.open(file);
});
handle('source:export', async input => {
  const parsed = z.object({ name: z.string().max(500), text: z.string().max(8000000) }).parse(input);
  const name = path.basename(parsed.name).replace(/\.tex$/i, '') + '-copy.tex';
  const result = await dialog.showSaveDialog(window!, { title: 'Export source to a new file', defaultPath: name, filters: [{ name: 'LaTeX source', extensions: ['tex'] }] });
  if (result.canceled || !result.filePath) return null;
  try { await writeSourceCopy(result.filePath, parsed.text); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('That file already exists. Choose a new filename; export never overwrites an existing file.'); throw error; }
  return result.filePath;
});
handle('source:recover', async () => {
  const result = await dialog.showOpenDialog(window!, { title: 'Inspect source recovery for a root LaTeX document', properties: ['openFile'], filters: [{ name: 'LaTeX document', extensions: ['tex'] }] });
  return result.canceled ? null : inspectSourceRecovery(result.filePaths[0]);
});
handle('project:demo', async () => {
  const dir = path.join(runtime, 'papers', `sample-${randomUUID().slice(0, 8)}`);
  await fs.mkdir(path.join(dir, '.modern-editor'), { recursive: true });
  await fs.copyFile(path.join(__dirname, 'fixtures/sample/main.tex'), path.join(dir, 'main.tex'));
  const review = reviewSchema.parse(JSON.parse(await fs.readFile(path.join(__dirname, 'fixtures/sample/review.json'), 'utf8')));
  await fs.writeFile(path.join(dir, '.modern-editor/review.json'), JSON.stringify(review, null, 2));
  return projects.open(path.join(dir, 'main.tex'));
});
handle('project:persist', input => projects.persist(input));
handle('project:save', input => projects.save(input));
handle('project:engine', input => { const p = z.object({ projectId: z.string(), engine: engineSchema }).parse(input); return projects.setEngine(p.projectId, p.engine); });
handle('project:effort', input => { const p = z.object({ projectId: z.string(), effort: effortSchema }).parse(input); return projects.setEffort(p.projectId, p.effort); });
handle('project:fast-mode', input => { const p = z.object({ projectId: z.string(), fastMode: fastModeSchema }).parse(input); return projects.setFastMode(p.projectId, p.fastMode); });
handle('project:instructions', input => { const p = z.object({ projectId: z.string(), instructions: paperInstructionsSchema }).parse(input); return projects.setPaperInstructions(p.projectId, p.instructions); });
handle('project:workspace', input => { const p = z.object({ projectId: z.string(), workspace: workspaceSchema }).parse(input); return projects.setWorkspace(p.projectId, p.workspace); });
const versionInput = z.object({ projectId:z.string(), versionId:z.string().regex(/^[a-f0-9]{64}$/) });
handle('comparison:history', id => projects.versionHistory(z.string().parse(id)));
handle('comparison:saved', input => { const p = versionInput.parse(input); return projects.compareSavedVersion(p.projectId,p.versionId); });
handle('comparison:delete', input => { const p = versionInput.parse(input); return projects.deleteSavedVersion(p.projectId,p.versionId); });
handle('comparison:budget', input => { const p = z.object({ projectId:z.string(), bytes:historyBudgetSchema }).parse(input); return projects.setHistoryBudget(p.projectId,p.bytes); });
handle('comparison:pin', input => { const p = textInput.extend({ name: z.string().trim().min(1).max(200) }).parse(input); return projects.pinBaseline(p.projectId, p.name, p.text); });
handle('comparison:choose', async id => {
  const projectId = z.string().parse(id); projects.get(projectId);
  const result = await dialog.showOpenDialog(window!, { title: 'Choose the original or an older LaTeX version', properties: ['openFile'], filters: [{ name: 'LaTeX source', extensions: ['tex'] }] });
  return result.canceled ? null : projects.baselineFromFile(projectId, result.filePaths[0]);
});
handle('project:reload', async id => restoreWorkspace(await projects.open(projects.get(z.string().parse(id)).path)));
handle('review:import', async input => {
  const parsed = textInput.parse(input); projects.get(parsed.projectId);
  const result = await dialog.showOpenDialog(window!, { title: 'Import comments from JSON', properties: ['openFile'], filters: [{ name: 'JSON review', extensions: ['json'] }] });
  return result.canceled ? null : projects.import(result.filePaths[0], parsed.projectId, parsed.text);
});
handle('build:compile', input => { const p = textInput.extend({ engine: z.enum(['pdflatex', 'lualatex', 'xelatex']) }).parse(input); return compiler.compile(p.projectId, p.text, p.engine); });
handle('build:validate', input => { const p = textInput.extend({ buildId: z.string() }).parse(input); return compiler.validate(p.projectId, p.buildId, p.text); });
handle('build:pdf', id => compiler.pdf(z.string().parse(id)));
handle('build:locate', input => compiler.locatePdf(pdfRequestSchema.parse(input)));
handle('build:cancel', () => compiler.cancel());
handle('build:clear-old', ids => compiler.clearOldBuilds(z.array(z.string().uuid()).max(20).parse(ids)));
handle('codex:review', input => { const p = textInput.extend({ from: z.number().int().nonnegative(), to: z.number().int().nonnegative(), instructions: z.string().max(10000), requestId: z.string().uuid().optional() }).parse(input); return codex.review(p, message => window?.webContents.send('codex:progress', message)); });
handle('codex:reply', input => { const p = textInput.extend({ comment: commentSchema, message: z.string().min(1).max(10000), requestId: z.string().uuid().optional(), deeper: z.boolean().optional() }).parse(input); return codex.reply(p, message => window?.webContents.send('codex:progress', message)); });
handle('codex:waiting', id => codex.results.list(z.string().parse(id)));
handle('codex:acknowledge', input => { const p = z.object({ projectId: z.string(), resultId: z.string().uuid(), outcome: z.enum(['adopted', 'dismissed']) }).parse(input); return codex.results.acknowledge(p.projectId, p.resultId, p.outcome); });
handle('codex:cancel', () => codex.client.cancel());
handle('codex:preamble', input => codex.preamble(preambleRequestSchema.parse(input), message => window?.webContents.send('codex:progress', message)));
async function finishClose() {
  await Promise.all([compiler.stop(), codex.client.stop()]);
  // A finished model process can still have an answer being validated/written.
  await codex.settle(); await projects.settle();
  closing = true; window?.close();
}
handle('window:close-ready', finishClose);

async function createWindow() {
  window = new BrowserWindow({ width: 1450, height: 960, minWidth: 960, minHeight: 640, title: 'Modern Codex Editor', backgroundColor: '#f7f8f6', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (url !== documentURL) event.preventDefault(); });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.on('console-message', details => { if (['warning', 'error'].includes(details.level)) console.error('Renderer:', details.message); });
  window.webContents.on('render-process-gone', () => { rendererGone = true; void Promise.all([compiler.stop(), codex.client.stop()]).catch(console.error); });
  window.on('close', event => { if (!closing) { event.preventDefault(); if (rendererGone) void finishClose().catch(console.error); else window?.webContents.send('window:close-requested'); } });
  window.on('closed', () => { window = null; });
  await window.loadFile(documentFile);
  console.log('Modern Codex Editor ready. Local interface; no HTTP server.');
}
if (primaryInstance) app.whenReady().then(async () => {
  await fs.mkdir(runtime, { recursive: true });
  const menu: Electron.MenuItemConstructorOptions[] = [
    { label: 'Modern Codex Editor', submenu: [{ role: 'about' }, { type: 'separator' }, { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => window?.close() }] },
    { label: 'File', submenu: [{ label: 'Open paper…', accelerator: 'CmdOrCtrl+O', click: () => send('open') }, { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => send('save') }, { label: 'Compile', accelerator: 'CmdOrCtrl+B', click: () => send('compile') }, { type: 'separator' }, { role: 'close' }] },
    { label: 'Edit', submenu: [
      // Source edits and review decisions share CodeMirror history, including menu shortcuts.
      { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => send('undo') },
      { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: () => send('redo') },
      { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'pasteAndMatchStyle' }, { role: 'delete' }, { type: 'separator' }, { role: 'selectAll' }
    ] }, { label: 'Find', submenu: [{ label: 'Find in source…', accelerator: 'CmdOrCtrl+F', click: () => send('find') }] }, { label: 'View', submenu: [{ label: 'Toggle PDF', accelerator: 'CmdOrCtrl+Shift+P', click: () => send('pdf') }, { label: 'Show/hide toolbar', accelerator: 'CmdOrCtrl+Shift+M', click: () => send('toolbar') }, { role: 'toggleDevTools' }, { role: 'togglefullscreen' }] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menu));
  await createWindow();
}).catch(error => { console.error(error); app.exit(1); });
app.on('window-all-closed', () => app.quit());
