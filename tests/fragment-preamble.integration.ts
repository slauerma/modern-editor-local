import { documentStatePath } from '../src/main/document-state.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProjectService } from '../src/main/project-service.ts';
import { CompileService } from '../src/main/compile-service.ts';
import { CodexService, preambleOutputSchema } from '../src/main/codex-service.ts';
import { preambleChanges } from '../src/shared/fragment-preamble.ts';
import { changedText } from '../src/shared/review.ts';

test('the real Codex-service path retains a structured answer and the real compiler validates its fragment wrapper', { timeout: 30000 }, async () => {
  const root = path.resolve('.test-runs', 'codex-preamble-' + randomUUID()), paper = path.join(root, 'paper');
  await fs.mkdir(paper, { recursive: true });
  const source = '\\begin{lemma}\nFor $x\\in\\mathbb{R}$, $x^2\\geq0$.\n\\end{lemma}\n% last source comment';
  const file = path.join(paper, 'fragment.tex'); await fs.writeFile(file, source);
  const projects = new ProjectService(path.join(root, 'cache')), p = await projects.open(file);
  const codex = new CodexService(projects, path.join(root, 'codex'));
  const compiler = new CompileService(projects, path.join(root, 'builds'), undefined, undefined, path.resolve('resources/tex-support/tcilatex.tex'));
  codex.client.run = async (prompt, schema) => {
    const request = JSON.parse(prompt);
    assert.equal(request.source, source); assert.equal(request.insertionPoint, 0); assert.equal(request.engine, 'pdflatex');
    assert.deepEqual(schema, preambleOutputSchema);
    return { explanation: 'AMS packages and an ordinary lemma environment.', preamble: '\\documentclass{article}\n\\usepackage{amsmath,amssymb,amsthm}\n\\newtheorem{lemma}{Lemma}\n\\begin{document}', ending: '\\end{document}', needsInput: null };
  };
  try {
    const answer = await codex.preamble({ projectId: p.id, text: source, engine: 'pdflatex' }, () => {});
    const candidate = changedText(source, preambleChanges(source, answer));
    const result = await compiler.compile(p.id, candidate, 'pdflatex');
    assert(result.clean, result.log); assert(await compiler.validate(p.id, result.id, candidate));
    assert.equal(await fs.readFile(file, 'utf8'), source);
    const answers = await fs.readdir(path.join(documentStatePath(file), 'reviews'));
    assert.equal(answers.filter(n => n.startsWith('preamble-')).length, 1);
    await fs.mkdir('test-evidence/fragment-preamble', { recursive: true });
    await fs.writeFile('test-evidence/fragment-preamble/lemma.pdf', await compiler.pdf(result.id));
    await fs.writeFile('test-evidence/fragment-preamble/lemma-build.json', JSON.stringify(result, null, 2));
    const invalid = candidate.replace('$x^2\\geq0$', '$\\payoff(x)$');
    const failure = await compiler.compile(p.id, invalid, 'pdflatex');
    assert.equal(failure.success, false); assert.equal(await fs.readFile(file, 'utf8'), source);
    assert((await compiler.pdf(result.id)).length > 0);
  } finally { await compiler.stop(); await codex.client.stop(); }
});
