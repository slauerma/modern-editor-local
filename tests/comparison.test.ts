import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { Chunk } from '@codemirror/merge';
import { comparisonText, comparisonDiffConfig } from '../src/renderer/comparison.ts';

const cases = [
  ['math token', String.raw`For $x\ge0$, $u_1(x)=-x$.`, String.raw`For $x>0$, $u_2(x)=x$.`],
  ['preamble and citation', String.raw`\usepackage{amsmath}\n\cite{Old}`, String.raw`\usepackage{amssymb}\n\cite{New}`],
  ['pure insertion', '', 'New paragraph.\n'], ['pure deletion', 'Removed paragraph.\n', ''],
  ['repeated paragraphs', 'Same\nKeep\nSame\n', 'Same\nChanged\nSame\n'],
  ['Unicode and braces', 'θ 😀 {x}', 'θ 😃 {x'],
  ['paragraph reflow', 'A long sentence about allocations.\nAnother sentence.', 'A long sentence\nabout allocations. Another sentence.'],
  ['large rewrite', 'Old text x\n'.repeat(5000), 'New text y\n'.repeat(5000)]
];
for (const [name, original, current] of cases) test(`whole-document diff retains all source characters: ${name}`, () => {
  const a = EditorState.create({ doc: original }).doc, b = EditorState.create({ doc: current }).doc;
  const chunks = Chunk.build(a, b, comparisonDiffConfig); assert(chunks.length > 0);
  let at = 0, reconstructed = '';
  for (const chunk of chunks) for (const change of chunk.changes) {
    const from = chunk.fromA + change.fromA, to = chunk.fromA + change.toA;
    reconstructed += original.slice(at, from) + current.slice(chunk.fromB + change.fromB, chunk.fromB + change.toB); at = to;
  }
  reconstructed += original.slice(at); assert.equal(reconstructed, current);
});
test('only line-ending and leading BOM normalization is applied, with whitespace and comments retained', () => {
  assert.equal(comparisonText('\uFEFF% comment\r\n  x  \r\ny\r'), '% comment\n  x  \ny\n');
  const doc = EditorState.create({ doc: 'Same source' }).doc; assert.equal(Chunk.build(doc, doc, comparisonDiffConfig).length, 0);
});
