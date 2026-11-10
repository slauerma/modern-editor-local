import { z } from 'zod';

export const codexModelIdSchema = z.string().min(1).max(200).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/);
const modelSchema = z.object({
  model: codexModelIdSchema,
  displayName: z.string().max(200).optional(),
  hidden: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  upgrade: codexModelIdSchema.nullable().optional(),
  upgradeInfo: z.object({
    model: codexModelIdSchema,
    retirementAt: z.number().int().min(0).max(8_640_000_000_000).nullable().optional()
  }).nullable().optional(),
  supportedReasoningEfforts: z.array(z.object({ reasoningEffort: z.string().min(1).max(30) })).min(1).max(20),
  inputModalities: z.array(z.string().max(30)).max(10).default(['text', 'image']),
  serviceTiers: z.array(z.object({ id: z.string().max(30) })).max(20).optional(),
  additionalSpeedTiers: z.array(z.string().max(30)).max(20).optional()
});
export type CodexModel = { id: string; name: string; efforts: string[]; images: boolean; fast: boolean; isDefault: boolean;
  hidden?: boolean; upgrade?: string | null; retirementAt?: number | null };

export function parseCodexModel(value: unknown): CodexModel {
  const model = modelSchema.parse(value);
  const tiers = [...(model.serviceTiers ?? []).map(tier => tier.id), ...(model.additionalSpeedTiers ?? [])];
  return { id: model.model, name: model.displayName || model.model,
    efforts: model.supportedReasoningEfforts.map(e => e.reasoningEffort), images: model.inputModalities.includes('image'),
    fast: tiers.some(tier => tier === 'fast' || tier === 'priority'), isDefault: model.isDefault ?? false,
    hidden: model.hidden ?? false, upgrade: model.upgradeInfo?.model ?? model.upgrade ?? null,
    retirementAt: model.upgradeInfo?.retirementAt ?? null };
}
