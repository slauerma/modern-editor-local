import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist';
import workerURL from 'pdfjs-dist/build/pdf.worker.mjs?url';
import 'pdfjs-dist/web/pdf_viewer.css';
import type { Build } from '../shared/contracts.ts';
import { pdfPage, revealOffset, type PdfPosition, type PdfJump } from './pdf-position.ts';
GlobalWorkerOptions.workerSrc = workerURL;

export function PdfPane({ build, freshness, position, jump, onPositionChange, onUserNavigate, onClose }: { build: Build | null; freshness: string; position: PdfPosition; jump?: PdfJump | null; onPositionChange: (position: Partial<PdfPosition>) => void; onUserNavigate: () => void; onClose: () => void }) {
  const [loaded, setLoaded] = useState<{ id: string; document: PDFDocumentProxy } | null>(null), [error, setError] = useState('');
  const { page, zoom } = position, positionRef = useRef(position); positionRef.current = position;
  const [pageDraft, setPageDraft] = useState(String(page));
  useEffect(() => setPageDraft(String(page)), [page]);
  function changePage(page: number) { onUserNavigate(); onPositionChange({ page, scrollX: 0, scrollY: 0 }); }
  function goToPage() { const next = pdfPage(Number(pageDraft), pdf?.numPages ?? 1); setPageDraft(String(next)); if (next !== page) changePage(next); }
  const pdf = loaded?.id === build?.id ? loaded?.document : null;
  const [width, setWidth] = useState(440), [rendered, setRendered] = useState(false);
  const [renderKey, setRenderKey] = useState(''), [marker, setMarker] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const scale = useRef(1), lastJump = useRef(-1);
  const scroll = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), layer = useRef<HTMLDivElement>(null), paper = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const ro = new ResizeObserver(entries => setWidth(Math.max(200, entries[0].contentRect.width - 40)));
    if (scroll.current) ro.observe(scroll.current);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (!build) return;
    let disposed = false, task: ReturnType<typeof getDocument> | undefined;
    setError(''); setRendered(false);
    void window.editor.getPdf(build.id).then(bytes => {
      if (disposed) return;
      task = getDocument({ data: new Uint8Array(bytes) });
      return task.promise.then(document => { if (!disposed) { setLoaded({ id: build.id, document }); onPositionChange({ page: pdfPage(positionRef.current.page, document.numPages) }); } });
    }).catch(e => { if (!disposed) setError(String(e)); });
    return () => { disposed = true; void task?.destroy(); };
  }, [build?.id]);
  useEffect(() => {
    if (!pdf || !canvas.current || !layer.current || !paper.current) return;
    let disposed = false, render: RenderTask | undefined, text: TextLayer | undefined;
    setRendered(false); setError('');
    const node = canvas.current, textNode = layer.current, paperNode = paper.current;
    void pdf.getPage(pdfPage(page, pdf.numPages)).then(async p => {
      if (disposed) return;
      const natural = p.getViewport({ scale: 1 }), viewport = p.getViewport({ scale: width / natural.width * zoom });
      scale.current = viewport.scale;
      const dpr = window.devicePixelRatio || 1;
      node.width = Math.ceil(viewport.width * dpr); node.height = Math.ceil(viewport.height * dpr);
      node.style.width = `${viewport.width}px`; node.style.height = `${viewport.height}px`;
      paperNode.style.width = `${viewport.width}px`; paperNode.style.height = `${viewport.height}px`;
      paperNode.style.setProperty('--scale-factor', String(viewport.scale));
      paperNode.style.setProperty('--total-scale-factor', String(viewport.scale));
      textNode.replaceChildren();
      render = p.render({ canvas: node, viewport, transform: [dpr, 0, 0, dpr, 0, 0] });
      await render.promise;
      if (disposed) return;
      const content = await p.getTextContent();
      if (disposed) return;
      text = new TextLayer({ textContentSource: content, container: textNode, viewport });
      await text.render();
      if (!disposed) {
        const scroller = scroll.current, saved = positionRef.current;
        if (scroller) { scroller.scrollTop = (saved.scrollY ?? 0) * Math.max(0, scroller.scrollHeight - scroller.clientHeight); scroller.scrollLeft = (saved.scrollX ?? 0) * Math.max(0, scroller.scrollWidth - scroller.clientWidth); }
        setRendered(true);
        setRenderKey(`${build?.id}:${page}:${width}:${zoom}`);
      }
    }).catch(e => { if (!disposed && e?.name !== 'RenderingCancelledException') setError(String(e)); });
    return () => { disposed = true; render?.cancel(); text?.cancel(); };
  }, [pdf, page, width, zoom]);
  useEffect(() => {
    setMarker(null);
    if (!jump || jump.buildId !== build?.id || jump.page !== page || !rendered || renderKey !== `${build?.id}:${page}:${width}:${zoom}`) return;
    const paperNode = paper.current, scroller = scroll.current;
    if (!paperNode || !scroller) return;
    const left = Math.min(jump.x * scale.current, paperNode.clientWidth - 8), top = Math.min(jump.y * scale.current, paperNode.clientHeight - 8);
    const box = { left: Math.max(0, left), top: Math.max(0, top), width: Math.min(jump.width * scale.current, paperNode.clientWidth - left), height: Math.min(Math.max(8, jump.height * scale.current), paperNode.clientHeight - top) };
    setMarker(box);
    if (lastJump.current !== jump.requestId) {
      lastJump.current = jump.requestId;
      const paperRect = paperNode.getBoundingClientRect(), scrollRect = scroller.getBoundingClientRect();
      scroller.scrollTop += revealOffset(paperRect.top - scrollRect.top + box.top, box.height, scroller.clientHeight);
      scroller.scrollLeft += revealOffset(paperRect.left - scrollRect.left + box.left, box.width, scroller.clientWidth);
    }
    if (jump.persistent) return;
    const timer = setTimeout(() => setMarker(null), 3000);
    return () => clearTimeout(timer);
  }, [jump?.requestId, build?.id, page, width, zoom, rendered, renderKey]);
  return <section className="pdf-pane" aria-label="Compiled PDF">
    <form className="pdf-controls" onSubmit={event => { event.preventDefault(); goToPage(); }}><span className={`pdf-state ${freshness.includes('matches') ? 'current' : 'older'}`} title={freshness} aria-label={freshness}>{!build || freshness.includes('matches') ? 'PDF' : freshness.includes('Candidate') ? 'Candidate' : 'Older PDF'}</span><button type="button" disabled={!pdf || page <= 1} onClick={() => changePage(page - 1)} aria-label="Previous PDF page">‹</button><input aria-label="PDF page number" type="number" min={1} max={pdf?.numPages ?? 1} disabled={!pdf} value={pageDraft} onChange={event => { onUserNavigate(); setPageDraft(event.target.value); }} onBlur={goToPage} /><span>/ {pdf?.numPages ?? '–'}</span><button type="button" disabled={!pdf || page >= pdf.numPages} onClick={() => changePage(page + 1)} aria-label="Next PDF page">›</button><select aria-label="PDF zoom" value={zoom} onChange={e => { onUserNavigate(); onPositionChange({ zoom: Number(e.target.value) }); }}><option value={1}>Fit width</option><option value={1.25}>125%</option><option value={1.5}>150%</option><option value={2}>200%</option></select><button type="button" className="icon" onClick={onClose} aria-label="Close PDF">×</button></form>
    {/* Cancel only on deliberate input. Restoring a position or revealing a hit
        also scrolls, and must not invalidate its own navigation request. */}
    <div className="pdf-scroll" ref={scroll} tabIndex={0} onWheel={onUserNavigate} onPointerDown={onUserNavigate} onTouchStart={onUserNavigate} onKeyDown={e => { if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) onUserNavigate(); }} onScroll={e => { if (!rendered || !e.currentTarget.clientHeight) return; const node = e.currentTarget; onPositionChange({ scrollX: node.scrollLeft / Math.max(1, node.scrollWidth - node.clientWidth), scrollY: node.scrollTop / Math.max(1, node.scrollHeight - node.clientHeight) }); }}>
      {!build && <div className="empty-pdf">Compile the paper to see its actual PDF here.</div>}
      {error && <p role="alert">{error}</p>}
      {build && !pdf && !error && <div className="empty-pdf" role="status">Loading compiled PDF…</div>}
      {build && <div className="pdf-paper" ref={paper} style={{ visibility: pdf && rendered ? 'visible' : 'hidden' }} aria-label={`PDF page ${page}${pdf && rendered ? ', rendered' : ', loading'}`}><canvas ref={canvas} /><div ref={layer} className="textLayer" />{marker && <div key={jump?.requestId} className={`pdf-passage-marker ${jump?.persistent ? 'persistent' : ''}`} style={marker} role="img" aria-label="Approximate source passage in PDF" />}</div>}
    </div>
  </section>;
}
