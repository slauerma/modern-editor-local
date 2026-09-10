// Collect the installed dependency notices without redistributing dependency code.
import { createHash } from 'node:crypto';
import { readFile, readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = path => readFile(resolve(root, path), 'utf8');
const sha = text => createHash('sha256').update(text).digest('hex');
const lock = JSON.parse(await read('package-lock.json'));
const packages = [], notices = new Map();
const auxiliary = ['cmaps', 'standard_fonts', 'wasm', 'iccs'];
const isNotice = name => /^(licen[cs]e|copying|notice|third.?party)/i.test(name);

async function collect(path) {
  const text = await read(path);
  notices.set(path, { text, sha256: sha(text) });
  return path;
}

for (const [path, entry] of Object.entries(lock.packages).sort(([a], [b]) => a.localeCompare(b))) {
  if (!path) continue;
  let metadata;
  try { metadata = JSON.parse(await read(`${path}/package.json`)); }
  catch (error) { if (error.code !== 'ENOENT' || !entry.optional) throw error; }
  if (metadata && metadata.version !== entry.version) throw new Error(`Version mismatch: ${path}`);
  const files = [];
  if (metadata) {
    for (const directory of [path, ...(metadata.name === 'pdfjs-dist' ? auxiliary.map(name => `${path}/${name}`) : [])]) {
      for (const name of (await readdir(resolve(root, directory))).sort()) {
        const file = `${directory}/${name}`;
        if (isNotice(name) && (await stat(resolve(root, file))).isFile()) files.push(await collect(file));
      }
    }
  }
  packages.push({
    name: metadata?.name ?? path.replace(/^.*node_modules\//, ''),
    version: entry.version, license: entry.license ?? metadata?.license ?? 'Unspecified',
    development: !!entry.dev, optional: !!entry.optional, installed: !!metadata,
    noticeFiles: files,
  });
}

let text = 'THIRD-PARTY LICENSE TEXTS\n\n';
text += 'Collected from the installed versions recorded in licenses/dependencies.json.\n';
text += 'Includes build tools and optional PDF.js asset notices for reference.\n';
text += 'Inclusion here does not mean all listed components are shipped in the application.\n';
text += 'Electron Chromium notices remain in its installed runtime and are copied into dist/licenses by the build.\n';
text += 'See THIRD_PARTY_NOTICES.md for scope, predecessor credit, and source-package limits.\n';
for (const [path, notice] of [...notices].sort(([a], [b]) => a.localeCompare(b))) {
  text += `\n${'='.repeat(72)}\n${path}\nSHA-256: ${notice.sha256}\n${'='.repeat(72)}\n\n${notice.text}`;
  if (!text.endsWith('\n')) text += '\n';
}
const inventory = { lockfileSha256: sha(await read('package-lock.json')), packages, notices: [...notices].map(([path, notice]) => ({ path, sha256: notice.sha256 })) };
await mkdir(resolve(root, 'licenses'), { recursive: true });
await writeFile(resolve(root, 'licenses/dependencies.json'), JSON.stringify(inventory, null, 2) + '\n');
await writeFile(resolve(root, 'THIRD_PARTY_LICENSES.txt'), text);
console.log(`Recorded ${packages.length} locked packages and ${notices.size} installed license/notice files.`);
for (const pkg of packages.filter(pkg => pkg.installed && !pkg.noticeFiles.length)) {
  console.log(`No separate notice shipped in npm package: ${pkg.name}@${pkg.version} (${pkg.license}); see THIRD_PARTY_NOTICES.md.`);
}
