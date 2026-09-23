export type Control = { name: string; argument: string; from: number; to: number };

// This is a bounded structural scan, not a TeX interpreter. Ignore comments,
// escaped symbols, literal examples and commands inside macro arguments.
export function controls(text: string, includeNested = false): Control[] {
  const result: Control[] = [];
  const literals = new Set(['verbatim', 'verbatim*', 'Verbatim', 'lstlisting', 'minted']);
  let depth = 0;
  function skipSpace(index: number) {
    while (index < text.length) {
      if (/\s/.test(text[index])) index++;
      else if (text[index] === '%') { const end = text.indexOf('\n', index); index = end < 0 ? text.length : end + 1; }
      else break;
    }
    return index;
  }
  for (let i = 0; i < text.length;) {
    if (text[i] === '%') { const end = text.indexOf('\n', i); i = end < 0 ? text.length : end + 1; continue; }
    if (text[i] === '{') { depth++; i++; continue; }
    if (text[i] === '}') { depth = Math.max(0, depth - 1); i++; continue; }
    if (text[i] !== '\\') { i++; continue; }
    const from = i++;
    if (!/[a-zA-Z@]/.test(text[i] ?? '')) { i++; continue; }
    const start = i;
    while (i < text.length && /[a-zA-Z@]/.test(text[i])) i++;
    const name = text.slice(start, i);
    if (name === 'verb') {
      if (text[i] === '*') i++;
      const delimiter = text[i++], end = delimiter ? text.indexOf(delimiter, i) : -1;
      const line = text.indexOf('\n', i);
      i = end >= 0 && (line < 0 || end < line) ? end + 1 : line < 0 ? text.length : line;
      continue;
    }
    const argumentStart = skipSpace(text[i] === '*' ? i + 1 : i);
    const group = /^\{\s*([a-zA-Z*@]+)\s*\}/.exec(text.slice(argumentStart, argumentStart + 256));
    const argument = group?.[1] ?? '';
    if (includeNested || depth === 0) result.push({ name, argument, from, to: group ? argumentStart + group[0].length : i });
    if (name === 'begin' && literals.has(argument)) {
      const end = text.indexOf(`\\end{${argument}}`, argumentStart + group![0].length);
      i = end < 0 ? text.length : end + argument.length + 6;
    }
  }
  return result;
}


// Read only literal package lists at active top-level commands. Keep the scan's
// original positions; comments/whitespace may separate the command and group.
export function literalPackages(text: string): Set<string> {
  const names = new Set<string>();
  for (const token of controls(text)) {
    if (!['usepackage', 'RequirePackage'].includes(token.name)) continue;
    const tail = text.slice(token.from + token.name.length + 1).replace(/%[^\n]*(?:\n|$)/g, '\n');
    const match = /^\s*(?:\[[^\]]*\]\s*)?\{([^{}\\]*)\}/.exec(tail);
    if (match) for (const name of match[1].split(',')) if (name.trim()) names.add(name.trim());
  }
  return names;
}
