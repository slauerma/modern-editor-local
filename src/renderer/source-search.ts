// Literal, case-sensitive source search; no parser, index, or replacement engine.
export function sourceMatch(text: string, query: string, from: number, to: number, backwards = false) {
  if (!query) return null;
  const start = Math.max(0, Math.min(text.length, backwards ? from : to));
  let match = backwards ? (start > 0 ? text.lastIndexOf(query, start - 1) : -1) : text.indexOf(query, start);
  if (match < 0) match = backwards ? text.lastIndexOf(query) : text.indexOf(query);
  return match < 0 ? null : { from: match, to: match + query.length };
}
