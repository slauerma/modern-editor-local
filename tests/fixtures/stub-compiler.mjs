#!/usr/bin/env node
// Disposable process-control fixture; its minimal PDF header is never a visual test.
import fs from 'node:fs/promises';
import path from 'node:path';
const file = process.argv.at(-1);
if (!file?.endsWith('.tex') || !process.cwd().includes('.test-runs')) throw new Error('Disposable test directory required');
const source = await fs.readFile(file, 'utf8');
if (source.includes('HANG')) {
  await fs.writeFile('compiler-ready.txt', String(process.pid));
  setInterval(() => {}, 1000);
} else {
  const word = Buffer.from('Greek Ελληνικά and Hebrew עברית\n');
  const firstUnicode = word.findIndex(n => n >= 128);
  process.stdout.write(word.subarray(0, firstUnicode + 1));
  await new Promise(resolve => setTimeout(resolve, 25));
  process.stdout.write(word.subarray(firstUnicode + 1));
  await fs.writeFile(path.basename(file, '.tex') + '.pdf', '%PDF-1.7\nTest header only');
}
