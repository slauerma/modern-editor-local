import { diff } from '@codemirror/merge';
import { z } from 'zod';
import { documentBody } from './document-mode.ts';
import { controls } from './tex-structure.ts';
import type { Build, Engine } from './contracts.ts';

export type ChangeLayout = 'inline' | 'paired' | 'added' | 'removed' | 'omitted';
export type ChangeReason = { text: string; origin: 'accepted' | 'proposal'; edited: boolean };
export type ComparisonChange = {
  id: string; fromA: number; toA: number; fromB: number; toB: number;
  oldText: string; newText: string; layout: ChangeLayout; inline: boolean; paired: boolean;
  omission?: string; reasons: ChangeReason[]; summary?: string; group?: string;
};
export type ComparisonPlan = { changes: ComparisonChange[]; notice?: string };
export type ChangesPresentation = 'markup' | 'clean';
export type ChangesInput = { projectId: string; before: string; after: string; name: string; engine: Engine;
  presentation?: ChangesPresentation; proposalId?: string; layouts?: Record<string, 'inline' | 'paired'>; arrangementId?: string; selectedPaths?: string[] };
export type ChangesArtifact = { id: string; presentation: ChangesPresentation; build: Build | null; changes: ComparisonChange[]; notice?: string; visual?: import('./changes-agent.ts').ChangesVisual };
export type ArrangementPreview = { id: string; prompt: string };
export const arrangementSchema = z.object({ groups: z.array(z.object({
  ids: z.array(z.string().max(40)).min(1).max(100),
  layout: z.enum(['inline', 'paired', 'keep']),
  summary: z.string().max(500)
}).strict()).max(100) }).strict();
export type Arrangement = z.infer<typeof arrangementSchema>;
export const arrangementOutputSchema = {
  type: 'object', additionalProperties: false, required: ['groups'], properties: { groups: { type: 'array', items: {
    type: 'object', additionalProperties: false, required: ['ids', 'layout', 'summary'], properties: {
      ids: { type: 'array', items: { type: 'string' } }, layout: { type: 'string', enum: ['inline', 'paired', 'keep'] }, summary: { type: 'string' }
    }
  } } }
};

// Complete exact ranges, including changes that cannot be typeset. The diff
// engine may coalesce nearby edits; it never decides whether an edit is shown.
export function exactChanges(before: string, after: string) {
  return diff(before, after, { scanLimit: 10000, timeout: 500 });
}
type Part = { from: number; to: number; text: string; fragment?: boolean };
const mathEnvironments = new Set(['equation', 'equation*', 'align', 'align*', 'gather', 'gather*', 'multline', 'multline*', 'aligned', 'gathered', 'split', 'cases', 'matrix', 'pmatrix', 'bmatrix']);
const proseEnvironments = new Set(['document', 'proof', 'quote', 'quotation', 'center', 'theorem', 'lemma', 'proposition', 'corollary', 'definition', 'assumption', 'remark', 'example', 'claim', 'conjecture']);
// Read one literal argument without interpreting its contents. Structural
// commands are kept outside prose blocks, so they are never repeated as Old.
function argumentEnd(text: string, start: number, open = '{', close = '}') {
  let i = start; while (/\s/.test(text[i] ?? '') && i < text.length) i++;
  if (text[i] !== open) return start;
  let depth = 0;
  for (; i < text.length; i++) {
    if (text[i] === '%') { const end = text.indexOf('\n', i); if (end < 0) return start; i = end; continue; }
    if (text[i] === '\\') { i++; continue; }
    if (text[i] === open) depth++;
    if (text[i] === close && --depth === 0) return i + 1;
  }
  return start;
}
function parts(text: string, body: { from: number; to: number }): Part[] {
  const boundaries = new Set([body.from, body.to]);
  for (const match of text.slice(body.from, body.to).matchAll(/\n[ \t]*\n+/g)) {
    boundaries.add(body.from + match.index! + match[0].length);
  }
  for (const t of controls(text)) {
    if (t.from < body.from || t.from >= body.to) continue;
    let end = t.to;
    if (['begin', 'end'].includes(t.name)) {
      if (mathEnvironments.has(t.argument)) continue;
      if (t.name === 'begin') end = argumentEnd(text, end, '[', ']');
    } else if (['part', 'chapter', 'section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph'].includes(t.name)) {
      let at = t.from + t.name.length + 1;
      if (text[at] === '*') at++;
      at = argumentEnd(text, at, '[', ']'); end = argumentEnd(text, at);
      if (end === at) continue;
    } else if (t.name !== 'maketitle') continue;
    boundaries.add(t.from); boundaries.add(Math.min(end, body.to));
  }
  const positions = [...boundaries].sort((a, b) => a - b), result: Part[] = [];
  for (let i = 1; i < positions.length; i++) {
    const from = positions[i - 1], to = positions[i], content = text.slice(from, to);
    // Ordinary comments are opaque source spans, not a reason to discard the
    // surrounding prose. Retain the entire comment AND its consumed newline.
    // Do not split comments inside math, groups, or command arguments.
    const comments = scanProse(content).comments;
    let at = from;
    for (const c of comments) {
      if (at < from + c.from) result.push({ from: at, to: from + c.from, text: text.slice(at, from + c.from), fragment: true });
      result.push({ from: from + c.from, to: from + c.to, text: content.slice(c.from, c.to) });
      at = from + c.to;
    }
    if (at < to) result.push({ from: at, to, text: text.slice(at, to), fragment: comments.length > 0 });
  }
  return result;
}
// Align whole paragraphs first. Within a changed run, bounded sequence alignment
// pairs related prose/math blocks without matching incidental characters across
// a paragraph, an equation and a deletion. All ranges still reconstruct exactly.
function blockRanges(before: string, after: string, a: { from: number; to: number }, b: { from: number; to: number }) {
  const left = parts(before, a), right = parts(after, b), words = new Map<string, string>();
  if (left.length + right.length > 20000) throw new Error('Preview not possible: too many paragraph boundaries. Use Text diff.');
  const encode = (ps: Part[]) => ps.map(p => { if (!words.has(p.text)) words.set(p.text, String.fromCharCode(4096 + words.size)); return words.get(p.text)!; }).join('');
  const encodedA = encode(left), encodedB = encode(right);
  const ranges: { fromA: number; toA: number; fromB: number; toB: number; fragment?: boolean }[] = [];
  if (before.slice(0, a.from) !== after.slice(0, b.from)) ranges.push({ fromA: 0, toA: a.from, fromB: 0, toB: b.from });
  const describe = (p: Part) => ({ kind: p.text.startsWith('%') ? 'comment' : /^\s*\\(?:\[|begin\{(?:equation|align|gather|multline))/.test(p.text) ? 'math' : 'prose', words: new Set(p.text.slice(0, 8000).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) });
  for (const run of exactChanges(encodedA, encodedB)) {
    const x = left.slice(run.fromA, run.toA), y = right.slice(run.fromB, run.toB);
    if (x.length > 100 || y.length > 100) throw new Error('Preview not possible: this rewrite exceeds 100 paragraphs. Choose a closer baseline or use Text diff.');
    const dx = x.map(describe), dy = y.map(describe), width = y.length + 1;
    const scores = new Float64Array((x.length + 1) * width), steps = new Uint8Array(scores.length);
    for (let i = 0; i <= x.length; i++) for (let j = 0; j <= y.length; j++) {
      if (!i && !j) continue;
      const at = i * width + j;
      let best = Infinity, step = 0;
      if (i) { best = scores[at - width] + 1; step = 1; }
      if (j && scores[at - 1] + 1 < best) { best = scores[at - 1] + 1; step = 2; }
      if (i && j) {
        const u = dx[i - 1], v = dy[j - 1], common = [...u.words].filter(w => v.words.has(w)).length;
        const cost = x[i - 1].text === y[j - 1].text ? 0 : u.kind !== v.kind ? 3 : 1.4 - common / Math.max(1, u.words.size + v.words.size - common);
        if (scores[at - width - 1] + cost <= best) { best = scores[at - width - 1] + cost; step = 3; }
      }
      scores[at] = best; steps[at] = step;
    }
    const paired: typeof ranges = []; let i = x.length, j = y.length;
    while (i || j) {
      const step = steps[i * width + j], old = step === 1 || step === 3 ? x[--i] : undefined, next = step === 2 || step === 3 ? y[--j] : undefined;
      const fromA = old?.from ?? left[run.fromA + i]?.from ?? a.to, fromB = next?.from ?? right[run.fromB + j]?.from ?? b.to;
      if (old?.text !== next?.text) paired.push({ fromA, toA: old?.to ?? fromA, fromB, toB: next?.to ?? fromB, fragment: old?.fragment || next?.fragment });
    }
    ranges.push(...paired.reverse());
  }
  if (before.slice(a.to) !== after.slice(b.to)) ranges.push({ fromA: a.to, toA: before.length, fromB: b.to, toB: after.length });
  return ranges;
}
const harmless = new Set(('emph textit textbf texttt textrm textsf textnormal underline cite citep citet ref eqref pageref url ' +
  'frac dfrac tfrac sqrt sum prod int iint lim min max inf sup log ln exp sin cos tan ' +
  'alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi varpi rho varrho sigma tau upsilon phi varphi chi psi omega ' +
  'Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega ' +
  'in notin subset subseteq supset supseteq le leq ge geq ne neq approx sim simeq equiv to mapsto rightarrow leftarrow Rightarrow Leftarrow iff implies ' +
  'times cdot pm mp infty partial nabla forall exists neg land lor cap cup setminus emptyset ' +
  'left right big Big bigg Bigg bigl bigr Bigl Bigr ' +
  'mathbb mathcal mathfrak mathrm mathbf mathit mathsf mathop operatorname overline bar hat widehat tilde widetilde vec dot ddot underbrace overbrace ' +
  'quad qquad hspace vspace text tag nonumber notag').split(/\s+/));
const noArgument = new Set(['noindent', 'indent', 'par', 'smallskip', 'medskip', 'bigskip', 'quad', 'qquad']);

function contextSupported(source: string, from: number): string | undefined {
  // Paragraph boundaries are not TeX group boundaries: a later paragraph can
  // still belong to a footnote, caption or other multi-paragraph argument.
  let depth = 0;
  for (let i = 0; i < from; i++) {
    if (source[i] === '%') { const end = source.indexOf('\n', i); i = end < 0 ? from : end; continue; }
    if (source[i] === '\\') { i++; continue; }
    if (source[i] === '{') depth++;
    if (source[i] === '}') depth--;
  }
  if (depth !== 0) return 'The change is inside a LaTeX argument or group. See Text diff.';
  const stack: string[] = [];
  for (const t of controls(source.slice(0, from))) {
    if (t.name === 'begin') stack.push(t.argument);
    if (t.name === 'end') stack.pop();
  }
  if (stack.some(e => !proseEnvironments.has(e))) return 'The change is inside a structured environment.';
}
function supported(text: string, source: string, from: number): string | undefined {
  const context = contextSupported(source, from); if (context) return context;
  if (scanProse(text).unbraced) return 'An unbraced command argument cannot safely receive comparison markup. See Text diff.';
  if (/\\verb\*?[^a-zA-Z@]/.test(text)) return 'Literal source examples are shown in Text diff only.';
  let braces = 0, dollars = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '%') return /^%[^\n]*(?:\n)?$/.test(text)
      ? 'A LaTeX source comment changed. See Text diff for its exact wording and line breaks.'
      : 'The source comment could not be separated from the surrounding LaTeX syntax. See Text diff for the exact change.';
    if (text[i] === '\\') { if (!/[a-zA-Z]/.test(text[i + 1] ?? '')) i++; continue; }
    if (text[i] === '{') braces++;
    if (text[i] === '}' && --braces < 0) return 'The change crosses a LaTeX group.';
    if (text[i] === '$') dollars++;
  }
  if (braces || dollars % 2) return 'The change crosses a LaTeX group or formula.';
  const environments: string[] = [];
  for (const t of controls(text, true)) {
    if (t.name === 'begin' || t.name === 'end') {
      if (!mathEnvironments.has(t.argument) || ['equation', 'align', 'gather', 'multline'].includes(t.argument)) return 'Numbered or structured environments are not repeated in comparisons.';
      if (t.name === 'begin') environments.push(t.argument);
      else if (environments.pop() !== t.argument) return 'The change crosses an environment boundary.';
    } else if (!harmless.has(t.name)) return `The command \\${t.name} is not supported in changed comparison text. See Text diff for the exact change.`;
  }
  if (environments.length) return 'The change crosses an environment boundary.';
  if (/\\(?:tag|nonumber|notag)\b/.test(text)) return 'Explicit equation numbering is not repeated in comparisons.';
  return undefined;
}

// Mark only ordinary text. Unchanged math, citations and formatting commands
// can stay in place; we never splice markup into their arguments or formulas.
function scanProse(text: string) {
  const mask = new Uint8Array(text.length + 1), boundaries = new Uint8Array(text.length + 1); let group = 0, option = 0, math = '', environment = 0;
  const comments: { from: number; to: number }[] = [];
  // Comments between a control word and its arguments cannot be separated:
  // inserting a margin marker there would change the command's argument.
  let commandTail = false, unbraced = false;
  for (let i = 0; i < text.length;) {
    // Inserting prose immediately BEFORE a formula is safe even though the
    // formula's first byte is opaque. Track positions separately from bytes;
    // never grant such a position between a command and its arguments.
    if (!group && !option && !math && !environment && !commandTail) boundaries[i] = 1;
    if (text[i] === '%') {
      const end = text.indexOf('\n', i), to = end < 0 ? text.length : end + 1;
      if (!group && !option && !math && !environment && !commandTail) comments.push({ from: i, to });
      i = to; continue;
    }
    if (text[i] === '\\') {
      const symbol = text[i + 1];
      if (symbol === '[' || symbol === '(') { math = symbol; i += 2; continue; }
      if (symbol === ']' || symbol === ')') { math = ''; commandTail = false; i += 2; continue; }
      const command = /^\\([a-zA-Z@]+)/.exec(text.slice(i));
      if (!command) { i += 2; continue; }
      // Display environments are opaque, just like dollar math. An unchanged
      // formula may contain arbitrary math macros; none of its bytes receive
      // inline markup. Rejecting them here also discarded ordinary prose on
      // either side of the formula.
      if (!math && !environment && !group && !harmless.has(command[1]) && !noArgument.has(command[1]) && !['label', 'begin', 'end'].includes(command[1])) return { mask: new Uint8Array(text.length + 1), boundaries: new Uint8Array(text.length + 1), comments: [], unbraced };
      commandTail = !noArgument.has(command[1]);
      if (['begin', 'end'].includes(command[1])) {
        environment += command[1] === 'begin' ? 1 : -1;
      }
      i += command[0].length; continue;
    }
    if (text[i] === '$') {
      const delimiter = text[i + 1] === '$' ? '$$' : '$';
      math = math ? '' : delimiter; if (!math) commandTail = false; i += delimiter.length; continue;
    }
    if (text[i] === '{') { commandTail = false; group++; i++; continue; }
    if (text[i] === '}') { group--; i++; continue; }
    if (!math && !group && !environment && (commandTail || option) && text[i] === '[') { option++; i++; continue; }
    if (!math && !group && !environment && option && text[i] === ']') { option--; i++; continue; }
    if (!group && !option && !math && !environment && commandTail && /\S/.test(text[i])) unbraced = true;
    if (!group && !option && !math && !environment && !commandTail && !/[&#_^~]/.test(text[i])) mask[i] = 1;
    if (!group && !option && !math && !environment && /\S/.test(text[i])) commandTail = false;
    i++;
  }
  if (!group && !option && !math && !environment) mask[text.length] = 1;
  if (mask[text.length] && !commandTail) boundaries[text.length] = 1;
  return { mask, boundaries, comments, unbraced };
}
export function inlineEdits(a: string, b: string) {
  if (a.trim().includes('\n\n') || b.trim().includes('\n\n')) return null;
  const changes = exactChanges(a, b).map(c => ({ ...c }));
  for (const c of changes) {
    while (c.fromA > 0 && c.fromB > 0 && /[\p{L}\p{N}]/u.test(a[c.fromA - 1]) && a[c.fromA - 1] === b[c.fromB - 1]) { c.fromA--; c.fromB--; }
    while (c.toA < a.length && c.toB < b.length && /[\p{L}\p{N}]/u.test(a[c.toA]) && a[c.toA] === b[c.toB]) { c.toA++; c.toB++; }
  }
  const left = scanProse(a), right = scanProse(b);
  const ordinary = (text: string, { mask, boundaries }: ReturnType<typeof scanProse>, from: number, to: number) => {
    if (from === to) return !!boundaries[from] || !!mask[from] && (from === 0 || !!mask[from - 1]);
    for (let i = from; i < to; i++) if (!mask[i]) return false;
    return !/[\\{}$%&#_^~]/.test(text.slice(from, to));
  };
  if (changes.some(c => !ordinary(a, left, c.fromA, c.toA) || !ordinary(b, right, c.fromB, c.toB))) return null;
  const merged: typeof changes = [];
  for (const c of changes) {
    const p = merged.at(-1);
    if (p && (p.toA >= c.fromA || p.toB >= c.fromB)) { p.toA = c.toA; p.toB = c.toB; }
    else merged.push(c);
  }
  return merged;
}

export function comparisonPlan(before: string, after: string): ComparisonPlan {
  if (before.length > 2_000_000 || after.length > 2_000_000) throw new Error('Preview not possible: the comparison exceeds the source limit.');
  const a = documentBody(before), b = documentBody(after);
  if (!a || !b) throw new Error('Preview not possible: both versions need an ordinary document wrapper. Use Text diff.');
  const merged = blockRanges(before, after, a, b);
  let reconstructed = before;
  for (const c of [...merged].reverse()) reconstructed = reconstructed.slice(0, c.fromA) + after.slice(c.fromB, c.toB) + reconstructed.slice(c.toA);
  if (reconstructed !== after) throw new Error('Preview not possible: block boundaries could not represent the exact comparison. Use Text diff.');
  if (merged.length > 100) throw new Error('Preview not possible: more than 100 changed blocks. Choose a closer baseline or use Text diff.');
  return { changes: merged.map(({ fragment, ...c }, i) => {
    const oldText = before.slice(c.fromA, c.toA), newText = after.slice(c.fromB, c.toB);
    const edits = inlineEdits(oldText, newText), changed = edits?.reduce((n, e) => n + e.toA - e.fromA + e.toB - e.fromB, 0) ?? Infinity;
    const inline = !!oldText.trim() && !!newText.trim() && edits !== null && !contextSupported(before, c.fromA) && !contextSupported(after, c.fromB);
    const repeated = supported(oldText, before, c.fromA) ?? supported(newText, after, c.fromB);
    const omission = oldText.replace(/\s+/g, '') === newText.replace(/\s+/g, '') ? 'Whitespace-only source changes are shown in Text diff.' : c.fromA < a.from || c.toA > a.to || c.fromB < b.from || c.toB > b.to
      ? 'The change is outside the ordinary document body.'
      : inline ? undefined : repeated;
    const paired = !fragment && !repeated && !omission && !!oldText.trim() && !!newText.trim() && (!inline || !/[\\{}$%&#_^~]/.test(oldText + newText));
    const layout: ChangeLayout = omission ? 'omitted' : !oldText.trim() ? 'added' : !newText.trim() ? 'removed' : inline && (!paired || changed < 160 && changed < (oldText.length + newText.length) * .45) ? 'inline' : 'paired';
    return { ...c, id: `change-${i + 1}`, oldText, newText, layout, inline: inline && !omission, paired, omission, reasons: [] };
  }) };
}

export function applyArrangement(plan: ComparisonPlan, raw: unknown): ComparisonPlan {
  const value = arrangementSchema.parse(raw), expected = plan.changes.map(c => c.id), received = value.groups.flatMap(g => g.ids);
  if (JSON.stringify(received) !== JSON.stringify(expected)) throw new Error('The arrangement does not cover every change exactly once in source order.');
  const result = structuredClone(plan);
  for (const [i, group] of value.groups.entries()) for (const id of group.ids) {
    const c = result.changes.find(c => c.id === id)!;
    if (group.layout === 'inline' && !c.inline) throw new Error('The arrangement requests unsupported inline markup.');
    if (group.layout === 'paired' && !c.paired) throw new Error('The arrangement changes an unsupported layout.');
    if (group.layout !== 'keep') c.layout = group.layout;
    c.group = `Group ${i + 1}`; c.summary = group.summary;
  }
  return result;
}
