import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { changedReview } from '../src/shared/changed-review.ts';
import { reviewContext } from '../src/shared/codex-context.ts';
import { reviewPresets } from '../src/shared/review-presets.ts';
import { ReviewPublisher, publishCommentsTool } from '../src/main/review-publisher.ts';
import { ProjectService } from '../src/main/project-service.ts';
import { CodexService, reviewOutputSchema } from '../src/main/codex-service.ts';
import { digest } from '../src/main/files.ts';

const comment = (original: string, replacement: string | null) => ({ title: 'Agreement', category: 'Language', explanation: 'Use singular agreement.', original, replacement, before: '', after: '', packages: [] });

test('changed review preserves deletions, insertions, Unicode offsets and nearby context without loading the whole paper into the prompt', () => {
  const middle = 'Unchanged paragraph.\n\n'.repeat(100);
  const before = '🌍 This text is deleted.\n\n' + middle + 'The result is useful.';
  const current = '🌍 ' + middle + 'The result are useful. Added conclusion.';
  const changes = changedReview(before, current, 'Before review');
  assert.match(changes.document.text, /This text is deleted/); assert.match(changes.document.text, /Deletion: check/);
  assert.match(changes.document.text, /Added conclusion/); assert(changes.ranges.length >= 2);
  assert(changes.ranges.every(r => r.from >= 0 && r.to <= current.length));
  const request = { projectId: 'p', text: current, from: 0, to: current.length, instructions: 'Language only.', changesSince: digest(before) };
  const prompt = JSON.stringify(reviewContext(request));
  assert(prompt.includes('review-changes')); assert(!prompt.includes('Unchanged paragraph')); assert(!prompt.includes('This text is deleted'));
});

test('identical drafts and oversized comparisons stop explicitly before a request', () => {
  assert.throws(() => changedReview('Same', 'Same', 'Before'), /No changes/);
  assert.throws(() => changedReview('x'.repeat(130000), '', 'Before'), /120,000/);
  const deleted = changedReview('Remove this entire paragraph.', '', 'Before');
  assert.equal(deleted.ranges[0].to, 0); assert(deleted.document.text.includes('Remove this entire paragraph'));
});

test('nearby deletion and wording edits retain readable historical wording', () => {
  const before = 'The proof is short.\n\nAn obsolete transition.\n\nUnchanged background.';
  const current = 'The proof are short.\n\nUnchanged background.';
  const result = changedReview(before, current, 'Before edits');
  assert.match(result.document.text, /An obsolete transition/);
  assert.match(result.document.text, /are short/);
  assert.equal(result.count, 1);
});

test('focused publisher allows a single early edit, blocks an unrelated replacement and retains wider questions', async () => {
  const text = 'The proof are short.\n' + 'Unchanged content. '.repeat(100) + '\nThe result are useful.';
  const ranges = [{ from: 0, to: 100 }], saved: unknown[] = [];
  const publisher = new ReviewPublisher(text, 0, text.length, async c => { saved.push(c); }, () => true, undefined, ranges);
  const reader = publisher.reader(reviewOutputSchema);
  assert.deepEqual(await reader.call(publishCommentsTool, { comments: [comment('proof are', 'proof is')] }), { published: 1, total: 1 });
  await assert.rejects(reader.call(publishCommentsTool, { comments: [comment('result are', 'result is')] }), /outside the confirmed/);
  assert.equal(saved.length, 1);
  await reader.call(publishCommentsTool, { comments: [comment('result are', null)] });
  const result = await publisher.finish({ comments: [] }); assert.equal(result.length, 2); assert.equal(result[1].replacement, null);
});

test('service verifies the selected version and exposes a frozen changes document alongside unsaved current-draft', async t => {
  const root = path.resolve('.test-runs', 'changed-review-' + randomUUID()); await fs.mkdir(root, { recursive: true });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'paper.txt'), before = 'The proof is short. Historical qualification.';
  await fs.writeFile(file, before);
  const projects = new ProjectService(path.join(root, 'runtime')), p = await projects.open(file), service = new CodexService(projects, path.join(root, 'codex'));
  const current = 'The proof are short.', baseline = await projects.pinBaseline(p.id, 'Before edits', before);
  let calls = 0;
  service.client.run = async (prompt, _schema, _progress, _effort, _fast, reader) => {
    calls++; assert(reader); assert(!prompt.includes('Historical qualification')); assert(!prompt.includes(current));
    const data: any = await reader.call('references_read', { fileId: 'review-changes' });
    assert.match(JSON.stringify(data), /Historical qualification/);
    const draft: any = await reader.call('references_read', { fileId: 'current-draft' }); assert(JSON.stringify(draft).includes(current));
    await reader.call(publishCommentsTool, { comments: [comment('proof are', 'proof is')] });
    return { comments: [] };
  };
  const request = { projectId: p.id, text: current, from: 0, to: current.length, instructions: reviewPresets.find(p => p.id === 'language')!.instructions, changesSince: baseline.sourceHash };
  const result = await service.review(request, () => {});
  assert.equal(result.length, 1); assert.equal(result[0].validity, 'current'); assert.equal(calls, 1);
  assert.equal(await fs.readFile(file, 'utf8'), before);
  await projects.pinBaseline(p.id, 'Another', 'Another version.');
  await assert.rejects(service.review(request, () => {}), /comparison version changed/); assert.equal(calls, 1);
});

test('purpose templates distinguish meaning questions and teaching brevity without imposing an edit quota', () => {
  assert.match(reviewPresets.find(p => p.id === 'language')!.instructions, /Meaning question with no replacement/);
  assert.match(reviewPresets.find(p => p.id === 'slides')!.instructions, /fragments, overlays, speaker notes/);
  assert.match(reviewPresets.find(p => p.id === 'technical')!.instructions, /provisional, not independent evidence/);
  const prompt = reviewContext({ projectId: 'p', text: 'Draft', from: 0, to: 5, instructions: '' }).task;
  assert.match(prompt, /first useful comment/); assert.match(prompt, /no comment quota/);
});
