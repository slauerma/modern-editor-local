import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proposalContext, tokenDiff } from '../src/shared/proposal-diff.ts';

test('the visible diff isolates consequential words and reconstructs both exact LaTeX strings', () => {
  const original = 'At most $\\alpha$ is feasible. Ελληνικά 😀', proposed = 'At least $\\beta$ is feasible. Ελληνικά 😀';
  const parts = tokenDiff(original, proposed);
  assert(parts.some(p => p.kind === 'removed' && p.text === 'most'));
  assert(parts.some(p => p.kind === 'added' && p.text === 'least'));
  assert.equal(parts.filter(p => p.kind !== 'added').map(p => p.text).join(''), original);
  assert.equal(parts.filter(p => p.kind !== 'removed').map(p => p.text).join(''), proposed);
});

test('paragraph rewrites preserve the common middle instead of treating everything as replaced', () => {
  const middle = 'A feasible assignment matches each buyer to a seller, with total value maximized. '.repeat(12);
  const original = 'The original lead-in. ' + middle + 'The old conclusion.';
  const proposed = 'A clearer beginning. ' + middle + 'A qualified conclusion.';
  const parts = tokenDiff(original, proposed);
  assert(parts.some(p => p.kind === 'same' && p.text.includes(middle)));
  assert.equal(parts.filter(p => p.kind !== 'added').map(p => p.text).join(''), original);
  assert.equal(parts.filter(p => p.kind !== 'removed').map(p => p.text).join(''), proposed);
});

test('context uses the exact selected occurrence and never changes the replacement span', () => {
  for (const nl of ['\n', '\r\n']) {
    const paragraph = 'We compare two patterns.' + nl + 'They accept any positive-value match. The stocks follow.';
    const original = 'accept any positive-value match';
    const text = 'Earlier: ' + original + '.' + nl + nl + paragraph + nl + nl + 'Next paragraph.';
    const from = text.lastIndexOf(original), to = from + original.length;
    const comment = { original, from, to, validity: 'current' as const, decision: 'open' as const };
    const context = proposalContext(text, comment);
    assert.equal(context.before + original + context.after, paragraph);
    assert.equal(text.slice(from, to), original);
    for (const validity of ['stale', 'unconfirmed', 'ambiguous'] as const) assert.equal(proposalContext(text, { ...comment, validity }).contextual, false);
    assert.equal(proposalContext(text, { ...comment, decision: 'applied' }).contextual, false);
    assert.equal(proposalContext(text, { ...comment, from: 0 }).contextual, false);
  }
});

test('ordinary section boundaries stay outside the contextual reading passage', () => {
  const text = '\\section{Setup}\nThe claim is true.\n\\section{Result}\nNext.';
  const from = text.indexOf('true');
  const context = proposalContext(text, { original: 'true', from, to: from + 4, validity: 'current', decision: 'open' });
  assert.equal(context.before + 'true' + context.after, 'The claim is true.\n');
});
test('large replacements and empty proposals retain exact text with bounded comparison work', () => {
  for (const [original, proposed] of [['a b '.repeat(5000), 'c d '.repeat(5000)], ['+ '.repeat(30000), ''], ['', 'New words'], ['Same', 'Same']]) {
    const parts = tokenDiff(original, proposed);
    assert.equal(parts.filter(p => p.kind !== 'added').map(p => p.text).join(''), original);
    assert.equal(parts.filter(p => p.kind !== 'removed').map(p => p.text).join(''), proposed);
  }
});
