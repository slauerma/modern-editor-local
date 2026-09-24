import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist';
import workerURL from 'pdfjs-dist/build/pdf.worker.mjs?url';
import 'pdfjs-dist/web/pdf_viewer.css';
import './pdf-reader.css';
import type { Build } from '../shared/contracts.ts';
import { pdfPage, revealOffset, type PdfPosition, type PdfJump } from './pdf-position.ts';
import { findPdfMatches, layoutPdfPages, pdfCanvasRatio, pdfPositionAtScroll, pdfScrollPosition, PDF_READER_PAGE_LIMIT, PDF_SEARCH_MATCH_LIMIT, PDF_SEARCH_QUERY_LIMIT, visiblePdfPages, type PdfPageLayout, type PdfPageSize, type PdfSearchMatch } from './pdf-reader.ts';
import { usePdfSearchIndex } from './pdf-search.ts';
GlobalWorkerOptions.workerSrc = workerURL;

export type PdfChangeTarget = { buildId: string; id: string; requestId: number };
type Props = { changeTarget?: PdfChangeTarget | null; hideClose?: boolean; hideFollow?: boolean; changeIds?: string[]; onChangeNote?: (id: string) => void; build: Build | null; freshness: string; position: PdfPosition; visible?: boolean; followComments: boolean; onFollowChange: (value: boolean) => void; jump?: PdfJump | null; onPositionChange: (position: Partial<PdfPosition>) => void; onUserNavigate: () => void; onClose: () => void };
type Loaded = { id: string; document: PDFDocumentProxy; sizes: PdfPageSize[] };
const positionKey = (position: PdfPosition) => [position.page, position.zoom, position.scrollX ?? 0, position.scrollY ?? 0, !!position.flow].join(':');
const noMatches: PdfSearchMatch[] = [];

function highlightText(layer: TextLayer, matches: PdfSearchMatch[], active: PdfSearchMatch | undefined) {
  const byItem = new Map<number, { from: number; to: number; active: boolean }[]>();
  for (const match of matches) for (const span of match.spans) {
    const ranges = byItem.get(span.item) ?? [];
    ranges.push({ ...span, active: match === active }); byItem.set(span.item, ranges);
  }
  layer.textDivs.forEach((div, item) => {
    const source = layer.textContentItemsStr[item], ranges = byItem.get(item);
    const key = ranges?.map(range => `${range.from}:${range.to}:${range.active ? 1 : 0}`).join(',') ?? '';
    // Indexing later pages must not rebuild unchanged text nodes and destroy a
    // selection that the reader is currently copying on this page.
    if (div.dataset.pdfFindRanges === key) return;
    div.dataset.pdfFindRanges = key;
    if (!ranges?.length) { if (div.textContent !== source || div.childElementCount) div.textContent = source; return; }
    const fragment = document.createDocumentFragment(); let at = 0;
    // Several normalized matches can share one original ligature glyph.
    const merged: typeof ranges = [];
    for (const range of ranges.sort((a, b) => a.from - b.from)) {
      const previous = merged.at(-1);
      if (previous && range.from < previous.to) { previous.to = Math.max(previous.to, range.to); previous.active ||= range.active; } else merged.push({ ...range });
    }
    for (const range of merged) {
      const from = Math.max(at, range.from), to = Math.min(source.length, range.to);
      if (to <= from) continue;
      fragment.append(document.createTextNode(source.slice(at, from)));
      const mark = document.createElement('mark'); mark.className = `pdf-find-hit${range.active ? ' active' : ''}`;
      if (range.active) mark.dataset.pdfActiveHit = 'true';
      mark.textContent = source.slice(from, to); fragment.append(mark); at = to;
    }
    fragment.append(document.createTextNode(source.slice(at))); div.replaceChildren(fragment);
  });
}

function RenderedPage({ pdf, layout, matches, active, onReady, changeIds, onChangeNote, activeNote }: { activeNote?: string; changeIds?: string[]; onChangeNote?: (id: string) => void; pdf: PDFDocumentProxy; layout: PdfPageLayout; matches: PdfSearchMatch[]; active?: PdfSearchMatch; onReady: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null), container = useRef<HTMLDivElement>(null), text = useRef<TextLayer | null>(null);
  const [notes, setNotes] = useState<{ id: string; rect: number[] }[]>([]);
  const noteMode = !!changeIds;
  const [ready, setReady] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    let disposed = false, rendering: RenderTask | undefined, textLayer: TextLayer | undefined;
    const node = canvas.current!, layer = container.current!;
    setReady(false); setError(''); setNotes([]); text.current = null;
    void pdf.getPage(layout.page).then(async page => {
      if (disposed) return;
      const viewport = page.getViewport({ scale: layout.scale }), ratio = pdfCanvasRatio(viewport.width, viewport.height, window.devicePixelRatio || 1);
      node.width = Math.max(1, Math.floor(viewport.width * ratio)); node.height = Math.max(1, Math.floor(viewport.height * ratio));
      layer.replaceChildren();
      rendering = page.render({ canvas: node, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
      await rendering.promise;
      if (disposed) return;
      const content = await page.getTextContent();
      if (disposed) return;
      textLayer = new TextLayer({ textContentSource: content, container: layer, viewport });
      await textLayer.render();
      if (!disposed) { text.current = textLayer; setReady(true); }
      if (noteMode) {
        const annotations = await page.getAnnotations({ intent: 'display' });
        if (!disposed) setNotes(annotations.flatMap(a => {
          const match = /^https:\/\/modern-editor\.invalid\/changes\/(\d+)$/.exec(a.url ?? '');
          if (!match || !Array.isArray(a.rect)) return [];
          return [{ id: 'change-' + match[1], rect: [...viewport.convertToViewportPoint(a.rect[0], a.rect[1]), ...viewport.convertToViewportPoint(a.rect[2], a.rect[3])] }];
        }));
      }
    }).catch(error => { if (!disposed && error?.name !== 'RenderingCancelledException') setError(String(error)); });
    return () => { disposed = true; rendering?.cancel(); textLayer?.cancel(); text.current = null; };
  }, [pdf, layout, noteMode]);
  useLayoutEffect(() => {
    if (!ready || !text.current) return;
    highlightText(text.current, matches, active); onReady();
  }, [ready, matches, active, notes, onReady]);
  return <>
    {!ready && <span className="pdf-page-placeholder" role={error ? 'alert' : undefined}>{error || `Loading page ${layout.page}…`}</span>}
    <canvas ref={canvas} style={{ width: layout.width, height: layout.height, visibility: ready ? 'visible' : 'hidden' }} aria-label={`PDF page ${layout.page}${ready ? ', rendered' : ', loading'}`} />
    <div ref={container} className="textLayer" />
    {notes.filter(n => changeIds?.includes(n.id)).map((n, i) => <button key={i} data-change-note={n.id} className={"pdf-change-note" + (activeNote === n.id ? " selected" : "")} aria-label={'Explain change ' + n.id.replace('change-', '')} title="Show change explanation" style={{ left: Math.min(n.rect[0], n.rect[2]), top: Math.min(n.rect[1], n.rect[3]), width: Math.max(18, Math.abs(n.rect[2] - n.rect[0])), height: Math.max(18, Math.abs(n.rect[3] - n.rect[1])) }} onClick={() => onChangeNote?.(n.id)} />)}
  </>;
}

export function PdfPane({ changeTarget, hideClose = false, hideFollow = false, changeIds, onChangeNote, build, freshness, position, visible = true, followComments, onFollowChange, jump, onPositionChange, onUserNavigate, onClose }: Props) {
  const [loaded, setLoaded] = useState<Loaded | null>(null), [error, setError] = useState(''), [progress, setProgress] = useState('');
  const [view, setView] = useState({ width: 440, height: 600, top: 0 }), [pageDraft, setPageDraft] = useState(String(position.page));
  const scroll = useRef<HTMLDivElement>(null), paperList = useRef<HTMLDivElement>(null), findInput = useRef<HTMLInputElement>(null);
  const callbacks = useRef({ onPositionChange, onUserNavigate }); callbacks.current = { onPositionChange, onUserNavigate };
  const positionRef = useRef(position); positionRef.current = position;
  const visibleRef = useRef(visible); visibleRef.current = visible;
  const layoutRef = useRef<PdfPageLayout[]>([]), lastPublished = useRef(''), appliedLayout = useRef<PdfPageLayout[] | null>(null);
  const publishedBuild = useRef<string | null>(null), scrollFrame = useRef(0);
  const current = loaded?.id === build?.id ? loaded : null, pdf = current?.document ?? null;
  const layouts = useMemo(() => layoutPdfPages(current?.sizes ?? [], view.width, position.zoom), [current, view.width, position.zoom]); layoutRef.current = layouts;
  const page = pdfPage(position.page, pdf?.numPages ?? 1);
  const [findOpen, setFindOpen] = useState(false), [query, setQuery] = useState(''), [debouncedQuery, setDebouncedQuery] = useState('');
  const index = usePdfSearchIndex(pdf, findOpen);
  useEffect(() => { const timer = setTimeout(() => setDebouncedQuery(query), 180); return () => clearTimeout(timer); }, [query]);
  const result = useMemo(() => findPdfMatches(index.pages, findOpen && query === debouncedQuery ? debouncedQuery : ''), [index.pages, findOpen, query, debouncedQuery]);
  const resultKey = `${build?.id}:${debouncedQuery}`;
  const [selection, setSelection] = useState({ key: '', index: -1 }), [searchTarget, setSearchTarget] = useState<{ key: string; index: number; request: number } | null>(null);
  const active = selection.key === resultKey ? result.matches[selection.index] : undefined;
  const searchRequest = useRef(0), completedSearch = useRef(0), lastJump = useRef('');
  const [readyRevision, setReadyRevision] = useState(0), [expiredJump, setExpiredJump] = useState('');
  const pageReady = useCallback(() => setReadyRevision(value => value + 1), []);
  const matchesByPage = useMemo(() => { const map = new Map<number, PdfSearchMatch[]>(); for (const match of result.matches) { const group = map.get(match.page) ?? []; group.push(match); map.set(match.page, group); } return map; }, [result]);
  const pendingSearch = findOpen && searchTarget?.key === resultKey ? result.matches[searchTarget.index] : undefined;
  const validJump = jump && jump.buildId === build?.id && jump.page >= 1 && jump.page <= layouts.length ? jump : null;
  const jumpKey = validJump ? `${validJump.buildId}:${validJump.requestId}` : '';
  const lastEmphasis = useRef(''), [emphasis, setEmphasis] = useState('');
  useEffect(() => {
    // A deliberate new target gets one pulse. Hiding/revealing a live pane or
    // repainting virtual pages must not start the pulse again.
    if (!visible || !jumpKey) { setEmphasis(''); return; }
    if (lastEmphasis.current === jumpKey) return;
    lastEmphasis.current = jumpKey; setEmphasis(jumpKey);
    const timer = setTimeout(() => setEmphasis(''), 1200);
    return () => clearTimeout(timer);
  }, [jumpKey, visible]);
  // Clean deletions have no text span. Resolve the actual generated PDF marker,
  // rather than using SyncTeX's nearby line as if it were the deleted passage.
  const noteKey = visible && changeTarget && changeTarget.buildId === build?.id && changeIds?.includes(changeTarget.id) ? changeTarget.buildId + ':' + changeTarget.requestId : '';
  const [notePage, setNotePage] = useState<{ key: string; page: number } | null>(null), [noteError, setNoteError] = useState('');
  const revealedNote = useRef('');
  useEffect(() => {
    let disposed = false; setNotePage(null); setNoteError('');
    if (!noteKey || !pdf || !changeTarget) return;
    void (async () => {
      const destination = await pdf.getDestination('MECompare-' + changeTarget.id.replace('change-', ''));
      if (disposed) return;
      if (!destination) throw new Error('This change marker is unavailable. See its explanation or Text diff.');
      const index = typeof destination[0] === 'number' ? destination[0] : await pdf.getPageIndex(destination[0]);
      if (!Number.isInteger(index) || index < 0 || index >= pdf.numPages) throw new Error('This change marker is unavailable.');
      if (!disposed) setNotePage({ key: noteKey, page: index + 1 });
    })().catch(e => { if (!disposed) setNoteError(String(e instanceof Error ? e.message : e)); });
    return () => { disposed = true; };
  }, [noteKey, pdf]);
  const targetNote = notePage?.key === noteKey ? notePage : null;
  const renderedPages = visiblePdfPages(layouts, view.top, view.height, pendingSearch?.page ?? targetNote?.page ?? validJump?.page);

  const readScroll = useCallback((publish = true) => {
    const node = scroll.current, pages = layoutRef.current;
    if (!node || !pages.length || !visibleRef.current || !node.clientHeight) return;
    setView(previous => previous.top === node.scrollTop && previous.height === node.clientHeight ? previous : { ...previous, top: node.scrollTop, height: node.clientHeight });
    if (publish) {
      const next = pdfPositionAtScroll(pages, node.scrollTop, node.scrollLeft, node.scrollWidth - node.clientWidth, positionRef.current.zoom);
      const key = positionKey(next);
      if (lastPublished.current !== key) { lastPublished.current = key; positionRef.current = next; callbacks.current.onPositionChange(next); }
    }
  }, []);
  useEffect(() => {
    const node = scroll.current;
    if (!node) return;
    const resize = new ResizeObserver(() => {
      if (!node.clientWidth || !node.clientHeight) return;
      const style = getComputedStyle(node), width = Math.max(100, node.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
      setView(previous => ({ ...previous, width, height: node.clientHeight }));
    });
    resize.observe(node);
    return () => { resize.disconnect(); cancelAnimationFrame(scrollFrame.current); };
  }, []);
  useEffect(() => {
    if (!build) return;
    let disposed = false, task: ReturnType<typeof getDocument> | undefined;
    setLoaded(null); setError(''); setProgress('Loading compiled PDF…');
    void window.editor.getPdf(build.id).then(async bytes => {
      if (disposed) return;
      task = getDocument({ data: new Uint8Array(bytes) });
      const document = await task.promise;
      if (disposed) return;
      if (document.numPages > PDF_READER_PAGE_LIMIT) throw new Error(`This PDF has ${document.numPages.toLocaleString()} pages. The reader limit is ${PDF_READER_PAGE_LIMIT.toLocaleString()} pages.`);
      const sizes: PdfPageSize[] = [];
      for (let number = 1; number <= document.numPages; number++) {
        const page = await document.getPage(number);
        if (disposed) return;
        const viewport = page.getViewport({ scale: 1 }); sizes.push({ width: viewport.width, height: viewport.height });
        if (number % 20 === 0) { setProgress(`Preparing PDF pages: ${number} / ${document.numPages}…`); await new Promise<void>(resolve => setTimeout(resolve, 0)); if (disposed) return; }
      }
      // Validate every placeholder before publishing the document.
      layoutPdfPages(sizes, 100, 1);
      setLoaded({ id: build.id, document, sizes }); setProgress('');
    }).catch(error => { if (!disposed) setError(String(error)); });
    return () => { disposed = true; void task?.destroy().catch(() => {}); };
  }, [build?.id]);
  useEffect(() => setPageDraft(String(page)), [page]);
  useLayoutEffect(() => {
    const node = scroll.current;
    if (!visible) { appliedLayout.current = null; return; }
    if (!node || !layouts.length || !node.clientHeight) return;
    const changedBuild = publishedBuild.current !== build?.id;
    if (!changedBuild && appliedLayout.current === layouts && positionKey(position) === lastPublished.current) return;
    publishedBuild.current = build?.id ?? null; appliedLayout.current = layouts;
    const style = getComputedStyle(node);
    node.scrollTop = pdfScrollPosition(layouts, position, node.clientHeight, parseFloat(style.paddingTop) + parseFloat(style.paddingBottom));
    node.scrollLeft = (position.scrollX ?? 0) * Math.max(0, node.scrollWidth - node.clientWidth);
    readScroll();
  }, [layouts, position, build?.id, readScroll, visible]);

  function revealElement(element: HTMLElement) {
    const node = scroll.current;
    if (!node) return;
    const target = element.getBoundingClientRect(), viewport = node.getBoundingClientRect();
    node.scrollTop += revealOffset(target.top - viewport.top, target.height, node.clientHeight);
    node.scrollLeft += revealOffset(target.left - viewport.left, target.width, node.clientWidth);
    readScroll();
  }
  useLayoutEffect(() => {
    if (!visible || !validJump || !jumpKey || !paperList.current) return;
    if (lastJump.current !== jumpKey) {
      const marker = paperList.current.querySelector<HTMLElement>(`[data-pdf-jump="${validJump.page}"]`);
      if (!marker) return;
      lastJump.current = jumpKey; revealElement(marker);
    }
  }, [jumpKey, layouts, readyRevision, visible]);
  useEffect(() => {
    if (!validJump || validJump.persistent) return;
    const timer = setTimeout(() => setExpiredJump(jumpKey), 3000); return () => clearTimeout(timer);
  }, [jumpKey]);
  useLayoutEffect(() => {
    if (!visible || !pendingSearch || !searchTarget || completedSearch.current === searchTarget.request || !paperList.current) return;
    const element = paperList.current.querySelector<HTMLElement>(`[data-pdf-page="${pendingSearch.page}"] [data-pdf-active-hit]`);
    if (element) { completedSearch.current = searchTarget.request; revealElement(element); }
  }, [pendingSearch, searchTarget, layouts, readyRevision, visible]);
  useLayoutEffect(() => {
    if (!targetNote || !changeTarget || revealedNote.current === noteKey || !paperList.current) return;
    const element = paperList.current.querySelector<HTMLElement>('[data-pdf-page="' + targetNote.page + '"] [data-change-note="' + changeTarget.id + '"]');
    if (element) { revealedNote.current = noteKey; revealElement(element); }
  }, [targetNote, noteKey, layouts, readyRevision]);
  function selectMatch(number: number) {
    const match = result.matches[number]; if (!match) return;
    callbacks.current.onUserNavigate();
    setSelection({ key: resultKey, index: number });
    setSearchTarget({ key: resultKey, index: number, request: ++searchRequest.current });
    const node = scroll.current, layout = layouts[match.page - 1];
    if (node && layout && !renderedPages.has(match.page)) { node.scrollTop = layout.top; readScroll(); }
  }
  useEffect(() => {
    // Select the first result once per query/document, without moving again as
    // later pages finish indexing. Deliberate navigation always wins thereafter.
    if (visible && findOpen && query === debouncedQuery && result.matches.length && selection.key !== resultKey) selectMatch(0);
  }, [result, resultKey, findOpen, visible]);
  function stepMatch(direction: number) {
    if (!result.matches.length) return;
    const current = selection.key === resultKey ? selection.index : -1;
    selectMatch((current + direction + result.matches.length) % result.matches.length);
  }
  function userNavigate() { completedSearch.current = searchRequest.current; callbacks.current.onUserNavigate(); }
  function changePage(number: number) {
    userNavigate(); const next = pdfPage(number, pdf?.numPages ?? 1); setPageDraft(String(next));
    callbacks.current.onPositionChange({ page: next, flow: true, scrollY: 0 });
  }
  function goToPage() { const next = pdfPage(Number(pageDraft), pdf?.numPages ?? 1); setPageDraft(String(next)); if (next !== page) changePage(next); }
  function openFind() { setFindOpen(true); requestAnimationFrame(() => { findInput.current?.focus(); findInput.current?.select(); }); }
  const searching = query !== debouncedQuery;
  const matchStatus = searching ? 'Searching…' : query.trim() ? result.matches.length ? `${active ? selection.index + 1 : 0} / ${result.matches.length}${result.limited ? '+' : ''}` : index.status === 'indexing' ? 'No matches yet' : 'No matches' : 'Find text in this PDF';
  const totalHeight = layouts.length ? layouts.at(-1)!.top + layouts.at(-1)!.height : 0;
  const stateLabel = !build ? 'No PDF yet' : build.purpose === 'comparison' || build.purpose === 'proposal' ? freshness : freshness.includes('Preview') ? 'Preview · not applied' : freshness.includes('Candidate') ? 'Candidate · not applied' : build.dependenciesVerified === false || freshness.includes('verification') ? 'Unverified inputs' : freshness.includes('matches') ? 'Current draft' : 'Earlier PDF';
  return <section hidden={!visible} className="pdf-reader continuous-pdf" aria-label="Compiled PDF" onKeyDown={event => {
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'f') { event.preventDefault(); event.stopPropagation(); openFind(); }
  }}>
    <form className="pdf-controls" onSubmit={event => { event.preventDefault(); goToPage(); }}>
      <span className={`pdf-state ${stateLabel === 'Current draft' ? 'current' : 'older'}`} title={freshness} aria-label={freshness}>{stateLabel}</span>
      <button type="button" disabled={!pdf || page <= 1} onClick={() => changePage(page - 1)} aria-label="Previous PDF page">‹</button><input aria-label="PDF page number" type="number" min={1} max={pdf?.numPages ?? 1} disabled={!pdf} value={pageDraft} onChange={event => { userNavigate(); setPageDraft(event.target.value); }} onBlur={goToPage} /><span>/ {pdf?.numPages ?? '–'}</span><button type="button" disabled={!pdf || page >= pdf.numPages} onClick={() => changePage(page + 1)} aria-label="Next PDF page">›</button>
      <select aria-label="PDF zoom" value={position.zoom} onChange={event => { userNavigate(); callbacks.current.onPositionChange({ zoom: Number(event.target.value) }); }}><option value={1}>Fit width</option><option value={1.25}>1.25× fit</option><option value={1.5}>1.5× fit</option><option value={2}>2× fit</option></select>
      {!hideFollow && <button type="button" className="pdf-follow" aria-label="PDF follows comments" title="Follow comments: bring each selected comment’s passage into view" aria-pressed={followComments} onClick={() => onFollowChange(!followComments)}>Follow</button>}
      <button type="button" className="pdf-find-toggle" aria-expanded={findOpen} onClick={() => findOpen ? setFindOpen(false) : openFind()}>Find</button>{!hideClose && <button type="button" className="icon" onClick={onClose} aria-label="Close PDF">×</button>}
    </form>
    {findOpen && <div className="pdf-search" role="search" aria-label="Search PDF">
      <form className="pdf-search-controls" onSubmit={event => { event.preventDefault(); stepMatch(1); }}>
        <input ref={findInput} aria-label="Find in PDF" value={query} maxLength={PDF_SEARCH_QUERY_LIMIT} placeholder="Find in PDF…" onChange={event => { setQuery(event.target.value); setSelection({ key: '', index: -1 }); setSearchTarget(null); }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setFindOpen(false); scroll.current?.focus(); } else if (event.key === 'Enter' && event.shiftKey) { event.preventDefault(); stepMatch(-1); } }} />
        <span className="pdf-match-count" role="status">{matchStatus}</span><button type="button" disabled={!result.matches.length} onClick={() => stepMatch(-1)} aria-label="Previous PDF match">↑</button><button type="submit" disabled={!result.matches.length} aria-label="Next PDF match">↓</button><button type="button" onClick={() => setFindOpen(false)} aria-label="Close PDF search">×</button>
      </form>
      <div className="pdf-search-status" aria-live="polite">{index.status === 'indexing' ? <>Indexing {index.pages.length} / {pdf?.numPages ?? 0} pages… <button type="button" onClick={index.pause}>Stop</button></> : index.status === 'paused' ? <>{index.pages.length} pages indexed. <button type="button" onClick={index.resume}>Continue indexing</button></> : index.notice || (index.status === 'complete' ? `All ${index.pages.length} pages searched. Text only; images are not searched.` : 'Search uses the displayed PDF, including an older or candidate preview.')}{result.limited && <> Showing the first {PDF_SEARCH_MATCH_LIMIT.toLocaleString()} matches; narrow the search.</>}{query.length === PDF_SEARCH_QUERY_LIMIT && <> Query limit: {PDF_SEARCH_QUERY_LIMIT} characters.</>}</div>
    </div>}
    {noteError && <p className="changes-pdf-notice" role="status">{noteError}</p>}
    <div className="pdf-scroll" ref={scroll} tabIndex={0} onWheel={userNavigate} onPointerDown={userNavigate} onTouchStart={userNavigate} onKeyDown={event => { if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) userNavigate(); }} onScroll={() => { cancelAnimationFrame(scrollFrame.current); scrollFrame.current = requestAnimationFrame(() => readScroll()); }}>
      {!build && <div className="empty-pdf">Compile the paper to see its actual PDF here.</div>}
      {error && <p role="alert">{error}</p>}
      {build && !pdf && !error && <div className="empty-pdf" role="status">{progress || 'Loading compiled PDF…'}</div>}
      {pdf && <div ref={paperList} className="pdf-pages" style={{ height: totalHeight, width: view.width * position.zoom }}>
        {layouts.map(layout => {
          const marker = validJump?.page === layout.page && expiredJump !== jumpKey ? validJump : null;
          const left = marker ? Math.max(0, Math.min(marker.x * layout.scale, layout.width - 8)) : 0, top = marker ? Math.max(0, Math.min(marker.y * layout.scale, layout.height - 8)) : 0;
          return <div key={`${build?.id}:${layout.page}`} className="pdf-paper" data-pdf-page={layout.page} style={{ position: 'absolute', top: layout.top, width: layout.width, height: layout.height, '--scale-factor': layout.scale, '--total-scale-factor': layout.scale } as React.CSSProperties} aria-label={`PDF page ${layout.page}`}>
            {renderedPages.has(layout.page) ? <RenderedPage activeNote={targetNote?.page === layout.page ? changeTarget?.id : undefined} changeIds={changeIds} onChangeNote={onChangeNote} pdf={pdf} layout={layout} matches={matchesByPage.get(layout.page) ?? noMatches} active={active?.page === layout.page ? active : undefined} onReady={pageReady} /> : <span className="pdf-page-placeholder">Page {layout.page}</span>}
            {marker && <div key={jumpKey} data-pdf-jump={layout.page} className={`pdf-passage-marker ${marker.persistent ? 'persistent' : ''} ${emphasis === jumpKey ? 'emphasize' : ''}`} style={{ left, top, width: Math.min(Math.max(8, marker.width * layout.scale), layout.width - left), height: Math.min(Math.max(8, marker.height * layout.scale), layout.height - top), '--passage-left': `${left}px`, '--cue-height': `${Math.min(28, Math.max(8, marker.height * layout.scale), layout.height - top)}px`, '--cue-pad': `${Math.min(2, Math.max(8, marker.height * layout.scale) * .12)}px` } as React.CSSProperties} role="img" aria-label="Approximate source passage in PDF" title="Nearby typeset line. Source-to-PDF mapping may identify a region rather than the exact quotation." />}
          </div>;
        })}
      </div>}
    </div>
  </section>;
}
