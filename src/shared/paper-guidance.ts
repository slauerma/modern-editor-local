import { z } from 'zod';
import { incrementalEditPolicy } from './review-presets.ts';

export const editPreferencesSchema = z.object({
  localEditsOnly: z.boolean().default(true),
  preserveVoice: z.boolean().default(true)
}).strict();
export type EditPreferences = z.infer<typeof editPreferencesSchema>;
export const defaultEditPreferences = (): EditPreferences => ({ localEditsOnly: true, preserveVoice: true });
export function paperGuidance(paperInstructions = '', preferences: EditPreferences = defaultEditPreferences()) {
  return {
    paperInstructions,
    ...(preferences.localEditsOnly ? { editPolicy: incrementalEditPolicy } : {}),
    ...(preferences.preserveVoice ? { stylePolicy: 'Preserve the author’s voice, notation and intended meaning. Keep changes minimal. Avoid generic AI phrasing, unnecessary transitions, inflated claims and decorative rewrites. A substantive concern may be discussed without rewriting the passage.' } : {})
  };
}
