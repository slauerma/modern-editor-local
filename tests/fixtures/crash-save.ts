import path from 'node:path';
import { ProjectService } from '../../src/main/project-service.ts';
import { atomicWrite } from '../../src/main/files.ts';

const [root, stage] = process.argv.slice(2);
if (!root || !path.basename(root).startsWith('abrupt-') || path.basename(path.dirname(root)) !== '.test-runs' || !['journal', 'source'].includes(stage)) throw new Error('This fixture only runs in an owned abrupt-save test directory.');
const file = path.join(root, 'paper.tex');
const service = new ProjectService(path.join(root, 'cache'), async (target, bytes, guard) => {
  await atomicWrite(target, bytes, guard);
  if (stage === 'journal' ? target.endsWith('/recovery/save.json') : target === file) process.kill(process.pid, 'SIGKILL');
});
const p = await service.open(file);
await service.save({ projectId: p.id, text: 'Abrupt-exit draft α\n', review: { ...p.review, activeId: 'crash-review-position' } });
throw new Error('The expected abrupt exit was not reached.');
