import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ProjectService } from '../src/main/project-service.ts';
import { CompileService } from '../src/main/compile-service.ts';
import { CodexService } from '../src/main/codex-service.ts';
import { BuildInputHelp } from '../src/main/build-input-help.ts';

async function fixture() {
  await fs.mkdir('.test-runs', { recursive: true });
  const root = await fs.mkdtemp(path.resolve('.test-runs/build-help-')), paper = path.join(root, 'paper'); await fs.mkdir(paper);
  const text = '\\def\\chosen{part}\n\\input{\\chosen}\n';
  await fs.writeFile(path.join(paper, 'main.tex'), text); await fs.writeFile(path.join(paper, 'part.tex'), 'Synthetic part.');
  await fs.writeFile(path.join(paper, 'archive.pdf'), ''); await fs.truncate(path.join(paper, 'archive.pdf'), 60_000_000);
  const projects = new ProjectService(path.join(root, 'runtime')), project = await projects.open(path.join(paper, 'main.tex'));
  const compiler = new CompileService(projects, path.join(root, 'builds')), codex = new CodexService(projects, path.join(root, 'codex'));
  const help = new BuildInputHelp(projects, compiler, codex);
  return { root, paper, text, project, compiler, codex, help, remove: async () => { await compiler.stop(); await codex.cancel(); await fs.rm(root, { recursive: true, force: true }); } };
}

test('local build-help preview never calls Codex; explicit request uses exactly that payload and only proposes checked relative paths', async () => {
  const f = await fixture(); let calls = 0, expected = '';
  try {
    f.codex.client.run = async (prompt, _schema, _progress, _effort, _fast, reader) => {
      calls++; assert.equal(prompt, expected); assert.equal(reader, undefined);
      return { selectedPaths: ['main.tex', 'part.tex'], explanation: 'The macro names part.tex.', needsInput: null };
    };
    const preview = await f.help.prepare(f.project.id, f.text); expected = preview.prompt;
    assert.equal(calls, 0); assert(!preview.prompt.includes(f.root));
    assert.equal(JSON.parse(preview.prompt).sources[0].text, f.text);
    const result = await f.help.ask(f.project.id, f.text, preview.id, () => {});
    assert.equal(calls, 1); assert.equal(result.validation.ready, true);
    assert(result.validation.issues.some(issue => issue.includes('Computed')));
    assert.deepEqual(result.selectedPaths, ['main.tex', 'part.tex']);
    await assert.rejects(fs.stat(path.join(f.root, 'builds')), { code: 'ENOENT' });
    assert.equal(await fs.readFile(path.join(f.paper, 'main.tex'), 'utf8'), f.text);
    await assert.rejects(f.help.ask(f.project.id, f.text, preview.id, () => {}), /preview/);
  } finally { await f.remove(); }
});
test('model file lists cannot read outside the project or silently omit literal/transitive dependencies', async () => {
  const f = await fixture();
  try {
    for (const selectedPaths of [['main.tex', '../outside.tex'], ['main.tex', '.hidden.tex'], ['main.tex', 'missing.tex'], ['main.tex', 'part.tex']]) {
      f.codex.client.run = async () => ({ selectedPaths, explanation: '', needsInput: null });
      const preview = await f.help.prepare(f.project.id, f.text);
      if (selectedPaths.includes('part.tex')) await fs.writeFile(path.join(f.paper, 'part.tex'), '\\input{missing-leaf}');
      const result = await f.help.ask(f.project.id, f.text, preview.id, () => {});
      assert.equal(result.validation.ready, false); assert(result.validation.issues.length);
    }
    assert.equal(await fs.readFile(path.join(f.paper, 'main.tex'), 'utf8'), f.text);
  } finally { await f.remove(); }
});
test('stale previews and cancelled model replies cannot start a later input plan; unanswered questions cannot compile', async () => {
  const f = await fixture();
  try {
    const preview = await f.help.prepare(f.project.id, f.text);
    f.codex.client.run = async () => { throw new Error('Unexpected model call'); };
    await assert.rejects(f.help.ask(f.project.id, f.text + 'Changed', preview.id, () => {}), /changed/);
    let release!: () => void, started!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { started = resolve; });
    f.codex.client.run = async () => { started(); await held; return { selectedPaths: ['main.tex', 'part.tex'], explanation: '', needsInput: null }; };
    const pending = f.help.ask(f.project.id, f.text, preview.id, () => {}), rejected = assert.rejects(pending, /cancelled/);
    await ready; f.help.cancel(); release(); await rejected;
    const next = await f.help.prepare(f.project.id, f.text);
    f.codex.client.run = async () => ({ selectedPaths: ['main.tex', 'part.tex'], explanation: '', needsInput: 'Which alternative is intended?' });
    const result = await f.help.ask(f.project.id, f.text, next.id, () => {});
    assert.equal(result.validation.ready, false); assert.match(result.needsInput!, /alternative/);
  } finally { await f.remove(); }
});
