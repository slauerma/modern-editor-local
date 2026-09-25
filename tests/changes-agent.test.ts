import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChangesPdfService } from '../src/main/changes-pdf.ts';
import { changesUpdateDue, visualCheckSchema, changesAgentSchema } from '../src/shared/changes-agent.ts';
import type { ChangesInput } from '../src/shared/changes-pdf.ts';
const before = '\\documentclass{article}\n\\begin{document}\nA sentence have a mistake.\n\\end{document}';
const input: ChangesInput = { projectId: 'paper', before, after: before.replace('have', 'has'), name: 'Session start', engine: 'pdflatex' };
function fixture() {
  const calls = { plan: 0, compile: 0, visual: 0 };
  const projects = { get() { return {}; }, changeJournal: { explain(_: string, __: string, p: unknown) { return p; } } };
  const compiler = { async compile() { calls.compile++; return { id: 'build', success: true, dependenciesVerified: true }; }, async inspect() { return { status: 'valid' }; }, async pdf() { return new Uint8Array(); }, async locatePdf() { assert.fail('Comparison navigation must not use approximate SyncTeX.'); } };
  const codex = { async planChanges(_: string, prompt: string) { calls.plan++; const changes = JSON.parse(prompt).changes; return { groups: changes.map((c: any) => ({ ids: [c.id], layout: 'keep', summary: 'Correct grammar.' })), inspect: [changes[0].id] }; }, async checkChanges(_: string, prompt: string, images: string[]) { calls.visual++; assert.deepEqual(JSON.parse(prompt).pages, [2]); assert.equal(images.length, 1); return { readable: true, issues: [] }; } };
  return { service: new ChangesPdfService(projects as any, compiler as any, codex as any, async (_, ids) => Object.fromEntries(ids.map(id => [id, { page: 2, x: 10, y: 20, width: 18, height: 12 }]))), calls, codex, compiler };
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
test('Sol receives exact presentation limits and a concrete visual-quality brief', async () => {
  const { service, codex } = fixture();
  const originalPlan = codex.planChanges, originalCheck = codex.checkChanges;
  codex.planChanges = async (...args) => {
    const prompt = JSON.parse(args[1]);
    assert.equal(prompt.presentation, 'markup');
    assert.deepEqual(prompt.changes[0].shownIn, { markup: true, clean: true });
    assert.match(prompt.task, /every supplied change ID exactly once/);
    assert.match(prompt.task, /application generates TeX from exact source/);
    assert.match(prompt.task, /Do not claim visual success/);
    return originalPlan(...args);
  };
  codex.checkChanges = async (...args) => {
    const prompt = JSON.parse(args[1]);
    assert.match(prompt.task, /joined old\/new words/);
    assert.match(prompt.task, /invisible anchors.*intentional/);
    assert.match(prompt.task, /not certification of unseen pages/);
    assert.equal(prompt.changes[0].id, 'change-1');
    return originalCheck(...args);
  };
  const arranged = await service.smartPlan(input, () => {}), artifact = await service.build({ ...input, arrangementId: arranged.id });
  await service.checkVisual('paper', artifact.id, [{ page: 2, dataUrl: 'image' }], () => {});
});
test('Sol cannot inspect a change omitted by the chosen presentation or bypass the JSON contract', async () => {
  const { service, calls, codex } = fixture();
  const math = { ...input, before: before.replace('A sentence have a mistake.', 'For $x=1$ the result holds.'), after: before.replace('A sentence have a mistake.', 'For $x=2$ the result holds.') };
  await service.smartPlan(math, () => {}); assert.equal(calls.plan, 0, 'No model request for an all-omitted markup view');
  const clean = await service.smartPlan({ ...math, presentation: 'clean' }, () => {}); assert(clean.id);
  const original = codex.planChanges;
  codex.planChanges = async (...args) => ({ ...await original(...args), inspect: ['change-2'] });
  await assert.rejects(service.smartPlan(input, () => {}), /unsupported visual check/);
  assert(!changesAgentSchema.safeParse({ groups: [], inspect: ['change-1', 'change-1'] }).success);
  assert(!changesAgentSchema.safeParse({ groups: [], inspect: [], tex: 'replacement code' }).success);
  assert(!visualCheckSchema.safeParse({ readable: true, issues: ['There is visible overlap.'] }).success);
  assert(!visualCheckSchema.safeParse({ readable: false, issues: [] }).success);
  assert(visualCheckSchema.safeParse({ readable: false, issues: ['Page 2: inserted wording overlaps the deletion.'] }).success);
});
