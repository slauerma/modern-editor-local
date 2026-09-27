import type { DebugInteraction } from '../shared/debugging.ts';

// Optional, app-local debugging. This never participates in editor state,
// model context, source saving or acceptance. Only bounded action metadata.
export function traceInteraction(action: DebugInteraction['action'], fields: Omit<DebugInteraction, 'action'> = {}) {
  try { void window.editor.debugInteraction?.({ action, ...fields }).catch(() => {}); } catch { /* Editing works without debugging. */ }
}
