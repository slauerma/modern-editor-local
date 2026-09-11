import { z } from 'zod';

export const REFERENCE_LIMITS = { roots: 12, calls: 40, characters: 120_000, searchFiles: 12, matches: 12, receipts: 20 } as const;
export type ReferenceRoot = { id: string; name: string; kind: 'file' | 'folder'; enabled: boolean; available: boolean };
export type ReferenceState = { roots: ReferenceRoot[]; notices: string[] };
export const sourceUseSchema = z.object({
  action: z.enum(['read', 'search']), name: z.string().max(500), location: z.string().max(1000),
  hash: z.string().regex(/^[a-f0-9]{64}$/), excerpts: z.array(z.object({ location: z.string().max(500), text: z.string().max(12000) })).max(20),
  notices: z.array(z.string().max(2000)).max(50)
});
export const sourcesReceiptSchema = z.object({
  schemaVersion: z.literal(1), id: z.string().uuid(), createdAt: z.string(), kind: z.enum(['review', 'reply']),
  sourceHash: z.string(), status: z.enum(['complete', 'stopped']), sources: z.array(sourceUseSchema).max(100), notices: z.array(z.string().max(2000)).max(50)
});
export type SourceUse = z.infer<typeof sourceUseSchema>;
export type SourcesReceipt = z.infer<typeof sourcesReceiptSchema>;
export type SourcesHistory = { items: SourcesReceipt[]; notices: string[] };

export const referenceToolNames = ['references_list', 'references_search', 'references_read'] as const;
export const referenceListSchema = z.object({ query: z.string().max(200).optional(), offset: z.number().int().min(0).max(1000).optional() }).strict();
export const referenceSearchSchema = z.object({ query: z.string().trim().min(1).max(200), fileId: z.string().max(100).optional(), offset: z.number().int().min(0).max(1000).optional(), startPage: z.number().int().min(1).max(100000).optional() }).strict();
export const referenceReadSchema = z.object({ fileId: z.string().min(1).max(100), pages: z.string().max(160).optional(), lines: z.string().max(80).optional() }).strict();
