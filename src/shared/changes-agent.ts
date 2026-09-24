import { z } from 'zod';
import { arrangementSchema, arrangementOutputSchema } from './changes-pdf.ts';

export const changesAgentModel = 'gpt-6-sol';
export const changesAgentSchema = arrangementSchema.extend({ inspect: z.array(z.string().max(40)).max(3) }).strict();
export const changesAgentOutputSchema = {
  ...arrangementOutputSchema, required: ['groups', 'inspect'], properties: {
    ...arrangementOutputSchema.properties,
    inspect: { type: 'array', items: { type: 'string' } }
  }
};
export const visualCheckSchema = z.object({ readable: z.boolean(), issues: z.array(z.string().max(500)).max(10) }).strict();
export const visualCheckOutputSchema = { type: 'object', additionalProperties: false, required: ['readable', 'issues'], properties: {
  readable: { type: 'boolean' }, issues: { type: 'array', items: { type: 'string' } }
} };
export type ChangesVisual = { pages: number[]; status: 'requested' | 'checked' | 'problem' | 'unavailable' | 'not-requested'; issues: string[] };
export type ChangesScreenshot = { page: number; dataUrl: string };

/** Event counters, not document changes, schedule model work. At most one run
 * consumes a batch; edits during it can enqueue the next batch without a loop. */
export function changesUpdateDue(previous: { accepted: number; saved: number }, now: { accepted: number; saved: number }, every: number) {
  return now.saved > previous.saved || now.accepted - previous.accepted >= every;
}
