// Personal editor: conservative source-to-PDF navigation; no source rewriting.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PdfLocation } from '../shared/contracts.ts';
const execute = promisify(execFile);

function uncomment(text: string) {
  return text.replace(/(^|\n)([^\n]*)/g, (_match, newline: string, line: string) => {
    for (let i = 0; i < line.length; i++) if (line[i] === '%') {
      let slashes = 0; for (let j = i - 1; j >= 0 && line[j] === '\\'; j--) slashes++;
      if (slashes % 2 === 0) return newline + line.slice(0, i) + ' '.repeat(line.length - i);
    }
    return newline + line;
  });
}

export function compiledPosition(current: string, compiled: string, from: number, to: number): { line: number; column: number } | Exclude<PdfLocation, { kind: 'mapped' }> {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > current.length) throw new Error('Choose a passage within the current source.');
  const masked = uncomment(current), start = masked.indexOf('\\begin{document}'), end = masked.lastIndexOf('\\end{document}');
  const at = from + (current.slice(from, to).match(/^\s*/)?.[0].length ?? 0);
  const lineStart = current.lastIndexOf('\n', Math.max(0, at - 1)) + 1;
  const lineEnd = current.indexOf('\n', at), limit = lineEnd < 0 ? current.length : lineEnd;
  if (start < 0) return { kind: 'compile', reason: 'This draft needs a document preamble before it can be shown in a PDF.' };
  if (at < start + '\\begin{document}'.length || (end >= 0 && at >= end) || !masked.slice(at, limit).trim() || !masked.slice(lineStart, limit).trim())
    return { kind: 'unavailable', reason: 'Choose typeset text in the document body. Preamble definitions, blank lines and LaTeX comments may have no visible PDF counterpart.' };
  let offset = at;
  if (current !== compiled) {
    // Require complete unchanged source lines, uniquely placed in both versions.
    // This intentionally asks for compilation when a tiny/repeated match is unsafe.
    const selectedEnd = Math.max(at, to > from ? to - 1 : at);
    const ending = current.indexOf('\n', selectedEnd), stop = ending < 0 ? current.length : ending;
    const passage = current.slice(lineStart, stop), found = compiled.indexOf(passage);
    if (!passage.trim() || found < 0 || (found > 0 && compiled[found - 1] !== '\n') || (found + passage.length < compiled.length && compiled[found + passage.length] !== '\n'))
      return { kind: 'compile', reason: 'This passage changed since the displayed PDF was compiled. Compile the current draft to show it.' };
    if (compiled.indexOf(passage, found + 1) >= 0 || current.indexOf(passage) !== lineStart || current.indexOf(passage, lineStart + 1) >= 0)
      return { kind: 'compile', reason: 'This passage occurs more than once. Compile the current draft to locate it reliably.' };
    offset = found + at - lineStart;
    // A line moved from the preamble or past the end marker is not an unchanged
    // typeset passage. Reuse the current-snapshot visibility check, without mapping.
    const visible = compiledPosition(compiled, compiled, offset, offset);
    if ('kind' in visible) return { kind: 'compile', reason: 'This passage was not visible document text in the displayed PDF. Compile the current draft to show it.' };
  }
  const before = compiled.slice(0, offset);
  return { line: before.split('\n').length, column: offset - before.lastIndexOf('\n') };
}

export function parseSyncTex(output: string): Omit<Extract<PdfLocation, { kind: 'mapped' }>, 'kind' | 'buildId'> | null {
  // The first record is SyncTeX's preferred hit. Coordinates are PDF points
  // from the top left; v is the bottom of the enclosing box, H its height.
  for (const block of output.split(/(?=^Page:)/m).slice(1)) {
    const values = Object.fromEntries([...block.matchAll(/^(Page|x|y|h|v|W|H):([-+\d.eE]+)\s*$/gm)].map(m => [m[1], Number(m[2])]));
    if (!['Page', 'x', 'y', 'h', 'v', 'W', 'H'].every(k => Number.isFinite(values[k]))) continue;
    if (!Number.isInteger(values.Page) || values.Page < 1 || values.Page > 100000 || Object.values(values).some(v => Math.abs(v) > 100000)) continue;
    return { page: values.Page, x: Math.max(0, values.h), y: Math.max(0, values.v - Math.max(12, values.H)), width: Math.max(8, Math.abs(values.W)), height: Math.max(12, Math.abs(values.H)) };
  }
  return null;
}

export async function syncTexLocation(executable: string, input: string, pdf: string, position: { line: number; column: number }, cwd: string, signal?: AbortSignal) {
  // Do not inherit SYNCTEX_VIEWER: it can ask the utility to execute a command.
  const { stdout } = await execute(executable, ['view', '-i', `${position.line}:${position.column}:${input}`, '-o', pdf], {
    cwd, env: { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' }, signal, timeout: 5000, maxBuffer: 256000
  });
  return parseSyncTex(stdout);
}
