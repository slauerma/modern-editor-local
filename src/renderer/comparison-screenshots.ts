import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerURL from 'pdfjs-dist/build/pdf.worker.mjs?url';
import type { ChangesScreenshot } from '../shared/changes-agent.ts';
GlobalWorkerOptions.workerSrc = workerURL;

/** Render the exact comparison PDF, without scrolling or capturing other panes.
 * These request images are temporary; keeping a debug copy is a separate opt-in. */
export async function comparisonScreenshots(buildId: string, pages: number[], current: () => boolean): Promise<ChangesScreenshot[]> {
  if (pages.length > 3 || !pages.length) throw new Error('Invalid visual inspection request.');
  const data = await window.editor.getPdf(buildId);
  if (!current()) throw new Error('Comparison changed before visual inspection.');
  const task = getDocument({ data: new Uint8Array(data) });
  try {
    const pdf = await task.promise, screenshots: ChangesScreenshot[] = [];
    for (const number of pages) {
      if (!current()) throw new Error('Comparison changed before visual inspection.');
      if (!Number.isInteger(number) || number < 1 || number > pdf.numPages) throw new Error('The requested comparison page is unavailable.');
      const page = await pdf.getPage(number), natural = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(1440 / natural.width, 2000 / natural.height) });
      const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      const render = page.render({ canvas, viewport });
      const timer = setTimeout(() => render.cancel(), 15000);
      try { await render.promise;
        if (!current()) throw new Error('Comparison changed during visual inspection.');
        const dataUrl = canvas.toDataURL('image/png');
        if (dataUrl.length > 2_700_000) throw new Error('The comparison screenshot is too large. Use Text diff.');
        screenshots.push({ page: number, dataUrl });
      } finally { clearTimeout(timer); canvas.width = 0; canvas.height = 0; page.cleanup(); }
    }
    return screenshots;
  } finally { await task.destroy(); }
}
