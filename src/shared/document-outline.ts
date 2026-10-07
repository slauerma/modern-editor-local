import { controls } from './tex-structure.ts';

export type OutlineEntry = { from: number; to: number; line: number; title: string; label: string; kind: string; level: number };
const levels: Record<string, number> = { part: 0, chapter: 0, section: 1, subsection: 2, subsubsection: 3, paragraph: 4, subparagraph: 5 };

function whitespace(text: string, at: number): number {
  while (at < text.length) {
    if (/\s/.test(text[at])) at++;
    else if (text[at] === '%') { const end = text.indexOf('\n', at); at = end < 0 ? text.length : end + 1; }
    else break;
  }
  return at;
}
function group(text: string, at: number, open = '{', close = '}') {
  at = whitespace(text, at);
  if (text[at] !== open) return null;
  let depth = 1, value = '';
  for (let i = at + 1; i < text.length; i++) {
    const c = text[i];
    if (c === '%') { const end = text.indexOf('\n', i); i = end < 0 ? text.length : end; value += ' '; continue; }
    if (c === '\\') { value += c + (text[++i] ?? ''); continue; }
    if (c === open) depth++;
    if (c === close) { depth--; if (!depth) return { value, to: i + 1 }; }
    value += c;
  }
  return null;
}
function readable(value: string) {
  return value.replace(/\\(?:texorpdfstring)\{([^{}]*)\}\{([^{}]*)\}/g, '$2')
    .replace(/\\[a-zA-Z]+\*?/g, ' ').replace(/[{}$]/g, '').replace(/\s+/g, ' ').trim();
}
// Structural navigation only: no macro expansion, file reads or model calls.
export function documentOutline(text: string): OutlineEntry[] {
  const tokens = controls(text), opening = tokens.find(c => c.name === 'begin' && c.argument === 'document');
  const ending = tokens.find(c => c.name === 'end' && c.argument === 'document');
  const entries: OutlineEntry[] = [], environments: { name: string; from: number; title: string }[] = [];
  let line = 1, scanned = 0, heading: OutlineEntry | undefined;
  for (const c of tokens) {
    for (; scanned < c.from; scanned++) if (text[scanned] === '\n') line++;
    if (opening && c.from <= opening.from || ending && c.from >= ending.from) continue;
    let at = c.from + c.name.length + 1;
    if (text[at] === '*') at++;
    const optional = group(text, at, '[', ']');
    if (optional) at = optional.to;
    if (c.name in levels) {
      const title = group(text, at);
      if (!title) continue;
      heading = { from: c.from, to: title.to, line, title: readable(title.value) || 'Untitled', label: '', kind: c.name, level: levels[c.name] };
      entries.push(heading);
    } else if (c.name === 'begin') {
      const name = group(text, at); if (!name || name.value.trim() === 'document') continue;
      const title = group(text, name.to, '[', ']');
      environments.push({ name: name.value.trim(), from: c.from, title: title ? readable(title.value) : '' });
    } else if (c.name === 'end') {
      const index = environments.map(e => e.name).lastIndexOf(c.argument);
      if (index >= 0) environments.splice(index);
    } else if (c.name === 'label') {
      const label = group(text, at); if (!label?.value.trim()) continue;
      const environment = environments.at(-1);
      if (!environment && heading && !heading.label && !text.slice(heading.to, c.from).replace(/%[^\n]*/g, '').trim()) heading.label = label.value.trim();
      else entries.push({ from: c.from, to: label.to, line, title: environment?.title || environment?.name.replace(/\*$/, '') || 'Label',
        label: label.value.trim(), kind: 'label', level: Math.min(5, (heading?.level ?? 0) + 1) });
    }
  }
  return entries;
}

export function filterOutline(entries: OutlineEntry[], query: string) {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return entries.filter(e => words.every(word => (e.title + ' ' + e.label + ' ' + e.kind).toLocaleLowerCase().includes(word)));
}
