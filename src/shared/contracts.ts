import type { FeedbackRequest, FeedbackRecord, FeedbackList } from './feedback.ts';
import type { AttachmentInventory, AttachmentPreview, AttachmentSelection } from './attachments.ts';
import type { ToolSettings, ToolSettingsState, SetupCheck, CopiedSetupDetails } from './tool-settings.ts';
import type { ReferenceState, SourcesHistory } from './references.ts';
import { z } from 'zod';
import { assertRecoveryFits, serializeJSON } from './persistence.ts';

function boundedJSON(value: unknown, ctx: z.RefinementCtx) {
  try { serializeJSON(value); }
  catch (error) { ctx.addIssue({ code: 'custom', message: error instanceof Error ? error.message : String(error) }); }
}

const packageListSchema = z.array(z.string().regex(/^[a-zA-Z][a-zA-Z0-9-]*$/, 'Use a plain LaTeX package name.')).max(10);
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
  messages: z.array(messageSchema).max(500).default([]), replyDraft: z.string().max(100000).default(''),
  reviewedSourceHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), reviewedAt: z.string().datetime().optional()
});
export const commentsSchema = z.array(commentSchema).max(2000).superRefine((comments, ctx) => {
  if (new Set(comments.map(c => c.id)).size !== comments.length) ctx.addIssue({ code: 'custom', message: 'Comment IDs must be unique' });
  boundedJSON(comments, ctx);
});
export const reviewSchema = z.object({
  schemaVersion: z.literal(1), rootFile: z.string().max(500), sourceHash: z.string(),
  activeId: z.string().nullable(), comments: commentsSchema, updatedAt: z.string()
}).superRefine(boundedJSON);
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
  toolbarCollapsed: z.boolean(), followComments: z.boolean(), reviewView: z.enum(['pending', 'later', 'history'])
});
export type WorkspaceState = z.infer<typeof workspaceSchema>;
export function defaultWorkspace(): WorkspaceState {
  return { schemaVersion: 1, source: { anchor: 0, head: 0, topLine: 1, offset: 0 }, pdf: { page: 1, zoom: 1, scrollX: 0, scrollY: 0 }, pdfBuildId: null, pdfOpen: false, commentsHidden: false, paneSizes: [.28, .33, .39], toolbarCollapsed: false, followComments: true, reviewView: 'pending' };
}
export const effortSchema = z.enum(['low', 'medium', 'high', 'max']);
export type Effort = z.infer<typeof effortSchema>;
export const fastModeSchema = z.boolean();
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
export type Project = { id: string; path: string; name: string; text: string; diskHash: string; review: Review; recovered: boolean; notices: string[]; engine: Engine; effort: Effort; fastMode: boolean; paperInstructions: string; baseline: Baseline | null; workspace?: WorkspaceState; restoredPdf?: { build: Build; text: string } };
export type Diagnostic = { severity: 'error' | 'warning'; message: string; line?: number; file?: string };
export type BuildInputLimits = { maxBytes: number; maxFiles: number };
export type BuildInputPreparation = { status: 'needs-selection'; reason: string; issues: string[]; requiredPaths: string[]; requiredBytes?: number; requiredFiles?: number; selectedBytes?: number; selectedFiles?: number; inventory: { paths: { relative: string; size: number }[]; truncated: boolean; visitedEntries: number }; limits: BuildInputLimits };
export type BuildInputSelection = { mode: 'folder' | 'dependencies' | 'explicit'; fileCount: number; totalBytes: number; unresolvedIssues?: string[] };
export type Build = { id: string; engine: Engine; success: boolean; clean: boolean; dependenciesVerified?: boolean; sourceHash: string; diagnostics: Diagnostic[]; log: string; elapsedMs: number; inputPreparation?: BuildInputPreparation; inputSelection?: BuildInputSelection };
export const pdfRequestSchema = z.object({ projectId: z.string(), buildId: z.string(), text: z.string().max(2000000), from: z.number().int().nonnegative(), to: z.number().int().nonnegative() });
export type PdfRequest = z.infer<typeof pdfRequestSchema>;
export type PdfLocation = { kind: 'mapped'; buildId: string; page: number; x: number; y: number; width: number; height: number } | { kind: 'compile' | 'unavailable'; reason: string };
export type ReviewRequest = { projectId: string; text: string; from: number; to: number; instructions: string; attachmentPreviewId?: string; requestId?: string };
export type ReplyRequest = { projectId: string; text: string; comment: Comment; message: string; requestId?: string; attachmentPreviewId?: string; deeper?: boolean };
export type CodexReply = { reply: string; replacement: string | null; packages: string[] };
const resultBase = { schemaVersion: z.literal(1), id: z.string().uuid(), rootFile: z.string().max(500), sourceHash: z.string().regex(/^[a-f0-9]{64}$/), createdAt: z.string().datetime() };
export const resultSchema = z.discriminatedUnion('kind', [
  z.object({ ...resultBase, kind: z.literal('review'), comments: commentsSchema }),
  z.object({ ...resultBase, kind: z.literal('reply'), commentId: z.string().min(1).max(200), original: z.string().max(100000), answer: z.object({ reply: z.string().max(100000), replacement: z.string().max(100000).nullable(), packages: packageListSchema }) })
]).superRefine(boundedJSON);
export type WaitingResult = z.infer<typeof resultSchema>;
export type SourceRecovery = { name: string; choices: { label: string; text: string }[]; notices: string[] };
export type EditorAPI = {
  chatState(scope: import('./help-chat.ts').ChatScope): Promise<import('./help-chat.ts').ChatState>;
  clearChat(scope: import('./help-chat.ts').ChatScope): Promise<void>;
  retryChat(scope: import('./help-chat.ts').ChatScope): Promise<import('./help-chat.ts').ChatState>;
  previewChat(input: import('./help-chat.ts').ChatInput): Promise<import('./help-chat.ts').ChatPreview>;
  sendChat(scope: import('./help-chat.ts').ChatScope, previewId: string): Promise<import('./help-chat.ts').ChatTurn>;
  openProject(): Promise<Project | null>;
  resumeProject(): Promise<Project | null>;
  openDemo(): Promise<Project>;
  openDraft(): Promise<Project | null>;
  getSetup(): Promise<ToolSettingsState>;
  chooseTool(tool: 'codex' | 'latexmk'): Promise<string | null>;
  saveSetup(settings: ToolSettings): Promise<ToolSettingsState>;
  checkSetup(settings: ToolSettings): Promise<SetupCheck>;
  copySetupDetails(settings: ToolSettings): Promise<CopiedSetupDetails>;
  attachmentInventory(projectId: string): Promise<AttachmentInventory>;
  chooseAttachments(projectId: string, folder: boolean): Promise<AttachmentInventory | null>;
  previewAttachments(projectId: string, selections: AttachmentSelection[]): Promise<AttachmentPreview>;
  removeAttachment(projectId: string, id: string): Promise<AttachmentInventory>;
  clearAttachments(projectId: string): Promise<void>;
  referenceState(projectId: string): Promise<ReferenceState>;
  addReferences(projectId: string, folder: boolean): Promise<ReferenceState | null>;
  changeReference(projectId: string, id: string, enabled: boolean | null): Promise<ReferenceState>;
  sourcesUsed(projectId: string): Promise<SourcesHistory>;
  convertFeedback(input: FeedbackRequest): Promise<FeedbackRecord>;
  savedFeedback(projectId: string): Promise<FeedbackList>;
  exportSource(input: { name: string; text: string }): Promise<string | null>;
  inspectRecovery(): Promise<SourceRecovery | null>;
  persist(input: BufferInput): Promise<void>;
  save(input: BufferInput): Promise<{ diskHash: string; baseline?: Baseline | null; historyNotice?: string }>;
  setEngine(projectId: string, engine: Engine): Promise<void>;
  setEffort(projectId: string, effort: Effort): Promise<void>;
  setFastMode(projectId: string, fastMode: boolean): Promise<void>;
  setPaperInstructions(projectId: string, instructions: string): Promise<void>;
  setWorkspace(projectId: string, workspace: WorkspaceState): Promise<void>;
  pinBaseline(input: { projectId: string; name: string; text: string }): Promise<Baseline>;
  chooseBaseline(projectId: string): Promise<Baseline | null>;
  versionHistory(projectId: string): Promise<VersionHistory>;
  compareSavedVersion(projectId: string, versionId: string): Promise<Baseline>;
  deleteSavedVersion(projectId: string, versionId: string): Promise<VersionHistory>;
  setHistoryBudget(projectId: string, bytes: number): Promise<VersionHistory>;
  reload(projectId: string): Promise<Project>;
  importReview(projectId: string, text: string): Promise<Review | null>;
  compile(input: { projectId: string; text: string; engine: Engine; selectedPaths?: string[]; limits?: BuildInputLimits }): Promise<Build>;
  previewBuildHelp(input: { projectId: string; text: string }): Promise<import('./build-input-help.ts').BuildInputHelpPreview>;
  askBuildHelp(input: { projectId: string; text: string; previewId: string }): Promise<import('./build-input-help.ts').BuildInputHelpResult>;
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
