import type { TextEncoding, TextImportChoice } from '../shared/text-import.ts';

export const textImportLimit = 2_000_000;
const leBom = Buffer.from([0xff, 0xfe]), beBom = Buffer.from([0xfe, 0xff]);
const singleByteMaps = new Map<TextEncoding, Map<string, number>>();
function singleByteMap(encoding: TextEncoding) {
  let map = singleByteMaps.get(encoding);
  if (!map) {
    map = new Map();
    const decoder = new TextDecoder(encoding, { fatal: true });
    for (let i = 0; i < 256; i++) {
      try { map.set(decoder.decode(Uint8Array.of(i)), i); } catch { /* Undefined bytes are not candidates. */ }
    }
    singleByteMaps.set(encoding, map);
  }
  return map;
}

/** Decode without replacement, then prove that no input byte was lost. This
 * establishes reversibility, not which legacy encoding the author intended. */
export function decodeText(bytes: Buffer, encoding: TextEncoding): string {
  const utf16 = encoding === 'utf-16le' || encoding === 'utf-16be';
  const bom = utf16 && bytes.subarray(0, 2).equals(encoding === 'utf-16le' ? leBom : beBom);
  const input = bom ? bytes.subarray(2) : bytes;
  // WHATWG's "iso-8859-1" decoder is Windows-1252. Use actual Latin-1 here.
  const text = encoding === 'iso-8859-1' ? input.toString('latin1') : new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(input);
  if (/[\u0000-\u0008\u000b\u000e-\u001f\u007f-\u009f\ufffe\uffff]/u.test(text)) throw new Error('The decoded file contains non-text control characters.');
  let restored: Buffer;
  if (utf16) {
    restored = Buffer.from(text, 'utf16le');
    if (encoding === 'utf-16be') restored.swap16();
    if (bom) restored = Buffer.concat([encoding === 'utf-16le' ? leBom : beBom, restored]);
  } else if (encoding === 'iso-8859-1') restored = Buffer.from(text, 'latin1');
  else {
    const map = singleByteMap(encoding), values: number[] = [];
    for (const char of text) {
      const byte = map.get(char);
      if (byte === undefined) throw new Error('This conversion cannot preserve every character.');
      values.push(byte);
    }
    restored = Buffer.from(values);
  }
  if (!restored.equals(bytes)) throw new Error('This conversion cannot preserve every input byte.');
  if (Buffer.byteLength(text, 'utf8') > textImportLimit) throw new Error('The UTF-8 copy exceeds the 2 MB document limit.');
  return text;
}

function latexLimitation(text: string): string | undefined {
  const source = text.replace(/(?<!\\)%[^\r\n]*/g, '');
  const declarations = [...source.matchAll(/\\(?:usepackage\s*\[([^\]]+)\]\s*\{inputen[cx]\}|inputencoding\s*\{([^}]+)\}|XeTeXinputencoding\s*["{]([^"}]+)["}])/g)];
  if (declarations.some(m => !['utf8', 'utf8x', 'utf-8'].includes((m[1] ?? m[2] ?? m[3]).trim().toLowerCase()))) {
    return 'This LaTeX file declares a legacy input encoding. Converting it requires checking that declaration and any included files together. ME does not change the preamble automatically.';
  }
}

export function inspectTextEncoding(bytes: Buffer, latex = false): { identified: boolean; choices: TextImportChoice[] } | null {
  if (bytes.length > textImportLimit) throw new Error('Choose a document smaller than 2 MB.');
  const head = bytes.subarray(0, 32);
  if (head.subarray(0, 4).equals(Buffer.from([0xff, 0xfe, 0, 0])) || head.subarray(0, 4).equals(Buffer.from([0, 0, 0xfe, 0xff]))) throw new Error('UTF-32 import is not supported. Export a UTF-8 text copy first. The original was not changed.');
  if (/^(?:%PDF-|\{\\rtf)/i.test(head.toString('ascii')) || ['504b0304', '504b0506', '504b0708'].includes(head.subarray(0, 4).toString('hex')) || head.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex'))) {
    throw new Error('This is a formatted or binary document. Export a plain-text copy first. Word and RTF import are not supported.');
  }
  const identified = head.subarray(0, 2).equals(leBom) ? 'utf-16le' : head.subarray(0, 2).equals(beBom) ? 'utf-16be' : null;
  if (head.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) {
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw new Error('This file is marked UTF-8 but contains invalid UTF-8 bytes. ME cannot convert it safely. The original was not changed.'); }
  }
  if (!identified) {
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (!text.includes('\0')) return null;
    } catch { /* A preview is required; do not replace invalid UTF-8 bytes. */ }
  }
  // A BOM is authoritative. Never reinterpret broken UTF-16 as a single-byte file.
  const encodings: TextEncoding[] = identified ? [identified] : bytes.includes(0) ? ['utf-16le', 'utf-16be'] : ['windows-1252', 'iso-8859-1', 'macintosh'];
  const choices: TextImportChoice[] = [];
  let failure: unknown;
  for (const encoding of encodings) {
    try {
      const text = decodeText(bytes, encoding);
      choices.push({ encoding, text, ...(latex ? { limitation: latexLimitation(text) } : {}) });
    } catch (e) { failure = e; }
  }
  if (!choices.length) throw new Error(`This file could not be converted safely${identified ? ' from ' + identified.toUpperCase() : ' using the supported text encodings'}. ${failure instanceof Error ? failure.message : ''} The original was not changed.`);
  return { identified: !!identified, choices };
}
