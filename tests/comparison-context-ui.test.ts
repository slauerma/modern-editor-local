import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { changesUpdateDue } from '../src/shared/changes-agent.ts';
import { comparisonPlan } from '../src/shared/changes-pdf.ts';
import { PASTED_CONTEXT_BYTES } from '../src/shared/references.ts';

type Element = { type: unknown; props: Record<string, any>; children: unknown[] };
const deferred = <T,>() => { let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const nodes = (n: any): Element[] => n && typeof n === 'object' ? [n, ...(n.children ?? []).flatMap(nodes)] : [];
// Real component bodies and event handlers; only painting, hooks and IPC are
// substituted. Explicit rerenders exercise events arriving while IPC is held.
function mount(file: string, name: string, props: Record<string, any>, editor: Record<string, any>) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name); assert(declaration);
  const js = ts.transpileModule(declaration.getText(source).replace(/^export\s+/, ''), {
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  let cursor = 0, tree: Element;
  const slots: any[] = [], deps: any[][] = [], cleanup: (() => void)[] = [], effects: (() => void)[] = [];
  const changed = (k: number, values: any[]) => !deps[k] || values.length !== deps[k].length || values.some((v, i) => v !== deps[k][i]);
  const useState = (initial: any) => { const k = cursor++; if (!(k in slots)) slots[k] = initial;
    return [slots[k], (v: any) => { slots[k] = typeof v === 'function' ? v(slots[k]) : v; }]; };
  const useRef = (initial: any) => { const k = cursor++; if (!(k in slots)) slots[k] = { current: initial }; return slots[k]; };
  const useMemo = (f: () => any, values: any[]) => { const k = cursor++; if (changed(k, values)) { slots[k] = f(); deps[k] = values; } return slots[k]; };
  const useEffect = (effect: () => any, values: any[]) => { const k = cursor++; if (changed(k, values)) {
    deps[k] = values; effects.push(() => { cleanup[k]?.(); cleanup[k] = effect(); });
  } };
  const target = new EventTarget();
  const scope = {
    useState, useRef, useMemo, useEffect, PASTED_CONTEXT_BYTES, changesUpdateDue,
    React: { createElement: (type: unknown, props: any, ...children: any[]) => ({ type, props: props ?? {}, children: children.flat(Infinity) }) },
    window: { editor, addEventListener: target.addEventListener.bind(target), removeEventListener: target.removeEventListener.bind(target) },
    requestAnimationFrame: (fn: () => void) => queueMicrotask(fn), traceInteraction: () => {}, PdfPane: 'PdfPane',
    errorText: (e: Error) => e.message, label: (p: string) => p === 'clean' ? 'Clean paper' : 'Revision markup',
    comparisonScreenshots: async () => { throw Error('No screenshots requested'); }
  };
  const component = new Function('scope', 'with(scope){' + js + ';return ' + name + ';}')(scope);
  const host = {
    render() { cursor = 0; tree = component(props); while (effects.length) effects.shift()!(); return tree; },
    get(label: string) { const node = nodes(tree).find(n => n.props['aria-label'] === label || n.type === 'button' && n.children.includes(label)); assert(node, label); return node; },
    all() { return nodes(tree); },
    async settle() { for (let n = 0; n < 6; n++) { await new Promise(r => setImmediate(r)); host.render(); } },
    unmount() { cleanup.forEach(fn => fn?.()); }
  };
  host.render(); return host;
}

for (const edit of ['name', 'typing', 'paste', 'none', 'failure']) test('context save preserves the right draft: ' + edit, async () => {
  const held = deferred<any>(), sent: any[] = [];
  const host = mount('src/renderer/ReferencePanel.tsx', 'ReferencePanel', { projectId: 'one', disabled: false, onState() {}, showSources() {}, convert() {} }, {
    referenceState: async () => ({ roots: [], notices: [] }),
    pasteContext: (_: string, value: any) => { sent.push(value); return held.promise; }
  });
  try {
    host.get('Paste context…').props.onClick(); host.render();
    host.get('Context name').props.onChange({ target: { value: 'First name' } });
    host.get('Pasted context text').props.onChange({ target: { value: 'First text' } }); host.render();
    host.get('Save and enable for this paper').props.onClick(); host.render();
    assert.deepEqual(sent, [{ name: 'First name', text: 'First text' }]);
    if (edit === 'name') host.get('Context name').props.onChange({ target: { value: 'Next name' } });
    if (edit === 'typing') host.get('Pasted context text').props.onChange({ target: { value: 'Next text' } });
    if (edit === 'paste') host.get('Pasted context text').props.onPaste({
      clipboardData: { getData: () => 'Next paste\r\n' }, currentTarget: { value: 'First text', selectionStart: 0, selectionEnd: 10, isConnected: false }, preventDefault() {}
    });
    host.render();
    if (edit === 'failure') held.reject(Error('Storage unavailable')); else held.resolve({ roots: [], notices: [] });
    await host.settle();
    if (edit === 'none') assert(!host.all().some(n => n.props['aria-label'] === 'Pasted context text'));
    else {
      assert.equal(host.get('Context name').props.value, edit === 'name' ? 'Next name' : 'First name');
      assert.equal(host.get('Pasted context text').props.value, edit === 'typing' ? 'Next text' : edit === 'paste' ? 'Next paste\r\n' : 'First text');
      assert.equal(host.get('Save and enable for this paper').props.disabled, false);
    }
  } finally { host.unmount(); }
});

for (const invalidation of ['typing', 'proposal', 'hide', 'unchanged']) test('Changes PDF handles a held Sol request: ' + invalidation, async () => {
  const before = '\\documentclass{article}\n\\begin{document}\nThe argument are correct.\n\\end{document}';
  const input = { projectId: 'one', before, after: before.replace('are', 'is'), name: 'Start', engine: 'pdflatex' };
  const held = deferred<any>();
  let plans = 0, builds = 0, cancels = 0, foreground = false;
  const artifact = { id: 'local', presentation: 'markup', build: { id: 'pdf' }, ...comparisonPlan(input.before, input.after) };
  const props = { input, reasonsKey: '', visible: true, disabled: false, proposalCurrent: true, events: { accepted: 0, saved: 0 },
    work: async (_: unknown, action: () => Promise<unknown>) => action(), onExport() {}, onExportReady() {}, onClose() {}, onSource() {}, onText() {}, onFormat() {} };
  const host = mount('src/renderer/ChangesPdfPane.tsx', 'ChangesPdfPane', props, {
    changesSettings: async () => ({ every: 5 }), inspectChanges: async () => ({ status: 'valid' }),
    buildChanges: async () => { builds++; return artifact; }, locateChange: async () => ({ kind: 'unavailable', reason: 'Synthetic marker' }),
    planChanges: async () => { plans++; return held.promise; },
    cancelCodex: async () => { assert(!foreground, 'Stale comparison cannot cancel later foreground work'); cancels++; held.resolve({ id: null }); },
    cancelBuild: async () => { throw Error('Do not cancel another kind of work'); }
  });
  try {
    await host.settle(); assert.equal(plans, 1); assert.equal(builds, 1);
    if (invalidation === 'typing') props.input = { ...input, after: input.after.replace('correct', 'precise') };
    if (invalidation === 'proposal') props.proposalCurrent = false;
    if (invalidation === 'hide') props.visible = false;
    host.render(); await host.settle();
    assert.equal(cancels, invalidation === 'unchanged' ? 0 : 1);
    held.resolve({ id: null }); await host.settle();
    foreground = true; await host.settle(); host.unmount();
    assert.equal(cancels, invalidation === 'unchanged' ? 0 : 1);
    assert.equal(plans, 1, 'Typing alone must not start a new Sol run'); assert.equal(builds, 1);
  } finally { held.resolve({ id: null }); host.unmount(); }
});

test('hiding a completed comparison invalidates held navigation without cancelling another worker', async () => {
  const before = '\\documentclass{article}\n\\begin{document}\nThe argument are correct.\n\nThe conclusion are clear.\n\\end{document}';
  const input = { projectId: 'one', before, after: before.replaceAll('are', 'is'), name: 'Start', engine: 'pdflatex' };
  const artifact = { id: 'local', presentation: 'markup', build: { id: 'pdf' }, ...comparisonPlan(input.before, input.after) };
  assert.equal(artifact.changes.length, 2);
  const held = deferred<any>(); let holding = false, cancels = 0;
  const props = { input, visible: true, disabled: false, proposalCurrent: true, events: { accepted: 0, saved: 0 },
    work: async (_: unknown, action: () => Promise<unknown>) => action(), onExport() {}, onExportReady() {}, onClose() {}, onSource() {}, onText() {}, onFormat() {} };
  const host = mount('src/renderer/ChangesPdfPane.tsx', 'ChangesPdfPane', props, {
    changesSettings: async () => ({ every: 5 }), inspectChanges: async () => ({ status: 'valid' }),
    buildChanges: async () => artifact, planChanges: async () => ({ id: null }),
    locateChange: async () => holding ? held.promise : { kind: 'mapped' },
    cancelCodex: async () => { cancels++; }, cancelBuild: async () => { cancels++; }
  });
  try {
    await host.settle(); host.get('Pause updates').props.onClick(); host.render();
    holding = true; host.get('Next change').props.onClick(); host.render();
    props.visible = false; host.render();
    held.resolve({ kind: 'mapped' }); await host.settle();
    props.visible = true; await host.settle();
    assert.equal(host.all().find(n => n.type === 'PdfPane')!.props.changeTarget, null);
    assert.equal(cancels, 0);
  } finally { held.resolve({ kind: 'mapped' }); host.unmount(); }
});

for (const phase of ['build', 'arrange']) test('a completed comparison ' + phase + ' cannot cancel the next gate owner', async () => {
  const before = '\\documentclass{article}\n\\begin{document}\nThe argument are correct.\n\\end{document}';
  const input = { projectId: 'one', before, after: before.replace('are', 'is'), name: 'Start', engine: 'pdflatex' };
  const artifact = { id: 'local', presentation: 'markup', build: { id: 'pdf' }, ...comparisonPlan(input.before, input.after) };
  let foreground = false, cancels = 0, host: ReturnType<typeof mount>;
  const props = { input, visible: true, disabled: false, proposalCurrent: true, events: { accepted: 0, saved: 0 },
    async work(kind: string, action: () => Promise<unknown>) {
      const value = await action();
      if (kind === phase) {
        foreground = true; props.input = { ...input, after: input.after + '\n' };
        host.render(); // Simulate another owner before the outer await resumes.
      }
      return value;
    }, onExport() {}, onExportReady() {}, onClose() {}, onSource() {}, onText() {}, onFormat() {} };
  host = mount('src/renderer/ChangesPdfPane.tsx', 'ChangesPdfPane', props, {
    changesSettings: async () => ({ every: 5 }), inspectChanges: async () => ({ status: 'valid' }),
    buildChanges: async () => artifact, locateChange: async () => ({ kind: 'unavailable', reason: 'Synthetic marker' }), planChanges: async () => ({ id: null }),
    cancelCodex: async () => { cancels++; }, cancelBuild: async () => { cancels++; }
  });
  try { await host.settle(); assert(foreground); assert.equal(cancels, 0); }
  finally { host.unmount(); }
});
