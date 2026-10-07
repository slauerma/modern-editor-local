import { controls, type Control } from './tex-structure.ts';

// Literal Beamer structure only. Macro-generated frames and argument bodies
// stay opaque; this scanner never expands or rewrites the author's source.
function space(text: string, at: number) {
  while (at < text.length) {
    if (/\s/.test(text[at])) at++;
    else if (text[at] === '%') { const end = text.indexOf('\n', at); at = end < 0 ? text.length : end + 1; }
    else break;
  }
  return at;
}
export function beamerArgument(text: string, at: number, open = '{', close = '}') {
  at = space(text, at);
  if (text[at] !== open) return null;
  const from = at; let depth = 1;
  for (at++; at < text.length; at++) {
    if (text[at] === '%') { const end = text.indexOf('\n', at); if (end < 0) return null; at = end; continue; }
    if (text[at] === '\\') { at++; continue; }
    if (text[at] === open) depth++;
    if (text[at] === close && --depth === 0) return { from, to: at + 1, value: text.slice(from + 1, at) };
  }
  return null;
}
export function isBeamer(text: string) {
  const token = controls(text).find(c => c.name === 'documentclass');
  if (!token) return false;
  let at = token.from + token.name.length + 1;
  at = beamerArgument(text, at, '[', ']')?.to ?? at;
  return beamerArgument(text, at)?.value.trim() === 'beamer';
}
function options(text: string, at: number) {
  // Frame/item overlay specifications may precede or follow an option list.
  for (let i = 0; i < 3; i++) {
    const group = beamerArgument(text, at, '<', '>') ?? beamerArgument(text, at, '[', ']');
    if (!group) break;
    at = group.to;
  }
  return at;
}
export function beamerBoundaryEnd(text: string, c: Control): number | undefined {
  if (c.name === 'begin' && c.argument === 'frame') {
    let at = options(text, c.to);
    for (let i = 0; i < 2; i++) at = beamerArgument(text, at)?.to ?? at;
    return at;
  }
  if (c.name === 'begin' && ['block', 'alertblock', 'exampleblock', 'column'].includes(c.argument)) {
    const at = options(text, c.to);
    return beamerArgument(text, at)?.to ?? at;
  }
  if (['frametitle', 'framesubtitle'].includes(c.name)) {
    const at = options(text, c.from + c.name.length + 1);
    return beamerArgument(text, at)?.to ?? at;
  }
  if (c.name === 'item') return options(text, c.from + 5);
  if (c.name === 'pause') return beamerArgument(text, c.from + 6, '[', ']')?.to ?? c.from + 6;
}
export type BeamerFrame = { from: number; bodyFrom: number; to: number; endFrom: number; number: number; title: string };
export function beamerFrames(text: string): BeamerFrame[] {
  if (!isBeamer(text)) return [];
  const frames: BeamerFrame[] = [];
  let frame: Omit<BeamerFrame, 'to' | 'endFrom'> | undefined;
  for (const c of controls(text)) {
    if (c.name === 'begin' && c.argument === 'frame') {
      const title = beamerArgument(text, options(text, c.to));
      frame = { from: c.from, bodyFrom: beamerBoundaryEnd(text, c)!, number: frames.length + 1, title: title?.value ?? '' };
    } else if (frame && c.name === 'frametitle') {
      frame.title = beamerArgument(text, options(text, c.from + c.name.length + 1))?.value ?? frame.title;
    } else if (frame && c.name === 'end' && c.argument === 'frame') {
      frames.push({ ...frame, endFrom: c.from, to: c.to }); frame = undefined;
    }
  }
  return frames;
}
export const beamerProseEnvironments = new Set(['frame', 'itemize', 'enumerate', 'description', 'block', 'alertblock', 'exampleblock', 'columns', 'column']);
