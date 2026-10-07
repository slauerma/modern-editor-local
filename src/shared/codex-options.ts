// Defaults for short editorial tasks; explicit paper/chat model choices stay independent.
export const editorialModel = 'gpt-6.1-sol';
export const editorialModelName = 'GPT-6.1 Sol';

export const codexEfforts = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;
export type CodexEffort = typeof codexEfforts[number];
export const effortOptions: Record<CodexEffort, { label: string; minutes: number }> = {
  low: { label: 'Quick', minutes: 3 },
  medium: { label: 'Standard', minutes: 3 },
  high: { label: 'Deep', minutes: 10 },
  xhigh: { label: 'Extra deep', minutes: 15 },
  max: { label: 'Max', minutes: 20 },
  ultra: { label: 'Ultra', minutes: 30 }
};
export function reconsiderEffort(effort: CodexEffort): CodexEffort {
  return codexEfforts.indexOf(effort) < codexEfforts.indexOf('high') ? 'high' : effort;
}
