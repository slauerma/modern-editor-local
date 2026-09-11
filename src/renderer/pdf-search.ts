import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { indexPdfPage, PdfSearchLimitError, PDF_SEARCH_CHARACTER_LIMIT, PDF_SEARCH_PAGE_LIMIT, type PdfSearchPage } from './pdf-reader.ts';

type SearchIndex = { pdf: PDFDocumentProxy | null; pages: PdfSearchPage[]; status: 'idle' | 'indexing' | 'paused' | 'complete' | 'limited' | 'error'; notice: string };
const emptyIndex = (pdf: PDFDocumentProxy | null): SearchIndex => ({ pdf, pages: [], status: 'idle', notice: '' });

export async function collectPdfSearchPages(pdf: Pick<PDFDocumentProxy, 'getPage' | 'numPages'>, previous: readonly PdfSearchPage[], stopped: () => boolean, update: (value: Omit<SearchIndex, 'pdf'>) => void) {
  const pages = [...previous];
  let characters = pages.reduce((sum, page) => sum + page.characters, 0);
  try {
    for (let number = pages.length + 1; number <= Math.min(pdf.numPages, PDF_SEARCH_PAGE_LIMIT); number++) {
      if (stopped()) return;
      const page = await pdf.getPage(number);
      if (stopped()) return;
      const content = await page.getTextContent();
      if (stopped()) return;
      const indexed = indexPdfPage(number, content.items.filter(item => 'str' in item), PDF_SEARCH_CHARACTER_LIMIT - characters);
      pages.push(indexed); characters += indexed.characters;
      if (number % 5 === 0 || number === pdf.numPages) {
        update({ pages: [...pages], status: 'indexing', notice: '' });
        // Scrolling, Cancel and a changed document get a turn between batches.
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        if (stopped()) return;
      }
    }
    if (stopped()) return;
    const limited = pdf.numPages > PDF_SEARCH_PAGE_LIMIT;
    update({ pages: [...pages], status: limited ? 'limited' : 'complete', notice: limited ? `Search covers the first ${PDF_SEARCH_PAGE_LIMIT.toLocaleString()} of ${pdf.numPages.toLocaleString()} pages.` : '' });
  } catch (error) {
    if (stopped()) return;
    update({ pages: [...pages], status: error instanceof PdfSearchLimitError ? 'limited' : 'error', notice: error instanceof PdfSearchLimitError ? `Search covers ${pages.length} complete pages; the ${PDF_SEARCH_CHARACTER_LIMIT.toLocaleString()}-character limit was reached before page ${pages.length + 1}.` : `Search stopped before page ${pages.length + 1}: ${String(error)}` });
  }
}

export function usePdfSearchIndex(pdf: PDFDocumentProxy | null, enabled: boolean) {
  const [state, setState] = useState<SearchIndex>(() => emptyIndex(null)), cache = useRef(state);
  const [attempt, setAttempt] = useState(0), cancellation = useRef({ stopped: false });
  function publish(value: SearchIndex) { cache.current = value; setState(value); }
  function pause() {
    cancellation.current.stopped = true;
    if (cache.current.pdf === pdf && cache.current.status === 'indexing') publish({ ...cache.current, status: 'paused', notice: 'Search indexing paused.' });
  }
  function resume() { setAttempt(value => value + 1); }
  useEffect(() => {
    const control = { stopped: false }; cancellation.current = control;
    if (cache.current.pdf !== pdf) publish(emptyIndex(pdf));
    if (!pdf || !enabled || ['complete', 'limited', 'error'].includes(cache.current.status)) return () => { control.stopped = true; };
    publish({ pdf, pages: cache.current.pages, status: 'indexing', notice: '' });
    void collectPdfSearchPages(pdf, cache.current.pages, () => control.stopped, value => publish({ pdf, ...value }));
    return () => { control.stopped = true; };
  }, [pdf, enabled, attempt]);
  // A document switch must not expose old matches even for the render before
  // the effect above clears its cache.
  return { ...(state.pdf === pdf ? state : emptyIndex(pdf)), pause, resume };
}
