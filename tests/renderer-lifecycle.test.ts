import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
import { EditorState, StateEffect, Transaction } from '@codemirror/state';
import { undo, redo, undoDepth, redoDepth, defaultKeymap, historyKeymap, isolateHistory } from '@codemirror/commands';
import { JSON_FILE_LIMIT } from '../src/shared/persistence.ts';
import { commentSchema, bufferSchema, defaultWorkspace, workspaceSchema } from '../src/shared/contracts.ts';
import * as reviewTools from '../src/shared/review.ts';
import * as stateTools from '../src/renderer/editor-state.ts';
import { RecoveryWriter } from '../src/renderer/recovery-writer.ts';
import { WorkGate } from '../src/renderer/work-gate.ts';
import { LatestTask } from '../src/renderer/workspace-state.ts';
import { SectionReview } from '../src/shared/section-review.ts';
import * as contextTools from '../src/shared/codex-context.ts';
import * as preambleTools from '../src/shared/fragment-preamble.ts';

// Exercise the actual App function bodies and its actual transaction filter with
// real CodeMirror/Zod, replacing only DOM painting and the narrow IPC boundary.
const source = await fs.readFile('src/renderer/App.tsx', 'utf8');
const syntax = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ['input', 'validateTransaction', 'dispatchTransactions', 'returnToSource', 'flush', 'captureWorkspace', 'flushWorkspace', 'patch', 'compile', 'acceptWithoutCompile', 'doHistory', 'discuss', 'appendReview', 'addAuthorComment', 'close', 'save', 'open', 'load', 'addPreambleAndCompile', 'cancelPreamble', 'cancelPdfNavigation', 'toggleComparison', 'showInPdf', 'navigatePdf'];
const extracted: string[] = []; let filter = '', bindings = '';
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? '')) extracted.push(node.getText(syntax));
  if (ts.isCallExpression(node) && node.expression.getText(syntax) === 'EditorState.transactionFilter.of') filter = node.getText(syntax);
  if (ts.isCallExpression(node) && node.expression.getText(syntax) === 'keymap.of') bindings = node.arguments[0].getText(syntax);
  ts.forEachChild(node, visit);
}
visit(syntax); assert.equal(extracted.length, names.length); assert(filter);
const javascript = ts.transpileModule(extracted.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const install = new Function('scope', `with(scope){ ${javascript}; return {${names.join(',')}}; }`);
const makeFilter = new Function('scope', `with(scope){ return ${ts.transpileModule(filter, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText}; }`);
const makeBindings = new Function('scope', `with(scope){ return ${ts.transpileModule(bindings, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText}; }`);
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
const turns = async () => { for (let n = 0; n < 16; n++) await Promise.resolve(); };
const quote = 'The allocation is monotone.';

function fixture(text = quote) {
  const c = reviewTools.adoptComment(text, commentSchema.parse({ id: 'c1', title: 'Clarity', explanation: 'Clarify.', original: quote, replacement: 'The allocation is increasing.', replyDraft: 'Please explain.' }));
  const review = { schemaVersion: 1, rootFile: 'main.tex', sourceHash: '', activeId: c.id, comments: [c], updatedAt: '2026-09-08' };
  const p = { id: 'p1', name: 'main.tex', text, review, recovered: false, notices: [], engine: 'pdflatex' };
  const states: Record<string, any> = { errors: [], writes: [], events: [], validations: [], build: null };
  const gate = new WorkGate();
  const editor = { state: stateTools.initialState(text, [c]), destroyed: false, destroy() { this.destroyed = true; },
    update(transactions: readonly Transaction[]) { for (const tr of transactions) { tr.state.field(stateTools.commentsField); editor.state = tr.state; } },
    dispatch(value: any) { const tr = value.startState ? value : editor.state.update(value); scope.dispatchTransactions([tr], editor); } };
  const api: any = {
    persist: async (value: any) => { bufferSchema.parse(value); states.writes.push(structuredClone(value)); },
    compile: async () => ({ id: 'build-1', engine: 'pdflatex', success: true, clean: true, diagnostics: [], log: '', elapsedMs: 1, sourceHash: '' }),
    validateBuild: async (value: any) => { states.validations.push(value); return true; },
    save: async (value: any) => { states.saved = structuredClone(value); },
    cancelBuild: async () => { states.events.push('cancel build'); }, cancelCodex: async () => { states.events.push('cancel codex'); },
    finishClose: async () => { states.events.push('closed'); },
  };
  const scope: any = {
    EditorState, Transaction, isolateHistory, undo, redo, defaultKeymap, historyKeymap, commentSchema, crypto, defaultWorkspace, workspaceSchema, ...reviewTools, ...stateTools, ...preambleTools, ...contextTools,
    document: { body: {}, activeElement: {} }, requestAnimationFrame: (callback: () => void) => { states.frame = callback; }, setCompareOpen: () => {},
    workspaceValues: { current: defaultWorkspace() }, restoredSource: { current: null }, laterRef: { current: false }, discussionLock: { current: false }, followPending: { current: null }, followTasks: { current: new LatestTask() },
    sourcePosition: () => defaultWorkspace().source,
    preambleRun: { current: null }, sectionRun: { current: null }, comparisonPosition: { current: {} },
    displayedBuild: { current: null }, pdfRequest: { current: 0 }, keyboardReviewFocus: { current: null },
    gate: { current: gate }, window: { editor: api }, view: { current: editor }, projectRef: { current: p }, reviewRef: { current: review }, activeRef: { current: c.id }, historyRef: { current: false }, active: c,
    viewCandidate: false, busy: false, aiBusy: false, effortBusy: false, engine: 'pdflatex', errorText: (e: Error) => e.message,
    setError: (e: string) => states.errors.push(e), setNotice: (v: string) => { states.notice = v; }, setStatus: (v: string) => { states.status = v; },
    choose: (v: string) => { scope.activeRef.current = v; }, move: () => {},
  };
  for (const setter of ['CandidatePosition', 'DiscussionBusy', 'LaterOnly', 'PaneSizes', 'ToolbarCollapsed', 'FollowComments', 'Busy', 'AiBusy', 'PreambleBusy', 'LastAttempt', 'Build', 'PdfText', 'DependencyStale', 'PdfOpen', 'PdfJump', 'PdfNavigation', 'PdfLocating', 'ViewCandidate', 'CandidateBuild', 'ShowHistory', 'NotesOpen', 'Project', 'CompareOpen', 'Baseline', 'Effort', 'FastMode', 'Engine', 'Text', 'SavedText', 'PdfPosition', 'FindOpen', 'FindNotice', 'ActiveId', 'PaperInstructions', 'SavedInstructions', 'SectionProgress', 'ContextOpen', 'OverviewOpen', 'InboxOpen', 'ContextText']) scope['set' + setter] = (value: any) => { states[setter] = value; };
  scope.workspaceWriter = { current: new RecoveryWriter<any>(async value => { states.workspace = value; }, () => {}) };
  scope.writer = { current: new RecoveryWriter<any>((value: any) => api.persist(value), (e: unknown) => { throw e; }) };
  editor.state = editor.state.update({ effects: StateEffect.appendConfig.of(makeFilter(scope)) }).state;
  Object.assign(scope, install(scope));
  return { scope, states, editor, gate, api, bindings: makeBindings(scope) };
}

// Exercise the real key bindings and final dispatch boundary, including history
// transactions marked filter:false. Each large synthetic case runs serially.
for (const route of ['undo', 'redo', 'undo-selection', 'redo-selection'] as const) test(`${route} cannot restore an oversized draft or consume its history entry`, () => {
  const forward = route.startsWith('redo'), full = quote + 'x'.repeat(20000 - quote.length), short = full.slice(0, 10000), f = fixture(forward ? short : full);
  const c = { ...f.editor.state.field(stateTools.commentsField)[0], messages: Array.from({ length: 107 }, () => ({ role: 'assistant' as const, text: '', createdAt: '2026-01-01T00:00:00.000Z' })) };
  const review = { ...f.scope.input().review, sourceHash: '0'.repeat(64), updatedAt: '2026-01-01T00:00:00.000Z', comments: [c] };
  const record = { schemaVersion: 1, baseDiskHash: '0'.repeat(64), text: full, review, revision: Number.MAX_SAFE_INTEGER };
  let remaining = JSON_FILE_LIMIT - 500 - Buffer.byteLength(JSON.stringify(record, null, 2));
  for (const message of c.messages) {
    const bytes = Math.min(remaining, 300000), rest = bytes % 3;
    message.text = '界'.repeat(Math.floor(bytes / 3)) + (rest === 2 ? 'é' : rest === 1 ? 'x' : ''); remaining -= bytes;
  }
  assert.equal(remaining, 0);
  f.editor.dispatch({ effects: stateTools.loadComments.of([c]), annotations: Transaction.addToHistory.of(false) });
  f.scope.validateTransaction(f.editor.state.update({}));
  if (forward) {
    f.editor.dispatch({ changes: { from: short.length, insert: full.slice(short.length) }, annotations: isolateHistory.of('full') });
    assert.equal(f.scope.doHistory(), true);
  } else f.editor.dispatch({ changes: { from: short.length, to: full.length }, annotations: isolateHistory.of('full') });
  assert.equal(f.scope.patch(c.id, { replyDraft: 'y'.repeat(9000) }), true);
  const before = f.editor.state, depth = forward ? redoDepth(before) : undoDepth(before);
  assert(depth > 0); bufferSchema.parse(f.scope.input());
  const key = route === 'undo' ? 'Mod-z' : route === 'redo' ? 'Mod-y' : route === 'undo-selection' ? 'Mod-u' : 'Alt-u';
  const binding = f.bindings.find((item: any) => item.key === key);
  assert(binding, 'actual App history key exists');
  assert.equal(binding.run(f.editor), true, 'rejection consumes the shortcut without falling through');
  assert.equal(f.editor.state, before); assert.equal(forward ? redoDepth(f.editor.state) : undoDepth(f.editor.state), depth);
  assert.match(f.states.errors.at(-1), /32000000 UTF-8 bytes/);
  assert.equal(f.scope.patch(c.id, { replyDraft: '' }), true);
  assert.equal(binding.run(f.editor), true); assert.equal(f.editor.state.doc.length, full.length, 'the preserved history entry can be retried');
  assert.equal(forward ? redoDepth(f.editor.state) : undoDepth(f.editor.state), depth - 1);
});

test('selection-history shortcuts cannot bypass the editing barrier', async () => {
  const f = fixture(); f.editor.dispatch({ changes: { from: 0, insert: 'Prefix ' }, annotations: isolateHistory.of('full') });
  const before = f.editor.state;
  await f.gate.commit(async () => {
    assert.equal(f.bindings.find((binding: any) => binding.key === 'Mod-u').run(f.editor), true);
    assert.equal(f.editor.state, before);
  });
});

test('ordinary Compile validates its completed snapshot and exposes a stale PDF when dependencies changed', async () => {
  const f = fixture(); f.api.validateBuild = async (value: any) => { f.states.validations.push(value); return false; };
  await f.scope.compile();
  assert.equal(f.states.validations.length, 1); assert.equal(f.states.Build.id, 'build-1'); assert.equal(f.states.DependencyStale, true);
  assert.match(f.states.status, /inputs changed/); assert.equal(f.editor.state.doc.toString(), quote);
});
test('source PDF requests use explicit comment bounds or cursor bounds and ignore late results after another jump or draft edit', async()=>{
  const f=fixture(), first=deferred<any>(); f.scope.displayedBuild.current={id:'old'};
  const requests:any[]=[];f.api.locatePdf=async(input:any)=>{requests.push(input);return requests.length===1?first.promise:{kind:'mapped',buildId:'old',page:2,x:1,y:2,width:30,height:10};};
  const pending=f.scope.navigatePdf({projectId:'p1',text:quote,from:0,to:5});await turns();
  await f.scope.navigatePdf({projectId:'p1',text:quote,from:5,to:8});assert.equal(f.states.PdfJump.page,2);
  first.resolve({kind:'mapped',buildId:'old',page:1});await pending;assert.equal(f.states.PdfJump.page,2);
  const later=deferred<any>();f.api.locatePdf=()=>later.promise;
  const old=f.scope.navigatePdf({projectId:'p1',text:quote,from:0,to:5});await turns();f.editor.dispatch({changes:{from:0,insert:'Edited '}});
  later.resolve({kind:'mapped',buildId:'old',page:3});await old;assert.equal(f.states.PdfJump,null);
  assert.deepEqual(requests.map(r=>[r.from,r.to]),[[0,5],[5,8]]);assert.equal(f.states.saved,undefined);
});
test('manual PDF navigation and opening Compare supersede a delayed comment-follow response', async () => {
  for (const action of ['page', 'scroll', 'compare']) {
    const f = fixture(), lookup = deferred<any>();
    f.scope.displayedBuild.current = { id: 'old' };
    f.api.locatePdf = () => lookup.promise;
    const pending = f.scope.navigatePdf({ projectId: 'p1', text: quote, from: 0, to: 5 }, false, true);
    await turns();
    f.scope.compareOpen = false; f.scope.setReviewOpen = () => {};
    if (action === 'compare') f.scope.toggleComparison();
    else {
      // PdfPane signals deliberate input separately from programmatic position updates.
      f.scope.cancelPdfNavigation();
      f.states.PdfPosition = action === 'page' ? { page: 9 } : { page: 3, scrollY: 0.7 };
    }
    const position = f.states.PdfPosition;
    lookup.resolve({ kind: 'mapped', buildId: 'old', page: 2 }); await pending;
    assert.equal(f.states.PdfPosition, position);
    assert.equal(f.states.PdfJump, null);
    assert.equal(f.states.PdfLocating, false);
    if (action === 'compare') assert.equal(f.states.CompareOpen, true);
    // A later explicit request still works; cancellation does not turn following off.
    f.api.locatePdf = async () => ({ kind: 'mapped', buildId: 'old', page: 4 });
    await f.scope.navigatePdf({ projectId: 'p1', text: quote, from: 0, to: 5 }, false, true);
    assert.equal((f.states.PdfJump as any)?.page, 4);
  }
});
test('Compile and show compiles only the current buffer, never accepts a proposal or Saves; failed compile retains old PDF',async()=>{
  for(const success of [true,false]){
    const f=fixture();f.scope.displayedBuild.current={id:'old'};f.states.Build={id:'old'};
    f.api.compile=async(input:any)=>{assert.equal(input.text,quote);return {id:'new',success,clean:success};};
    f.api.locatePdf=async(input:any)=>{assert.equal(input.buildId,'new');return {kind:'mapped',buildId:'new',page:2};};
    await f.scope.navigatePdf({projectId:'p1',text:quote,from:0,to:5},true);
    assert.equal(f.states.Build.id,success?'new':'old');assert.equal(f.editor.state.doc.toString(),quote);assert.equal(f.editor.state.field(stateTools.commentsField)[0].decision,'open');assert.equal(f.states.saved,undefined);
    if(success)assert.equal(f.states.PdfJump.page,2);else assert.equal(f.states.PdfJump,null);
  }
});

test('accept publishes one undoable edit before persistence; a failed write cannot hide a candidate', async () => {
  const f = fixture(); let count = 0;
  f.api.persist = async (value: any) => {
    assert.equal(value.text, f.editor.state.doc.toString(), 'Recovery must never contain a candidate ahead of the editor');
    if (++count === 2) throw new Error('storage unavailable');
    f.states.writes.push(value);
  };
  await f.scope.compile('c1');
  assert.equal(f.editor.state.doc.toString(), 'The allocation is increasing.'); assert.equal(f.editor.state.field(stateTools.commentsField)[0].decision, 'applied');
  assert.match(f.states.errors.at(-1), /suggestion is applied.*recovery could not be saved/i); assert.equal(f.gate.locked, false);
  assert(f.scope.doHistory()); assert.equal(f.editor.state.doc.toString(), quote); assert.equal(f.editor.state.field(stateTools.commentsField)[0].decision, 'open');
});

test('close during compile blocks source/review edits, ignores a late result, then persists the final visible buffer', async () => {
  const f = fixture(), result = deferred<any>();
  f.api.compile = () => result.promise;
  const compiling = f.scope.compile('c1'); await turns();
  const closing = f.scope.close(); await turns();
  f.editor.dispatch({ changes: { from: 0, insert: 'Late text' } });
  assert.equal(f.scope.patch('c1', { draft: 'Late draft' }), false); assert.equal(f.scope.doHistory(), false);
  assert.equal(f.editor.state.doc.toString(), quote); assert(!f.states.events.includes('closed'));
  result.resolve({ id: 'late-build', success: true, clean: true }); await Promise.all([compiling, closing]);
  assert.equal(f.states.writes.at(-1).text, quote); assert.equal(f.states.writes.at(-1).review.comments[0].decision, 'open');
  assert(f.states.events.includes('closed')); assert.equal(f.states.Build, undefined);
});

test('close during an accepted edit waits for its write and captures that visible edit', async () => {
  const f = fixture(), saved = deferred<void>(); let count = 0;
  f.api.persist = async (value: any) => { f.states.writes.push(structuredClone(value)); if (++count === 2) await saved.promise; };
  const applying = f.scope.compile('c1'); await turns();
  assert.equal(f.editor.state.doc.toString(), 'The allocation is increasing.'); assert(f.gate.locked);
  const closing = f.scope.close(); await turns(); assert(!f.states.events.includes('closed'));
  saved.resolve(); await Promise.all([applying, closing]);
  assert.equal(f.states.writes.at(-1).text, f.editor.state.doc.toString()); assert.equal(f.states.writes.at(-1).review.comments[0].decision, 'applied');
  assert(f.states.events.includes('closed'));
});

test('late Codex reply during close cannot replace a draft or mutate the final discussion', async () => {
  const f = fixture(), answer = deferred<any>(); f.api.replyToComment = () => answer.promise;
  const discussing = f.scope.discuss(); await turns();
  const closing = f.scope.close(); await turns();
  answer.resolve({ reply: 'Late answer', replacement: 'Unchosen model prose', packages: [] }); await Promise.all([discussing, closing]);
  const last = f.states.writes.at(-1).review.comments[0];
  assert.equal(last.messages.length, 1); assert.equal(last.messages[0].role, 'user'); assert.equal(last.replacement, 'The allocation is increasing.');
  assert.equal(f.editor.state.doc.toString(), quote); assert(f.states.events.includes('closed'));
});

test('failed close leaves the actual buffer editable and permits a later successful retry', async () => {
  const f = fixture(); f.api.persist = async () => { throw new Error('disk full'); };
  await f.scope.close(); assert.equal(f.gate.locked, false); assert(!f.states.events.includes('closed'));
  f.editor.dispatch({ changes: { from: 0, insert: 'Kept ' } }); assert.match(f.editor.state.doc.toString(), /^Kept /);
  f.api.persist = async (value: any) => { f.states.writes.push(value); };
  await f.scope.close(); assert.match(f.states.writes.at(-1).text, /^Kept /); assert(f.states.events.includes('closed'));
});

test('Save uses a brief editing barrier so later recovery cannot be overwritten by an older Save capture', async () => {
  const f = fixture(), saving = deferred<void>();
  f.api.save = async (value: any) => { f.states.saved = value; await saving.promise; };
  const operation = f.scope.save(); await turns(); assert(f.gate.locked);
  f.editor.dispatch({ changes: { from: 0, insert: 'While saving' } }); assert.equal(f.editor.state.doc.toString(), quote);
  const closing = f.scope.close(); await turns(); assert(!f.states.events.includes('closed'));
  saving.resolve(); await Promise.all([operation, closing]); assert.equal(f.states.saved.text, f.states.writes.at(-1).text);
});

test('closing during project handoff cannot combine the new project id with the old source', async () => {
  const f = fixture(), opened = deferred<any>(); f.api.openProject = () => opened.promise;
  const opening = f.scope.open(); await turns(); assert(f.gate.locked);
  const closing = f.scope.close(); await turns();
  const next = { ...f.scope.projectRef.current, id: 'p2', name: 'other.tex', text: 'New paper', review: { ...f.scope.reviewRef.current, rootFile: 'other.tex', comments: [] } };
  opened.resolve(next); await Promise.all([opening, closing]);
  assert(f.editor.destroyed); assert.equal(f.states.writes.at(-1).projectId, 'p2'); assert.equal(f.states.writes.at(-1).text, 'New paper');
});

test('an author comment uses the selected repeated occurrence and keeps source unchanged', () => {
  const source = quote + '\n' + quote, f = fixture(source);
  const from = source.lastIndexOf(quote); f.editor.dispatch({ selection: { anchor: from, head: from + quote.length } });
  f.scope.addAuthorComment();
  const added = f.editor.state.field(stateTools.commentsField).at(-1)!;
  assert.equal(added.from, from); assert.equal(added.validity, 'current'); assert.equal(added.replacement, null); assert.equal(f.editor.state.doc.toString(), source);
  bufferSchema.parse(f.scope.input());
});

const generatedPreamble = { preamble: '\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}', ending: '\\end{document}', explanation: 'AMS mathematics support.', needsInput: null };

test('explicit unchecked acceptance applies even invalid TeX with its packages, preserves the old PDF and undoes both', async () => {
  const source = '\\documentclass{article}\n\\begin{document}\n' + quote + '\n\\end{document}', f = fixture(source);
  f.scope.patch('c1', { draft: '\\notARealCommand{sample}', packages: ['mathtools'] });
  const c = f.editor.state.field(stateTools.commentsField)[0];
  const expected = reviewTools.changedText(source, reviewTools.proposalChanges(source, c));
  let compilerCalls = 0; f.api.compile = f.api.validateBuild = async () => { compilerCalls++; throw new Error('Compiler unavailable'); };
  f.states.Build = { id: 'old-pdf' }; f.states.PdfText = source;
  await f.scope.acceptWithoutCompile('c1');
  assert.equal(compilerCalls, 0); assert.equal(f.editor.state.doc.toString(), expected);
  assert.equal(f.editor.state.field(stateTools.commentsField)[0].decision, 'applied');
  assert.equal(f.states.writes[0].text, source); assert.equal(f.states.writes.at(-1).text, expected); assert.equal(f.states.saved, undefined);
  assert.equal(f.states.Build.id, 'old-pdf'); assert.equal(f.states.PdfText, source); assert.equal(f.states.ViewCandidate, false); assert.equal(f.states.CandidateBuild, null);
  assert.match(f.states.status, /applied without compiling/);
  assert(f.scope.doHistory()); assert.equal(f.editor.state.doc.toString(), source); assert.equal(f.editor.state.field(stateTools.commentsField)[0].decision, 'open'); assert.equal(f.states.notice, '');
});

test('unchecked acceptance keeps source and placement limits, including questions and oversized edits', async () => {
  for (const validity of ['stale', 'missing', 'ambiguous', 'unconfirmed']) {
    const f = fixture(); f.scope.patch('c1', { validity });
    await f.scope.acceptWithoutCompile('c1');
    assert.equal(f.editor.state.doc.toString(), quote); assert.equal(f.editor.state.field(stateTools.commentsField)[0].decision, 'open');
  }
  const question = fixture(); question.scope.patch('c1', { replacement: null });
  await question.scope.acceptWithoutCompile('c1'); assert.equal(question.editor.state.doc.toString(), quote);
  const source = quote + ' '.repeat(2000000 - quote.length), large = fixture(source);
  await large.scope.acceptWithoutCompile('c1');
  assert.equal(large.editor.state.doc.toString(), source); assert.equal(large.editor.state.field(stateTools.commentsField)[0].decision, 'open');
  assert.match(large.states.errors.at(-1), /limits/);
});

test('unchecked acceptance rejects a newer source or proposal and yields to close while original recovery is pending', async () => {
  for (const action of ['source', 'proposal', 'close']) {
    const f = fixture(), recording = deferred<void>(); let closing: Promise<void> | undefined;
    f.api.persist = async (value: any) => { f.states.writes.push(structuredClone(value)); await recording.promise; };
    const applying = f.scope.acceptWithoutCompile('c1'); await turns();
    if (action === 'source') f.editor.dispatch({ changes: { from: 0, insert: 'Newer text. ' } });
    if (action === 'proposal') f.scope.patch('c1', { draft: 'Newer proposal.' });
    if (action === 'close') closing = f.scope.close();
    recording.resolve(); await applying; await closing;
    assert.equal(f.editor.state.doc.toString(), action === 'source' ? 'Newer text. ' + quote : quote);
    assert.equal(f.editor.state.field(stateTools.commentsField)[0].decision, 'open');
    if (action === 'close') assert(f.states.events.includes('closed'));
  }
});

test('unchecked acceptance distinguishes failed recovery before application from a visible undoable edit afterwards', async () => {
  for (const failAt of [1, 2]) {
    const f = fixture(); let count = 0;
    f.api.persist = async (value: any) => {
      assert.equal(value.text, f.editor.state.doc.toString());
      if (++count === failAt) throw new Error('storage unavailable');
    };
    await f.scope.acceptWithoutCompile('c1');
    assert.equal(f.gate.locked, false);
    if (failAt === 1) assert.equal(f.editor.state.doc.toString(), quote);
    else {
      assert.equal(f.editor.state.doc.toString(), 'The allocation is increasing.');
      assert.match(f.states.errors.at(-1), /applied without compiling.*recovery could not be saved/);
      assert(f.scope.doHistory()); assert.equal(f.editor.state.doc.toString(), quote);
    }
  }
});

test('close waits for unchecked acceptance recovery and preserves the visible accepted edit', async () => {
  const f = fixture(), recorded = deferred<void>(); let count = 0;
  f.api.persist = async (value: any) => { f.states.writes.push(structuredClone(value)); if (++count === 2) await recorded.promise; };
  const applying = f.scope.acceptWithoutCompile('c1'); await turns();
  assert.equal(f.editor.state.doc.toString(), 'The allocation is increasing.'); assert(f.gate.locked);
  const closing = f.scope.close(); await turns(); assert(!f.states.events.includes('closed'));
  recorded.resolve(); await Promise.all([applying, closing]);
  assert.equal(f.states.writes.at(-1).text, f.editor.state.doc.toString()); assert.equal(f.states.writes.at(-1).review.comments[0].decision, 'applied');
  assert(f.states.events.includes('closed'));
});

test('a Codex preamble is tested before application; source comments and one-step Undo survive', async () => {
  const f = fixture();
  f.api.generatePreamble = async () => generatedPreamble;
  f.api.compile = async (input: any) => {
    assert.equal(f.editor.state.doc.toString(), quote, 'No untested preamble may enter the editor');
    assert(input.text.includes(quote));
    return { id: 'preamble-pdf', success: true, clean: true };
  };
  await f.scope.addPreambleAndCompile();
  assert.equal(f.states.Build.id, 'preamble-pdf'); assert.equal(f.states.PdfOpen, true);
  const c = f.editor.state.field(stateTools.commentsField)[0];
  assert.equal(f.editor.state.doc.sliceString(c.from, c.to), quote); assert.equal(c.validity, 'current');
  assert.equal(f.states.writes.at(-1).text, f.editor.state.doc.toString());
  assert.equal(f.states.saved, undefined, 'The source file is not implicitly saved');
  assert(f.scope.doHistory()); assert.equal(f.editor.state.doc.toString(), quote);
  assert.equal(f.editor.state.field(stateTools.commentsField)[0].from, 0);
});

test('a failed preamble is corrected once using the real failure log, with neither candidate installed early', async () => {
  const f = fixture(); let calls = 0, builds = 0;
  f.api.generatePreamble = async (request: any) => {
    calls++;
    if (calls === 2) assert.match(request.previousAttempt.log, /missing package/);
    return generatedPreamble;
  };
  f.api.compile = async () => {
    assert.equal(f.editor.state.doc.toString(), quote);
    return ++builds === 1 ? { id: 'bad', success: false, clean: false, log: 'missing package' } : { id: 'good', success: true, clean: true };
  };
  await f.scope.addPreambleAndCompile(); assert.equal(calls, 2); assert.equal(f.states.Build.id, 'good');
});

test('two failed preamble checks or an unknown definition leave source and comments intact', async () => {
  const f = fixture(); let calls = 0;
  f.api.generatePreamble = async () => { calls++; return generatedPreamble; };
  f.api.compile = async () => ({ id: 'bad', success: false, clean: false, log: 'Undefined control sequence' });
  await f.scope.addPreambleAndCompile(); assert.equal(calls, 2); assert.equal(f.editor.state.doc.toString(), quote);
  assert.match(f.states.errors.at(-1), /two attempts/);
  f.api.generatePreamble = async () => ({ preamble: '', ending: '', explanation: '', needsInput: 'What is the original definition of \\payoff?' });
  f.api.compile = async () => { throw new Error('Must not compile an unanswered definition'); };
  await f.scope.addPreambleAndCompile(); assert.match(f.states.errors.at(-1), /original definition/); assert.equal(f.editor.state.doc.toString(), quote);
});

test('typing while Codex prepares a preamble prevents application to the changed source', async () => {
  const f = fixture(), reply = deferred<any>(); f.api.generatePreamble = () => reply.promise;
  const run = f.scope.addPreambleAndCompile(); await turns();
  f.editor.dispatch({ changes: { from: 0, insert: 'New typing. ' } });
  reply.resolve(generatedPreamble); await run;
  assert.equal(f.editor.state.doc.toString(), 'New typing. ' + quote); assert.equal(f.states.Build, undefined);
  assert.match(f.states.errors.at(-1), /source changed/i);
});

test('cancelling or closing during a preamble build cannot apply it or start another model attempt', async () => {
  for (const closing of [false, true]) {
    const f = fixture(), result = deferred<any>(); let calls = 0;
    f.api.generatePreamble = async () => { calls++; return generatedPreamble; };
    f.api.compile = () => result.promise;
    const run = f.scope.addPreambleAndCompile(); await turns();
    const stop = closing ? f.scope.close() : f.scope.cancelPreamble(); await turns();
    result.resolve({ id: 'late', success: true, clean: true }); await Promise.all([run, stop]);
    assert.equal(calls, 1); assert.equal(f.editor.state.doc.toString(), quote); assert.equal(f.states.Build, undefined);
    if (closing) assert(f.states.events.includes('closed'));
  }
});

test('recovery failure after a checked preamble leaves its visible changes undoable', async () => {
  const f = fixture(); let writes = 0;
  f.api.generatePreamble = async () => generatedPreamble;
  f.api.persist = async () => { if (++writes === 2) throw new Error('disk full'); };
  await f.scope.addPreambleAndCompile();
  assert.match(f.states.errors.at(-1), /preamble is applied and undoable/i);
  assert(f.scope.doHistory()); assert.equal(f.editor.state.doc.toString(), quote); assert.equal(f.gate.locked, false);
});

test('returning from comparison does not steal focus from a subsequently selected control', () => {
  const f = fixture(); let focused = false;
  Object.assign(f.editor, { requestMeasure() {}, focus() { focused = true; }, dom: { contains() { return false; } } });
  f.scope.returnToSource(); f.scope.document.activeElement = { label: 'PDF page input' }; f.states.frame(); assert.equal(focused, false);
  f.scope.returnToSource(); f.scope.document.activeElement = f.scope.document.body; f.states.frame(); assert.equal(focused, true);
});
