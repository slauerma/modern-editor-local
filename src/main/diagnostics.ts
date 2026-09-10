import type { Diagnostic } from '../shared/contracts.ts';

export function classifyBuildLog(log: string): { diagnostics: Diagnostic[]; blockingWarnings: boolean } {
  const diagnostics: Diagnostic[] = [], lines = log.split(/\r?\n/);
  let blockingWarnings = false;
  const warningStart = /^(?:LaTeX(?: Font)?|Package \S+|Class \S+) Warning:/;
  const boundary = /^(?:!|.*\.tex:\d+:|Overfull |Underfull |Missing character:|Output written|Transcript written)/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], error = line.match(/^(?:\.\/)?([^:]+\.tex):(\d+):\s*(.*)/);
    if (error) { diagnostics.push({ severity: 'error', file: error[1], line: Number(error[2]), message: error[3] }); continue; }
    if (line.startsWith('!')) { diagnostics.push({ severity: 'error', message: line.replace(/^!\s*/, '') }); continue; }
    let message = line;
    if (warningStart.test(line)) {
      // TeX hard-wraps warning text, even in the middle of a word. Join only
      // this bounded warning block, never across a blank or a new diagnostic.
      for (let n = 0; n < 12 && i + 1 < lines.length && message.length < 4000; n++) {
        const next = lines[i + 1];
        if (!next.trim() || warningStart.test(next) || boundary.test(next)) break;
        message += '\n' + next.replace(/^\([^)]{1,80}\)\s*/, ''); i++;
      }
    }
    const compact = message.replace(/\s+/g, '');
    const blocking = /undefined(?:references|citations)|(?:Reference|Citation).*undefined|multiplydefined|Missingcharacter:/i.test(compact);
    if (blocking || /Overfull \\[hv]box/.test(message)) diagnostics.push({ severity: 'warning', message });
    blockingWarnings ||= blocking;
  }
  return { diagnostics, blockingWarnings };
}
