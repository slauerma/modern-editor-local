import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { findHelpSections, helpSections } from '../src/renderer/help-content.ts';

test('bundled help retains complete installation commands and derives shortcuts from the current guide', async () => {
  const setup = await fs.readFile('docs/SETUP.md', 'utf8'), guide = await fs.readFile('docs/USER_GUIDE.md', 'utf8');
  const sections = [...helpSections(setup, 'setup'), ...helpSections(guide, 'guide')];
  assert.equal(new Set(sections.map(section => section.id)).size, sections.length);
  const install = findHelpSections(sections, 'npm ci');
  assert(install.some(section => section.body.includes('npm ci --ignore-scripts') && section.body.includes('node node_modules/electron/install.js')));
  const shortcuts = sections.filter(section => section.document === 'guide' && /keyboard shortcuts/i.test(section.title));
  assert.equal(shortcuts.length, 1);
  assert.match(shortcuts[0].body, /Shift\+A/); assert.match(shortcuts[0].body, /Command\+S/);
  assert(findHelpSections(sections, 'REVIEW mathematical').some(section => section.document === 'guide'));
});

test('headings inside a code block remain literal instructions within their owning help section', () => {
  const markdown = '# Help\n\n## Install\n\n~~~sh\n# Preserve this shell comment\n## This is not a new help topic\nprintf \'<script>literal</script>\\n\'\n~~~\n\n## Recovery\n\nKeep the original source.\n';
  const sections = helpSections(markdown, 'setup');
  assert.deepEqual(sections.map(section => section.title), ['Install', 'Recovery']);
  assert.match(sections[0].body, /## This is not a new help topic/);
  assert.match(sections[0].body, /<script>literal<\/script>/);
  assert.deepEqual(findHelpSections(sections, 'keep source').map(section => section.title), ['Recovery']);
});

test('the current release is identifiable in the package and searchable changelog', async () => {
  const info = JSON.parse(await fs.readFile('package.json', 'utf8'));
  const lock = JSON.parse(await fs.readFile('package-lock.json', 'utf8'));
  const sections = helpSections(await fs.readFile('CHANGELOG.md', 'utf8'), 'changelog');
  assert.equal(info.version, '0.2.0');
  assert.equal(lock.version, info.version); assert.equal(lock.packages[''].version, info.version);
  assert.match(sections[0].title, new RegExp(`^${info.version.replaceAll('.', '\\.')} `));
  for (const query of ['continuous PDF', 'search read on demand', 'large folders', 'Command+T', 'dismiss pending', 'relink question', 'setup details']) {
    assert(findHelpSections(sections, query).some(section => section.id === sections[0].id), `Current release is missing searchable topic: ${query}`);
  }
});
