/*
 * Personal project for LaTeX writing and Codex-assisted revision.
 * Keep it simple, lean, and clean. Production-level completeness is not a goal;
 * unusual edge cases may be handled manually. Always preserve the manuscript.
 */
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } from 'electron';
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
import { CodexClient } from './codex-client.ts';
import { ChangesPdfService } from './changes-pdf.ts';
import { BuildInputHelp } from './build-input-help.ts';
import { buildInputLimitsSchema, buildInputPathsSchema } from '../shared/build-input-help.ts';
import { inspectSourceRecovery, writeSourceCopy } from './source-export.ts';
import { prepareRuntimeStorage, runtimeLocation, createDraftSource } from './runtime-storage.ts';
import { ToolSettingsService, validateExecutable } from './tool-settings.ts';
import { formatSetupDetails, toolSettingsSchema, type ToolSettingsState } from '../shared/tool-settings.ts';
import { verifiedCodexVersions } from './codex-policy.ts';
import { HelpChat } from './help-chat.ts';
import { chatInputSchema, chatScopeSchema } from '../shared/help-chat.ts';
import { normalizeChatImage } from './chat-images.ts';
import { readRegularFile, readJSON, writeJSON } from './files.ts';
import { DebugStore } from './debug-store.ts';
import { debugSettingsSchema } from '../shared/debugging.ts';
import { chatImageSchema } from '../shared/help-chat.ts';
import { managedCodexLocation, managedCodexVersion, verifyManagedCodex } from './managed-codex.ts';
import { editorAuthor, predecessorCredit } from '../shared/editor-credits.ts';

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
const debug = new DebugStore(path.join(runtime, 'debugging'));
codex.client.debugRecord = record => {
  if (!debug.enabled) return;
  if (record.kind === 'screenshot') {
    const data = record.data as { id: string; purpose: string; url: string; index: number };
    const extension = data.url.startsWith('data:image/png;') ? 'png' : 'jpg';
    void debug.record('screenshot', `${data.purpose} input ${data.index + 1} · ${data.id}`, null, { bytes: Buffer.from(data.url.split(',')[1], 'base64'), extension });
  } else void debug.record(record.kind, 'Codex ' + record.kind, record.data);
};
const buildHelp = new BuildInputHelp(projects, compiler, codex);
const changesPdf = new ChangesPdfService(projects, compiler, codex);
const tools = new ToolSettingsService(runtime, undefined, app.getAppPath());
const helpChat = new HelpChat(projects, codex.client, path.join(runtime, 'help-chats'), async () => ({
  version: app.getVersion(), platform: process.platform, osVersion: process.getSystemVersion(),
  documentation: (await Promise.all(['USER_GUIDE.md','SETUP.md','FAQ.md','CHANGELOG.md'].map(async name => `## ${name}\n${(await readRegularFile(path.join(__dirname, 'help', name), 100000)).toString('utf8')}`))).join('\n\n')
}), references);
let storageNotices: string[] = [], setupBusy = false, activeToolOperations = 0;
let setupCatalog: CodexClient | null = null;
let setupCatalogGeneration = 0;
let debugCapture = Promise.resolve(), debugSuspended = false;
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
    try { const result = await action(...args);
      if (['project:save', 'project:close', 'build:compile', 'build:changes'].includes(channel)) void debug.record('event', channel, { outcome: 'complete', at: new Date().toISOString() });
      return result;
    }
    catch (error) {
      if (error instanceof z.ZodError) throw new Error('Invalid review or request data: ' + error.issues.slice(0, 3).map(issue => `${issue.path.join('.') || 'value'}: ${issue.message}`).join(' '));
      if (error instanceof SyntaxError) throw new Error('The JSON file could not be read. Check its syntax; the original file was preserved.');
      if (!channel.startsWith('debug:')) void debug.record('event', channel, { outcome: 'error', message: error instanceof Error ? error.message : String(error) });
      throw error;
    }
    finally { if (toolOperation) activeToolOperations--; }
  });
}
const send = (command: string) => window?.webContents.send('menu:command', command);
handle('debug:state', () => debug.state());
handle('debug:configure', input => debug.configure(debugSettingsSchema.parse(input)));
handle('debug:delete', ids => debug.remove(z.union([z.literal('all'), z.array(z.string().uuid()).max(500)]).parse(ids)));
handle('debug:open', async () => { const state = await debug.state(); if (!state.entries.length && !state.settings.enabled) throw new Error('Enable debugging before opening its folder.'); const error = await shell.openPath(state.directory); if (error) throw new Error(error); });
handle('changes:settings', async value => {
  const file = path.join(runtime, 'changes-settings.json'), schema = z.object({ every: z.number().int().min(1).max(50) }).strict();
  if (value !== undefined) { const settings = schema.parse({ every: value }); await writeJSON(file, settings); return settings; }
  try { return schema.parse(await readJSON(file, 2000)); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { every: 5 }; throw e; }
});
async function restoreWorkspace(p: Project | null) {
  if (p && storageNotices.length) p.notices.push(...storageNotices);
  if (p?.workspace?.pdfBuildId) try { p.restoredPdf = await compiler.restore(p.id, p.workspace.pdfBuildId); }
  catch { p.notices.push('The previous PDF is no longer available or could not be verified. Compile to rebuild it; your saved reading position is kept.'); }
  return p;
}
handle('project:open', async () => {
  const result = await dialog.showOpenDialog(window!, { title: 'Open a LaTeX or text document', properties: ['openFile'], filters: [{ name: 'LaTeX or text document', extensions: ['tex', 'txt'] }] });
  return result.canceled ? null : restoreWorkspace(await projects.open(result.filePaths[0]));
});
handle('project:resume', async () => restoreWorkspace(await projects.resume()));
handle('project:draft', async () => {
  const result = await dialog.showSaveDialog(window!, { title: 'Choose a folder for the new paper', defaultPath: path.join(app.getPath('documents'), 'new-paper.tex'), filters: [{ name: 'LaTeX or text source', extensions: ['tex', 'txt'] }] });
  if (result.canceled || !result.filePath) return null;
  return projects.open(await createDraftSource(result.filePath, app.getAppPath()));
});
async function toolSettingsState(): Promise<ToolSettingsState> {
  const saved = await tools.load();
  const managed = managedCodexLocation(app.getAppPath());
  return { settings: saved.settings, identity: setupIdentity(), runtimePath: runtime, notices: [...storageNotices, ...saved.notices], verifiedCodexVersions: [...verifiedCodexVersions], managedCodex: { version: managed.version, path: managed.path } };
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
    compiler.setLatexmk(saved.latexmkPath); codex.client.setBinary(saved.codexPath, saved.codexSource === 'managed' ? managedCodexVersion : undefined, saved.codexSource === 'managed' ? app.getAppPath() : undefined);
    codex.client.setModel(saved.codexModel ?? null);
    return toolSettingsState();
  } finally { setupBusy = false; }
});
handle('setup:check', async input => {
  const parsed = toolSettingsSchema.parse(input); reserveSetup();
  try { return await tools.check(parsed); } finally { setupBusy = false; }
});
handle('setup:models', async input => {
  const parsed = tools.resolve(input); reserveSetup();
  const generation = setupCatalogGeneration;
  try {
    if (parsed.codexSource === 'managed') await verifyManagedCodex(app.getAppPath());
    else await validateExecutable(parsed.codexPath);
    if (generation !== setupCatalogGeneration) throw new Error('Codex model check cancelled.');
    setupCatalog = new CodexClient(path.join(runtime, 'setup-models'), parsed.codexPath, parsed.codexSource === 'managed' ? managedCodexVersion : undefined, parsed.codexSource === 'managed' ? app.getAppPath() : undefined);
    return await setupCatalog.listModels();
  } finally { setupCatalog = null; setupBusy = false; }
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
  const parsed = z.object({ name: z.string().max(500), text: z.string().max(8000000), format: z.enum(['tex', 'txt']).optional() }).parse(input);
  const extension = parsed.format ?? (parsed.name.toLowerCase().endsWith('.txt') ? 'txt' : 'tex');
  const name = path.basename(parsed.name).replace(/\.(?:tex|txt)$/i, '') + '-copy.' + extension;
  const result = await dialog.showSaveDialog(window!, { title: 'Export source to a new file', defaultPath: name, filters: [{ name: 'Source copy', extensions: [extension] }] });
  if (result.canceled || !result.filePath) return null;
  try { await writeSourceCopy(result.filePath, parsed.text); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('That file already exists. Choose a new filename; export never overwrites an existing file.'); throw error; }
  return result.filePath;
});
handle('source:recover', async () => {
  const result = await dialog.showOpenDialog(window!, { title: 'Inspect source recovery', properties: ['openFile'], filters: [{ name: 'LaTeX or text document', extensions: ['tex', 'txt'] }] });
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
  const result = await dialog.showOpenDialog(window!, { title: 'Choose the original or an older version', properties: ['openFile'], filters: [{ name: 'LaTeX or text source', extensions: ['tex', 'txt'] }] });
  return result.canceled ? null : projects.baselineFromFile(projectId, result.filePaths[0]);
});
handle('project:reload', async id => restoreWorkspace(await projects.open(projects.get(z.string().parse(id)).path)));
handle('review:import', async input => {
  const parsed = textInput.parse(input); projects.get(parsed.projectId);
  const result = await dialog.showOpenDialog(window!, { title: 'Import comments from JSON', properties: ['openFile'], filters: [{ name: 'JSON review', extensions: ['json'] }] });
  return result.canceled ? null : projects.import(result.filePaths[0], parsed.projectId, parsed.text);
});
const changesInput = z.object({ projectId: z.string(), before: z.string().max(2000000), after: z.string().max(2000000), name: z.string().max(200), engine: engineSchema, presentation: z.enum(['markup', 'clean']).optional(), proposalId: z.string().max(200).optional(), layouts: z.record(z.enum(['inline', 'paired'])).refine(v => Object.keys(v).length <= 100).optional(), arrangementId: z.string().uuid().optional(), selectedPaths: buildInputPathsSchema.optional() }).strict();
handle('build:changes', input => changesPdf.build(changesInput.parse(input)));
handle('build:changes-presentation', input => { const p = z.object({ projectId: z.string(), artifactId: z.string().uuid(), presentation: z.enum(['markup', 'clean']) }).strict().parse(input); return changesPdf.present(p.projectId, p.artifactId, p.presentation); });
handle('codex:changes-plan', input => changesPdf.smartPlan(changesInput.parse(input), message => window?.webContents.send('codex:progress', message)));
handle('codex:changes-visual', value => {
  const p = z.object({ projectId: z.string(), artifactId: z.string().uuid(), screenshots: z.array(z.object({ page: z.number().int().min(1).max(10000), dataUrl: chatImageSchema.shape.dataUrl }).strict()).min(1).max(3) }).strict().parse(value);
  const screenshots = p.screenshots.map(s => ({ page: s.page, dataUrl: normalizeChatImage({ id: randomUUID(), name: `comparison-page-${s.page}.png`, dataUrl: s.dataUrl }).dataUrl }));
  return changesPdf.checkVisual(p.projectId, p.artifactId, screenshots, message => window?.webContents.send('codex:progress', message));
});
handle('build:changes-inspect', input => { const p = z.object({ projectId: z.string(), artifactId: z.string().uuid() }).strict().parse(input); return changesPdf.inspect(p.projectId, p.artifactId); });
handle('build:change-location', input => { const p = z.object({ projectId: z.string(), artifactId: z.string().uuid(), changeId: z.string().max(40) }).strict().parse(input); return changesPdf.locate(p.projectId, p.artifactId, p.changeId); });
handle('build:arrange-preview', input => changesPdf.prepare(changesInput.parse(input)));
handle('codex:arrange-changes', value => { const p = z.object({ input: changesInput, previewId: z.string().uuid() }).strict().parse(value); return changesPdf.arrange(p.input, p.previewId, message => window?.webContents.send('codex:progress', message)); });
handle('build:compile', input => { const p = textInput.extend({ engine: engineSchema, purpose: z.enum(['paper', 'proposal']).optional(), selectedPaths: buildInputPathsSchema.optional(), limits: buildInputLimitsSchema.optional() }).strict().parse(input); return compiler.compile(p.projectId, p.text, p.engine, p.selectedPaths, p.limits, p.purpose); });
handle('build:help-preview', input => { const p = textInput.strict().parse(input); return buildHelp.prepare(p.projectId, p.text); });
handle('codex:build-help', input => { const p = textInput.extend({ previewId: z.string().uuid() }).strict().parse(input); return buildHelp.ask(p.projectId, p.text, p.previewId, message => window?.webContents.send('codex:progress', message)); });
handle('build:inspect', input => { const p = textInput.extend({ buildId: z.string() }).parse(input); return compiler.inspect(p.projectId, p.buildId, p.text); });
handle('build:validate', input => { const p = textInput.extend({ buildId: z.string() }).parse(input); return compiler.validate(p.projectId, p.buildId, p.text); });
handle('build:pdf', id => compiler.pdf(z.string().parse(id)));
handle('build:locate', input => compiler.locatePdf(pdfRequestSchema.parse(input)));
handle('build:cancel', () => { buildHelp.cancel(); changesPdf.cancel(); compiler.cancel(); });
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
handle('chat:pending', () => helpChat.pending());
handle('chat:pending-reply', id => helpChat.pendingReply(z.string().regex(/^[a-f0-9]{64}$/).parse(id)));
handle('chat:recover', async input => {
  const p = z.object({ id: z.string().regex(/^[a-f0-9]{64}$/), action: z.enum(['retry', 'copy', 'discard']) }).strict().parse(input);
  if (p.action === 'copy') { clipboard.writeText(JSON.stringify(helpChat.pendingReply(p.id), null, 2)); return; }
  await helpChat.recover(p.id, p.action);
});
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
handle('codex:cancel', () => { buildHelp.cancel(); changesPdf.cancel(); return Promise.all([helpChat.cancel(), codex.cancel()]); });
handle('codex:preamble', input => codex.preamble(preambleRequestSchema.parse(input), message => window?.webContents.send('codex:progress', message)));
function cancelSetupCatalog() { setupCatalogGeneration++; return setupCatalog?.cancel(); }
async function settleWindowWork() {
  debugSuspended = true;
  try {
  changesPdf.cancel();
  await Promise.all([compiler.stop(), helpChat.cancel(), codex.cancel(), attachments.stop(), cancelSetupCatalog()]);
  // A finished model process can still have an answer being validated/written.
  await Promise.all([changesPdf.settle(), codex.settle(), helpChat.settle()]); await projects.settle();
  await debugCapture; await debug.settle();
  } finally { debugSuspended = false; }
}
handle('project:close', async id => {
  const projectId = z.string().parse(id); projects.get(projectId);
  await settleWindowWork();
  await projects.close(projectId);
});
async function finishClose() {
  await settleWindowWork();
  closing = true; window?.close();
}
handle('window:close-ready', finishClose);

async function createWindow() {
  window = new BrowserWindow({ width: 1450, height: 960, minWidth: 960, minHeight: 640, title: 'Modern Codex Editor', backgroundColor: '#f7f8f6', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (url !== documentURL) event.preventDefault(); });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.on('console-message', details => { if (['warning', 'error'].includes(details.level)) console.error('Renderer:', details.message); });
  window.webContents.on('render-process-gone', () => { rendererGone = true; changesPdf.cancel(); void Promise.all([compiler.stop(), helpChat.cancel(), codex.cancel(), attachments.stop(), cancelSetupCatalog()]).catch(console.error); });
  window.on('close', event => { if (!closing) { event.preventDefault(); if (rendererGone) void finishClose().catch(console.error); else window?.webContents.send('window:close-requested'); } });
  window.on('closed', () => { window = null; });
  await window.loadFile(documentFile);
  console.log('Modern Codex Editor ready. Local interface; no HTTP server.');
}
if (primaryInstance) app.whenReady().then(async () => {
  const storage = await prepareRuntimeStorage({ directory: runtime, isolated: runtimeOverride !== undefined, legacyDirectory: app.isPackaged ? userData : path.join(app.getAppPath(), '.runtime') });
  storageNotices = storage.notices;
  const settings = await tools.load();
  compiler.setLatexmk(settings.settings.latexmkPath); codex.client.setBinary(settings.settings.codexPath, settings.settings.codexSource === 'managed' ? managedCodexVersion : undefined, settings.settings.codexSource === 'managed' ? app.getAppPath() : undefined);
  codex.client.setModel(settings.settings.codexModel ?? null);
  storageNotices.push(...settings.notices);
  app.setAboutPanelOptions({ applicationName: 'Modern Codex Editor', applicationVersion: app.getVersion(),
    authors: [editorAuthor], copyright: `© 2026 ${editorAuthor}. MIT license.`, credits: predecessorCredit,
    website: 'https://github.com/slauerma/modern-editor-local' });
  const menu: Electron.MenuItemConstructorOptions[] = [
    { label: 'Modern Codex Editor', submenu: [{ role: 'about' }, { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => send('settings') }, { type: 'separator' }, { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => window?.close() }] },
    { label: 'File', submenu: [{ label: 'Open paper…', accelerator: 'CmdOrCtrl+O', click: () => send('open') }, { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => send('save') }, { label: 'Compile', accelerator: 'CmdOrCtrl+B', click: () => send('compile') }, { label: 'Compile (alternate shortcut)', accelerator: 'CmdOrCtrl+T', click: () => send('compile') }, { type: 'separator' }, { label: 'Close project', click: () => send('close-project') }, { role: 'close' }] },
    { label: 'Edit', submenu: [
      // Source edits and review decisions share CodeMirror history, including menu shortcuts.
      { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => send('undo') },
      { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: () => send('redo') },
      { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'pasteAndMatchStyle' }, { role: 'delete' }, { type: 'separator' }, { role: 'selectAll' }
    ] }, { label: 'Find', submenu: [{ label: 'Find in focused pane…', accelerator: 'CmdOrCtrl+F', click: () => send('find') }] }, { label: 'View', submenu: [{ label: 'Toggle PDF', accelerator: 'CmdOrCtrl+Shift+P', click: () => send('pdf') }, { label: 'Show/hide toolbar', accelerator: 'CmdOrCtrl+Shift+M', click: () => send('toolbar') }, { label: 'Focus source', accelerator: 'CmdOrCtrl+1', click: () => send('focus-source') }, { label: 'Focus comments', accelerator: 'CmdOrCtrl+2', click: () => send('focus-comments') }, { label: 'Show/hide comments', click: () => send('comments') }, { label: 'Codex Side Chat…', accelerator: 'CmdOrCtrl+Shift+H', click: () => send('help-chat') }, { label: 'Help and shortcuts…', click: () => send('help') }, { role: 'toggleDevTools' }, { role: 'togglefullscreen' }] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menu));
  await debug.state();
  await createWindow();
  // Capture only this app's visible content, never the desktop or other apps.
  let capturing = false, lastCapture = 0;
  const debugTimer = setInterval(() => { if (capturing || debugSuspended) return; debugCapture = (async () => {
    if (debugSuspended || capturing || !window || window.isDestroyed() || !window.isVisible() || window.isMinimized() || closing) return;
    capturing = true;
    try {
      const state = await debug.state();
      if (debugSuspended || !state.settings.enabled || !state.settings.screenshots || Date.now() - lastCapture < state.settings.screenshotSeconds * 1000) return;
      lastCapture = Date.now();
      const pixels = await window.webContents.capturePage();
      const bytes = pixels.resize({ width: Math.min(pixels.getSize().width, 1600) }).toJPEG(85);
      await debug.record('screenshot', 'Periodic editor window', null, { bytes, extension: 'jpg' });
    } catch { /* Debug capture must never interrupt editing or closing. */ }
    finally { capturing = false; }
  })(); }, 10000);
  app.once('before-quit', () => clearInterval(debugTimer));
}).catch(error => { console.error(error); dialog.showErrorBox('Modern Editor could not start', String(error instanceof Error ? error.message : error) + '\nOriginal files were preserved. Check the storage location and permissions before trying again.'); app.exit(1); });
app.on('window-all-closed', () => app.quit());
