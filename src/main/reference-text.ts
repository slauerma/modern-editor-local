// Literal, bounded reference search. Results are excerpts, never executable input.
export function referenceText(bytes: Buffer) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (text.includes('\0')) throw new Error('This reference is not a UTF-8 text document.');
  return text;
}
export function searchReferenceText(text: string, query: string) {
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  const excerpts: { location: string; text: string }[] = [];
  let limited = false;
  for (const match of text.matchAll(pattern)) {
    if (excerpts.length >= 12) { limited = true; break; }
    const at = match.index!, from = Math.max(0, at - 250), to = Math.min(text.length, at + match[0].length + 750);
    const line = text.slice(0, at).split('\n').length;
    excerpts.push({ location: `Match near text line ${line}`, text: text.slice(from, to) });
  }
  return { excerpts, notices: limited ? ['Only the first 12 matches are shown. Narrow the query for other matches.'] : [], location: `Searched ${text.split('\n').length} text lines` };
}
