import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChangesPdfService } from '../src/main/changes-pdf.ts';
import { changesUpdateDue } from '../src/shared/changes-agent.ts';
import type { ChangesInput } from '../src/shared/changes-pdf.ts';
const before = '\\documentclass{article}\n\\begin{document}\nA sentence have a mistake.\n\\end{document}';
const input: ChangesInput = { projectId: 'paper', before, after: before.replace('have', 'has'), name: 'Session start', engine: 'pdflatex' };
function fixture() {
  const calls = { plan: 0, compile: 0, visual: 0 };
  const projects = { get() { return {}; }, changeJournal: { explain(_: string, __: string, p: unknown) { return p; } } };
  const compiler = { async compile() { calls.compile++; return { id: 'build', success: true, dependenciesVerified: true }; }, async inspect() { return { status: 'valid' }; }, async locatePdf() { return { kind: 'mapped', page: 2 }; } };
  const codex = { async planChanges(_: string, prompt: string) { calls.plan++; const changes = JSON.parse(prompt).changes; return { groups: changes.map((c: any) => ({ ids: [c.id], layout: 'keep', summary: 'Correct grammar.' })), inspect: [changes[0].id] }; }, async checkChanges(_: string, prompt: string, images: string[]) { calls.visual++; assert.deepEqual(JSON.parse(prompt).pages, [2]); assert.equal(images.length, 1); return { readable: true, issues: [] }; } };
  return { service: new ChangesPdfService(projects as any, compiler as any, codex as any), calls, codex, compiler };
}
test('Changes PDF is driven by accepted and saved events, not source keystrokes', () => {
  assert.equal(changesUpdateDue({ accepted: 2, saved: 1 }, { accepted: 6, saved: 1 }, 5), false);
  assert.equal(changesUpdateDue({ accepted: 2, saved: 1 }, { accepted: 7, saved: 1 }, 5), true);
  assert.equal(changesUpdateDue({ accepted: 2, saved: 1 }, { accepted: 2, saved: 2 }, 5), true);
  assert.equal(changesUpdateDue({ accepted: 2, saved: 1 }, { accepted: 4, saved: 1 }, 3), false);
});
test('Sol requests specific actual comparison pages and a visual check is consumed once', async () => {
  const { service, calls } = fixture();
  const plan = await service.smartPlan(input, () => {});
  const artifact = await service.build({ ...input, arrangementId: plan.id });
  assert.deepEqual(artifact.visual, { pages: [2], status: 'requested', issues: [] });
  await assert.rejects(service.checkVisual('other', artifact.id, [{ page: 2, dataUrl: 'image' }], () => {}), /no longer/);
  await assert.rejects(service.checkVisual('paper', artifact.id, [{ page: 1, dataUrl: 'image' }], () => {}), /do not match/);
  assert.equal(calls.visual, 0);
  assert.equal((await service.checkVisual('paper', artifact.id, [{ page: 2, dataUrl: 'image' }], () => {})).status, 'checked');
  await assert.rejects(service.checkVisual('paper', artifact.id, [{ page: 2, dataUrl: 'image' }], () => {}), /no longer/);
  assert.deepEqual(calls, { plan: 1, compile: 1, visual: 1 });
});
test('Sol can decline a visual check and empty or unsupported comparisons cost no model turn', async () => {
  const { service, calls, codex } = fixture();
  await service.smartPlan({ ...input, after: before }, () => {});
  await service.smartPlan({ ...input, after: before.replace('article', 'report') }, () => {});
  assert.equal(calls.plan, 0);
  const planChanges = codex.planChanges; codex.planChanges = async (...args) => ({ ...await planChanges(...args), inspect: [] });
  const plan = await service.smartPlan(input, () => {}), artifact = await service.build({ ...input, arrangementId: plan.id });
  assert.equal(artifact.visual?.status, 'not-requested'); assert.equal(calls.visual, 0);
});
test('cancelled planning and changed inputs cannot authorize an arrangement or visual inspection', async () => {
  const { service, codex, compiler, calls } = fixture();
  const original = codex.planChanges; let release!: () => void;
  codex.planChanges = async (...args) => { await new Promise<void>(r => { release = r; }); return original(...args); };
  const planning = service.smartPlan(input, () => {}); const rejected = assert.rejects(planning, /cancelled/);
  service.cancel(); release(); await rejected; assert.equal(calls.compile, 0);
  codex.planChanges = original;
  const plan = await service.smartPlan(input, () => {});
  await assert.rejects(service.build({ ...input, after: input.after + '\n', arrangementId: plan.id }), /changed/);
  const artifact = await service.build({ ...input, arrangementId: plan.id });
  compiler.inspect = async () => ({ status: 'changed' });
  await assert.rejects(service.checkVisual('paper', artifact.id, [{ page: 2, dataUrl: 'image' }], () => {}), /inputs changed/);
  assert.equal(calls.visual, 0);
});
