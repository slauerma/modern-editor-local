import { z } from 'zod';

export const ATTACHMENT_LIMITS = Object.freeze({ files: 8, inventory: 100, entries: 500, depth: 3, textBytes: 2_000_000, pdfBytes: 20_000_000, pages: 20, characters: 48_000, perFileCharacters: 12_000 });
export type AttachmentItem = { id: string; name: string; kind: 'text' | 'pdf'; bytes: number };
export type AttachmentInventory = { items: AttachmentItem[]; notices: string[] };
export const attachmentSelectionSchema = z.object({ id: z.string().uuid(), pages: z.string().max(160).optional(), lines: z.string().max(80).optional() }).strict();
export const attachmentSelectionsSchema = z.array(attachmentSelectionSchema).min(1).max(ATTACHMENT_LIMITS.files).refine(items => new Set(items.map(item => item.id)).size === items.length, 'Choose each reference only once.');
export type AttachmentSelection = z.infer<typeof attachmentSelectionSchema>;
export type AttachmentExcerpt = { name: string; location: string; text: string };
export type AttachmentPreview = { id: string; selections: AttachmentSelection[]; excerpts: AttachmentExcerpt[]; notices: string[]; characters: number };
export const attachmentPreviewIdSchema = z.string().uuid();

// Both the preview and the actual request use this projection. Local paths, file
// identifiers and byte hashes are deliberately absent from the model payload.
export function attachmentPromptContext(preview: AttachmentPreview | null | undefined) {
  return preview ? { sources: preview.excerpts.map(({ name, location, text }) => ({ name, location, text })), notices: [...preview.notices] } : undefined;
}

export function selectedPdfPages(value: string | undefined, pageCount: number): number[] {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) throw new Error('The PDF contains no pages.');
  if (!value?.trim()) return Array.from({ length: Math.min(8, pageCount) }, (_, i) => i + 1);
  const result = new Set<number>();
  for (const token of value.split(',')) {
    const match = /^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(token);
    if (!match) throw new Error('Use PDF pages such as 1-3, 7.');
    const from = Number(match[1]), to = Number(match[2] ?? match[1]);
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 1 || to < from || to > pageCount) throw new Error(`Choose PDF pages between 1 and ${pageCount}.`);
    if (to - from + 1 > ATTACHMENT_LIMITS.pages) throw new Error(`Choose at most ${ATTACHMENT_LIMITS.pages} PDF pages per file.`);
    for (let page = from; page <= to; page++) result.add(page);
    if (result.size > ATTACHMENT_LIMITS.pages) throw new Error(`Choose at most ${ATTACHMENT_LIMITS.pages} PDF pages per file.`);
  }
  return [...result].sort((a, b) => a - b);
}

export function selectedTextLines(value: string | undefined, count: number): { from: number; to: number } {
  if (!value?.trim()) return { from: 1, to: count };
  const match = /^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(value);
  if (!match) throw new Error('Use a line range such as 20-80.');
  const from = Number(match[1]), to = Number(match[2] ?? match[1]);
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 1 || to < from || to > count) throw new Error(`Choose text lines between 1 and ${count}.`);
  return { from, to };
}
