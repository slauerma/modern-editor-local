/** Tiny uncompressed 24-bit BMP, generated from scratch for compiler tests. */
export function sampleBitmap() {
  const width = 8, height = 4, row = 24, size = 54 + row * height;
  const bytes = Buffer.alloc(size);
  bytes.write('BM'); bytes.writeUInt32LE(size, 2); bytes.writeUInt32LE(54, 10);
  bytes.writeUInt32LE(40, 14); bytes.writeInt32LE(width, 18); bytes.writeInt32LE(height, 22);
  bytes.writeUInt16LE(1, 26); bytes.writeUInt16LE(24, 28); bytes.writeUInt32LE(row * height, 34);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = 54 + y * row + x * 3;
    bytes[offset] = x < 4 ? 210 : 70; bytes[offset + 1] = y < 2 ? 160 : 80; bytes[offset + 2] = x < 4 ? 40 : 230;
  }
  return bytes;
}
