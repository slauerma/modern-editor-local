import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceMatch } from '../src/renderer/source-search.ts';

test('search uses the edited query, cycles both ways and wraps from the first match', () => {
  const text = 'alpha βήτα alpha';
  assert.deepEqual(sourceMatch(text, 'alpha', 0, 0), { from: 0, to: 5 });
  assert.deepEqual(sourceMatch(text, 'alpha', 0, 5), { from: 11, to: 16 });
  assert.deepEqual(sourceMatch(text, 'βήτα', 11, 16), { from: 6, to: 10 });
  assert.deepEqual(sourceMatch(text, 'alpha', 0, 5, true), { from: 11, to: 16 });
  assert.equal(sourceMatch(text, '', 0, 0), null);
  assert.equal(sourceMatch(text, 'absent', 0, 0), null);
});
test('search treats LaTeX punctuation literally and keeps Unicode offsets on a long document', () => {
  const text = '😀\n'.repeat(25000) + '\\ref{result.a}';
  const found = sourceMatch(text, '\\ref{result.a}', 0, 0)!;
  assert.equal(text.slice(found.from, found.to), '\\ref{result.a}');
  assert.equal(sourceMatch(text, 'result.*', 0, 0), null);
});
