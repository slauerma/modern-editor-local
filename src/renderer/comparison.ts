// Compare the same logical LaTeX lines CodeMirror edits. The stored baseline
// still retains its original BOM and line endings for preservation/export.
export const comparisonText = (text: string) => text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
export const comparisonDiffConfig = { scanLimit: 1500, timeout: 100 };
