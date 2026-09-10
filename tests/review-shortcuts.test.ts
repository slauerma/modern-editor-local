import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewShortcut } from '../src/renderer/review-shortcuts.ts';

test('Shift+A/S accept/skip only outside typing fields, without repeat, composition or other modifiers', () => {
  const event = { key: 'A', shiftKey: true, altKey: false, ctrlKey: false, metaKey: false, repeat: false, isComposing: false };
  const target = (typing: boolean) => ({ closest: () => typing ? {} : null }) as unknown as EventTarget;
  assert.equal(reviewShortcut(event, target(false)), 'accept');
  assert.equal(reviewShortcut({ ...event, key: 'S' }, target(false)), 'skip');
  for (const key of ['A', 'S']) {
    assert.equal(reviewShortcut({ ...event, key }, target(true)), null);
    for (const modifier of ['repeat', 'isComposing', 'ctrlKey', 'metaKey', 'altKey']) assert.equal(reviewShortcut({ ...event, key, [modifier]: true }, target(false)), null);
    assert.equal(reviewShortcut({ ...event, key, shiftKey: false }, target(false)), null);
  }
  assert.equal(reviewShortcut({ ...event, shiftKey: false, altKey: true, key: 'Enter' }, target(false)), 'accept');
  assert.equal(reviewShortcut({ ...event, shiftKey: false, altKey: true, key: 'ArrowLeft' }, target(false)), 'previous');
});
