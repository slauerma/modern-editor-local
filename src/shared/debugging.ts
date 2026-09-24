import { z } from 'zod';

export const debugSettingsSchema = z.object({ enabled: z.boolean(), screenshots: z.boolean(), screenshotSeconds: z.number().int().min(30).max(600) }).strict();
export const defaultDebugSettings = { enabled: false, screenshots: true, screenshotSeconds: 60 };
export type DebugSettings = z.infer<typeof debugSettingsSchema>;
export const debugEntrySchema = z.object({ id: z.string().uuid(), createdAt: z.string(), kind: z.enum(['prompt', 'reply', 'event', 'screenshot', 'request-error']), label: z.string().max(200), file: z.string().regex(/^[a-f0-9-]{36}\.(json|png|jpg)$/), bytes: z.number().int().nonnegative() }).strict();
export type DebugEntry = z.infer<typeof debugEntrySchema>;
export type DebugState = { settings: DebugSettings; directory: string; entries: DebugEntry[]; bytes: number; limitBytes: number; notice: string };
