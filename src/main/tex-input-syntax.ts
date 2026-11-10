// Strip comments while preserving line offsets; verbatim bodies are prose, not
// dependency commands. TeX macro expansion is deliberately outside this parser.
export function sourceForScan(text: string) {
  let output = '', cursor = 0;
  while (cursor < text.length) {
    if (text[cursor] === '%') {
      const end = text.indexOf('\n', cursor); if (end < 0) break;
      output += ' '.repeat(end - cursor); cursor = end; continue;
    }
    if (text[cursor] === '\\') {
      const verbatim = text.slice(cursor).match(/^\\begin\{(verbatim\*?|Verbatim|lstlisting|minted)\}/);
      if (verbatim) {
        const end = text.indexOf(`\\end{${verbatim[1]}}`, cursor + verbatim[0].length);
        const stop = end < 0 ? text.length : end + verbatim[1].length + 6;
        output += text.slice(cursor, stop).replace(/[^\n]/g, ' '); cursor = stop; continue;
      }
      const verb = text.slice(cursor).match(/^\\verb\*?([^a-zA-Z\s])/);
      if (verb) {
        const end = text.indexOf(verb[1], cursor + verb[0].length);
        const stop = end < 0 ? text.length : end + 1;
        output += text.slice(cursor, stop).replace(/[^\n]/g, ' '); cursor = stop; continue;
      }
      output += text.slice(cursor, cursor + 2); cursor += 2; continue;
    }
    output += text[cursor++];
  }
  return output;
}
export type Argument = { value: string; end: number };
export function group(text: string, offset: number, open = '{', close = '}'): Argument | null {
  let i = offset; while (/\s/.test(text[i] ?? '') && i < text.length) i++;
  if (text[i] !== open) return null;
  const start = ++i; let depth = 1;
  for (; i < text.length; i++) {
    if (text[i] === '\\') { i++; continue; }
    if (text[i] === open) depth++;
    if (text[i] === close && --depth === 0) return { value: text.slice(start, i), end: i + 1 };
  }
  return null;
}
export function afterOptions(text: string, offset: number) {
  let cursor = offset; if (text[cursor] === '*') cursor++;
  for (let i = 0; i < 3; i++) { const option = group(text, cursor, '[', ']'); if (!option) break; cursor = option.end; }
  return cursor;
}
export function literal(value: string) { return value.trim().replace(/^"([^"\n]+)"$/, '$1'); }
export function isLiteral(value: string) { return !!value && !/[\\{}#$%^~\x00-\x1f]/.test(value); }
