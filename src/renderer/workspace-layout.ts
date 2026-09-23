import type { WorkspaceState } from '../shared/contracts.ts';
export type Arrangement = 'source-comments' | 'pdf-comments' | 'source' | 'writing' | 'three' | 'tabs' | 'stacked';
export function resolveLayout(mode: WorkspaceState['layout'], commentsHidden: boolean, pdfOpen: boolean, size: { width: number; height: number }): Arrangement {
  if (commentsHidden) return pdfOpen ? 'writing' : 'source';
  if (!pdfOpen) return 'source-comments';
  if (mode !== 'auto' && mode !== 'writing') return mode;
  return size.width >= 1380 && size.height >= 620 ? 'three' : 'tabs';
}
