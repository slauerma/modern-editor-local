import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPdfMatches, indexPdfPage, layoutPdfPages, pageAtScroll, pdfCanvasRatio, pdfPositionAtScroll, pdfScrollPosition, pdfSearchQuery, PDF_CANVAS_LIMIT, PDF_CANVAS_PIXELS, PDF_PAGE_GAP, visiblePdfPages } from '../src/renderer/pdf-reader.ts';

test('continuous page placeholders preserve mixed dimensions and identify the page at scroll boundaries', () => {
  const pages = layoutPdfPages([{ width: 600, height: 800 }, { width: 800, height: 600 }, { width: 600, height: 1200 }], 300, 1);
  assert.deepEqual(pages.map(({ top, height, width }) => ({ top, height, width })), [{ top: 0, height: 400, width: 300 }, { top: 418, height: 225, width: 300 }, { top: 661, height: 600, width: 300 }]);
  assert.equal(pageAtScroll(pages, -3), 1); assert.equal(pageAtScroll(pages, 417), 1); assert.equal(pageAtScroll(pages, 418), 2); assert.equal(pageAtScroll(pages, 10000), 3);
  assert.throws(() => layoutPdfPages([{ width: NaN, height: 50 }], 100, 1));
  assert.throws(() => layoutPdfPages([{ width: 0, height: 50 }], 100, 1));
});

test('render window is bounded and includes a pending distant page without mounting the entire document', () => {
  const pages = layoutPdfPages(Array.from({ length: 500 }, () => ({ width: 100, height: 10 })), 100, 1);
  const visible = visiblePdfPages(pages, 1000, 800, 490);
  assert.equal(visible.size, PDF_CANVAS_LIMIT); assert(visible.has(490)); assert(visible.has(pageAtScroll(pages, 1000)));
  assert.deepEqual([...visiblePdfPages([], 0, 500)], []);
  const ordinary = layoutPdfPages(Array.from({ length: 20 }, () => ({ width: 600, height: 800 })), 600, 1);
  assert.deepEqual([...visiblePdfPages(ordinary, 0, 900)].sort((a, b) => a - b), [1, 2]);
});

test('legacy single-page positions convert once, and flow positions survive zoom and width changes', () => {
  const sizes = Array.from({ length: 5 }, () => ({ width: 600, height: 800 }));
  const pages = layoutPdfPages(sizes, 600, 1);
  const legacy = { page: 3, zoom: 1, scrollX: .4, scrollY: .75 };
  const top = pdfScrollPosition(pages, legacy, 500, 40);
  assert.equal(top, pages[2].top + .75 * (800 + 40 - 500));
  const converted = pdfPositionAtScroll(pages, top, 40, 100, 1);
  assert.equal(converted.page, 3); assert.equal(converted.flow, true); assert.equal(converted.scrollX, .4);
  assert.equal(pdfScrollPosition(pages, converted, 500, 40), top);
  const resized = layoutPdfPages(sizes, 450, 1.5);
  assert.equal(pdfScrollPosition(resized, { ...converted, zoom: 1.5 }, 500), resized[2].top + converted.scrollY! * resized[2].height);
  const second = pdfPositionAtScroll(pages, pages[1].top + 790, 0, 0, 1);
  assert.equal(second.page, 2); assert.equal(pdfScrollPosition(pages, second, 200), pages[1].top + 790);
  assert.equal(pdfScrollPosition(pages, { page: 1, zoom: 1, scrollY: 1 }, 1200), 0);
  assert.equal(pages[2].top, 2 * (800 + PDF_PAGE_GAP));
});

test('canvas backing stores have a pixel and dimension budget even for high-DPI or unusually large pages', () => {
  for (const [width, height, dpr] of [[600, 800, 3], [4000, 8000, 2], [100000, 50, 2]]) {
    const ratio = pdfCanvasRatio(width, height, dpr);
    assert(width * height * ratio ** 2 <= PDF_CANVAS_PIXELS + .01);
    assert(Math.max(width, height) * ratio <= 8192); assert(ratio <= 2);
  }
});

test('PDF search treats regex and markup characters literally, and finds matches across text runs and lines', () => {
  const page = indexPdfPage(3, [{ str: 'A monot', hasEOL: false }, { str: 'one' }, { str: ' allocation', hasEOL: true }, { str: 'is [a+b]. <tag> [a+b].' }]);
  const match = findPdfMatches([page], 'MONOTONE  allocation\nis').matches[0];
  assert.equal(match.page, 3); assert.deepEqual(match.spans, [{ item: 0, from: 2, to: 7 }, { item: 1, from: 0, to: 3 }, { item: 2, from: 0, to: 11 }, { item: 3, from: 0, to: 2 }]);
  assert.equal(findPdfMatches([page], '[a+b]').matches.length, 2);
  assert.equal(findPdfMatches([page], '<tag>').matches.length, 1);
  assert.equal(findPdfMatches([page], 'a.*b').matches.length, 0);
  assert.equal(findPdfMatches([page], '   ').matches.length, 0);
});

test('ligatures, unicode and folded whitespace retain offsets into the original selectable text', () => {
  const page = indexPdfPage(1, [{ str: '🙂  ﬁnite\tSet' }]);
  assert.equal(pdfSearchQuery('FINITE\n SET'), 'finite set');
  const match = findPdfMatches([page], 'finite set').matches[0];
  assert.deepEqual(match.spans, [{ item: 0, from: 4, to: 13 }]);
  assert.equal('🙂  ﬁnite\tSet'.slice(match.spans[0].from, match.spans[0].to), 'ﬁnite\tSet');
  assert.deepEqual(findPdfMatches([page], '🙂').matches[0].spans, [{ item: 0, from: 0, to: 2 }]);
});

test('result and text limits are explicit, deterministic, and never accept half a page as complete', () => {
  const pages = [indexPdfPage(1, [{ str: 'same same' }]), indexPdfPage(2, [{ str: 'same' }])];
  assert.equal(findPdfMatches(pages, 'same', 2).limited, true);
  assert.equal(findPdfMatches(pages, 'same', 3).limited, false);
  assert.deepEqual(findPdfMatches(pages, 'same', 2).matches.map(match => match.page), [1, 1]);
  assert.throws(() => indexPdfPage(2, [{ str: '12345' }], 4), /limit/);
  assert.throws(() => indexPdfPage(2, [{ str: 'ﬄ' }], 1), /limit/);
  assert.equal(indexPdfPage(2, [{ str: '12345' }], 5).characters, 5);
});
