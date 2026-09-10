import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenDiff } from '../src/shared/proposal-diff.ts';

test('the visible diff isolates consequential words and reconstructs both exact LaTeX strings', () => {
  const original = 'At most $\\alpha$ is feasible. Ελληνικά 😀', proposed = 'At least $\\beta$ is feasible. Ελληνικά 😀';
  const parts = tokenDiff(original, proposed);
  assert(parts.some(p => p.kind === 'removed' && p.text === 'most'));
  assert(parts.some(p => p.kind === 'added' && p.text === 'least'));
  assert.equal(parts.filter(p => p.kind !== 'added').map(p => p.text).join(''), original);
  assert.equal(parts.filter(p => p.kind !== 'removed').map(p => p.text).join(''), proposed);
});
test('large replacements and empty proposals retain exact text with bounded comparison work', () => {
  for (const [original, proposed] of [['a b '.repeat(5000), 'c d '.repeat(5000)], ['+ '.repeat(30000), ''], ['', 'New words'], ['Same', 'Same']]) {
    const parts = tokenDiff(original, proposed);
    assert.equal(parts.filter(p => p.kind !== 'added').map(p => p.text).join(''), original);
    assert.equal(parts.filter(p => p.kind !== 'removed').map(p => p.text).join(''), proposed);
  }
});
