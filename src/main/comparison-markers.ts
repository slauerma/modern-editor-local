import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';

export type ComparisonMarker = { page: number; x: number; y: number; width: number; height: number };
export type ComparisonMarkerReader = (bytes: Uint8Array, ids: string[], signal: AbortSignal) => Promise<Record<string, ComparisonMarker>>;

// Read only the destinations and matching link rectangles in our generated
// PDF. SyncTeX can point to another page for a deferred margin note. Never
// replace a missing destination with a nearby source line or guessed position.
// PDF parsing is isolated, bounded and cancellable even for a malformed file.
const workerSource = `
const { parentPort, workerData } = require('node:worker_threads');
(async () => {
  const { getDocument } = await import(workerData.module);
  const task = getDocument({ data: new Uint8Array(workerData.bytes), verbosity: 0,
    disableFontFace: true, useSystemFonts: false, useWorkerFetch: false,
    useWasm: false, enableXfa: false, disableAutoFetch: true,
    disableStream: true, stopAtErrors: true, isEvalSupported: false });
  try {
    const pdf = await task.promise, result = {}, pages = new Map();
    if (pdf.numPages < 1 || pdf.numPages > 2000) throw Error('Unsupported comparison page count.');
    for (const id of workerData.ids) {
      const number = id.slice(7), dest = await pdf.getDestination('MECompare-' + number);
      if (!dest) continue;
      const index = typeof dest[0] === 'number' ? dest[0] : await pdf.getPageIndex(dest[0]);
      if (!Number.isInteger(index) || index < 0 || index >= pdf.numPages) continue;
      if (!pages.has(index)) {
        const page = await pdf.getPage(index + 1);
        pages.set(index, { viewport: page.getViewport({ scale: 1 }), notes: await page.getAnnotations({ intent: 'display' }) });
      }
      const { viewport, notes } = pages.get(index);
      const matches = notes.filter(n => n.url === 'https://modern-editor.invalid/changes/' + number);
      if (matches.length !== 1) continue;
      const rect = matches[0].rect;
      if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(Number.isFinite)) continue;
      const [x1, y1] = viewport.convertToViewportPoint(rect[0], rect[1]);
      const [x2, y2] = viewport.convertToViewportPoint(rect[2], rect[3]);
      const x = Math.min(x1, x2), y = Math.min(y1, y2), width = Math.abs(x2 - x1), height = Math.abs(y2 - y1);
      if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > viewport.width || y + height > viewport.height) continue;
      result[id] = { page: index + 1, x, y, width, height };
    }
    parentPort.postMessage({ ok: true, markers: result });
  } finally { await task.destroy(); }
})().catch(() => parentPort.postMessage({ ok: false }));
`;

export function readComparisonMarkers(bytes: Uint8Array, ids: string[], signal: AbortSignal,
  modulePath = path.resolve('node_modules/pdfjs-dist/legacy/build/pdf.mjs')): Promise<Record<string, ComparisonMarker>> {
  if (signal.aborted) return Promise.reject(new Error('Changes PDF cancelled.'));
  if (ids.length > 100 || ids.some(id => !/^change-[1-9]\d{0,2}$/.test(id)) || new Set(ids).size !== ids.length || bytes.byteLength > 100_000_000) {
    return Promise.reject(new Error('Invalid comparison marker request.'));
  }
  const worker = new Worker(workerSource, { eval: true,
    workerData: { module: pathToFileURL(modulePath).href, bytes, ids },
    resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 }, stdout: true, stderr: true });
  worker.stdout.resume(); worker.stderr.resume();
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = async (error: Error | null, markers?: Record<string, ComparisonMarker>) => {
      if (finished) return; finished = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
      await worker.terminate();
      if (error) reject(error); else resolve(markers!);
    };
    const abort = () => { void finish(new Error('Changes PDF cancelled.')); };
    const timer = setTimeout(() => { void finish(new Error('Comparison marker reading took too long. Use Text diff.')); }, 15000);
    worker.once('message', result => { void finish(result.ok ? null : new Error('The comparison markers could not be read. Use Text diff.'), result.markers); });
    worker.once('error', () => { void finish(new Error('The comparison markers could not be read. Use Text diff.')); });
    worker.once('exit', () => { void finish(new Error('Comparison marker reading stopped.')); });
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
