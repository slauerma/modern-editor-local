import { z } from 'zod';
import type { BuildInputLimits, BuildInputPreparation } from './contracts.ts';

export const buildInputLimitsSchema = z.object({ maxBytes: z.number().int().min(1).max(200_000_000), maxFiles: z.number().int().min(1).max(2000) }).strict();
export const buildInputPathsSchema = z.array(z.string().min(1).max(2000)).min(1).max(2000);
export const buildInputAnswerSchema = z.object({ selectedPaths: z.array(z.string().min(1).max(2000)).max(2000), explanation: z.string().max(4000), needsInput: z.string().max(4000).nullable() }).strict();
export const buildInputOutputSchema = { type: 'object', properties: { selectedPaths: { type: 'array', items: { type: 'string' } }, explanation: { type: 'string' }, needsInput: { type: ['string', 'null'] } }, required: ['selectedPaths', 'explanation', 'needsInput'], additionalProperties: false };
export type BuildInputHelpPreview = { id: string; sourceHash: string; prompt: string; notices: string[] };
export type BuildInputHelpResult = z.infer<typeof buildInputAnswerSchema> & { validation: { ready: boolean; issues: string[]; files: number; bytes: number; limits: BuildInputLimits; preparation?: BuildInputPreparation } };
