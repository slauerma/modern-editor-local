import { controls } from './tex-structure.ts';

export type DocumentMode = 'text' | 'latex';

// Recognize ordinary document wrappers only. This is not a test of whether TeX
// can compile the document, and is deliberately not used to repair fragments.
export function documentBody(text: string): { from: number; to: number } | null {
  const tokens = controls(text);
  const begin = tokens.filter(t => t.name === 'begin' && t.argument === 'document');
  const end = tokens.filter(t => t.name === 'end' && t.argument === 'document');
  if (begin.length !== 1 || end.length !== 1 || begin[0].to > end[0].from) return null;
  return { from: begin[0].to, to: end[0].from };
}

export function documentMode(text: string): DocumentMode { return documentBody(text) ? 'latex' : 'text'; }

export function documentModeNotice(text: string): string | null {
  if (documentBody(text)) return null;
  const hasWrapper = controls(text).some(t => t.name === 'documentclass' || (['begin', 'end'].includes(t.name) && t.argument === 'document'));
  return hasWrapper ? 'Opened in Text mode: the LaTeX document wrapper is incomplete or ambiguous.' : null;
}

export function documentGuidance(text: string): string {
  return documentMode(text) === 'text'
    ? 'This is text or a LaTeX fragment, without a complete document wrapper. Preserve its format, paragraphs and any existing LaTeX notation. Do not add a preamble, document wrapper, new markup or package requirements. Return exact quotations and plain replacement text.'
    : 'This is a complete LaTeX document. Preserve its LaTeX notation and structure.';
}
