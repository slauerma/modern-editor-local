import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { collectPdfSearchPages } from '../src/renderer/pdf-search.ts';
import { indexPdfPage, PDF_SEARCH_CHARACTER_LIMIT, PDF_SEARCH_PAGE_LIMIT } from '../src/renderer/pdf-reader.ts';

function document(pages: number, getText: (number: number) => string | Promise<string>) {
  return { numPages: pages, getPage: async (number: number) => ({ getTextContent: async () => ({ items: [{ str: await getText(number) }] }) }) as PDFPageProxy } satisfies Pick<PDFDocumentProxy, 'numPages' | 'getPage'>;
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

test('PDF text collection indexes the complete document, reports progress, and resumes after already-complete pages', async () => {
  const seen: number[] = [], updates: any[] = [];
  const pdf = document(8, number => { seen.push(number); return `Page ${number}`; });
  await collectPdfSearchPages(pdf, [indexPdfPage(1, [{ str: 'Page 1' }])], () => false, value => updates.push(value));
  assert.deepEqual(seen, [2,3,4,5,6,7,8]);
  assert.deepEqual(updates.map(value => [value.status,value.pages.length]), [['indexing',5],['indexing',8],['complete',8]]);
});

test('cancelling during text extraction discards the late response and schedules no further pages', async () => {
  const gate = deferred(), entered = deferred(), seen: number[] = [], updates: any[] = []; let cancelled = false;
  const pdf = document(8, async number => { seen.push(number); entered.resolve(); await gate.promise; return 'Late text'; });
  const job = collectPdfSearchPages(pdf, [], () => cancelled, value => updates.push(value));
  await entered.promise; cancelled = true; gate.resolve(); await job;
  assert.deepEqual(seen, [1]); assert.deepEqual(updates, []);
});

test('replacing the document keeps a late old-document index from overwriting the new one', async () => {
  const gate = deferred(), entered = deferred(), updates: string[] = []; let oldCancelled = false;
  const old = collectPdfSearchPages(document(2, async () => { entered.resolve(); await gate.promise; return 'old paper'; }), [], () => oldCancelled, value => updates.push('old:' + value.status));
  await entered.promise; oldCancelled = true;
  await collectPdfSearchPages(document(1, () => 'new paper'), [], () => false, value => updates.push('new:' + value.status));
  gate.resolve(); await old;
  assert.deepEqual(updates, ['new:indexing', 'new:complete']);
});

test('page/text limits and extraction failures explicitly preserve partial coverage', async () => {
  const updates: any[] = [];
  await collectPdfSearchPages(document(PDF_SEARCH_PAGE_LIMIT + 1, () => 'x'), [], () => false, value => updates.push(value));
  assert.equal(updates.at(-1).status, 'limited'); assert.equal(updates.at(-1).pages.length, PDF_SEARCH_PAGE_LIMIT); assert.match(updates.at(-1).notice, /first/);
  updates.length = 0;
  await collectPdfSearchPages(document(3, number => number === 2 ? 'x'.repeat(PDF_SEARCH_CHARACTER_LIMIT) : 'first'), [], () => false, value => updates.push(value));
  assert.equal(updates.at(-1).status, 'limited'); assert.equal(updates.at(-1).pages.length, 1); assert.match(updates.at(-1).notice, /before page 2/);
  updates.length = 0;
  await collectPdfSearchPages(document(3, number => { if (number === 2) throw new Error('bad page'); return 'first'; }), [], () => false, value => updates.push(value));
  assert.equal(updates.at(-1).status, 'error'); assert.equal(updates.at(-1).pages.length, 1); assert.match(updates.at(-1).notice, /before page 2/);
});
