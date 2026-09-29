import type { FeedbackRequest, FeedbackRecord, FeedbackList } from './feedback.ts';
import type { PrepareFeedback, ResumeFeedback } from './feedback-batches.ts';
import type { AttachmentInventory, AttachmentPreview, AttachmentSelection } from './attachments.ts';
import type { ToolSettings, ToolSettingsState, SetupCheck, CopiedSetupDetails } from './tool-settings.ts';
import { editPreferencesSchema } from './paper-guidance.ts';
import type { ReferenceState, SourcesHistory } from './references.ts';
import { z } from 'zod';
import { assertRecoveryFits, serializeJSON } from './persistence.ts';

function boundedJSON(value: unknown, ctx: z.RefinementCtx) {
  try { serializeJSON(value); }
  catch (error) { ctx.addIssue({ code: 'custom', message: error instanceof Error ? error.message : String(error) }); }
}

const packageListSchema = z.array(z.string().regex(/^[a-zA-Z][a-zA-Z0-9-]*$/, 'Use a plain LaTeX package name.')).max(10);
export const replyActionSchema = z.enum(['standard', 'quick', 'quick-alternative', 'alternatives', 'reconsider']);
export type ReplyAction = z.infer<typeof replyActionSchema>;
export const replyAlternativeSchema = z.object({ label: z.string().min(1).max(100), reason: z.string().max(2000), replacement: z.string().max(100000), packages: packageListSchema }).strict();
export const savedAlternativeSchema = replyAlternativeSchema.extend({
  id: z.string().min(1).max(200), original: z.string().max(100000).optional(),
  draft: z.string().max(100000).optional()
});
export const codexReplySchema = z.object({ reply: z.string().max(100000), replacement: z.string().max(100000).nullable(), packages: packageListSchema, alternatives: z.array(replyAlternativeSchema).max(3).optional() });
export const messageSchema = z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(100000), createdAt: z.string(), resultId: z.string().uuid().optional(), proposalOriginal: z.string().max(100000).optional(), proposal: z.object({ replacement: z.string().max(100000).nullable(), packages: packageListSchema }).optional() });
export const commentSchema = z.object({
  id: z.string().min(1).max(200), category: z.string().max(100).default('Clarity'),
  title: z.string().max(300), explanation: z.string().max(100000),
  original: z.string().max(100000), replacement: z.string().max(100000).nullable(),
  questionOriginal: z.string().max(100000).optional(),
  before: z.string().max(2000).default(''), after: z.string().max(2000).default(''),
  from: z.number().int().nonnegative().default(0), to: z.number().int().nonnegative().default(0),
  decision: z.enum(['open', 'applied', 'dismissed', 'resolved']).default('open'),
  later: z.boolean().default(false),
  validity: z.enum(['current', 'stale', 'ambiguous', 'missing', 'unconfirmed']).default('missing'),
  draft: z.string().max(100000).nullable().optional().transform(value => value ?? undefined), appliedText: z.string().max(100000).optional(),
  packages: packageListSchema.default([]),
  alternatives: z.array(savedAlternativeSchema).max(30).optional(),
  selectedAlternativeId: z.string().min(1).max(200).optional(),
  messages: z.array(messageSchema).max(500).default([]), replyDraft: z.string().max(100000).default(''),
  reviewedSourceHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), reviewedAt: z.string().datetime().optional()
}).superRefine((c, ctx) => {
  const options = c.alternatives ?? [];
  if (new Set(options.map(a => a.id)).size !== options.length) ctx.addIssue({ code: 'custom', message: 'Wording IDs must be unique within each comment.' });
  if (c.selectedAlternativeId && !options.some(a => a.id === c.selectedAlternativeId && a.replacement === c.replacement && (a.original === undefined || a.original === c.original) && JSON.stringify([...a.packages].sort()) === JSON.stringify([...c.packages].sort()))) ctx.addIssue({ code: 'custom', message: 'The selected wording must match the comment proposal and passage.' });
});
export const commentsSchema = z.array(commentSchema).max(2000).superRefine((comments, ctx) => {
  if (new Set(comments.map(c => c.id)).size !== comments.length) ctx.addIssue({ code: 'custom', message: 'Comment IDs must be unique' });
  boundedJSON(comments, ctx);
});
export const reviewSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2)]), rootFile: z.string().max(500), sourceHash: z.string(),
  activeId: z.string().nullable(), comments: commentsSchema, updatedAt: z.string()
}).transform(value => ({ ...value, schemaVersion: value.comments.some(c => c.alternatives?.length) ? 2 as const : value.schemaVersion })).superRefine(boundedJSON);
export const bufferSchema = z.object({ projectId: z.string(), text: z.string().max(2000000), review: reviewSchema }).superRefine((value, ctx) => {
  try { assertRecoveryFits(value.text, value.review); }
  catch (error) { ctx.addIssue({ code: 'custom', message: error instanceof Error ? error.message : String(error) }); }
});
export type Comment = z.infer<typeof commentSchema>;
export type Review = z.infer<typeof reviewSchema>;
export type BufferInput = z.infer<typeof bufferSchema>;
export const engineSchema = z.enum(['pdflatex', 'lualatex', 'xelatex']);
export type Engine = z.infer<typeof engineSchema>;
const fractionSchema = z.number().finite().min(0).max(1);
export const workspaceSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.object({ anchor: z.number().int().min(0).max(2000000), head: z.number().int().min(0).max(2000000), topLine: z.number().int().min(1).max(2000001), offset: z.number().finite().min(-2000).max(10000000) }),
  pdf: z.object({ page: z.number().int().min(1).max(100000), zoom: z.union([z.literal(1), z.literal(1.25), z.literal(1.5), z.literal(2)]), scrollX: fractionSchema, scrollY: fractionSchema, flow: z.boolean().optional() }),
  pdfBuildId: z.string().uuid().nullable(), pdfOpen: z.boolean(), commentsHidden: z.boolean().default(false),
  paneSizes: z.tuple([fractionSchema, fractionSchema, fractionSchema]).refine(v => v.every(n => n >= .05) && Math.abs(v.reduce((a, b) => a + b, 0) - 1) < .001, 'Invalid pane proportions'),
  layout: z.enum(['auto', 'three', 'source-comments', 'pdf-comments', 'writing', 'stacked']).default('auto'), compactTab: z.enum(['source', 'pdf']).default('source'), displayName: z.string().trim().max(80).default(''),
  classic: z.boolean().default(false), classicSurface: z.enum(['source', 'pdf']).default('source'),
  autoAddComments: z.boolean().default(true),
  changesOpen: z.boolean().default(true), toolbarCollapsed: z.boolean(), followComments: z.boolean(), reviewView: z.enum(['pending', 'later', 'history'])
});
export type WorkspaceState = z.infer<typeof workspaceSchema>;
export function defaultWorkspace(): WorkspaceState {
  return { schemaVersion: 1, autoAddComments: true, classic: false, classicSurface: 'source', source: { anchor: 0, head: 0, topLine: 1, offset: 0 }, pdf: { page: 1, zoom: 1, scrollX: 0, scrollY: 0 }, pdfBuildId: null, pdfOpen: false, commentsHidden: false, paneSizes: [.28, .33, .39], layout: 'auto', compactTab: 'source', displayName: '', changesOpen: true, toolbarCollapsed: false, followComments: true, reviewView: 'pending' };
}
export const effortSchema = z.enum(['low', 'medium', 'high', 'max']);
export type Effort = z.infer<typeof effortSchema>;
export const fastModeSchema = z.boolean();
export const paperReviewSettingsSchema = z.object({
  engine: engineSchema.default('pdflatex'), effort: effortSchema.default('medium'), fastMode: fastModeSchema.default(false),
  ...editPreferencesSchema.shape
}).strict();
export type PaperReviewSettings = z.infer<typeof paperReviewSettingsSchema>;
export const defaultPaperReviewSettings = (): PaperReviewSettings => paperReviewSettingsSchema.parse({});
export const paperInstructionsSchema = z.string().max(10000);
export const baselineSchema = z.object({ schemaVersion: z.literal(1), rootFile: z.string().max(500), name: z.string().trim().min(1).max(200), text: z.string().max(2000000), sourceHash: z.string().regex(/^[a-f0-9]{64}$/), createdAt: z.string().datetime(), sourcePath: z.string().max(10000).nullable() });
export type Baseline = z.infer<typeof baselineSchema>;
export const historyBudgetSchema = z.number().int().min(1000000).max(1000000000);
export type SavedVersion = { id: string; createdAt: string; bytes: number; protectedReason: string | null };
export type VersionHistory = { versions: SavedVersion[]; folderBytes: number; protectedBytes: number; budgetBytes: number; notices: string[] };
export const preambleProposalSchema = z.object({ explanation: z.string().max(4000), preamble: z.string().max(32000), ending: z.string().max(2000), needsInput: z.string().max(4000).nullable() });
export type PreambleProposal = z.infer<typeof preambleProposalSchema>;
export const preambleRequestSchema = z.object({ projectId: z.string(), text: z.string().min(1).max(120000), engine: engineSchema, previousAttempt: z.object({ proposal: preambleProposalSchema, log: z.string().max(16000) }).optional() });
export type PreambleRequest = z.infer<typeof preambleRequestSchema>;
export type Project = { id: string; path: string; name: string; text: string; diskHash: string; review: Review; recovered: boolean; notices: string[]; engine: Engine; effort: Effort; fastMode: boolean; paperInstructions: string; editPreferences?: import('./paper-guidance.ts').EditPreferences; baseline: Baseline | null; sessionBaseline?: Baseline; workspace?: WorkspaceState; restoredPdf?: { build: Build; text: string } };
export type Diagnostic = { severity: 'error' | 'warning'; message: string; line?: number; file?: string };
export type BuildInputLimits = { maxBytes: number; maxFiles: number };
export type BuildInputPreparation = { status: 'needs-selection'; reason: string; issues: string[]; requiredPaths: string[]; requiredBytes?: number; requiredFiles?: number; selectedBytes?: number; selectedFiles?: number; inventory: { paths: { relative: string; size: number }[]; truncated: boolean; visitedEntries: number }; limits: BuildInputLimits };
export type BuildInputSelection = { mode: 'folder' | 'dependencies' | 'explicit'; fileCount: number; totalBytes: number; unresolvedIssues?: string[] };
export type Build = { purpose?: 'paper' | 'proposal' | 'comparison'; id: string; engine: Engine; success: boolean; clean: boolean; dependenciesVerified?: boolean; sourceHash: string; diagnostics: Diagnostic[]; log: string; elapsedMs: number; inputPreparation?: BuildInputPreparation; inputSelection?: BuildInputSelection };
export const pdfRequestSchema = z.object({ projectId: z.string(), buildId: z.string(), text: z.string().max(2000000), from: z.number().int().nonnegative(), to: z.number().int().nonnegative() });
export type PdfRequest = z.infer<typeof pdfRequestSchema>;
export type BuildValidation = { status: 'valid' | 'changed' | 'deferred' | 'unavailable' };
export type PdfLocation = { kind: 'mapped'; buildId: string; page: number; x: number; y: number; width: number; height: number } | { kind: 'compile' | 'unavailable'; reason: string };
export type ReviewRequest = { projectId: string; text: string; from: number; to: number; instructions: string; localEditsOnly?: boolean; autoAddComments?: boolean; attachmentPreviewId?: string; requestId?: string };
export type ReplyRequest = { projectId: string; text: string; comment: Comment; message: string; requestId?: string; attachmentPreviewId?: string; deeper?: boolean; action?: ReplyAction };
export type CodexReply = z.infer<typeof codexReplySchema>;
const resultBase = { schemaVersion: z.union([z.literal(1), z.literal(2)]), id: z.string().uuid(), rootFile: z.string().max(500), sourceHash: z.string().regex(/^[a-f0-9]{64}$/), createdAt: z.string().datetime() };
export const resultSchema = z.discriminatedUnion('kind', [
  z.object({ ...resultBase, kind: z.literal('review'), comments: commentsSchema, autoAddComments: z.boolean().optional() }),
  z.object({ ...resultBase, kind: z.literal('reply'), commentId: z.string().min(1).max(200), original: z.string().max(100000), answer: codexReplySchema })
]).transform(value => (value.kind === 'review' ? value.comments.some(c => c.alternatives?.length) : value.answer.alternatives?.length)
  ? { ...value, schemaVersion: 2 as const } : value).superRefine(boundedJSON);
export type WaitingResult = z.infer<typeof resultSchema>;
export type SourceRecovery = { name: string; choices: { label: string; text: string }[]; notices: string[] };
export type EditorAPI = {
  projectFiles(projectId: string): Promise<import('./project-files.ts').ProjectFiles>;
  fileAction(projectId: string, id: string, action: 'reveal' | 'copy'): Promise<void>;
  exportPdf(projectId: string, buildId: string): Promise<import('./project-files.ts').PdfExport | null>;
  debugState(): Promise<import('./debugging.ts').DebugState>;
  debugInteraction(event: import('./debugging.ts').DebugInteraction): Promise<void>;
  configureDebug(settings: import('./debugging.ts').DebugSettings): Promise<import('./debugging.ts').DebugState>;
  deleteDebug(ids: string[] | 'all'): Promise<import('./debugging.ts').DebugState>;
  openDebugFolder(): Promise<void>;
  changesSettings(every?: number): Promise<{ every: number }>;
  planChanges(input: import('./changes-pdf.ts').ChangesInput): Promise<{ id?: string }>;
  checkChangesVisual(projectId: string, artifactId: string, screenshots: import('./changes-agent.ts').ChangesScreenshot[]): Promise<import('./changes-agent.ts').ChangesVisual>;
  pendingChats(): Promise<import('./help-chat.ts').PendingChat[]>;
  pendingChat(id: string): Promise<import('./help-chat.ts').PendingChatReply>;
  recoverChat(input: { id: string; action: 'retry' | 'copy' | 'discard' }): Promise<void>;
  chatState(scope: import('./help-chat.ts').ChatScope): Promise<import('./help-chat.ts').ChatState>;
  clearChat(scope: import('./help-chat.ts').ChatScope): Promise<void>;
  retryChat(scope: import('./help-chat.ts').ChatScope): Promise<import('./help-chat.ts').ChatState>;
  previewChat(input: import('./help-chat.ts').ChatInput): Promise<import('./help-chat.ts').ChatPreview>;
  sendChat(scope: import('./help-chat.ts').ChatScope, previewId: string): Promise<import('./help-chat.ts').ChatTurn>;
  openProject(): Promise<Project | null>;
  resumeProject(): Promise<Project | null>;
  closeProject(projectId: string): Promise<void>;
  openDemo(): Promise<Project>;
  openDraft(): Promise<Project | null>;
  getSetup(): Promise<ToolSettingsState>;
  chooseTool(tool: 'codex' | 'latexmk'): Promise<string | null>;
  saveSetup(settings: ToolSettings): Promise<ToolSettingsState>;
  setPaperReviewSettings(projectId: string, settings: PaperReviewSettings): Promise<void>;
  checkSetup(settings: ToolSettings): Promise<SetupCheck>;
  listCodexModels(settings: ToolSettings): Promise<import('./codex-models.ts').CodexModel[]>;
  copySetupDetails(settings: ToolSettings): Promise<CopiedSetupDetails>;
  copyReviewPrompt(text: string): Promise<void>;
  attachmentInventory(projectId: string): Promise<AttachmentInventory>;
  chooseAttachments(projectId: string, folder: boolean): Promise<AttachmentInventory | null>;
  previewAttachments(projectId: string, selections: AttachmentSelection[]): Promise<AttachmentPreview>;
  removeAttachment(projectId: string, id: string): Promise<AttachmentInventory>;
  clearAttachments(projectId: string): Promise<void>;
  referenceState(projectId: string): Promise<ReferenceState>;
  addReferences(projectId: string, folder: boolean): Promise<ReferenceState | null>;
  pasteContext(projectId: string, input: import('./references.ts').PastedContext): Promise<ReferenceState>;
  inspectContext(projectId: string, id: string): Promise<import('./references.ts').PastedContext>;
  renameContext(projectId: string, id: string, name: string): Promise<ReferenceState>;
  copyContext(projectId: string, id: string): Promise<void>;
  changeReference(projectId: string, id: string, enabled: boolean | null): Promise<ReferenceState>;
  sourcesUsed(projectId: string): Promise<SourcesHistory>;
  convertFeedback(input: FeedbackRequest): Promise<FeedbackRecord>;
  prepareFeedback(input: PrepareFeedback): Promise<FeedbackRecord>;
  resumeFeedback(input: ResumeFeedback): Promise<FeedbackRecord>;
  savedFeedback(projectId: string): Promise<FeedbackList>;
  exportSource(input: { name: string; text: string; format?: 'tex' | 'txt' }): Promise<string | null>;
  inspectRecovery(): Promise<SourceRecovery | null>;
  persist(input: BufferInput): Promise<void>;
  save(input: BufferInput): Promise<{ diskHash: string; baseline?: Baseline | null; historyNotice?: string }>;
  setEngine(projectId: string, engine: Engine): Promise<void>;
  setEffort(projectId: string, effort: Effort): Promise<void>;
  setFastMode(projectId: string, fastMode: boolean): Promise<void>;
  setPaperInstructions(projectId: string, instructions: string): Promise<void>;
  setPaperGuidance(projectId: string, instructions: string, preferences: import('./paper-guidance.ts').EditPreferences): Promise<void>;
  setWorkspace(projectId: string, workspace: WorkspaceState): Promise<void>;
  pinBaseline(input: { projectId: string; name: string; text: string }): Promise<Baseline>;
  chooseBaseline(projectId: string): Promise<Baseline | null>;
  versionHistory(projectId: string): Promise<VersionHistory>;
  compareSavedVersion(projectId: string, versionId: string): Promise<Baseline>;
  deleteSavedVersion(projectId: string, versionId: string): Promise<VersionHistory>;
  setHistoryBudget(projectId: string, bytes: number): Promise<VersionHistory>;
  reload(projectId: string): Promise<Project>;
  importReview(projectId: string, text: string): Promise<Review | null>;
  buildChanges(input: import('./changes-pdf.ts').ChangesInput): Promise<import('./changes-pdf.ts').ChangesArtifact>;
  presentChanges(projectId: string, artifactId: string, presentation: import('./changes-pdf.ts').ChangesPresentation): Promise<import('./changes-pdf.ts').ChangesArtifact>;
  inspectChanges(projectId: string, artifactId: string): Promise<BuildValidation>;
  locateChange(projectId: string, artifactId: string, changeId: string): Promise<PdfLocation>;
  prepareArrangement(input: import('./changes-pdf.ts').ChangesInput): Promise<import('./changes-pdf.ts').ArrangementPreview>;
  arrangeChanges(input: import('./changes-pdf.ts').ChangesInput, previewId: string): Promise<{ id: string; changes: import('./changes-pdf.ts').ComparisonChange[] }>;
  compile(input: { projectId: string; text: string; engine: Engine; purpose?: 'paper' | 'proposal'; selectedPaths?: string[]; limits?: BuildInputLimits }): Promise<Build>;
  previewBuildHelp(input: { projectId: string; text: string }): Promise<import('./build-input-help.ts').BuildInputHelpPreview>;
  askBuildHelp(input: { projectId: string; text: string; previewId: string }): Promise<import('./build-input-help.ts').BuildInputHelpResult>;
  inspectBuild(input: { projectId: string; buildId: string; text: string }): Promise<BuildValidation>;
  validateBuild(input: { projectId: string; buildId: string; text: string }): Promise<boolean>;
  getPdf(buildId: string): Promise<Uint8Array>;
  locatePdf(input: PdfRequest): Promise<PdfLocation>;
  cancelBuild(): Promise<void>;
  clearOldBuilds(keepIds: string[]): Promise<{ removed: number; retained: number }>;
  requestReview(input: ReviewRequest): Promise<Comment[]>;
  replyToComment(input: ReplyRequest): Promise<CodexReply>;
  waitingResults(projectId: string): Promise<{ items: WaitingResult[]; notices: string[] }>;
  acknowledgeResult(input: { projectId: string; resultId: string; outcome: 'adopted' | 'dismissed' }): Promise<void>;
  generatePreamble(input: PreambleRequest): Promise<PreambleProposal>;
  cancelCodex(): Promise<void>;
  onCodexProgress(callback: (message: string) => void): () => void;
  finishClose(): Promise<void>;
  onCloseRequested(callback: () => void): () => void;
  onCommand(callback: (command: string) => void): () => void;
};
declare global { interface Window { editor: EditorAPI } }
