import { test } from 'node:test';
import assert from 'node:assert/strict';
import { undo } from '@codemirror/commands';
import { commentSchema } from '../src/shared/contracts.ts';
import { adoptComment, proposalChanges, changedText } from '../src/shared/review.ts';
import { initialState, commentsField, applyProposal } from '../src/renderer/editor-state.ts';

for (const opening of ['\\begin{document}', '\\begin {document}', '\\begin% a comment\n{ document }']) {
  test(`package insertion respects active boundaries and undo: ${JSON.stringify(opening)}`, () => {
    const source = `\\documentclass{article}\n% Example: \\begin{document}\n\\newcommand{\\example}{\\begin{document}}\n${opening}\nThe allocation are feasible.\n\\end{document}\n`;
    const comment = adoptComment(source, commentSchema.parse({ id: 'one', title: 'Grammar', explanation: 'Correct agreement.', original: 'The allocation are feasible.', replacement: 'The allocation is feasible.', packages: ['xcolor'] }));
    const changes = proposalChanges(source, comment);
    const next = changedText(source, changes);
    assert(next.includes(`\\usepackage{xcolor}\n${opening}`));
    assert(next.includes('The allocation is feasible.'));
    let state = initialState(source, [comment]);
    state = state.update(applyProposal(state, 'one')).state;
    assert(undo({ state, dispatch: tr => { state = tr.state; } }));
    assert.equal(state.doc.toString(), source); assert.equal(state.field(commentsField)[0].decision, 'open');
  });
}
test('spaced package declarations are recognized and literal examples do not supply packages', () => {
  const source = '\\documentclass{article}\n% \\usepackage{xcolor}\n\\usepackage [\n table\n] {xcolor, amsmath}\n\\begin{document}\nOld.\n\\end{document}';
  const comment = adoptComment(source, commentSchema.parse({ id: 'c', title: 'Edit', explanation: 'Replace the sentence.', original: 'Old.', replacement: 'New.', packages: ['xcolor','amsmath'] }));
  assert.equal(proposalChanges(source, comment).length, 1);
});
