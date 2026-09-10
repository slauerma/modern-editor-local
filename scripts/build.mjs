import { build as bundle } from 'esbuild';
import { build as viteBuild } from 'vite';
import { mkdir } from 'node:fs/promises';
import { copyBuildAssets } from './copy-build-assets.mjs';
await mkdir('dist', { recursive: true });
await Promise.all([
  bundle({ entryPoints: ['src/main/index.ts'], outfile: 'dist/main.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], sourcemap: true }),
  bundle({ entryPoints: ['src/preload/editor-api.ts'], outfile: 'dist/preload.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'] })
]);
await viteBuild({ root: 'src/renderer', base: './', esbuild: { jsx: 'automatic' }, build: { outDir: '../../dist/renderer', emptyOutDir: true, target: 'chrome140' } });
await copyBuildAssets();
console.log('Built the local desktop application.');
