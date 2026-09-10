// Original, deterministic test artwork. No external image or document is read.
// Generate only the two ignored graphics needed by the compile integration tests.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

function allocationPdf() {
  const drawing = '0.9 G 0.5 w 32 28 m 288 28 l 288 172 l S\n' +
    '0 G 1 w 32 172 m 32 28 l 288 28 l S\n' +
    '0.15 0.35 0.65 RG 2 w 32 28 m 288 172 l S\n';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 320 200] /Resources << >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(drawing)} >>\nstream\n${drawing}endstream`
  ];
  let pdf = '%PDF-1.4\n', offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'ascii');
}

function allocationJpeg() {
  // Baseline grayscale JPEG, 64 x 64 pixels, with constant 8 x 8 blocks.
  // Each block has only a DC coefficient: DCT(DC) = 8 * (pixel - 128).
  // Quantization by 16 gives (pixel - 128) / 2; every chosen pixel is even.
  // Custom canonical Huffman tables encode DC categories 0..7 in four bits
  // and AC end-of-block in one bit. The artwork is a coarse rising diagonal.
  const segment = (marker, payload) => {
    const data = Buffer.from(payload), header = Buffer.alloc(4);
    header[0] = 0xff; header[1] = marker; header.writeUInt16BE(data.length + 2, 2);
    return Buffer.concat([header, data]);
  };
  const dcCounts = Array(16).fill(0); dcCounts[3] = 8;
  const acCounts = Array(16).fill(0); acCounts[0] = 1;
  let pending = 0, bitCount = 0, previousDc = 0;
  const scan = [];
  const bits = (value, count) => {
    for (let i = count - 1; i >= 0; i--) {
      pending = (pending << 1) | ((value >> i) & 1); bitCount++;
      if (bitCount === 8) {
        scan.push(pending); if (pending === 0xff) scan.push(0);
        pending = 0; bitCount = 0;
      }
    }
  };
  for (let row = 0; row < 8; row++) {
    for (let column = 0; column < 8; column++) {
      const pixel = column === 0 || row === 7 ? 64 : row === 7 - column ? 32 : 240;
      const dc = (pixel - 128) / 2, difference = dc - previousDc;
      previousDc = dc;
      const category = difference === 0 ? 0 : Math.floor(Math.log2(Math.abs(difference))) + 1;
      bits(category, 4);
      if (category) bits(difference < 0 ? difference + (1 << category) - 1 : difference, category);
      bits(0, 1);
    }
  }
  if (bitCount) bits((1 << (8 - bitCount)) - 1, 8 - bitCount);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segment(0xdb, [0, ...Array(64).fill(16)]),
    segment(0xc0, [8, 0, 64, 0, 64, 1, 1, 0x11, 0]),
    segment(0xc4, [0, ...dcCounts, 0, 1, 2, 3, 4, 5, 6, 7]),
    segment(0xc4, [0x10, ...acCounts, 0]),
    segment(0xda, [1, 1, 0, 0, 63, 0]),
    Buffer.from(scan), Buffer.from([0xff, 0xd9])
  ]);
}

for (const [relative, data] of [
  ['fixtures/audit-paper/figures/allocation.pdf', allocationPdf()],
  ['fixtures/texpile/allocation.jpg', allocationJpeg()]
]) {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, data);
  console.log(`Generated ${relative} (${data.length} bytes).`);
}
