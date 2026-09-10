import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preambleContext, preambleChanges } from '../src/shared/fragment-preamble.ts';
import { changedText } from '../src/shared/review.ts';
import { preambleProposalSchema } from '../src/shared/contracts.ts';

const proposal = (preamble: string, ending = '\\end{document}') => preambleProposalSchema.parse({ preamble, ending, explanation: '', needsInput: null });
const opening = '\\documentclass{article}\n\\usepackage{amsmath,amssymb}\n\\begin{document}';

test('generated insertions preserve a fragment including Unicode, whitespace and a final comment', () => {
  const source = '  A θ type has payoff $u=0$.\n\n% final comment without newline';
  const changes = preambleChanges(source, proposal(opening));
  const candidate = changedText(source, changes);
  assert(changes.every(c => c.from === c.to));
  assert(candidate.includes(source));
  assert.equal(candidate.slice(changes[0].insert.length, changes[0].insert.length + source.length), source);
  assert.match(candidate, /without newline\n\\end\{document\}/);
});

test('existing preambles receive additions before the document, without another class or body', () => {
  const source = '\\documentclass[12pt]{article}\n\\begin { document }\nA paragraph.\n\\end{document}';
  const changes = preambleChanges(source, proposal('\\usepackage{amsmath}', ''));
  assert.equal(changes[0].from, source.indexOf('\\begin'));
  assert(changedText(source, changes).includes('\\documentclass[12pt]{article}\n\\usepackage{amsmath}\n\\begin { document }'));
  assert.equal(preambleChanges(source, proposal('', '')).length, 0);
  assert.throws(() => preambleChanges(source, proposal(opening, '')), /second document class/);
});

test('missing closing boundaries can be completed while comments and literal TeX examples are ignored', () => {
  const source = '% \\documentclass{fake}\n\\documentclass{article}\n\\begin{document}\n\\verb|\\end{document}|\n\\begin{verbatim}\n\\begin{document}\n\\end{verbatim}\nText.';
  const context = preambleContext(source);
  assert.equal(context.hasDocumentEnd, false); assert.equal(context.hasDocumentClass, true);
  const candidate = changedText(source, preambleChanges(source, proposal('', '\\end{document}')));
  assert(candidate.startsWith(source));
  assert.equal(preambleContext(candidate).hasDocumentEnd, true);
});

test('escaped commands and commands in macro arguments are not mistaken for document boundaries', () => {
  const source = '\\\\begin{document}\n\\newcommand{\\example}{\\begin{document}}\nA fragment.';
  assert.equal(preambleContext(source).hasDocumentBegin, false);
  assert.equal(preambleContext(source).hasDocumentClass, false);
});

test('ambiguous partial preambles and duplicate boundaries stay unchanged', () => {
  for (const source of ['\\documentclass{article}\nSome body.', '\\usepackage{amsmath}\nSome body.', '\\begin{document}\n\\begin{document}\nSome body.', '\\end{document}\n\\begin{document}'])
    assert.throws(() => preambleContext(source), /source was kept/i);
  assert.throws(() => preambleContext('   '), /Paste some LaTeX/);
});

test('a model cannot insert body prose, arbitrary endings or custom mathematical definitions', () => {
  assert.throws(() => preambleChanges('Text.', proposal(opening + '\nExtra body prose')), /without adding body text/);
  assert.throws(() => preambleChanges('Text.', proposal(opening, 'Extra text.\\end{document}')), /only add the missing document closing/);
  assert.throws(() => preambleChanges('$\\payoff(x)$', proposal('\\documentclass{article}\n\\newcommand{\\payoff}{0}\n\\begin{document}')), /custom command definitions/);
  assert.throws(() => preambleChanges('Text.', proposal('\\begin{document}')), /one complete document wrapper/);
  assert.throws(() => preambleChanges('Text.', { ...proposal(''), needsInput: 'Supply the original macro.' }), /original macro/);
});
