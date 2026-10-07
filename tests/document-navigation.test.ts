import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { documentOutline, filterOutline } from '../src/shared/document-outline.ts';
import { NavigationHistory } from '../src/renderer/navigation-history.ts';

test('outline covers starred/nested headings and labelled results, skipping preamble, comments, literal examples and macro definitions', () => {
  const text = String.raw`\documentclass{article}
\newcommand{\sample}{\section{Fake}}
\begin{document}
% \section{Comment}
\section* % a title
 [Short]{An \emph{important} result}\label{sec:result}
\subsection{Details}
\begin{lemma}[Existence]\label{lem:exists}
A statement.
\end{lemma}
\begin{equation}\label{eq:bound}
x=1
\end{equation}
\begin{verbatim}
\section{Literal}\label{fake}
\end{verbatim}
\verb|\section{Also fake}|
\end{document}
\section{Outside}`;
  const entries = documentOutline(text);
  assert.deepEqual(entries.map(e => e.title), ['An important result', 'Details', 'Existence', 'equation']);
  assert.deepEqual(entries.map(e => e.label), ['sec:result', '', 'lem:exists', 'eq:bound']);
  for (const e of entries) assert.equal(e.line, text.slice(0, e.from).split('\n').length);
  assert.equal(filterOutline(entries, 'LEM:ex EXIST').length, 1);
  assert.equal(filterOutline(entries, 'not present').length, 0);
  assert.equal(documentOutline('\\section{unfinished').length, 0);
  assert.equal(documentOutline('Plain text without headings').length, 0);
});
test('Back is bounded, follows source edits and consumes no document Undo step', () => {
  const stack = new NavigationHistory<{ id: number; source: { anchor: number; head: number; topLine: number; offset: number } }>();
  const state = EditorState.create({ doc: 'First.\nDestination.\nFinal.' });
  for (let id = 0; id < 60; id++) stack.push({ id, source: { anchor: 7, head: 19, topLine: 2, offset: 6 } });
  assert.equal(stack.size, 50);
  const edit = state.update({ changes: { from: 0, insert: 'New line.\n' } });
  stack.map(edit);
  assert.deepEqual(stack.pop(), { id: 59, source: { anchor: 17, head: 29, topLine: 3, offset: 6 } });
  stack.map(edit.state.update({ changes: { from: 0, to: 10 } }));
  assert.deepEqual(stack.pop()?.source, { anchor: 7, head: 19, topLine: 2, offset: 6 });
  stack.clear(); assert.equal(stack.size, 0); assert.equal(stack.pop(), undefined);
});
