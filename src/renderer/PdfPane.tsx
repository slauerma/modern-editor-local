import { createPortal } from 'react-dom';
import { ActionMenu } from './ActionMenu.tsx';
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref, type RefObject } from 'react';
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
export type PdfSourcePoint = { buildId: string; page: number; x: number; y: number };
export type PdfPaneHandle = { find: () => void; position: () => PdfPosition };
type Props = { emptyMessage?: string; onSource?: (point: PdfSourcePoint) => void; changeStates?: Record<string, string>; regionStates?: Record<string, string>; tentativeRegions?: string[]; onChangeRegion?: (id: string, index: number) => void; toolbarHost?: RefObject<HTMLDivElement>; compactControls?: boolean; onExport?: () => void; findHandle?: Ref<PdfPaneHandle>; bottomOverlay?: RefObject<HTMLElement>; bottomControls?: boolean; hideState?: boolean; onFind?: () => void; changeTarget?: PdfChangeTarget | null; hideClose?: boolean; hideFollow?: boolean; showChangeNotes?: boolean; changeIds?: string[]; onChangeNote?: (id: string) => void; build: Build | null; freshness: string; position: PdfPosition; visible?: boolean; followComments: boolean; onFollowChange: (value: boolean) => void; jump?: PdfJump | null; onPositionChange: (position: Partial<PdfPosition>) => void; onUserNavigate: () => void; onClose: () => void };
type Loaded = { id: string; document: PDFDocumentProxy; sizes: PdfPageSize[] };
const positionKey = (position: PdfPosition) => [position.page, position.zoom, position.fit ?? '', position.scrollX ?? 0, position.scrollY ?? 0, !!position.flow].join(':');
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

function RenderedPage({ changeStates, regionStates, tentativeRegions, onChangeRegion, pdf, layout, matches, active, onReady, changeIds, showChangeNotes = false, onChangeNote, activeNote }: { changeStates?: Record<string, string>; regionStates?: Record<string, string>; tentativeRegions?: string[]; onChangeRegion?: (id: string, index: number) => void; activeNote?: string; showChangeNotes?: boolean; changeIds?: string[]; onChangeNote?: (id: string) => void; pdf: PDFDocumentProxy; layout: PdfPageLayout; matches: PdfSearchMatch[]; active?: PdfSearchMatch; onReady: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null), container = useRef<HTMLDivElement>(null), text = useRef<TextLayer | null>(null);
  const [notes, setNotes] = useState<{ id: string; rect: number[]; region?: number }[]>([]);
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
          const match = /^https:\/\/modern-editor\.invalid\/changes\/(\d+)(?:\/edit\/(\d+))?$/.exec(a.url ?? '');
          if (!match || !Array.isArray(a.rect)) return [];
          return [{ id: 'change-' + match[1], region: match[2] === undefined ? undefined : Number(match[2]), rect: [...viewport.convertToViewportPoint(a.rect[0], a.rect[1]), ...viewport.convertToViewportPoint(a.rect[2], a.rect[3])] }];
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
    {notes.filter(n => n.region === undefined && changeIds?.includes(n.id)).map((n, i) => <button key={i} data-change-note={n.id} aria-hidden={!showChangeNotes} disabled={!showChangeNotes} className={"pdf-change-note" + (changeStates?.[n.id] ? " review-" + changeStates[n.id].toLowerCase() : "") + (activeNote === n.id ? " selected" : "")} aria-label={'Explain change ' + n.id.replace('change-', '')} title={changeStates?.[n.id] ? changeStates[n.id] + " · inspect change" : "Show change explanation"} style={{ visibility: showChangeNotes ? 'visible' : 'hidden', fontSize: Math.max(10, layout.scale * 8), left: Math.min(n.rect[0], n.rect[2]), top: Math.min(n.rect[1], n.rect[3]), width: Math.max(18, Math.abs(n.rect[2] - n.rect[0])), height: Math.max(18, Math.abs(n.rect[3] - n.rect[1])) }} onClick={() => onChangeNote?.(n.id)}>[{n.id.replace('change-', '')}]</button>)}
    {onChangeRegion && showChangeNotes && notes.filter(n => n.region !== undefined && changeIds?.includes(n.id)).map((n, i) => <button key={'region-' + i} className={'pdf-review-region' + (tentativeRegions?.includes(n.id + ':' + n.region) ? ' tentative' : '')} aria-label={(regionStates?.[n.id + ':' + n.region] ?? 'Manual/unlinked change') + ' edit · change ' + n.id.replace('change-', '')} title="Inspect this edit" style={{ left: Math.min(n.rect[0], n.rect[2]), top: Math.min(n.rect[1], n.rect[3]), width: Math.max(2, Math.abs(n.rect[2] - n.rect[0])), height: Math.max(2, Math.abs(n.rect[3] - n.rect[1])) }} onClick={() => onChangeRegion(n.id, n.region!)} />)}
  </>;
}

export function PdfPane({ emptyMessage = "Compile the paper to see its actual PDF here.", onSource, changeStates, regionStates, tentativeRegions, onChangeRegion, toolbarHost, compactControls = false, onExport, findHandle, bottomOverlay, bottomControls = false, hideState = false, onFind, changeTarget, hideClose = false, hideFollow = false, changeIds, showChangeNotes = false, onChangeNote, build, freshness, position, visible = true, followComments, onFollowChange, jump, onPositionChange, onUserNavigate, onClose }: Props) {
  const sourceBuild = useRef(build?.id); sourceBuild.current = build?.id;
  const [sourceMenu, setSourceMenu] = useState<{ page: number; x: number; y: number; left: number; top: number } | null>(null);
  const sourceMenuRef = useRef<HTMLDivElement>(null), [sourceNotice, setSourceNotice] = useState('');
  useEffect(() => { setSourceMenu(null); setSourceNotice(''); }, [build?.id, visible]);
  useEffect(() => {
    if (!sourceMenu) return;
    sourceMenuRef.current?.querySelector('button')?.focus({ preventScroll: true });
    const close = (event: Event) => { if (!sourceMenuRef.current?.contains(event.target as Node)) setSourceMenu(null); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setSourceMenu(null); };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', key); window.addEventListener('resize', close);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', key); window.removeEventListener('resize', close); };
  }, [sourceMenu]);
  const [controlsHost, setControlsHost] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => { setControlsHost(toolbarHost?.current ?? null); }, [toolbarHost, visible]);
  const [loaded, setLoaded] = useState<Loaded | null>(null), [error, setError] = useState(''), [progress, setProgress] = useState('');
  const [view, setView] = useState({ width: 440, height: 600, top: 0 }), [pageDraft, setPageDraft] = useState(String(position.page));
  const scroll = useRef<HTMLDivElement>(null), paperList = useRef<HTMLDivElement>(null), findInput = useRef<HTMLInputElement>(null);
  const callbacks = useRef({ onPositionChange, onUserNavigate }); callbacks.current = { onPositionChange, onUserNavigate };
  const positionRef = useRef(position); positionRef.current = position;
  const visibleRef = useRef(visible); visibleRef.current = visible;
  const layoutRef = useRef<PdfPageLayout[]>([]), lastPublished = useRef(''), appliedLayout = useRef<PdfPageLayout[] | null>(null);
  const publishedBuild = useRef<string | null>(null), scrollFrame = useRef(0);
  const current = loaded?.id === build?.id ? loaded : null, pdf = current?.document ?? null;
  const fitHeight = position.fit === 'page' ? Math.max(1, view.height - 40) : undefined;
  const layouts = useMemo(() => layoutPdfPages(current?.sizes ?? [], view.width, position.zoom, fitHeight), [current, view.width, position.zoom, fitHeight]); layoutRef.current = layouts;
  const page = pdfPage(position.page, pdf?.numPages ?? 1);
  const [findOpen, setFindOpen] = useState(false), [query, setQuery] = useState(''), [debouncedQuery, setDebouncedQuery] = useState('');
  const [findFocusRequest, setFindFocusRequest] = useState(0);
  useLayoutEffect(() => {
    if (findOpen && visibleRef.current) { findInput.current?.focus(); findInput.current?.select(); }
  }, [findOpen, findFocusRequest]);
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
  // Resolve actual comparison destinations for all changes. Margin notes can
  // move to another page; source-line positions are not reliable for them.
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
      const next = pdfPositionAtScroll(pages, node.scrollTop, node.scrollLeft, node.scrollWidth - node.clientWidth, positionRef.current.zoom, positionRef.current.fit);
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
      setView(previous => previous.width === width && previous.height === node.clientHeight ? previous : { ...previous, width, height: node.clientHeight });
    });
    resize.observe(node);
    return () => { resize.disconnect(); cancelAnimationFrame(scrollFrame.current); };
  }, []);
  useEffect(() => {
    // A text-only comparison destroys the previous PDF task. Clear its proxy
    // too, so returning to a reused build ID cannot resurrect that document.
    if (!build) { setLoaded(null); setProgress(''); setError(''); return; }
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
    if (changedBuild) node.style.paddingBottom = '';
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
    const overlay = bottomOverlay?.current?.getBoundingClientRect();
    const visibleHeight = overlay && overlay.height > 0 && overlay.right > viewport.left && overlay.left < viewport.right && overlay.bottom > viewport.top
      ? Math.max(0, Math.min(node.clientHeight, overlay.top - viewport.top)) : node.clientHeight;
    // Only deliberate navigation reveals a target above the explanation.
    // Toggling the overlay itself never changes PDF layout or reading position.
    const nextTop = node.scrollTop + revealOffset(target.top - viewport.top, target.height, visibleHeight);
    const missingRoom = nextTop - Math.max(0, node.scrollHeight - node.clientHeight);
    if (visibleHeight < node.clientHeight && missingRoom > 0) {
      // A marker near the final page needs scroll room above the panel too.
      // Add only the missing allowance, retain it across Why toggles, and
      // reset it with the next PDF. Existing page positions remain unchanged.
      node.style.paddingBottom = Math.ceil(parseFloat(getComputedStyle(node).paddingBottom) + missingRoom) + 'px';
    }
    node.scrollTop = nextTop;
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
  function openFind() {
    if (!visibleRef.current) return;
    onFind?.(); setFindOpen(true); setFindFocusRequest(value => value + 1);
  }
  useImperativeHandle(findHandle, () => ({ find: openFind, position: () => {
    const node = scroll.current;
    return node && layouts.length ? pdfPositionAtScroll(layouts, node.scrollTop, node.scrollLeft, node.scrollWidth - node.clientWidth, positionRef.current.zoom, positionRef.current.fit) : positionRef.current;
  } }));
  async function showSource(point: { page: number; x: number; y: number }) {
    setSourceMenu(null); setSourceNotice('');
    if (!pdf || !build || !onSource) return;
    const id = build.id;
    try {
      const page = await pdf.getPage(point.page), layout = layouts[point.page - 1];
      if (sourceBuild.current !== id || !visibleRef.current) return;
      if (page.view[0] !== 0 || page.view[1] !== 0 || page.userUnit !== 1) throw new Error('Source jumps are unavailable for cropped or rescaled PDF pages.');
      const [x, y] = page.getViewport({ scale: layout.scale }).convertToPdfPoint(point.x, point.y);
      onSource({ buildId: id, page: point.page, x: Math.max(0, x), y: Math.max(0, page.view[3] - y) });
    } catch (e) { if (sourceBuild.current === id) setSourceNotice(String(e instanceof Error ? e.message : e)); }
  }
  const searching = query !== debouncedQuery;
  const matchStatus = searching ? 'Searching…' : query.trim() ? result.matches.length ? `${active ? selection.index + 1 : 0} / ${result.matches.length}${result.limited ? '+' : ''}` : index.status === 'indexing' ? 'No matches yet' : 'No matches' : 'Find text in this PDF';
  const totalHeight = layouts.length ? layouts.at(-1)!.top + layouts.at(-1)!.height : 0;
  const stateLabel = !build ? 'No PDF yet' : build.purpose === 'comparison' || build.purpose === 'proposal' ? freshness : freshness.includes('Preview') ? 'Preview · not applied' : freshness.includes('Candidate') ? 'Candidate · not applied' : build.dependenciesVerified === false || freshness.includes('verification') ? 'Unverified inputs' : freshness.includes('matches') ? 'Current draft' : 'Earlier PDF';
  const pageControls = <div className="pdf-page-controls"><button type="button" disabled={!pdf || page <= 1} onClick={() => changePage(page - 1)} aria-label="Previous PDF page">‹</button><input aria-label="PDF page number" type="number" min={1} max={pdf?.numPages ?? 1} disabled={!pdf} value={pageDraft} onChange={event => { userNavigate(); setPageDraft(event.target.value); }} onBlur={goToPage} /><span>/ {pdf?.numPages ?? '–'}</span><button type="button" disabled={!pdf || page >= pdf.numPages} onClick={() => changePage(page + 1)} aria-label="Next PDF page">›</button></div>;
  const zoomControl = <select aria-label="PDF zoom" value={position.fit ?? position.zoom} onChange={event => { userNavigate(); callbacks.current.onPositionChange(event.target.value === 'page' ? { zoom: 1, fit: 'page', scrollY: 0, scrollX: 0 } : { zoom: Number(event.target.value), fit: undefined }); }}><option value={1}>Fit width</option><option value="page">Fit page</option><option value={1.25}>1.25× fit</option><option value={1.5}>1.5× fit</option><option value={2}>2× fit</option></select>;
  const menuItems = <>
    {!hideFollow && <button type="button" className="pdf-follow" aria-label="PDF follows comments" aria-pressed={followComments} onClick={() => onFollowChange(!followComments)}>Follow selected comments</button>}
    <button type="button" disabled={!build?.success} onClick={() => onExport?.()}>Save displayed PDF…</button>
    {onSource && <small>Command-click (Ctrl-click on Windows/Linux) a passage to show its LaTeX. Or right-click → Show in LaTeX.</small>}
    <small>{freshness}</small>
  </>;
  const controls = <form className={'pdf-controls' + (compactControls ? ' compact-pdf-controls' : '')} onSubmit={event => { event.preventDefault(); goToPage(); }}>
    {!hideState && !compactControls && <span className={`pdf-state ${stateLabel === 'Current draft' ? 'current' : 'older'}`} title={freshness} aria-label={freshness}>{stateLabel}</span>}
    {<>{pageControls}{zoomControl}<button type="button" className="pdf-find-toggle" aria-expanded={findOpen} onClick={() => findOpen ? setFindOpen(false) : openFind()}>Find</button></>}
    <ActionMenu label="⋯" menuLabel="PDF options"><div>{menuItems}</div></ActionMenu>
    {!hideClose && <button type="button" className="icon" onClick={onClose} aria-label="Close PDF">×</button>}
  </form>;
  return <section hidden={!visible} className={"pdf-reader continuous-pdf" + (bottomControls ? " bottom-controls" : "") + (toolbarHost ? " hosted-controls" : "")} aria-label="Compiled PDF" onKeyDown={event => {
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'f') { event.preventDefault(); event.stopPropagation(); openFind(); }
  }}>
    {sourceMenu && <div ref={sourceMenuRef} className="pdf-source-menu" role="menu" aria-label="PDF passage actions" style={{ left: Math.max(8, Math.min(sourceMenu.left, window.innerWidth - 190)), top: Math.max(8, Math.min(sourceMenu.top, window.innerHeight - 60)) }}><button role="menuitem" onClick={() => void showSource(sourceMenu)}>Show in LaTeX</button></div>}
    {sourceNotice && <div className="pdf-navigation" role="status">{sourceNotice}<button aria-label="Dismiss navigation message" onClick={() => setSourceNotice('')}>×</button></div>}
    {toolbarHost ? controlsHost && createPortal(controls, controlsHost) : controls}
    {findOpen && <div className="pdf-search" role="search" aria-label="Search PDF">
      <form className="pdf-search-controls" onSubmit={event => { event.preventDefault(); stepMatch(1); }}>
        <input ref={findInput} aria-label="Find in PDF" value={query} maxLength={PDF_SEARCH_QUERY_LIMIT} placeholder="Find in PDF…" onChange={event => { setQuery(event.target.value); setSelection({ key: '', index: -1 }); setSearchTarget(null); }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setFindOpen(false); scroll.current?.focus(); } else if (event.key === 'Enter' && event.shiftKey) { event.preventDefault(); stepMatch(-1); } }} />
        <span className="pdf-match-count" role="status">{matchStatus}</span><button type="button" disabled={!result.matches.length} onClick={() => stepMatch(-1)} aria-label="Previous PDF match">↑</button><button type="submit" disabled={!result.matches.length} aria-label="Next PDF match">↓</button><button type="button" onClick={() => setFindOpen(false)} aria-label="Close PDF search">×</button>
      </form>
      <div className="pdf-search-status" aria-live="polite">{index.status === 'indexing' ? <>Indexing {index.pages.length} / {pdf?.numPages ?? 0} pages… <button type="button" onClick={index.pause}>Stop</button></> : index.status === 'paused' ? <>{index.pages.length} pages indexed. <button type="button" onClick={index.resume}>Continue indexing</button></> : index.notice || (index.status === 'complete' ? `All ${index.pages.length} pages searched. Text only; images are not searched.` : 'Search uses the displayed PDF, including an older or candidate preview.')}{result.limited && <> Showing the first {PDF_SEARCH_MATCH_LIMIT.toLocaleString()} matches; narrow the search.</>}{query.length === PDF_SEARCH_QUERY_LIMIT && <> Query limit: {PDF_SEARCH_QUERY_LIMIT} characters.</>}</div>
    </div>}
    {noteError && <p className="changes-pdf-notice" role="status">{noteError}</p>}
    <div className="pdf-scroll" ref={scroll} tabIndex={0} onWheel={userNavigate} onPointerDown={userNavigate} onTouchStart={userNavigate} onKeyDown={event => { if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) userNavigate(); }} onScroll={() => { cancelAnimationFrame(scrollFrame.current); scrollFrame.current = requestAnimationFrame(() => readScroll()); }}>
      {!build && <div className="empty-pdf">{emptyMessage}</div>}
      {error && <p role="alert">{error}</p>}
      {build && !pdf && !error && <div className="empty-pdf" role="status">{progress || 'Loading compiled PDF…'}</div>}
      {pdf && <div ref={paperList} className="pdf-pages" style={{ height: totalHeight, width: view.width * position.zoom }}>
        {layouts.map(layout => {
          const marker = validJump?.page === layout.page && expiredJump !== jumpKey ? validJump : null;
          const left = marker ? Math.max(0, Math.min(marker.x * layout.scale, layout.width - 8)) : 0, top = marker ? Math.max(0, Math.min(marker.y * layout.scale, layout.height - 8)) : 0;
          return <div key={`${build?.id}:${layout.page}`} className="pdf-paper" data-pdf-page={layout.page}
            onClick={event => {
              if (!onSource || !(event.metaKey || event.ctrlKey) || (event.target as Element).closest('button,a,input')) return;
              event.preventDefault(); event.stopPropagation();
              const rect = event.currentTarget.getBoundingClientRect();
              void showSource({ page: layout.page, x: event.clientX - rect.left, y: event.clientY - rect.top });
            }}
            onContextMenu={event => {
              if (!onSource || (event.target as Element).closest('button,a,input')) return;
              event.preventDefault();
              const rect = event.currentTarget.getBoundingClientRect();
              setSourceMenu({ page: layout.page, x: event.clientX - rect.left, y: event.clientY - rect.top, left: event.clientX, top: event.clientY });
            }} style={{ position: 'absolute', top: layout.top, left: position.fit === 'page' ? (view.width - layout.width) / 2 : 0, width: layout.width, height: layout.height, '--scale-factor': layout.scale, '--total-scale-factor': layout.scale } as React.CSSProperties} aria-label={`PDF page ${layout.page}`}>
            {renderedPages.has(layout.page) ? <RenderedPage changeStates={changeStates} regionStates={regionStates} tentativeRegions={tentativeRegions} onChangeRegion={onChangeRegion} activeNote={targetNote?.page === layout.page ? changeTarget?.id : undefined} changeIds={changeIds} showChangeNotes={showChangeNotes} onChangeNote={onChangeNote} pdf={pdf} layout={layout} matches={matchesByPage.get(layout.page) ?? noMatches} active={active?.page === layout.page ? active : undefined} onReady={pageReady} /> : <span className="pdf-page-placeholder">Page {layout.page}</span>}
            {marker && <div key={jumpKey} data-pdf-jump={layout.page} className={`pdf-passage-marker ${marker.persistent ? 'persistent' : ''} ${emphasis === jumpKey ? 'emphasize' : ''}`} style={{ left, top, width: Math.min(Math.max(8, marker.width * layout.scale), layout.width - left), height: Math.min(Math.max(8, marker.height * layout.scale), layout.height - top), '--passage-left': `${left}px`, '--cue-height': `${Math.min(28, Math.max(8, marker.height * layout.scale), layout.height - top)}px`, '--cue-pad': `${Math.min(2, Math.max(8, marker.height * layout.scale) * .12)}px` } as React.CSSProperties} role="img" aria-label="Approximate source passage in PDF" title="Nearby typeset line. Source-to-PDF mapping may identify a region rather than the exact quotation." />}
          </div>;
        })}
      </div>}
    </div>
  </section>;
}
