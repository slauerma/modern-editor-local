import type { PreambleProposal } from './contracts.ts';
import { changedText } from './review.ts';
type Control = { name: string; argument: string; from: number; to: number };

// This is a bounded structural scan, not a TeX interpreter. Ignore comments,
// escaped symbols, literal examples and commands inside macro arguments.
function controls(text: string, includeNested = false): Control[] {
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

function structure(text: string) {
  if (!text.trim()) throw new Error('Paste some LaTeX first, then add a preamble.');
  const tokens = controls(text);
  const classes = tokens.filter(t => t.name === 'documentclass' || t.name === 'documentstyle');
  const begins = tokens.filter(t => t.name === 'begin' && t.argument === 'document');
  const ends = tokens.filter(t => t.name === 'end' && t.argument === 'document');
  if (classes.length > 1 || begins.length > 1 || ends.length > 1 ||
      (begins.length && ends.length && ends[0].from < begins[0].from) ||
      (classes.length && begins.length && classes[0].from > begins[0].from))
    throw new Error('The document boundaries are ambiguous. Keep one preamble and one document body, then compile. The source was kept.');
  const headerCommands = tokens.some(t => ['usepackage', 'RequirePackage', 'PassOptionsToPackage'].includes(t.name) || (t.name === 'input' && t.argument === 'tcilatex'));
  if (!begins.length && (classes.length || headerCommands))
    throw new Error('An existing preamble has no \\begin{document}. Add that line where your paragraph begins, then retry. The source was kept.');
  return { classes, begins, ends };
}

export function preambleContext(text: string) {
  const { classes, begins, ends } = structure(text);
  return { hasDocumentClass: !!classes.length, hasDocumentBegin: !!begins.length, hasDocumentEnd: !!ends.length,
    insertionPoint: begins[0]?.from ?? 0 };
}

const whitespaceOrComments = (text: string) => /^(?:\s|%[^\r\n]*(?:\r?\n|$))*$/.test(text);

// Generated additions support a deliberately small declaration language. The
// author's existing source is not restricted by this list. TeX hooks, aliases,
// encodings and arbitrary macros need author-supplied definitions, not a guess.
const generatedCommands = new Set(['documentclass', 'documentstyle', 'usepackage', 'RequirePackage',
  'PassOptionsToPackage', 'newtheorem', 'theoremstyle', 'numberwithin', 'setcounter',
  'begin', 'end', 'input', 'textbf', 'textit', 'emph', 'normalfont', 'bfseries', 'itshape']);
function validateGeneratedPreamble(text: string) {
  const all = controls(text, true);
  if (all.some(t => ['newcommand', 'renewcommand', 'providecommand', 'def', 'gdef', 'edef', 'xdef', 'let', 'DeclareMathOperator', 'DeclarePairedDelimiter', 'DeclareRobustCommand', 'NewDocumentCommand', 'RenewDocumentCommand', 'ProvideDocumentCommand'].includes(t.name)))
    throw new Error('Codex proposed custom command definitions. Supply the original definitions in your draft and retry; nothing was applied.');
  if (text.includes('^^') || all.some(t => !generatedCommands.has(t.name) || (t.name === 'input' && t.argument !== 'tcilatex')))
    throw new Error('Codex proposed an unsupported preamble command or hook. Supply the required original definitions yourself; nothing was applied.');
}

// Codex supplies the additions. This code only restricts where they can go;
// it never chooses packages or invents mathematical command definitions.
export function preambleChanges(text: string, proposal: PreambleProposal) {
  if (proposal.needsInput) throw new Error('Codex needs your input: ' + proposal.needsInput);
  validateGeneratedPreamble(proposal.preamble);
  const context = preambleContext(text), additions = controls(proposal.preamble);
  if (context.hasDocumentClass && additions.some(t => ['documentclass', 'documentstyle'].includes(t.name)))
    throw new Error('Codex proposed a second document class. Nothing was applied.');
  if (context.hasDocumentBegin && additions.some(t => ['begin', 'end'].includes(t.name) && t.argument === 'document'))
    throw new Error('Codex proposed a duplicate document boundary. Nothing was applied.');
  if (!context.hasDocumentBegin) {
    const begin = additions.filter(t => t.name === 'begin' && t.argument === 'document');
    if (begin.length !== 1 || !whitespaceOrComments(proposal.preamble.slice(begin[0].to)))
      throw new Error('Codex must finish the preamble with a document opening, without adding body text. Nothing was applied.');
  }
  if (context.hasDocumentEnd ? !whitespaceOrComments(proposal.ending) : !/^\s*\\end\s*\{\s*document\s*\}\s*$/.test(proposal.ending))
    throw new Error('Codex may only add the missing document closing. Nothing was applied.');
  // Leading/trailing newlines keep a source comment from swallowing a boundary.
  const prefix = proposal.preamble ? proposal.preamble + '\n' : '';
  const suffix = proposal.ending ? '\n' + proposal.ending + '\n' : '';
  const changes = [...(prefix ? [{ from: context.insertionPoint, to: context.insertionPoint, insert: prefix }] : []), ...(suffix ? [{ from: text.length, to: text.length, insert: suffix }] : [])];
  const candidate = changedText(text, changes);
  if (candidate.length > 2000000) throw new Error('Adding the preamble would exceed the source size limit. The source was kept.');
  const layout = structure(candidate);
  if (layout.classes.length !== 1 || layout.begins.length !== 1 || layout.ends.length !== 1)
    throw new Error('Codex did not supply one complete document wrapper. Nothing was applied.');
  return changes;
}
