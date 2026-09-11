import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ProjectService } from '../src/main/project-service.ts';
import { CompileService } from '../src/main/compile-service.ts';

async function fixture() {
  await fs.mkdir('.test-runs', { recursive: true });
  const root = await fs.mkdtemp(path.resolve('.test-runs/project-directory-')), paper = path.join(root, 'paper'), other = path.join(root, 'other');
  await fs.mkdir(paper); await fs.mkdir(other);
  const text = '\\input{part}\n', file = path.join(paper, 'main.tex');
  for (const directory of [paper, other]) await fs.writeFile(path.join(directory, 'main.tex'), text);
  await fs.writeFile(path.join(paper, 'part.tex'), 'Original companion');
  await fs.writeFile(path.join(other, 'part.tex'), 'Unopened companion');
  const service = new ProjectService(path.join(root, 'runtime')), project = await service.open(file);
  const compiler = new CompileService(service, path.join(root, 'builds'), path.join(root, 'must-not-run-latexmk'));
  return { root, paper, other, file, text, service, project, compiler, remove: async () => { await compiler.stop(); await fs.rm(root, { recursive: true, force: true }); } };
}
for (const replacement of ['symlink', 'regular-directory'] as const) {
  test(`project and compilation reject ${replacement} replacement despite identical root-source bytes`, async () => {
    const f = await fixture();
    try {
      await fs.rename(f.paper, path.join(f.root, 'opened-paper'));
      if (replacement === 'symlink') await fs.symlink(f.other, f.paper); else await fs.rename(f.other, f.paper);
      await assert.rejects(f.service.assertDirectory(f.project.id), /paper folder changed or is linked/);
      await assert.rejects(f.service.assertUnchanged(f.project.id), /paper folder changed or is linked/);
      await assert.rejects(f.compiler.planInputs(f.project.id, f.text), /paper folder changed or is linked/);
      await assert.rejects(f.compiler.compile(f.project.id, f.text, 'pdflatex'), /paper folder changed or is linked/);
      await assert.rejects(f.service.save({ projectId: f.project.id, text: 'Editor change', review: f.project.review }), /paper folder changed or is linked/);
      assert.equal(await fs.readFile(path.join(f.paper, 'main.tex'), 'utf8'), f.text);
      await assert.rejects(fs.stat(path.join(f.root, 'builds')), { code: 'ENOENT' });
      assert.equal(f.compiler.isBusy, false);
    } finally { await f.remove(); }
  });
}
test('source-only atomic replacement and normal Save preserve the opened directory identity', async () => {
  const f = await fixture();
  try {
    const identity = await f.service.assertDirectory(f.project.id);
    identity.ino = -1;
    const bound = await f.service.assertDirectory(f.project.id);
    assert.notEqual(bound.ino, -1, 'Callers cannot change the privately stored identity.');
    await fs.writeFile(path.join(f.paper, 'replacement.tex'), f.text);
    await fs.rename(path.join(f.paper, 'replacement.tex'), f.file);
    await f.service.assertUnchanged(f.project.id);
    const saved = 'Normal atomic source save\n';
    await f.service.save({ projectId: f.project.id, text: saved, review: f.project.review });
    await f.service.assertUnchanged(f.project.id);
    assert.deepEqual(await f.service.assertDirectory(f.project.id), bound);
    assert.equal(await fs.readFile(f.file, 'utf8'), saved);
    await f.service.persist({ projectId: f.project.id, text: saved + 'Recovered draft', review: f.project.review });
    const reopened = await new ProjectService(path.join(f.root, 'runtime')).open(f.file);
    assert.equal(reopened.text, saved + 'Recovered draft'); assert.equal(reopened.recovered, true);
  } finally { await f.remove(); }
});
