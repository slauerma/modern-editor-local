import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compiledPosition, parseSyncTex, currentSourceLine, parseSyncTexSource } from '../src/main/pdf-navigation.ts';
import { sourceRequestSchema } from '../src/shared/contracts.ts';
const original='\\documentclass{article}\n\\begin{document}\nUnique opening paragraph.\nSame words.\nSame words.\n\\end{document}\n';
test('reverse navigation maps unchanged shifted lines and refuses changed or ambiguous source', () => {
  const at = original.indexOf('Unique'), changed = original.replace('Unique', 'Rewritten');
  assert.deepEqual(currentSourceLine(original, original, 3), { from: at, to: at + 'Unique opening paragraph.'.length, line: 3 });
  const shifted = original.replace('Unique', 'New paragraph.\nUnique');
  const hit = currentSourceLine(shifted, original, 3);
  assert(!('kind' in hit)); assert.equal(hit.line, 4); assert.equal(shifted.slice(hit.from, hit.to), 'Unique opening paragraph.');
  assert.equal((currentSourceLine(changed, original, 3) as any).kind, 'compile');
  assert.equal((currentSourceLine(shifted, original, 4) as any).kind, 'compile');
  assert.equal((currentSourceLine(original, original, 0) as any).kind, 'unavailable');
  assert.equal((currentSourceLine(original, original, 99) as any).kind, 'unavailable');
  assert.equal((currentSourceLine(original, original, 1) as any).kind, 'unavailable');
});
test('reverse parser preserves paths with spaces and ignores invalid records; IPC rejects invalid geometry', () => {
  assert.deepEqual(parseSyncTexSource('SyncTeX result begin\nInput:/a paper/main.tex\nLine:17\nColumn:-1\nSyncTeX result end'), { input: '/a paper/main.tex', line: 17 });
  for (const bad of ['Input:a\nLine:-1', 'Input:a\nLine:Infinity', 'Input:a\nLine:999999999999', 'Input:a\0b\nLine:1', 'No result']) assert.equal(parseSyncTexSource(bad), null);
  const request = { projectId: 'p', buildId: 'b', text: original, page: 1, x: 120, y: 240 };
  assert(sourceRequestSchema.safeParse(request).success);
  for (const values of [{page:0}, {page:1.5}, {x:-2}, {x:Infinity}, {y:NaN}]) assert(!sourceRequestSchema.safeParse({ ...request, ...values }).success);
});
test('source positions use the displayed snapshot: current repeats work, unchanged shifted lines map, changed or ambiguous passages require compilation',()=>{
  const at=original.indexOf('Unique');assert.deepEqual(compiledPosition(original,original,at,at+6),{line:3,column:1});
  const shifted=original.replace('Unique','Inserted elsewhere.\nUnique'), after=shifted.indexOf('Unique');
  assert.deepEqual(compiledPosition(shifted,original,after,after+6),{line:3,column:1});
  const changed=original.replace('Unique opening','Revised opening');assert.equal((compiledPosition(changed,original,at,at+7) as any).kind,'compile');
  const second=original.lastIndexOf('Same');assert.deepEqual(compiledPosition(original,original,second,second+4),{line:5,column:1});
  const ambiguous=shifted.lastIndexOf('Same');assert.equal((compiledPosition(shifted,original,ambiguous,ambiguous+4) as any).kind,'compile');
  assert.throws(()=>compiledPosition(original,original,-1,10));assert.throws(()=>compiledPosition(original,original,2,original.length+1));
});
test('preamble, comments, blank lines and end marker have no visible counterpart; escaped percent remains visible',()=>{
  const text='\\documentclass{article}\n% \\begin{document}\n\\begin{document}\n% Invisible note\n\nA visible 10\\% rate.\n\\end{document}\n';
  for(const at of [0,text.indexOf('Invisible'),text.indexOf('\n\n')+1,text.lastIndexOf('\\end')]) assert.equal((compiledPosition(text,text,at,at) as any).kind,'unavailable');
  const at=text.indexOf('10');assert.deepEqual(compiledPosition(text,text,at,at+3),{line:6,column:11});
});
test('older PDFs require the complete line in the compiled document body, not a matching substring or preamble', () => {
  const line = 'A bound is tight.', current = `\\documentclass{article}\n\\begin{document}\n${line}\n\\end{document}\n`;
  const from = current.indexOf(line);
  for (const compiled of [
    current.replace(line, 'The following claim is false: ' + line),
    current.replace(line, line + ' Only in this special case.'),
    current.replace(line, '% ' + line),
    `\\documentclass{article}\n${line}\n\\begin{document}\nDifferent text.\n\\end{document}\n`,
    `\\documentclass{article}\n\\begin{document}\nDifferent text.\n\\end{document}\n${line}\n`,
  ]) assert.equal((compiledPosition(current, compiled, from, from + line.length) as any).kind, 'compile');
  const shifted = current.replace('\\begin{document}\n', '\\begin{document}\nEarlier paragraph.\n');
  assert.deepEqual(compiledPosition(current, shifted, from + 2, from + 7), { line: 4, column: 3 });
});
test('SyncTeX parses its first finite box in top-left PDF points and rejects malformed/out-of-range records',()=>{
  const result='SyncTeX result begin\nOutput:test.pdf\nPage:2\nx:100.1\ny:300\nh:90\nv:300\nW:350\nH:14\nSyncTeX result end\n';
  assert.deepEqual(parseSyncTex(result),{page:2,x:90,y:286,width:350,height:14});
  for(const bad of [result.replace('Page:2','Page:0'),result.replace('W:350','W:NaN'),result.replace('v:300','v:1e30'),'No tag for input']) assert.equal(parseSyncTex(bad),null);
});
test('PDF navigation recognizes active document controls with whitespace and comments', () => {
  const text = String.raw`\documentclass{article}
% \begin{document}
\newcommand{\example}{\begin{document}}
\begin % opening
 { document }
A visible sentence.
\verb|\end{document}|
Another visible sentence.
\end {document}
Outside the document.`;
  for (const word of ['A visible', 'Another visible']) {
    const at = text.indexOf(word);
    assert.deepEqual(compiledPosition(text, text, at, at + word.length), { line: text.slice(0, at).split('\n').length, column: 1 });
  }
  assert.equal((compiledPosition(text, text, text.indexOf('Outside'), text.length) as any).kind, 'unavailable');
  const duplicate = text.replace('A visible', '\\begin{document}\nA visible'), at = duplicate.indexOf('A visible');
  assert.equal((compiledPosition(duplicate, duplicate, at, at + 9) as any).kind, 'unavailable');
});
