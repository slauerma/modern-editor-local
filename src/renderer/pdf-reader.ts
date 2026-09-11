import { pdfPage, type PdfPosition } from './pdf-position.ts';

export const PDF_PAGE_GAP = 18;
export const PDF_READER_PAGE_LIMIT = 5_000;
export const PDF_CANVAS_LIMIT = 8;
export const PDF_CANVAS_PIXELS = 4_000_000;
export const PDF_SEARCH_PAGE_LIMIT = 1_000;
export const PDF_SEARCH_CHARACTER_LIMIT = 5_000_000;
export const PDF_SEARCH_MATCH_LIMIT = 2_000;
export const PDF_SEARCH_QUERY_LIMIT = 256;

export type PdfPageSize = { width: number; height: number };
export type PdfPageLayout = PdfPageSize & { page: number; top: number; scale: number };

export function layoutPdfPages(sizes: readonly PdfPageSize[], width: number, zoom: number): PdfPageLayout[] {
  let top = 0;
  return sizes.map((size, index) => {
    if (![size.width, size.height].every(value => Number.isFinite(value) && value > 0 && value <= 100_000)) throw new Error(`Unsupported PDF page dimensions on page ${index + 1}.`);
    const scale = Math.max(1, width) / size.width * zoom;
    const page = { page: index + 1, top, width: size.width * scale, height: size.height * scale, scale };
    top += page.height + PDF_PAGE_GAP;
    return page;
  });
}

export function pageAtScroll(pages: readonly PdfPageLayout[], scrollTop: number): number {
  if (!pages.length) return 1;
  let low = 0, high = pages.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (pages[middle].top <= scrollTop) low = middle + 1; else high = middle;
  }
  return Math.max(1, low);
}

// Keep the real dimensions for every placeholder, while canvases/text layers
// exist only around the viewport. A distant pending navigation is also mounted.
export function visiblePdfPages(pages: readonly PdfPageLayout[], top: number, height: number, pendingPage?: number): Set<number> {
  if (!pages.length) return new Set();
  const first = pageAtScroll(pages, Math.max(0, top - 250));
  const last = pageAtScroll(pages, top + height + 250);
  const result = new Set<number>();
  if (pendingPage && pendingPage >= 1 && pendingPage <= pages.length) result.add(pendingPage);
  const current = pageAtScroll(pages, top);
  for (let distance = 0; result.size < PDF_CANVAS_LIMIT && (current - distance >= first || current + distance <= last); distance++) {
    for (const number of distance ? [current + distance, current - distance] : [current]) {
      if (number >= first && number <= last && result.size < PDF_CANVAS_LIMIT) result.add(number);
    }
  }
  return result;
}

export function pdfCanvasRatio(width: number, height: number, deviceRatio: number): number {
  // Very wide/tall pages must also stay below common browser canvas limits.
  return Math.min(Math.max(1, deviceRatio), 2, Math.sqrt(PDF_CANVAS_PIXELS / Math.max(1, width * height)), 8192 / Math.max(1, width, height));
}

const fraction = (value: number | undefined) => Math.max(0, Math.min(1, Number.isFinite(value) ? value! : 0));
export function pdfScrollPosition(pages: readonly PdfPageLayout[], position: PdfPosition, viewportHeight: number, padding = 40) {
  const page = pages[pdfPage(position.page, pages.length) - 1];
  if (!page) return 0;
  // Old scrollY was divided by (single-page scrollHeight - viewportHeight).
  const local = fraction(position.scrollY) * (position.flow ? page.height : Math.max(0, page.height + padding - viewportHeight));
  return page.top + local;
}

export function pdfPositionAtScroll(pages: readonly PdfPageLayout[], top: number, left: number, horizontalOverflow: number, zoom: number): PdfPosition {
  const page = pageAtScroll(pages, top), layout = pages[page - 1];
  return { page, zoom, flow: true, scrollY: fraction(layout ? (top - layout.top) / layout.height : 0), scrollX: fraction(left / Math.max(1, horizontalOverflow)) };
}

export type PdfTextItem = { str: string; hasEOL?: boolean };
type PdfTextRun = { item: number; start: number; end: number; from: Uint32Array; to: Uint32Array };
export type PdfSearchPage = { page: number; text: string; characters: number; runs: PdfTextRun[] };
export type PdfSearchSpan = { item: number; from: number; to: number };
export type PdfSearchMatch = { page: number; start: number; end: number; spans: PdfSearchSpan[] };
export class PdfSearchLimitError extends Error { constructor() { super('PDF search reached its extracted-text limit.'); this.name = 'PdfSearchLimitError'; } }

function foldedCharacters(source: string, limit = Infinity) {
  const pieces: string[] = [], from: number[] = [], to: number[] = [];
  let offset = 0;
  for (const character of source) {
    const normalized = character.normalize('NFKC').toLowerCase().replace(/\s/gu, ' ');
    if (from.length + normalized.length > limit) throw new PdfSearchLimitError();
    pieces.push(normalized);
    for (let i = 0; i < normalized.length; i++) { from.push(offset); to.push(offset + character.length); }
    offset += character.length;
  }
  return { text: pieces.join(''), from: new Uint32Array(from), to: new Uint32Array(to) };
}

export function pdfSearchQuery(query: string) {
  return foldedCharacters(query).text.replace(/ +/g, ' ').trim();
}

export function indexPdfPage(page: number, items: readonly PdfTextItem[], remainingCharacters = PDF_SEARCH_CHARACTER_LIMIT): PdfSearchPage {
  const characters = items.reduce((sum, item) => sum + item.str.length, 0);
  // Reject the complete page before allocating offset maps; never pretend a
  // prefix of one page is its complete searchable content.
  if (characters > remainingCharacters) throw new PdfSearchLimitError();
  let length = 0, previousSpace = false;
  const pieces: string[] = [];
  const runs: PdfTextRun[] = [];
  items.forEach((item, index) => {
    const folded = foldedCharacters(item.str, remainingCharacters - length);
    const start = length;
    // Collapse whitespace in the search representation without changing text
    // layer strings or losing the offsets used to highlight the original text.
    const from: number[] = [], to: number[] = [];
    for (let i = 0; i < folded.text.length; i++) {
      const character = folded.text[i];
      if (character === ' ' && previousSpace) continue;
      pieces.push(character); length++; previousSpace = character === ' '; from.push(folded.from[i]); to.push(folded.to[i]);
    }
    if (length > start) runs.push({ item: index, start, end: length, from: new Uint32Array(from), to: new Uint32Array(to) });
    if (item.hasEOL && !previousSpace) { pieces.push(' '); length++; previousSpace = true; }
    if (length > remainingCharacters) throw new PdfSearchLimitError();
  });
  return { page, text: pieces.join(''), characters: Math.max(characters, length), runs };
}

export function findPdfMatches(pages: readonly PdfSearchPage[], query: string, limit = PDF_SEARCH_MATCH_LIMIT) {
  const needle = pdfSearchQuery(query), matches: PdfSearchMatch[] = [];
  if (!needle) return { matches, limited: false };
  for (const page of pages) {
    let at = 0;
    while ((at = page.text.indexOf(needle, at)) !== -1) {
      if (matches.length >= limit) return { matches, limited: true };
      const end = at + needle.length;
      let low = 0, high = page.runs.length;
      while (low < high) { const middle = (low + high) >>> 1; if (page.runs[middle].end <= at) low = middle + 1; else high = middle; }
      const spans: PdfSearchSpan[] = [];
      for (let index = low; index < page.runs.length && page.runs[index].start < end; index++) {
        const run = page.runs[index];
        spans.push({ item: run.item, from: run.from[Math.max(at, run.start) - run.start], to: run.to[Math.min(end, run.end) - run.start - 1] });
      }
      matches.push({ page: page.page, start: at, end, spans });
      at = end;
    }
  }
  return { matches, limited: false };
}
