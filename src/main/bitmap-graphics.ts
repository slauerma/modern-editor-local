// macOS SWP compatibility belongs to the disposable build, never the paper.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { digest, readRegularFile } from './files.ts';
import { sourceForScan, group, afterOptions, literal } from './tex-input-syntax.ts';

export type BitmapGraphic = { source: string; from: number; to: number; input: string };
type PreparedFile = { relative: string; hash: string };
const execute = promisify(execFile);
const blank = (text: string) => text.replace(/[^\r\n]/g, '');

/** Only ordinary BMPs within a bounded decoded size reach the system decoder. */
export function bitmapDimensions(bytes: Buffer) {
  if (bytes.length < 26 || bytes.toString('ascii', 0, 2) !== 'BM') throw new Error('The image is not a readable BMP.');
  const header = bytes.readUInt32LE(14);
  if (header !== 12 && (header < 40 || bytes.length < 54)) throw new Error('This BMP header is unsupported.');
  const width = header === 12 ? bytes.readUInt16LE(18) : bytes.readInt32LE(18);
  const height = header === 12 ? bytes.readUInt16LE(20) : Math.abs(bytes.readInt32LE(22));
  if (width <= 0 || height <= 0 || width * height > 20_000_000) throw new Error('BMP images must contain at most 20 million pixels.');
  return { width, height };
}

export function preparedBitmapCommand(command: string, converted: string) {
  const scan = sourceForScan(command), name = scan.match(/^\\includegraphics\b/);
  if (!name) throw new Error('The BMP reference changed during preparation.');
  const arg = group(scan, afterOptions(scan, name[0].length));
  if (!arg || arg.end !== command.length || !/\.bmp$/i.test(literal(arg.value))) throw new Error('The BMP reference changed during preparation.');
  const from = arg.end - arg.value.length - 1;
  const old = literal(arg.value), replacement = old.replace(/[^/]+$/, path.posix.basename(converted));
  const quoted = arg.value.trim().startsWith('"') ? '"' + replacement + '"' : replacement;
  const tokenStart = from + arg.value.search(/\S/), tokenEnd = from + arg.value.trimEnd().length;
  let result = command.slice(0, tokenStart) + quoted + command.slice(tokenEnd);
  // SWP supplies obsolete natural dimensions. PNG contains its own dimensions;
  // keep explicit display width/height and every source line for SyncTeX.
  const options = group(scan, name[0].length + (scan[name[0].length] === '*' ? 1 : 0), '[', ']');
  if (options) {
    const start = options.end - options.value.length - 1;
    let cleaned = command.slice(start, options.end - 1);
    const fields = [...options.value.matchAll(/(?:^|(?<=,))\s*(?:natwidth|natheight)\s*=\s*[^,]*,?/g)];
    for (const field of fields.reverse()) cleaned = cleaned.slice(0, field.index) + blank(cleaned.slice(field.index, field.index + field[0].length)) + cleaned.slice(field.index + field[0].length);
    // Blank physical lines become TeX paragraph tokens; comment only those
    // empty lines, retaining the exact line count and the closing bracket.
    cleaned = cleaned.replace(/(?<=\n)[ \t]*(?=\r?\n)/g, '%');
    result = result.slice(0, start) + cleaned + result.slice(options.end - 1);
  }
  if (result.split('\n').length !== command.split('\n').length) throw new Error('BMP preparation would change source line positions.');
  return result;
}

export async function prepareBitmapGraphics(directory: string, references: BitmapGraphic[], signal: AbortSignal, remainingBytes: number): Promise<PreparedFile[]> {
  if (!references.length) return [];
  if (process.platform !== 'darwin') throw new Error('Automatic BMP preparation is available on macOS. Use PNG or PDF figures on this system.');
  const prepared: PreparedFile[] = [], converted = new Map<string, string>();
  for (const reference of references) {
    if (signal.aborted) throw new Error('Compilation cancelled.');
    if (converted.has(reference.input)) continue;
    const input = path.join(directory, reference.input);
    const bytes = await readRegularFile(input, 80_000_000), dimensions = bitmapDimensions(bytes);
    const relative = path.posix.join(path.posix.dirname(reference.input), `me-bmp-${digest(reference.input).slice(0, 20)}.png`);
    const output = path.join(directory, relative);
    // Reserve the generated name exclusively; never replace a supplied figure.
    await fs.writeFile(output, '', { flag: 'wx', mode: 0o600 });
    try {
      await execute('/usr/bin/sips', ['-s', 'format', 'png', input, '--out', output], {
        signal, timeout: 15_000, maxBuffer: 32_000, env: { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' }
      });
      const png = await readRegularFile(output, Math.min(remainingBytes, 80_000_000));
      if (png.length < 24 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || png.readUInt32BE(16) !== dimensions.width || png.readUInt32BE(20) !== dimensions.height) throw new Error('Converted image has unexpected dimensions or format.');
      remainingBytes -= png.length;
      prepared.push({ relative, hash: digest(png) }); converted.set(reference.input, relative);
    } catch (error) {
      if (signal.aborted) throw new Error('Compilation cancelled.');
      throw new Error(`Could not prepare BMP image ${reference.input}. Export it as PNG or PDF and update its reference.`, { cause: error });
    }
  }
  for (const source of new Set(references.map(reference => reference.source))) {
    const file = path.join(directory, source), original = await readRegularFile(file, 8_000_000);
    let text = new TextDecoder('utf-8', { fatal: true }).decode(original);
    for (const reference of references.filter(item => item.source === source).sort((a, b) => b.from - a.from)) {
      text = text.slice(0, reference.from) + preparedBitmapCommand(text.slice(reference.from, reference.to), converted.get(reference.input)!) + text.slice(reference.to);
    }
    const bytes = Buffer.from(text);
    remainingBytes -= Math.max(0, bytes.length - original.length);
    if (remainingBytes < 0) throw new Error('Prepared graphics exceed the build size limit.');
    await fs.writeFile(file, bytes, { mode: 0o600 }); prepared.push({ relative: source, hash: digest(bytes) });
  }
  return prepared;
}
