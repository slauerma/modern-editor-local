import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { planBuildInputs, validateBuildInputSelection, readBuildInput, captureBuildDirectory, DEFAULT_BUILD_INPUT_LIMITS, BUILD_INPUT_COPY_THRESHOLD } from '../src/main/build-input-plan.ts';

async function fixture(text = 'Frozen source') {
  await fs.mkdir('.test-runs', { recursive: true });
  const root = await fs.mkdtemp(path.resolve('.test-runs/build-input-plan-'));
  const put = async (relative: string, content: string) => { await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true }); await fs.writeFile(path.join(root, relative), content); };
  await put('main.tex', 'Original disk source');
  const settings = { rootDir: root, rootName: 'main.tex', text };
  return { root, put, settings, remove: () => fs.rm(root, { recursive: true, force: true }) };
}
const narrow = { maxBytes: 50_000_000, maxFiles: 1 };
test('small folders retain all supported inputs, account for frozen source bytes, and ignore the output PDF', async () => {
  const f = await fixture('Frozen Ελληνικά');
  try {
    await f.put('unreferenced.tex', 'Keep compatibility'); await f.put('main.pdf', 'Previous output'); await f.put('.modern-editor/private.txt', 'Not input');
    const plan = await planBuildInputs(f.settings);
    assert.equal(plan.status, 'ready'); if (plan.status !== 'ready') return;
    assert.equal(plan.mode, 'folder'); assert.deepEqual(plan.files.map(f => f.relative), ['main.tex', 'unreferenced.tex']);
    assert.equal(plan.totalBytes, Buffer.byteLength(f.settings.text) + Buffer.byteLength('Keep compatibility'));
    assert.deepEqual(plan.limits, DEFAULT_BUILD_INPUT_LIMITS);
    assert.deepEqual(BUILD_INPUT_COPY_THRESHOLD, { maxBytes: 50_000_000, maxFiles: 500 });
  } finally { await f.remove(); }
});
test('large folder resolves local TeX, styles, graphics, bibliography and imports from frozen root only', async () => {
  const text = String.raw`\documentclass{article}
\usepackage{local}
\graphicspath{{figures/}}
\input{sections/chapter}
\includegraphics{plot}
\bibliography{refs}
\bibliographystyle{localstyle}
\includeonly{chapter-one}
\include{chapter-one}
\include{chapter-two}
\import{imported/}{entry}
% \input{commented-out}
\verb|\input{verbatim-name}|
\begin{verbatim}\input{more-verbatim}\end{verbatim}`;
  const f = await fixture(text);
  try {
    for (const [name, content] of Object.entries({ 'local.sty': '\\RequirePackage{amsmath}\n\\input{local-settings}', 'local-settings.tex': '% settings', 'sections/chapter.tex': '\\input{shared}', 'shared.tex': 'Shared root-relative input', 'figures/plot.png': 'Image', 'refs.bib': '@article{key}', 'localstyle.bst': 'style', 'chapter-one.tex': 'One', 'chapter-two.tex': 'Two', 'imported/entry.tex': '\\subimport{nested/}{part}', 'imported/nested/part.tex': '\\input{leaf}', 'imported/nested/leaf.tex': 'Leaf' })) await f.put(name, content);
    await Promise.all(Array.from({ length: 505 }, (_, i) => f.put(`archive/unrelated-${i}.tex`, 'Unrelated')));
    const seen: string[] = [];
    const plan = await planBuildInputs({ ...f.settings, standardFileExists: async name => { seen.push(name); return ['article.cls', 'amsmath.sty'].includes(name); } });
    assert.equal(plan.status, 'ready', JSON.stringify(plan)); if (plan.status !== 'ready') return;
    assert.equal(plan.mode, 'dependencies');
    assert.deepEqual(plan.files.map(file => file.relative).sort(), ['main.tex', 'local.sty', 'local-settings.tex', 'sections/chapter.tex', 'shared.tex', 'figures/plot.png', 'refs.bib', 'localstyle.bst', 'chapter-one.tex', 'chapter-two.tex', 'imported/entry.tex', 'imported/nested/part.tex', 'imported/nested/leaf.tex'].sort());
    assert.deepEqual(seen.sort(), ['amsmath.sty', 'article.cls']);
    assert(plan.files.filter(file => /\.(tex|sty)$/.test(file.relative)).every(file => /^[a-f0-9]{64}$/.test(file.hash ?? '')));
    assert.equal(await fs.readFile(path.join(f.root, 'main.tex'), 'utf8'), 'Original disk source');
  } finally { await f.remove(); }
});
test('more than 500 literal required files fit the automatic 2,000-file budget after discovery', async () => {
  const f = await fixture(Array.from({ length: 505 }, (_, i) => `\\input{parts/part-${i}}`).join('\n'));
  try {
    await Promise.all(Array.from({ length: 505 }, (_, i) => f.put(`parts/part-${i}.tex`, 'Part')));
    const plan = await planBuildInputs(f.settings);
    assert.equal(plan.status, 'ready', JSON.stringify(plan)); if (plan.status !== 'ready') return;
    assert.equal(plan.mode, 'dependencies'); assert.equal(plan.files.length, 506); assert.equal(plan.limits.maxFiles, 2000);
  } finally { await f.remove(); }
});
test('graphics alternatives are retained for TeX to choose; an explicit list keeps the root mandatory', async () => {
  const f = await fixture(String.raw`\includegraphics{plot}`);
  try {
    await f.put('plot.pdf', 'PDF'); await f.put('plot.png', 'PNG');
    await f.put('unrelated.pdf', ''); await fs.truncate(path.join(f.root, 'unrelated.pdf'), 60_000_000);
    const automatic = await planBuildInputs(f.settings);
    assert.equal(automatic.status, 'ready', JSON.stringify(automatic)); if (automatic.status !== 'ready') return;
    assert.equal(automatic.mode, 'dependencies');
    assert.deepEqual(automatic.files.map(file => file.relative), ['main.tex', 'plot.pdf', 'plot.png']);
    const blocked = await planBuildInputs({ ...f.settings, limits: narrow });
    assert.equal(blocked.status, 'needs-selection'); if (blocked.status !== 'needs-selection') return;
    assert.equal(blocked.requiredFiles, 3);
    assert.deepEqual(blocked.requiredPaths, ['main.tex', 'plot.pdf', 'plot.png']);
    const chosen = await validateBuildInputSelection({ ...f.settings, selectedPaths: ['main.tex', 'plot.pdf'] });
    assert.equal(chosen.status, 'ready', JSON.stringify(chosen));
    const both = await validateBuildInputSelection({ ...f.settings, selectedPaths: ['main.tex', 'plot.pdf', 'plot.png'] });
    assert.equal(both.status, 'ready');
    const omitted = await validateBuildInputSelection({ ...f.settings, selectedPaths: ['plot.pdf'] });
    assert.equal(omitted.status, 'needs-selection'); if (omitted.status === 'needs-selection') assert(omitted.issues.some(issue => issue.includes('omits required input: main.tex')));
  } finally { await f.remove(); }
});
test('only the exact bundled TCI copy skips library definitions; caller graphics and modified copies remain checked', async () => {
  const f = await fixture(String.raw`\input{tcilatex}`);
  try {
    const support = await fs.readFile('resources/tex-support/tcilatex.tex');
    await fs.writeFile(path.join(f.root, 'tcilatex.tex'), support);
    await f.put('unrelated.pdf', ''); await fs.truncate(path.join(f.root, 'unrelated.pdf'), 60_000_000);
    const plan = await planBuildInputs(f.settings);
    assert.equal(plan.status, 'ready', JSON.stringify(plan)); if (plan.status !== 'ready') return;
    assert.equal(plan.mode, 'dependencies'); assert.deepEqual(plan.unresolvedIssues, []);
    assert.deepEqual(plan.files.map(file => file.relative), ['main.tex', 'tcilatex.tex']);
    assert.match(plan.files[1].hash ?? '', /^[a-f0-9]{64}$/);
    for (const command of ['FRAME', 'GRAPHIC', 'IFRAME', 'graffile']) {
      const legacy = await planBuildInputs({ ...f.settings, text: f.settings.text + '\n\\' + command + '{picture.png}' });
      assert.equal(legacy.status, 'needs-selection'); if (legacy.status === 'needs-selection') assert(legacy.issues.some(issue => issue.includes(command)));
    }
    await fs.appendFile(path.join(f.root, 'tcilatex.tex'), '\n\\input{another-input}');
    const modified = await planBuildInputs(f.settings);
    assert.equal(modified.status, 'needs-selection'); if (modified.status === 'needs-selection') {
      assert(modified.issues.some(issue => issue.includes('another-input')));
      assert(modified.issues.some(issue => issue.includes('catcode')));
    }
  } finally { await f.remove(); }
});
test('foreign Windows graphics fallbacks do not block local files; missing or outside inputs still block', { skip: process.platform === 'win32' }, async () => {
  const f = await fixture(String.raw`\graphicspath{{./}{figures/}{X:/paper/figures/}}\includegraphics{plot}`);
  try {
    await f.put('figures/plot.pdf', 'PDF'); await f.put('figures/plot.png', 'PNG');
    await f.put('unrelated.pdf', ''); await fs.truncate(path.join(f.root, 'unrelated.pdf'), 60_000_000);
    const plan = await planBuildInputs(f.settings);
    assert.equal(plan.status, 'ready', JSON.stringify(plan)); if (plan.status !== 'ready') return;
    assert.deepEqual(plan.files.map(file => file.relative), ['figures/plot.pdf', 'figures/plot.png', 'main.tex']);
    for (const text of [
      String.raw`\graphicspath{{X:/paper/figures/}}\includegraphics{missing}`,
      String.raw`\includegraphics{X:/paper/figures/plot.pdf}`,
      String.raw`\graphicspath{{/private/figures/}}\includegraphics{figures/plot.pdf}`,
      String.raw`\graphicspath{{../figures/}}\includegraphics{figures/plot.pdf}`,
      String.raw`\input{X:/paper/part}`
    ]) {
      const blocked = await planBuildInputs({ ...f.settings, text });
      assert.equal(blocked.status, 'needs-selection', text);
    }
  } finally { await f.remove(); }
});
test('computed references require an explicit preview and retain their uncertainty; missing literals still block', async () => {
  const f = await fixture(String.raw`\def\filename{part}\input{\filename}\input{known}`);
  try {
    await f.put('part.tex', 'Selected computed input'); await f.put('known.tex', 'Known input');
    const plan = await planBuildInputs({ ...f.settings, limits: narrow });
    assert.equal(plan.status, 'needs-selection'); if (plan.status === 'needs-selection') assert(plan.issues.some(issue => issue.includes('Computed')));
    const explicit = await validateBuildInputSelection({ ...f.settings, selectedPaths: ['main.tex', 'known.tex', 'part.tex'] });
    assert.equal(explicit.status, 'ready'); if (explicit.status === 'ready') assert(explicit.unresolvedIssues.some(issue => issue.includes('Computed')));
    const missing = await validateBuildInputSelection({ ...f.settings, selectedPaths: ['main.tex', 'part.tex'] });
    assert.equal(missing.status, 'needs-selection');
    const conditional = await validateBuildInputSelection({ ...f.settings, text: String.raw`\IfFileExists{optional.tex}{Yes}{No}`, selectedPaths: ['main.tex'] });
    assert.equal(conditional.status, 'needs-selection'); if (conditional.status === 'needs-selection') assert(conditional.issues.some(issue => issue.includes('Unresolved dependency')));
    await f.put('part.tex', '\\input{not-selected}');
    const transitive = await validateBuildInputSelection({ ...f.settings, selectedPaths: ['main.tex', 'known.tex', 'part.tex'] });
    assert.equal(transitive.status, 'needs-selection'); if (transitive.status === 'needs-selection') assert(transitive.issues.some(issue => issue.includes('not-selected')));
  } finally { await f.remove(); }
});
test('60 MB literal requirements fit the automatic 200 MB budget after dependency discovery; larger requirements report totals', async () => {
  const f = await fixture(String.raw`\includegraphics{large.pdf}`);
  try {
    await f.put('large.pdf', ''); await fs.truncate(path.join(f.root, 'large.pdf'), 60_000_000);
    const plan = await planBuildInputs(f.settings);
    assert.equal(plan.status, 'ready', JSON.stringify(plan)); if (plan.status !== 'ready') return;
    assert.equal(plan.mode, 'dependencies'); assert.equal(plan.totalBytes, 60_000_000 + Buffer.byteLength(f.settings.text));
    assert.deepEqual(plan.limits, { maxBytes: 200_000_000, maxFiles: 2000 });
    const lowered = await planBuildInputs({ ...f.settings, limits: { maxBytes: 50_000_000, maxFiles: 500 } });
    assert.equal(lowered.status, 'needs-selection');
    await fs.truncate(path.join(f.root, 'large.pdf'), 210_000_000);
    const blocked = await planBuildInputs(f.settings);
    assert.equal(blocked.status, 'needs-selection'); if (blocked.status !== 'needs-selection') return;
    assert.equal(blocked.requiredBytes, 210_000_000 + Buffer.byteLength(f.settings.text)); assert.equal(blocked.requiredFiles, 2);
    await assert.rejects(validateBuildInputSelection({ ...f.settings, selectedPaths: ['main.tex'], limits: { maxBytes: 200_000_001, maxFiles: 500 } }), /Invalid build input limits/);
  } finally { await f.remove(); }
});
test('oversized computed selections report actual selected totals separately from literal requirements', async () => {
  const f = await fixture(String.raw`\def\imagefile{large.pdf}\includegraphics{\imagefile}`);
  try {
    await f.put('large.pdf', ''); await fs.truncate(path.join(f.root, 'large.pdf'), 60_000_000);
    const selectedPaths = ['main.tex', 'large.pdf'];
    const blocked = await validateBuildInputSelection({ ...f.settings, selectedPaths, limits: { maxBytes: 50_000_000, maxFiles: 500 } });
    assert.equal(blocked.status, 'needs-selection'); if (blocked.status !== 'needs-selection') return;
    assert.equal(blocked.requiredFiles, 1); assert.equal(blocked.requiredBytes, Buffer.byteLength(f.settings.text));
    assert.equal(blocked.selectedFiles, 2); assert.equal(blocked.selectedBytes, 60_000_000 + Buffer.byteLength(f.settings.text));
    const raised = await validateBuildInputSelection({ ...f.settings, selectedPaths });
    assert.equal(raised.status, 'ready'); if (raised.status === 'ready') assert(raised.unresolvedIssues.some(issue => issue.includes('Computed')));
  } finally { await f.remove(); }
});
test('bounded metadata inventory reports truncation and requires an explicit unverified selection', async () => {
  const f = await fixture(String.raw`\input{needed/part}`);
  try {
    await f.put('needed/part.tex', 'Needed');
    for (let i = 0; i < 12; i++) await f.put(`other-${i}.pdf`, 'Other');
    const plan = await planBuildInputs({ ...f.settings, inventoryEntryLimit: 3 });
    assert.equal(plan.status, 'needs-selection', JSON.stringify(plan)); if (plan.status !== 'needs-selection') return;
    assert.equal(plan.inventory.truncated, true); assert(plan.inventory.visitedEntries <= 3);
    assert.deepEqual(plan.requiredPaths, ['main.tex', 'needed/part.tex']);
    const selected = await validateBuildInputSelection({ ...f.settings, inventoryEntryLimit: 3, selectedPaths: ['main.tex', 'needed/part.tex'] });
    assert.equal(selected.status, 'ready'); if (selected.status === 'ready') assert(selected.unresolvedIssues.some(issue => issue.includes('inventory was truncated')));
  } finally { await f.remove(); }
});
test('root-local package configuration is retained; deliberately omitted companions leave a preview unverified', async () => {
  const f = await fixture(String.raw`\input{part}`);
  try {
    await f.put('part.tex', 'Part'); await f.put('package.cfg', '\\input{settings.def}'); await f.put('settings.def', '\\def\\configured{Yes}');
    const plan = await planBuildInputs({ ...f.settings, limits: { maxBytes: 1000, maxFiles: 3 } });
    assert.equal(plan.status, 'needs-selection'); if (plan.status === 'needs-selection') assert.deepEqual(plan.requiredPaths, ['main.tex', 'package.cfg', 'part.tex', 'settings.def']);
    const selected = await validateBuildInputSelection({ ...f.settings, selectedPaths: ['main.tex', 'part.tex'] });
    assert.equal(selected.status, 'ready'); if (selected.status === 'ready') assert(selected.unresolvedIssues.some(issue => issue.includes('package.cfg')));
    const complete = await validateBuildInputSelection({ ...f.settings, selectedPaths: ['main.tex', 'part.tex', 'package.cfg', 'settings.def'] });
    assert.equal(complete.status, 'ready'); if (complete.status === 'ready') assert.deepEqual(complete.unresolvedIssues, []);
  } finally { await f.remove(); }
});
test('selection rejects outside, hidden and linked resources including linked parent directories', async () => {
  const f = await fixture(String.raw`\input{part}`);
  try {
    await f.put('part.tex', 'Part'); await f.put('ordinary/leaf.tex', 'Leaf');
    await fs.symlink(path.join(f.root, 'ordinary'), path.join(f.root, 'linked-directory'));
    await fs.symlink(path.join(f.root, 'part.tex'), path.join(f.root, 'linked-file.tex'));
    for (const selected of ['../outside.tex', '/outside.tex', '.modern-editor/private.txt', 'linked-directory/leaf.tex', 'linked-file.tex', 'not-there.tex']) {
      const plan = await validateBuildInputSelection({ ...f.settings, selectedPaths: ['main.tex', 'part.tex', selected] });
      assert.equal(plan.status, 'needs-selection', selected);
    }
    const linkedRef = await planBuildInputs({ ...f.settings, text: '\\input{linked-directory/leaf}', limits: narrow });
    assert.equal(linkedRef.status, 'needs-selection');
    await assert.rejects(readBuildInput(f.root, 'linked-directory/leaf.tex', 1000), /Linked build input/);
    assert.equal((await readBuildInput(f.root, 'ordinary/leaf.tex', 1000)).toString(), 'Leaf');
  } finally { await f.remove(); }
});
test('literal dependency cycles terminate and cancellation interrupts metadata preparation', async () => {
  const f = await fixture(String.raw`\input{part}`);
  try {
    await f.put('part.tex', '\\input{main}'); await f.put('unused.pdf', 'Other');
    const plan = await validateBuildInputSelection({ ...f.settings, selectedPaths: ['main.tex', 'part.tex'] });
    assert.equal(plan.status, 'ready'); if (plan.status === 'ready') assert.equal(plan.files.length, 2);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(planBuildInputs({ ...f.settings, signal: controller.signal }), /Compilation cancelled/);
  } finally { await f.remove(); }
});
for (const replacement of ['symlink', 'regular-directory'] as const) {
  test(`opened directory identity rejects ${replacement} root substitution before planning or reading`, async () => {
    const f = await fixture();
    try {
      const paper = path.join(f.root, 'paper'), other = path.join(f.root, 'other');
      await f.put('paper/main.tex', '\\input{part}'); await f.put('paper/part.tex', 'Original part');
      await f.put('other/main.tex', '\\input{part}'); await f.put('other/part.tex', 'Unopened replacement data');
      const expectedIdentity = await captureBuildDirectory(paper);
      const settings = { rootDir: paper, rootName: 'main.tex', text: '\\input{part}', expectedIdentity };
      assert.equal((await planBuildInputs(settings)).status, 'ready');
      await fs.rename(paper, path.join(f.root, 'original-paper'));
      if (replacement === 'symlink') await fs.symlink(other, paper); else await fs.rename(other, paper);
      await assert.rejects(planBuildInputs(settings), /paper folder changed or is linked/);
      await assert.rejects(readBuildInput(paper, 'part.tex', 1000, expectedIdentity), /paper folder changed or is linked/);
    } finally { await f.remove(); }
  });
}
test('a linked ancestor cannot redirect an unchanged directory inode to a new canonical path', async () => {
  const f = await fixture();
  try {
    await f.put('container/paper/main.tex', 'Source');
    const paper = path.join(f.root, 'container/paper'), expectedIdentity = await captureBuildDirectory(paper);
    await fs.rename(path.join(f.root, 'container'), path.join(f.root, 'moved-container'));
    await fs.symlink(path.join(f.root, 'moved-container'), path.join(f.root, 'container'));
    assert.equal((await fs.stat(paper)).ino, expectedIdentity.ino);
    await assert.rejects(planBuildInputs({ rootDir: paper, rootName: 'main.tex', text: 'Source', expectedIdentity }), /paper folder changed or is linked/);
    await assert.rejects(readBuildInput(paper, 'main.tex', 1000, expectedIdentity), /paper folder changed or is linked/);
  } finally { await f.remove(); }
});
test('directory identity is rechecked after an awaited dependency resolution before returning a plan', async () => {
  const f = await fixture();
  try {
    await f.put('paper/main.tex', 'Source'); await f.put('paper/part.tex', 'Original');
    await f.put('other/main.tex', 'Source'); await f.put('other/part.tex', 'Unopened replacement data');
    const paper = path.join(f.root, 'paper'), expectedIdentity = await captureBuildDirectory(paper);
    await assert.rejects(planBuildInputs({ rootDir: paper, rootName: 'main.tex', text: '\\documentclass{article}\\input{part}', limits: narrow, expectedIdentity,
      standardFileExists: async () => { await fs.rename(paper, path.join(f.root, 'original-paper')); await fs.symlink(path.join(f.root, 'other'), paper); return true; }
    }), /paper folder changed or is linked/);
  } finally { await f.remove(); }
});
