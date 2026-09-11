import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { commentSchema, type Comment } from '../src/shared/contracts.ts';

// Exercise the actual TSX renderer without requiring a browser or an AI call.
const bundled = await build({ entryPoints: ['src/renderer/DiscussionMessage.tsx'], bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react', 'react/jsx-runtime'] });
const compiled = { exports: {} as { DiscussionMessage: (props: { message: Comment['messages'][number]; comment: Comment; onUse: () => void }) => ReturnType<typeof createElement> } };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
const comment = commentSchema.parse({ id: 'example', title: 'Clarify', original: 'Original claim.', explanation: '', replacement: 'Existing proposal.' });
const message = (replacement: string | null, packages: string[] = []): Comment['messages'][number] => ({ role: 'assistant', text: 'A shorter alternative.', createdAt: '2026-09-09T00:00:00Z', proposal: { replacement, packages } });
const render = (m: Comment['messages'][number], c = comment) => renderToStaticMarkup(createElement(compiled.exports.DiscussionMessage, { message: m, comment: c, onUse: () => { throw new Error('Rendering must not adopt a proposal'); } }));

test('discussion displays literal suggested LaTeX, preserves the ending and escapes markup', () => {
  const latex = 'By Lemma~\\ref{lem:order}, $x < y$.\n<script>not executable</script>\nFINAL LINE';
  const html = render(message(latex));
  assert.match(html, /aria-label="Suggested wording"/);
  assert(html.includes('By Lemma~\\ref{lem:order}, $x &lt; y$.'));
  assert(html.includes('&lt;script&gt;not executable&lt;/script&gt;\nFINAL LINE'));
  assert.match(html, /Use this wording/);
  assert.equal(comment.replacement, 'Existing proposal.');
});

test('explanation-only replies have no empty proposal; deletions and package additions are explicit', () => {
  for (const m of [message(null), { role: 'assistant' as const, text: 'Keep the existing wording.', createdAt: '2026-09-09T00:00:00Z' }]) {
    assert.doesNotMatch(render(m), /Suggested wording|Use this wording/);
  }
  const html = render(message('', ['amsmath', 'amssymb']));
  assert.match(html, /Remove this passage\./);
  assert(html.includes('\\usepackage{amsmath}\n\\usepackage{amssymb}'));
  assert.match(html, /Use this wording/);
});

test('current proposal marker follows effective draft and packages, and completed alternatives remain readable', () => {
  const m = message('Alternative.', ['amsmath']);
  assert.doesNotMatch(render(m), /Matches the current proposal/);
  const selected = { ...comment, draft: 'Alternative.', packages: ['amsmath'] };
  assert.match(render(m, selected), /Matches the current proposal/);
  assert.match(render(m, selected), /button disabled=""/);
  assert.doesNotMatch(render(m, { ...selected, draft: 'Manually edited.' }), /Matches the current proposal/);
  assert.doesNotMatch(render(m, { ...selected, packages: [] }), /Matches the current proposal/);
  const completed = render(m, { ...selected, decision: 'applied' });
  assert.match(completed, /Alternative\./);
  assert.match(completed, /button disabled=""/);
  assert.doesNotMatch(completed, /Matches the current proposal/);
});

test('long multiline alternatives are rendered in full without truncating the suggested source', () => {
  const replacement = 'A mathematical claim: $\\alpha + \\beta$.\n'.repeat(1800) + 'END OF PROPOSAL';
  const html = render(message(replacement));
  assert(html.includes(replacement));
});

test('an alternative for earlier question wording stays visible but cannot replace the newly linked passage', () => {
  const html = render({ ...message('Earlier alternative.'), proposalOriginal: 'Earlier quote.' }, { ...comment, original: 'Newly linked quote.' });
  assert.match(html, /Earlier alternative\./); assert.match(html, /earlier passage/); assert.match(html, /button disabled=""/);
});
