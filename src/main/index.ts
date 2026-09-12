/*
 * Personal project for LaTeX writing and Codex-assisted revision.
 * Keep it simple, lean, and clean. Production-level completeness is not a goal;
 * unusual edge cases may be handled manually. Always preserve the manuscript.
 */
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu } from 'electron';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ProjectService } from './project-service.ts';
import { CompileService } from './compile-service.ts';
import { reviewSchema, commentSchema, engineSchema, effortSchema, fastModeSchema, historyBudgetSchema, preambleRequestSchema, paperInstructionsSchema, pdfRequestSchema, workspaceSchema, type Project } from '../shared/contracts.ts';
import { AttachmentService } from './attachment-service.ts';
import { ReferenceService } from './reference-service.ts';
import { attachmentSelectionsSchema, attachmentPreviewIdSchema } from '../shared/attachments.ts';
import { feedbackRequestSchema } from '../shared/feedback.ts';
import { CodexService } from './codex-service.ts';
import { BuildInputHelp } from './build-input-help.ts';
import { buildInputLimitsSchema, buildInputPathsSchema } from '../shared/build-input-help.ts';
import { inspectSourceRecovery, writeSourceCopy } from './source-export.ts';
import { prepareRuntimeStorage, runtimeLocation, createDraftSource } from './runtime-storage.ts';
import { ToolSettingsService } from './tool-settings.ts';
import { formatSetupDetails, toolSettingsSchema, type ToolSettingsState } from '../shared/tool-settings.ts';
import { verifiedCodexVersions } from './codex-policy.ts';
import { HelpChat } from './help-chat.ts';
import { chatInputSchema, chatScopeSchema } from '../shared/help-chat.ts';
import { normalizeChatImage } from './chat-images.ts';
import { readRegularFile } from './files.ts';

app.setName('Modern Codex Editor');
const runtimeOverride = process.env.MODERN_EDITOR_RUNTIME_DIR;
const userData = app.getPath('userData'), runtime = runtimeLocation(userData, runtimeOverride);
// Tests opt into a completely separate runtime and Electron profile. Normal
// source launches keep both outside the checkout, so updates cannot remove papers.
if (runtimeOverride) app.setPath('userData', path.join(path.dirname(runtime), path.basename(runtime) + '-electron'));
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
const projects = new ProjectService(runtime), compiler = new CompileService(projects, path.join(runtime, 'builds'), undefined, undefined, path.join(__dirname, 'tex-support', 'tcilatex.tex'));
const attachments = new AttachmentService({ pdfModulePath: path.join(app.getAppPath(), 'node_modules/pdfjs-dist/legacy/build/pdf.mjs') });
const references = new ReferenceService(projects, path.join(runtime, 'reference-folders'), attachments);
const codex = new CodexService(projects, path.join(runtime, 'codex-context'), attachments, references);
const buildHelp = new BuildInputHelp(projects, compiler, codex);
const tools = new ToolSettingsService(runtime);
const helpChat = new HelpChat(projects, codex.client, path.join(runtime, 'help-chats'), async () => ({
  version: app.getVersion(), platform: process.platform, osVersion: process.getSystemVersion(),
  documentation: (await Promise.all(['USER_GUIDE.md','SETUP.md','FAQ.md','CHANGELOG.md'].map(async name => `## ${name}\n${(await readRegularFile(path.join(__dirname, 'help', name), 100000)).toString('utf8')}`))).join('\n\n')
}), references);
let storageNotices: string[] = [], setupBusy = false, activeToolOperations = 0;
let window: BrowserWindow | null = null, closing = false, rendererGone = false;
app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.show(); window?.focus(); });
const documentFile = path.join(__dirname, 'renderer/index.html');
const documentURL = pathToFileURL(documentFile).href;
const textInput = z.object({ projectId: z.string(), text: z.string().max(2000000) });
function handle(channel: string, action: (...args: any[]) => unknown) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (event.sender !== window?.webContents || event.senderFrame?.url.split('#')[0] !== documentURL) throw new Error('Untrusted application request.');
    const toolOperation = /^(codex:|build:)/.test(channel) && !['codex:cancel', 'build:cancel', 'codex:progress'].includes(channel);
    if (toolOperation && setupBusy) throw new Error('Wait for setup to finish before starting Codex or compilation.');
    if (toolOperation) activeToolOperations++;
    try { return await action(...args); }
    catch (error) {
      if (error instanceof z.ZodError) throw new Error('Invalid review or request data: ' + error.issues.slice(0, 3).map(issue => `${issue.path.join('.') || 'value'}: ${issue.message}`).join(' '));
      if (error instanceof SyntaxError) throw new Error('The JSON file could not be read. Check its syntax; the original file was preserved.');
      throw error;
    }
    finally { if (toolOperation) activeToolOperations--; }
  });
}
const send = (command: string) => window?.webContents.send('menu:command', command);
async function restoreWorkspace(p: Project | null) {
  if (p && storageNotices.length) p.notices.push(...storageNotices);
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
  const result = await dialog.showSaveDialog(window!, { title: 'Choose a folder for the new paper', defaultPath: path.join(app.getPath('documents'), 'new-paper.tex'), filters: [{ name: 'LaTeX source', extensions: ['tex'] }] });
  if (result.canceled || !result.filePath) return null;
  return projects.open(await createDraftSource(result.filePath, app.getAppPath()));
});
async function toolSettingsState(): Promise<ToolSettingsState> {
  const saved = await tools.load();
  return { settings: saved.settings, identity: setupIdentity(), runtimePath: runtime, notices: [...storageNotices, ...saved.notices], verifiedCodexVersions: [...verifiedCodexVersions] };
}
const setupIdentity = () => ({ editorVersion: app.getVersion(), platform: process.platform, osVersion: process.getSystemVersion() });
function reserveSetup() {
  if (setupBusy || activeToolOperations || compiler.isBusy || codex.client.isBusy) throw new Error('Finish or cancel active Codex, compilation, and PDF navigation before changing or checking setup.');
  setupBusy = true;
}
handle('setup:get', toolSettingsState);
handle('setup:choose', async input => {
  const tool = z.enum(['codex', 'latexmk']).parse(input);
  const result = await dialog.showOpenDialog(window!, { title: `Choose the ${tool} executable`, properties: ['openFile', 'showHiddenFiles'] });
  return result.canceled ? null : result.filePaths[0];
});
handle('setup:save', async input => {
  const parsed = toolSettingsSchema.parse(input); reserveSetup();
  try {
    const saved = await tools.save(parsed);
    // All tool requests are excluded across the await above. Apply both paths
    // together, retaining the compiler's already verified PDF snapshots.
    compiler.setLatexmk(saved.latexmkPath); codex.client.setBinary(saved.codexPath);
    return toolSettingsState();
  } finally { setupBusy = false; }
});
handle('setup:check', async input => {
  const parsed = toolSettingsSchema.parse(input); reserveSetup();
  try { return await tools.check(parsed); } finally { setupBusy = false; }
});
handle('setup:copy-details', async input => {
  const parsed = toolSettingsSchema.parse(input); reserveSetup();
  try {
    const check = await tools.check(parsed), details = formatSetupDetails(setupIdentity(), check);
    clipboard.writeText(details);
    return { details, check };
  } finally { setupBusy = false; }
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
handle('build:compile', input => { const p = textInput.extend({ engine: engineSchema, selectedPaths: buildInputPathsSchema.optional(), limits: buildInputLimitsSchema.optional() }).strict().parse(input); return compiler.compile(p.projectId, p.text, p.engine, p.selectedPaths, p.limits); });
handle('build:help-preview', input => { const p = textInput.strict().parse(input); return buildHelp.prepare(p.projectId, p.text); });
handle('codex:build-help', input => { const p = textInput.extend({ previewId: z.string().uuid() }).strict().parse(input); return buildHelp.ask(p.projectId, p.text, p.previewId, message => window?.webContents.send('codex:progress', message)); });
handle('build:validate', input => { const p = textInput.extend({ buildId: z.string() }).parse(input); return compiler.validate(p.projectId, p.buildId, p.text); });
handle('build:pdf', id => compiler.pdf(z.string().parse(id)));
handle('build:locate', input => compiler.locatePdf(pdfRequestSchema.parse(input)));
handle('build:cancel', () => { buildHelp.cancel(); compiler.cancel(); });
handle('build:clear-old', ids => compiler.clearOldBuilds(z.array(z.string().uuid()).max(20).parse(ids)));
handle('attachments:list', id => { const projectId = z.string().parse(id); projects.get(projectId); return attachments.inventory(projectId); });
handle('attachments:choose', async input => {
  const p = z.object({ projectId: z.string(), folder: z.boolean() }).strict().parse(input); projects.get(p.projectId);
  const result = await dialog.showOpenDialog(window!, { title: p.folder ? 'Choose a folder to list references' : 'Choose local reference files', properties: p.folder ? ['openDirectory'] : ['openFile', 'multiSelections'], ...(p.folder ? {} : { filters: [{ name: 'Reference documents', extensions: ['pdf','tex','md','txt'] }] }) });
  return result.canceled ? null : attachments.grant(p.projectId, result.filePaths);
});
handle('attachments:preview', input => { const p = z.object({ projectId: z.string(), selections: attachmentSelectionsSchema }).strict().parse(input); projects.get(p.projectId); return attachments.preview(p.projectId, p.selections); });
handle('attachments:remove', input => { const p = z.object({ projectId: z.string(), id: z.string().uuid() }).strict().parse(input); projects.get(p.projectId); return attachments.remove(p.projectId, p.id); });
handle('attachments:clear', id => attachments.clear(z.string().parse(id)));
handle('references:state', id => references.state(z.string().parse(id)));
handle('references:add', async input => {
  const p = z.object({ projectId: z.string(), folder: z.boolean() }).strict().parse(input); projects.get(p.projectId);
  const result = await dialog.showOpenDialog(window!, { title: p.folder ? 'Attach a reference folder for this paper' : 'Attach reference files for this paper', properties: p.folder ? ['openDirectory'] : ['openFile', 'multiSelections'], ...(p.folder ? {} : { filters: [{ name: 'Reference documents', extensions: ['pdf','tex','md','markdown','txt'] }] }) });
  return result.canceled ? null : references.add(p.projectId, result.filePaths);
});
handle('references:change', input => { const p = z.object({ projectId: z.string(), id: z.string().uuid(), enabled: z.boolean().nullable() }).strict().parse(input); return references.change(p.projectId, p.id, p.enabled); });
handle('references:sources', id => references.history(z.string().parse(id)));
handle('codex:feedback', input => codex.convertFeedback(feedbackRequestSchema.parse(input), message => window?.webContents.send('codex:progress', message)));
handle('feedback:list', id => codex.feedback.list(z.string().parse(id)));
handle('codex:review', input => { const p = textInput.extend({ from: z.number().int().nonnegative(), to: z.number().int().nonnegative(), instructions: z.string().max(10000), attachmentPreviewId: attachmentPreviewIdSchema.optional(), requestId: z.string().uuid().optional() }).parse(input); return codex.review(p, message => window?.webContents.send('codex:progress', message)); });
handle('codex:reply', input => { const p = textInput.extend({ comment: commentSchema, message: z.string().min(1).max(10000), attachmentPreviewId: attachmentPreviewIdSchema.optional(), requestId: z.string().uuid().optional(), deeper: z.boolean().optional() }).parse(input); return codex.reply(p, message => window?.webContents.send('codex:progress', message)); });
handle('codex:waiting', id => codex.results.list(z.string().parse(id)));
handle('chat:state', input => helpChat.state(chatScopeSchema.parse(input)));
handle('chat:clear', input => helpChat.clear(chatScopeSchema.parse(input)));
handle('chat:retry', input => helpChat.retry(chatScopeSchema.parse(input)));
handle('chat:preview', input => {
  const parsed = chatInputSchema.parse(input);
  parsed.images = parsed.images.map(normalizeChatImage);
  return helpChat.preview(parsed);
});
handle('codex:chat', input => {
  const parsed = chatScopeSchema.extend({ previewId: z.string().uuid() }).strict().parse(input);
  return helpChat.send({ projectId: parsed.projectId }, parsed.previewId, message => window?.webContents.send('codex:progress', message));
});
handle('codex:acknowledge', input => { const p = z.object({ projectId: z.string(), resultId: z.string().uuid(), outcome: z.enum(['adopted', 'dismissed']) }).parse(input); return codex.results.acknowledge(p.projectId, p.resultId, p.outcome); });
handle('codex:cancel', () => { buildHelp.cancel(); return Promise.all([helpChat.cancel(), codex.cancel()]); });
handle('codex:preamble', input => codex.preamble(preambleRequestSchema.parse(input), message => window?.webContents.send('codex:progress', message)));
async function finishClose() {
  await Promise.all([compiler.stop(), helpChat.cancel(), codex.cancel(), attachments.stop()]);
  // A finished model process can still have an answer being validated/written.
  await Promise.all([codex.settle(), helpChat.settle()]); await projects.settle();
  closing = true; window?.close();
}
handle('window:close-ready', finishClose);

async function createWindow() {
  window = new BrowserWindow({ width: 1450, height: 960, minWidth: 960, minHeight: 640, title: 'Modern Codex Editor', backgroundColor: '#f7f8f6', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (url !== documentURL) event.preventDefault(); });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.on('console-message', details => { if (['warning', 'error'].includes(details.level)) console.error('Renderer:', details.message); });
  window.webContents.on('render-process-gone', () => { rendererGone = true; void Promise.all([compiler.stop(), helpChat.cancel(), codex.cancel(), attachments.stop()]).catch(console.error); });
  window.on('close', event => { if (!closing) { event.preventDefault(); if (rendererGone) void finishClose().catch(console.error); else window?.webContents.send('window:close-requested'); } });
  window.on('closed', () => { window = null; });
  await window.loadFile(documentFile);
  console.log('Modern Codex Editor ready. Local interface; no HTTP server.');
}
if (primaryInstance) app.whenReady().then(async () => {
  const storage = await prepareRuntimeStorage({ directory: runtime, isolated: runtimeOverride !== undefined, legacyDirectory: app.isPackaged ? userData : path.join(app.getAppPath(), '.runtime') });
  storageNotices = storage.notices;
  const settings = await tools.load();
  compiler.setLatexmk(settings.settings.latexmkPath); codex.client.setBinary(settings.settings.codexPath);
  storageNotices.push(...settings.notices);
  app.setAboutPanelOptions({ applicationName: 'Modern Codex Editor', applicationVersion: app.getVersion() });
  const menu: Electron.MenuItemConstructorOptions[] = [
    { label: 'Modern Codex Editor', submenu: [{ role: 'about' }, { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => send('settings') }, { type: 'separator' }, { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => window?.close() }] },
    { label: 'File', submenu: [{ label: 'Open paper…', accelerator: 'CmdOrCtrl+O', click: () => send('open') }, { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => send('save') }, { label: 'Compile', accelerator: 'CmdOrCtrl+B', click: () => send('compile') }, { label: 'Compile (alternate shortcut)', accelerator: 'CmdOrCtrl+T', click: () => send('compile') }, { type: 'separator' }, { role: 'close' }] },
    { label: 'Edit', submenu: [
      // Source edits and review decisions share CodeMirror history, including menu shortcuts.
      { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => send('undo') },
      { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: () => send('redo') },
      { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'pasteAndMatchStyle' }, { role: 'delete' }, { type: 'separator' }, { role: 'selectAll' }
    ] }, { label: 'Find', submenu: [{ label: 'Find in focused pane…', accelerator: 'CmdOrCtrl+F', click: () => send('find') }] }, { label: 'View', submenu: [{ label: 'Toggle PDF', accelerator: 'CmdOrCtrl+Shift+P', click: () => send('pdf') }, { label: 'Show/hide toolbar', accelerator: 'CmdOrCtrl+Shift+M', click: () => send('toolbar') }, { label: 'Focus source', accelerator: 'CmdOrCtrl+1', click: () => send('focus-source') }, { label: 'Focus comments', accelerator: 'CmdOrCtrl+2', click: () => send('focus-comments') }, { label: 'Show/hide comments', click: () => send('comments') }, { label: 'Codex Side Chat…', accelerator: 'CmdOrCtrl+Shift+H', click: () => send('help-chat') }, { label: 'Help and shortcuts…', click: () => send('help') }, { role: 'toggleDevTools' }, { role: 'togglefullscreen' }] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menu));
  await createWindow();
}).catch(error => { console.error(error); dialog.showErrorBox('Modern Editor could not start', String(error instanceof Error ? error.message : error) + '\nOriginal files were preserved. Check the storage location and permissions before trying again.'); app.exit(1); });
app.on('window-all-closed', () => app.quit());
