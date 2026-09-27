import { z } from 'zod';

export const debugSettingsSchema = z.object({ enabled: z.boolean(), screenshots: z.boolean(), screenshotSeconds: z.number().int().min(30).max(600) }).strict();
export const defaultDebugSettings = { enabled: false, screenshots: true, screenshotSeconds: 60 };
export const debugInteractionSchema = z.object({
  action: z.enum(['comment-select', 'accept', 'reject', 'resolve', 'comment-navigation', 'later', 'undo', 'redo', 'discussion-open', 'discussion', 'use-wording', 'viewer-mode', 'changes-refresh', 'changes-navigate', 'changes-why', 'proposal-preview']),
  projectId: z.string().max(200).optional(), commentId: z.string().max(200).optional(),
  mode: z.string().max(40).optional(), outcome: z.enum(['started', 'complete', 'error', 'cancelled']).optional(),
  elapsedMs: z.number().finite().nonnegative().max(86400000).optional()
}).strict();
export type DebugInteraction = z.infer<typeof debugInteractionSchema>;
export type DebugSettings = z.infer<typeof debugSettingsSchema>;
export const debugEntrySchema = z.object({ id: z.string().uuid(), createdAt: z.string(), kind: z.enum(['prompt', 'reply', 'event', 'screenshot', 'request-error']), label: z.string().max(200), file: z.string().regex(/^[a-f0-9-]{36}\.(json|png|jpg)$/), bytes: z.number().int().nonnegative() }).strict();
export type DebugEntry = z.infer<typeof debugEntrySchema>;
export type DebugState = { settings: DebugSettings; directory: string; entries: DebugEntry[]; bytes: number; limitBytes: number; notice: string };
