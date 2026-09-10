import type { PdfLocation } from '../shared/contracts.ts';
export type PdfJump = Extract<PdfLocation, { kind: 'mapped' }> & { requestId: number; persistent?: boolean };
export type PdfPosition = { page: number; zoom: number; scrollX?: number; scrollY?: number };
export function pdfPage(value: number, pages: number) {
  return Math.max(1, Math.min(Math.max(1, pages), Number.isFinite(value) ? Math.trunc(value) : 1));
}
export function revealOffset(start: number, size: number, visible: number, margin = 16) {
  // A long box cannot fit; leave it still if its beginning is already visible.
  if (start >= 0 && (start + size <= visible || (size > visible && start <= visible / 2))) return 0;
  return start - Math.max(margin, (visible - Math.min(size, visible - 2 * margin)) / 2);
}
