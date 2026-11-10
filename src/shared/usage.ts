import { z } from 'zod';
import { effortSchema } from './contracts.ts';

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const duration = z.number().finite().nonnegative().max(86400000);
export const tokenUsageSchema = z.object({
  totalTokens: count, inputTokens: count, cachedInputTokens: count,
  outputTokens: count, reasoningOutputTokens: count, cacheWriteInputTokens: count.optional()
});
export const usageRecordSchema = z.object({
  id: z.string().uuid(), createdAt: z.string().datetime(), scope: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  purpose: z.enum(['review', 'discussion', 'changes', 'help', 'anchors']), model: z.string().max(200).nullable(),
  effort: effortSchema, fastMode: z.boolean(), outcome: z.enum(['complete', 'error', 'cancelled']),
  elapsedMs: duration, firstBatchMs: duration.nullable().optional(), firstAnswerMs: duration.nullable(), connectMs: duration.nullable(), setupMs: duration.nullable(),
  tokens: tokenUsageSchema.nullable(),
  commentCount: count.optional(),
  firstUsableMs: duration.nullable().optional(),
  firstUsableDelivery: z.enum(['automatic', 'manual']).optional(),
  reviewMode: z.enum(['fresh', 'continue']).optional(),
  reviewOutcome: z.enum(['complete', 'failed', 'stopped']).optional()
});
export type UsageRecord = z.infer<typeof usageRecordSchema>;
export type TokenUsage = z.infer<typeof tokenUsageSchema>;
export function usageSince(total: TokenUsage, previous: TokenUsage | null): TokenUsage | null {
  if (!previous) return null;
  const delta = Object.fromEntries(Object.entries(total).map(([key, value]) => [key, value - (previous[key as keyof TokenUsage] ?? 0)]));
  const checked = tokenUsageSchema.safeParse(delta);
  return checked.success ? checked.data : null;
}
export const usageHistorySchema = z.object({
  enabled: z.boolean(), since: z.string().datetime(), entries: z.array(usageRecordSchema).max(1000)
});
export type UsageState = z.infer<typeof usageHistorySchema> & { currentScope: string | null; notice: string };
export type AccountLimits = { checkedAt: string; windows: { name: string; usedPercent: number | null; minutes: number | null; resetsAt: number | null }[] };

export function parseAccountLimits(value: unknown): AccountLimits {
  const window = z.object({ usedPercent: z.number().finite(), windowDurationMins: count.nullish(), resetsAt: count.nullish() }).nullable().optional();
  const bucket = z.object({ limitName: z.string().max(160).nullish(), primary: window, secondary: window });
  const result = z.object({ rateLimits: bucket, rateLimitsByLimitId: z.record(z.string(), bucket).nullish() }).parse(value);
  const buckets = result.rateLimitsByLimitId && Object.keys(result.rateLimitsByLimitId).length
    ? Object.entries(result.rateLimitsByLimitId) : [['Codex', result.rateLimits] as const];
  return { checkedAt: new Date().toISOString(), windows: buckets.slice(0, 30).flatMap(([id, b]) =>
    (['primary', 'secondary'] as const).map(key => {
      const w = b[key];
      return { name: (b.limitName || id).slice(0, 160) + ' · ' + (key === 'primary' ? 'Primary' : 'Secondary'),
        usedPercent: w ? Math.max(0, Math.min(100, w.usedPercent)) : null,
        minutes: w?.windowDurationMins ?? null, resetsAt: w?.resetsAt ?? null };
    })) };
}

export function summarizeUsage(entries: readonly UsageRecord[]) {
  const durations = entries.map(r => r.elapsedMs).sort((a, b) => a - b);
  const known = entries.filter(r => r.tokens !== null);
  return { requests: entries.length, complete: entries.filter(r => r.outcome === 'complete').length,
    errors: entries.filter(r => r.outcome === 'error').length, cancelled: entries.filter(r => r.outcome === 'cancelled').length,
    medianMs: durations.length ? (durations[Math.floor((durations.length - 1) / 2)] + durations[Math.floor(durations.length / 2)]) / 2 : null,
    totalTokens: known.length ? known.reduce((sum, r) => sum + r.tokens!.totalTokens, 0) : null, tokenReports: known.length };
}
