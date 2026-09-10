import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commentSchema } from '../src/shared/contracts.ts';

const comment = { id: 'imported', title: 'A saved discussion', explanation: 'Fixture', original: 'Text', replacement: null };
const message = (packages: string[]) => ({ role: 'assistant', text: 'A proposed alternative', createdAt: '2026-09-07T12:00:00Z', proposal: { replacement: 'Changed text', packages } });
test('imported discussion alternatives validate package names before they can enter editor state', () => {
  assert.throws(() => commentSchema.parse({ ...comment, messages: [message(['../invalid-package'])] }));
  assert.throws(() => commentSchema.parse({ ...comment, messages: [message(Array(11).fill('amsmath'))] }));
  assert.equal(commentSchema.parse({ ...comment, messages: [message(['mathtools'])] }).messages[0].proposal?.packages[0], 'mathtools');
});
