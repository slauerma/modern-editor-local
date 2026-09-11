import { nativeImage } from 'electron';
import { CHAT_LIMITS, chatImageSchema, type ChatImage } from '../shared/help-chat.ts';
import { chatImageDimensions } from '../shared/chat-images.ts';

export function normalizeChatImage(raw: ChatImage): ChatImage {
  const checked = chatImageSchema.parse(raw), encoded = checked.dataUrl.split(',')[1], bytes = Buffer.from(encoded, 'base64');
  if (bytes.length > CHAT_LIMITS.imageBytes || bytes.toString('base64') !== encoded) throw new Error('Invalid or oversized screenshot.');
  chatImageDimensions(bytes, checked.dataUrl.slice(5, checked.dataUrl.indexOf(';')));
  const image = nativeImage.createFromBuffer(bytes), size = image.getSize();
  if (image.isEmpty() || size.width < 1 || size.height < 1 || size.width > 4096 || size.height > 4096) throw new Error('Choose a PNG or JPEG screenshot no larger than 4096 × 4096 pixels.');
  // Re-encoding decoded pixels drops EXIF, comments and other input metadata.
  const clean = image.toPNG();
  if (clean.length > CHAT_LIMITS.imageBytes) throw new Error('Screenshot exceeds 2 MB after decoding. Crop or resize it before attaching.');
  return chatImageSchema.parse({ ...checked, name: checked.name.replace(/[\\/\u0000-\u001f\u007f]/g, '_'), dataUrl: 'data:image/png;base64,' + clean.toString('base64') });
}
