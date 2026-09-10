export type DiffPart = { kind: 'same' | 'removed' | 'added'; text: string };
export function tokenDiff(original: string, proposed: string): DiffPart[] {
  const tokens = (text: string) => text.match(/\\[a-zA-Z]+|\\.|[\p{L}\p{N}]+|\s+|[^\s]/gu) ?? [];
  const a = tokens(original), b = tokens(proposed), result: DiffPart[] = [];
  const push = (kind: DiffPart['kind'], text: string) => {
    if (!text) return;
    const last = result.at(-1);
    if (last?.kind === kind) last.text += text; else result.push({ kind, text });
  };
  let start = 0, endA = a.length, endB = b.length;
  while (start < endA && start < endB && a[start] === b[start]) start++;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  push('same', a.slice(0, start).join(''));
  const rows = endA - start, cols = endB - start;
  // Bound comparison work for large replacements; retain the full exact text.
  if (!rows || !cols || rows + cols > 2000 || rows * cols > 40000) {
    push('removed', a.slice(start, endA).join('')); push('added', b.slice(start, endB).join(''));
  } else {
    const lengths = Array.from({ length: rows + 1 }, () => new Uint32Array(cols + 1));
    for (let i = rows - 1; i >= 0; i--) for (let j = cols - 1; j >= 0; j--)
      lengths[i][j] = a[start + i] === b[start + j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    let i = 0, j = 0;
    while (i < rows || j < cols) {
      if (i < rows && j < cols && a[start + i] === b[start + j]) { push('same', a[start + i++]); j++; }
      else if (i < rows && (j === cols || lengths[i + 1][j] >= lengths[i][j + 1])) push('removed', a[start + i++]);
      else push('added', b[start + j++]);
    }
  }
  push('same', a.slice(endA).join(''));
  return result;
}
