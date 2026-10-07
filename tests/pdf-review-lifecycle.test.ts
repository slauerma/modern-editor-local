import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

// Run the production hook with deterministic React scheduling and delayed IPC.
// Native suites separately cover actual painting and real TeX compilation.
const source = ts.createSourceFile('hook.ts', fs.readFileSync('src/renderer/use-pdf-review-build.ts', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const declaration = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'usePdfReviewBuild')!;
const code = ts.transpileModule(declaration.getText(source).replace(/^export /, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => resolve = r); return { promise, resolve }; };
function harness() {
  const slots: any[] = [], deps: any[][] = [], cleanup: any[] = [];
  let cursor = 0, dirty = true, effects: (() => void)[] = [], timers = new Map<number, () => void>(), timerId = 0;
  const f: any = { visible: true, value: null, compiles: 0, plans: 0, changes: 0, valid: true };
  const api: any = {
    compile: async () => ({ id: 'build-' + ++f.compiles, success: true, dependenciesVerified: true }),
    buildChanges: async () => ({ id: 'changes-' + ++f.changes, build: { id: 'marked' } }),
    validateBuild: async () => f.valid, inspectChanges: async () => ({ status: 'valid' }),
    cancelBuild: async () => {}, cancelCodex: async () => {},
    planChanges: async () => { f.plans++; return { id: 'plan' }; }
  };
  const useState = (initial: any) => { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], (next: any) => { const value = typeof next === 'function' ? next(slots[i]) : next; if (value !== slots[i]) { slots[i] = value; dirty = true; } }]; };
  const useRef = (initial: any) => { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; };
  const useEffect = (action: () => any, values: any[]) => { const i = cursor++; if (!deps[i] || values.some((v, j) => !Object.is(v, deps[i][j]))) { deps[i] = values; effects.push(() => { cleanup[i]?.(); cleanup[i] = action(); }); } };
  const win = { editor: api, addEventListener() {}, removeEventListener() {} };
  const hook = new Function('useState', 'useRef', 'useEffect', 'window', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'message', 'comparisonScreenshots', code + '; return usePdfReviewBuild;')(
    useState, useRef, useEffect, win, (fn: () => void) => { timers.set(++timerId, fn); return timerId; }, (id: number) => timers.delete(id), () => 0, () => {}, String, async () => []);
  f.api = api;
  f.render = () => {
    let rounds = 0;
    do { assert(++rounds < 30, 'render loop'); dirty = false; cursor = 0; f.value = hook({ projectId: 'paper', before: 'Original', after: 'Proposed', engine: 'pdflatex', presentation: 'markup' }, f.visible, false, async (_: any, action: any) => action()); const pending = effects; effects = []; pending.forEach(fn => fn()); } while (dirty);
  };
  f.settle = async () => { for (let n = 0; n < 12; n++) { await new Promise(resolve => setImmediate(resolve)); if (dirty) f.render(); } };
  f.fire = async () => { f.render(); const queued = [...timers.values()]; timers.clear(); queued.forEach(fn => fn()); await f.settle(); };
  f.close = () => cleanup.forEach(fn => fn?.());
  f.render(); return f;
}

test('Stop during cached validation cannot start another compile', async () => {
  const f = harness(); try {
    await f.fire(); assert.equal(f.compiles, 2);
    const pending = deferred<boolean>(); f.api.validateBuild = () => pending.promise;
    f.value.refresh(); await f.fire(); assert(f.value.busy);
    f.value.stop(); pending.resolve(false); await f.settle();
    assert.equal(f.compiles, 2); assert.match(f.value.status, /stopped/);
    await f.fire(); assert.equal(f.compiles, 2, 'explicit Stop remains stopped');
  } finally { f.close(); }
});

test('hiding the first build retries once on return while explicit Stop does not', async () => {
  const f = harness(); try {
    const pending = deferred<any>(); f.api.compile = async () => { f.compiles++; return pending.promise; };
    await f.fire(); assert.equal(f.compiles, 1);
    f.visible = false; f.render(); pending.resolve({ id: 'cancelled', success: true, dependenciesVerified: true }); await f.settle();
    assert.equal(f.value.value, null);
    f.api.compile = async () => ({ id: 'build-' + ++f.compiles, success: true, dependenciesVerified: true });
    f.visible = true; await f.fire(); assert(f.value.fresh); assert.equal(f.compiles, 3);
    await f.fire(); assert.equal(f.compiles, 3, 'no repeated automatic builds');
  } finally { f.close(); }
});

test('Sol refinement cannot publish a marked PDF with an invalid retained pair', async () => {
  const f = harness(); try {
    await f.fire(); const original = f.value.value;
    f.api.planChanges = async () => { f.valid = false; return { id: 'plan' }; };
    f.value.refresh(true); await f.fire();
    assert.equal(f.value.value.changes.id, 'changes-2', 'the local refreshed comparison is retained');
    assert.notEqual(f.value.value.changes.id, 'changes-3', 'invalid refined result is not published');
    assert.equal(f.value.value.original.id, original.original.id); assert.equal(f.value.fresh, false);
    assert.match(f.value.error, /inputs changed/);
  } finally { f.close(); }
});
