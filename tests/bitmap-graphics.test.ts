import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bitmapDimensions, preparedBitmapCommand } from '../src/main/bitmap-graphics.ts';
import { sampleBitmap } from './fixtures/sample-bitmap.ts';

test('BMP preparation retains display dimensions, comments outside options and exact line positions', () => {
  const command = '\\includegraphics[\r\nnatheight=5.180200in,% SWP dimensions\r\nnatwidth=12.602100in,\r\nheight=1.3578in,\r\nwidth=3.2863in\r\n]%\r\n{TMR4SA02.bmp}';
  const result = preparedBitmapCommand(command, 'me-bmp-example.png');
  assert.match(result, /height=1.3578in/); assert.match(result, /width=3.2863in/);
  assert.doesNotMatch(result, /natheight|natwidth/);
  assert.match(result, /\]%\r\n\{me-bmp-example.png\}$/);
  assert.equal(result.split('\r\n').length, command.split('\r\n').length);
  const spaced = '\\includegraphics*{ \n"figures/example.bmp"\n}';
  assert.equal(preparedBitmapCommand(spaced, 'figures/me-bmp-example.png'), '\\includegraphics*{ \n"figures/me-bmp-example.png"\n}');
  assert.equal(preparedBitmapCommand('\\includegraphics[width=2cm]{image.bmp}', 'prepared.png'), '\\includegraphics[width=2cm]{prepared.png}');
  assert.throws(() => preparedBitmapCommand('\\includegraphics{image.png}', 'prepared.png'), /changed/);
});

test('BMP decoding has a size bound and rejects non-BMP data before conversion', () => {
  assert.deepEqual(bitmapDimensions(sampleBitmap()), { width: 8, height: 4 });
  assert.throws(() => bitmapDimensions(Buffer.from('not a BMP')), /not a readable BMP/);
  const huge = sampleBitmap(); huge.writeInt32LE(100_000, 18);
  huge.writeInt32LE(100_000, 22);
  assert.throws(() => bitmapDimensions(huge), /20 million/);
});
