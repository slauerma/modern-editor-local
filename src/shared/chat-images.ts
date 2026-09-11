// Bound raster dimensions before either Chromium or Electron decodes pixels.
// Main still decodes/re-encodes the image, rejecting malformed image contents.
export function chatImageDimensions(bytes: Uint8Array, mime: string) {
  const fail = () => { throw new Error('Choose a valid PNG or JPEG screenshot no larger than 4096 × 4096 pixels.'); };
  const u16 = (n: number) => (bytes[n] << 8) | bytes[n + 1];
  const check = (width: number, height: number) => {
    if (!(width > 0 && height > 0 && width <= 4096 && height <= 4096)) return fail();
    return { width, height };
  };
  if (mime === 'image/png') {
    if (bytes.length < 33 || ![137,80,78,71,13,10,26,10].every((v, i) => bytes[i] === v)
      || new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8) !== 13
      || ![73,72,68,82].every((v, i) => bytes[12 + i] === v)) return fail();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return check(view.getUint32(16), view.getUint32(20));
  }
  if (mime !== 'image/jpeg' || bytes[0] !== 255 || bytes[1] !== 216) return fail();
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset++] !== 255) return fail();
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === 217 || marker === 218 || offset + 2 > bytes.length) return fail();
    if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
    const length = u16(offset);
    if (length < 2 || offset + length > bytes.length) return fail();
    if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) {
      if (length < 8) return fail();
      return check(u16(offset + 5), u16(offset + 3));
    }
    offset += length;
  }
  return fail();
}
