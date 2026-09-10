import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ProjectService } from '../src/main/project-service.ts';
import { commentSchema } from '../src/shared/contracts.ts';
import { digest } from '../src/main/files.ts';

async function fixture() {
  await fs.mkdir('.test-runs', { recursive: true });
  const root = await fs.mkdtemp(path.resolve('.test-runs/recovery-retention-'));
  const file = path.join(root, 'main.tex'), text = 'A synthetic manuscript.';
  await fs.writeFile(file, text);
  const service = new ProjectService(path.join(root, 'cache')), project = await service.open(file);
  const review = { ...project.review, comments: [commentSchema.parse({ id: 'c1', title: 'Wording', explanation: 'Synthetic comment.', original: text, replacement: 'A concise manuscript.' })] };
  const recovery = path.join(await service.stateDirectory(project.id), 'recovery');
  return { root, file, text, service, project, review, recovery };
}
test('repeated unchanged Saves retain one recovery archive despite revision and review timestamp changes', async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 25; i++) await f.service.save({ projectId: f.project.id, text: f.text, review: { ...f.review, updatedAt: `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z` } });
    const archives = (await fs.readdir(f.recovery)).filter(n => n.startsWith('conflict-'));
    assert.equal(archives.length, 1);
    const archived = JSON.parse(await fs.readFile(path.join(f.recovery, archives[0]), 'utf8'));
    assert.equal(archived.text, f.text);
    assert.equal(archived.review.comments[0].replacement, 'A concise manuscript.');
    assert.equal((await f.service.open(f.file)).text, f.text);
  } finally { await fs.rm(f.root, { recursive: true, force: true }); }
});
test('recovery deduplication preserves changes to proposals, notes, decisions, messages, source and disk baseline', async () => {
  const f = await fixture();
  try {
    const changes = [{ replyDraft: 'Keep this author note.' }, { replacement: 'A changed proposal.' },
      { draft: 'An edited proposal.' }, { messages: [{ role: 'user' as const, text: 'A discussion question.', createdAt: '2026-01-01' }] },
      { decision: 'dismissed' as const }, { packages: ['amsmath'] }];
    for (const change of changes) {
      const review = { ...f.review, comments: [{ ...f.review.comments[0], ...change }] };
      await f.service.persist({ projectId: f.project.id, text: f.text, review });
      await f.service.save({ projectId: f.project.id, text: f.text, review });
    }
    const text = f.text + ' Another sentence.';
    await f.service.persist({ projectId: f.project.id, text, review: f.review });
    await f.service.save({ projectId: f.project.id, text, review: f.review });
    await f.service.save({ projectId: f.project.id, text, review: f.review });
    const records = await Promise.all((await fs.readdir(f.recovery)).filter(n => n.startsWith('conflict-')).map(async n => JSON.parse(await fs.readFile(path.join(f.recovery, n), 'utf8'))));
    for (const change of changes) for (const [key, value] of Object.entries(change)) assert(records.some(r => JSON.stringify(r.review.comments[0][key]) === JSON.stringify(value)), `Recover ${key}`);
    assert(records.some(r => r.text === text && r.baseDiskHash === digest(f.text)));
    assert(records.some(r => r.text === text && r.baseDiskHash === digest(text)));
  } finally { await fs.rm(f.root, { recursive: true, force: true }); }
});
