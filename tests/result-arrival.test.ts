import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Transaction } from '@codemirror/state';
import { undo } from '@codemirror/commands';
import { commentSchema, type BufferInput, type WaitingResult } from '../src/shared/contracts.ts';
import { captureContext } from '../src/shared/review.ts';
import { mergeResult } from '../src/shared/result-arrival.ts';
import { proposalChanges } from '../src/shared/review.ts';
import { ResultInbox } from '../src/renderer/result-inbox.ts';
import { initialState, commentsField, loadComments, applyProposal, patchComments } from '../src/renderer/editor-state.ts';
import { WorkGate } from '../src/renderer/work-gate.ts';
import { ProjectService } from '../src/main/project-service.ts';
import { ReviewResults } from '../src/main/review-results.ts';
import { digest } from '../src/main/files.ts';

const source = 'A first claim.\nA second claim.';
const comment = (id: string, original = 'A first claim.') => captureContext(source, commentSchema.parse({ id, title: 'Clarify', explanation: 'Clarify claim.', original, replacement: 'A precise claim.', from: source.indexOf(original), to: source.indexOf(original) + original.length, validity: 'current' }));
const result = (comments = [comment('new')]): Extract<WaitingResult, { kind: 'review' }> => ({ schemaVersion: 1, id: randomUUID(), kind: 'review', rootFile: 'main.tex', sourceHash: digest(source), createdAt: new Date().toISOString(), comments });
const defer = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
function fixture(autoAddComments?: () => boolean) {
  let state = initialState(source, [comment('old')]);
  const ready: { id: string; mode: string }[] = []; let canDiscuss = true;
  let stored: WaitingResult[] = [result()], shown: WaitingResult[] = [], errors: unknown[] = [], saved: BufferInput[] = [];
  const gate = new WorkGate(); let failPersist = false, failAfter: number | null = null, hold: Promise<void> | null = null, flushHold: Promise<void> | null = null;
  const input = (): BufferInput => ({ projectId: 'p', text: state.doc.toString(), review: { schemaVersion: 1, rootFile: 'main.tex', sourceHash: '', activeId: 'old', comments: state.field(commentsField), updatedAt: '' } });
  const inbox = new ResultInbox({ input, autoAddComments,
    ready: async (id, mode) => { ready.push({ id, mode }); },
    canAct: c => { if (c.replacement === null) return canDiscuss; try { proposalChanges(input().text, c); return true; } catch { return false; } }, locked: () => gate.locked, begin: () => gate.begin('results'),
    api: { waitingResults: async () => { if (hold) await hold; return { items: stored, notices: [] }; }, acknowledgeResult: async ({ resultId }) => { assert(saved.length, 'must persist before ack'); stored = stored.filter(item => item.id !== resultId); } },
    install: comments => { state = state.update({ effects: loadComments.of(comments), annotations: Transaction.addToHistory.of(false) }).state; },
    flush: async () => { if (failPersist || saved.length === failAfter) throw new Error('Disk full'); if (flushHold) await flushHold; saved.push(input()); },
    changed: items => { shown = items; }, error: e => { errors.push(e); } });
  return { inbox, gate, input, ready, discussion: (v: boolean) => { canDiscuss = v; }, dispatch: (tr: any) => { state = state.update(tr).state; }, get state() { return state; }, get shown() { return shown; }, get errors() { return errors; }, get stored() { return stored; }, setStored: (value: WaitingResult[]) => { stored = value; }, fail: (v: boolean) => { failPersist = v; }, failAfter: (v: number | null) => { failAfter = v; }, hold: (v: Promise<void>) => { hold = v; }, holdFlush: (v: Promise<void>) => { flushHold = v; } };
}
test('explicit Side Chat suggestions arrive with continuous reviews off and retain changed-source protections', async () => {
  const f = fixture(() => false), ordinary = result([comment('ordinary')]), quick = { ...result([comment('quick', 'A second claim.')]), delivery: 'side-chat-suggest' as const };
  f.dispatch({ selection: { anchor: source.length } });
  f.dispatch({ effects: patchComments.of([{ id: 'old', fields: { decision: 'dismissed', draft: 'My wording' } }]) });
  f.dispatch({ changes: { from: source.indexOf('second'), insert: 'different ' } });
  const text = f.input().text, selection = f.state.selection.main.head;
  f.setStored([ordinary, quick]); await f.inbox.refresh();
  assert.equal(f.input().text, text); assert.equal(f.state.selection.main.head, selection);
  assert.equal(f.input().review.activeId, 'old'); assert.equal(f.input().review.comments[0].decision, 'dismissed');
  assert.equal(f.input().review.comments[0].draft, 'My wording');
  assert.equal(f.input().review.comments[1].id, 'quick'); assert.notEqual(f.input().review.comments[1].validity, 'current');
  assert.deepEqual(f.stored.map(r => r.id), [ordinary.id]);
});
test('result arrival preserves active selection, edited proposal, decisions and Undo', async () => {
  const f = fixture(); f.dispatch({ selection: { anchor: source.length } });
  f.dispatch({ effects: patchComments.of([{ id: 'old', fields: { draft: 'My prose' } }]) });
  f.dispatch(applyProposal(f.state, 'old'));
  await f.inbox.refresh(); assert.equal(f.shown.length, 1, 'older source waits');
  await f.inbox.handle(f.shown[0].id, 'adopted');
  assert.equal(f.input().review.activeId, 'old'); assert.equal(f.state.selection.main.head, f.state.doc.length);
  assert.equal(f.state.field(commentsField)[0].draft, 'My prose'); assert.equal(f.state.field(commentsField)[0].decision, 'applied');
  assert(undo({ state: f.state, dispatch: (tr: any) => f.dispatch(tr) }));
  assert.equal(f.state.doc.toString(), source); assert.equal(f.state.field(commentsField).length, 2);
  assert.equal(f.state.field(commentsField)[0].decision, 'open');
});
test('a result arriving during Save waits and delivers after the barrier', async () => {
  const f = fixture(), fetching = defer(), saving = defer(); f.hold(fetching.promise);
  const refresh = f.inbox.refresh(), save = f.gate.commit(() => saving.promise);
  fetching.resolve(); await refresh; assert.equal(f.state.field(commentsField).length, 1); assert.equal(f.shown.length, 1);
  saving.resolve(); await save; await f.inbox.refresh();
  assert.equal(f.state.field(commentsField).length, 2); assert.equal(f.shown.length, 0);
});
test('typing during retrieval keeps results waiting and changed context stays unconfirmed', async () => {
  const f = fixture(), fetching = defer(); f.hold(fetching.promise);
  const refresh = f.inbox.refresh(); f.dispatch({ changes: { from: 0, insert: 'Changed context. ' } }); fetching.resolve(); await refresh;
  assert.equal(f.state.field(commentsField).length, 1); await f.inbox.handle(f.shown[0].id, 'adopted');
  // Prefix context at the beginning is empty, but unchanged suffix disambiguates.
  assert.equal(f.state.field(commentsField).length, 2); assert.match(f.state.doc.toString(), /^Changed context/);
  const moved = mergeResult('A first claim. Completely changed context', [], result(), false)[0]; assert.equal(moved.validity, 'unconfirmed');
});
test('failed recovery leaves an idempotent result; retry never restores an old draft or decision', async () => {
  const f = fixture(); f.fail(true); await f.inbox.refresh();
  assert.equal(f.errors.length, 1); assert.equal(f.stored.length, 1); assert.equal(f.state.field(commentsField).length, 2);
  f.dispatch({ effects: patchComments.of([{ id: 'new', fields: { draft: 'Edited after arrival', decision: 'dismissed' } }]) });
  f.fail(false); await f.inbox.refresh();
  assert.equal(f.state.field(commentsField).length, 2); assert.equal(f.state.field(commentsField)[1].draft, 'Edited after arrival'); assert.equal(f.state.field(commentsField)[1].decision, 'dismissed'); assert.equal(f.stored.length, 0);
});
test('reply adoption appends an alternative once, preserving ongoing notes and manual replacement', () => {
  const c = { ...comment('old'), draft: 'Manual proposal', replyDraft: 'Next question' };
  const r: WaitingResult = { ...result(), kind: 'reply', commentId: c.id, original: c.original, answer: { reply: 'Explanation', replacement: 'Alternative', packages: [] } };
  const once = mergeResult(source, [c], r, true), twice = mergeResult(source, once, r, true);
  assert.equal(twice[0].messages.length, 1); assert.equal(twice[0].draft, c.draft); assert.equal(twice[0].replyDraft, c.replyDraft);
  assert.equal(twice[0].replacement, c.replacement); assert.equal(twice[0].messages[0].resultId, r.id);
  assert.throws(() => mergeResult(source, [], r, true), /no longer available/);
  assert.notEqual(mergeResult(source, [], result([{ ...comment('bad'), validity: 'missing' }]), false)[0].validity, 'current');
});
test('closing during inbox retrieval leaves results retained and installs nothing', async () => {
  const f = fixture(), fetched = defer(); f.hold(fetched.promise); const refresh = f.inbox.refresh(); let closed = false;
  const close = f.gate.close(async () => {}, async () => {}, async () => { closed = true; });
  fetched.resolve(); await Promise.all([refresh, close]); assert(closed); assert.equal(f.state.field(commentsField).length, 1); assert.equal(f.stored.length, 1);
});
test('completed result store survives reopening, binds roots and receipts, and preserves original bytes', async () => {
  const root = path.resolve('.test-runs', 'inbox-' + randomUUID()); await fs.mkdir(root, { recursive: true });
  const file = path.join(root, 'main.tex'); await fs.writeFile(file, source);
  const projects = new ProjectService(path.join(root, 'runtime')); const p = await projects.open(file), results = new ReviewResults(projects), r = result();
  await results.retain(p.id, r); await assert.rejects(results.retain(p.id, r), /already exists/);
  await assert.rejects(results.retain(p.id, { ...r, id: randomUUID(), rootFile: 'other.tex' }), /another document/);
  const reopened = await new ProjectService(path.join(root, 'runtime2')).open(file); assert.equal(reopened.text, source);
  assert.equal((await results.list(p.id)).items[0].id, r.id);
  const dir = path.join(await projects.stateDirectory(p.id), 'reviews'), raw = await fs.readFile(path.join(dir, `result-${r.id}.json`));
  await results.acknowledge(p.id, r.id, 'adopted'); assert.equal((await results.list(p.id)).items.length, 0);
  assert.deepEqual(await fs.readFile(path.join(dir, `result-${r.id}.json`)), raw); assert.equal(await fs.readFile(file, 'utf8'), source);
});
test('a second arrival during manual adoption is fetched automatically when that adoption settles', async () => {
  const f = fixture(), flush = defer(); f.dispatch({ changes: { from: source.length, insert: '\nNew context' } });
  await f.inbox.refresh(); const old = f.shown[0]; f.holdFlush(flush.promise);
  const adoption = f.inbox.handle(old.id, 'adopted');
  for (let i = 0; i < 100 && f.state.field(commentsField).length === 1; i++) await new Promise(resolve => setTimeout(resolve, 2));
  assert.equal(f.state.field(commentsField).length, 2);
  const incoming = { ...result([comment('second-arrival')]), sourceHash: digest(f.input().text) };
  f.setStored([...f.stored, incoming]); await f.inbox.refresh(); flush.resolve(); await adoption;
  for (let i = 0; i < 100 && f.stored.length; i++) await new Promise(resolve => setTimeout(resolve, 2));
  assert.equal(f.state.field(commentsField).length, 3); assert.equal(f.stored.length, 0); assert.equal(f.shown.length, 0);
});

test('Add comments when ready appends to a changed draft while preserving old decisions and selection', async () => {
  const f=fixture(), incoming=result([comment('ready','A second claim.')]);
  assert.equal(incoming.kind,'review');
  f.setStored([{...incoming,autoAddComments:true} as WaitingResult]);
  f.dispatch({selection:{anchor:source.length}});
  f.dispatch({effects:patchComments.of([{id:'old',fields:{draft:'My own wording'}}])});
  f.dispatch(applyProposal(f.state,'old'));
  const text=f.state.doc.toString(), cursor=f.state.selection.main.head;
  await f.inbox.refresh();
  assert.equal(f.shown.length,0);assert.equal(f.stored.length,0);
  assert.equal(f.state.doc.toString(),text);assert.equal(f.input().review.activeId,'old');
  assert.equal(f.state.selection.main.head,cursor);
  assert.equal(f.state.field(commentsField)[0].decision,'applied');
  assert.equal(f.state.field(commentsField)[0].draft,'My own wording');
  assert.equal(f.state.field(commentsField)[1].id,'ready');
});

test('disabled automatic inclusion keeps even a fresh result waiting, while stale uncertain matches never become applicable', async () => {
  const f=fixture();f.setStored([{...result(),autoAddComments:false} as WaitingResult]);
  await f.inbox.refresh();assert.equal(f.shown.length,1);assert.equal(f.state.field(commentsField).length,1);
  await f.inbox.handle(f.shown[0].id,'adopted');assert.equal(f.state.field(commentsField).length,2);
  const other=fixture();other.dispatch({changes:{from:0,to:source.length,insert:'The earlier passage is gone.'}});
  other.setStored([{...result(),autoAddComments:true} as WaitingResult]);
  await other.inbox.refresh();assert.equal(other.state.field(commentsField).length,2);
  assert.notEqual(other.state.field(commentsField)[1].validity,'current');
  assert.equal(other.state.doc.toString(),'The earlier passage is gone.');
});

test('Add all imports review batches once, preserves editing and leaves discussion answers waiting', async () => {
  const f = fixture();
  f.dispatch({ selection: { anchor: source.length }, effects: patchComments.of([{ id: 'old', fields: { draft: 'My wording', decision: 'dismissed' } }]) });
  f.dispatch({ changes: { from: 0, insert: 'New introduction. ' } });
  const text = f.input().text, cursor = f.state.selection.main.head;
  const pending = (comments: ReturnType<typeof comment>[]) => ({ ...result(comments), autoAddComments: false } as WaitingResult);
  const reply: WaitingResult = { ...result(), kind: 'reply', commentId: 'old', original: 'A first claim.', answer: { reply: 'Discuss separately.', replacement: null, packages: [] } };
  f.setStored([pending([comment('one', 'A second claim.')]), pending([]), pending([comment('one', 'A second claim.'), comment('two', 'A second claim.')]), reply]);
  await f.inbox.refresh(); assert.equal(f.shown.length, 4);
  await f.inbox.addAllComments();
  assert.equal(f.input().text, text); assert.equal(f.state.selection.main.head, cursor);
  assert.equal(f.input().review.activeId, 'old');
  assert.deepEqual(f.input().review.comments.map(c => c.id), ['old', 'one', 'two']);
  assert.equal(f.input().review.comments[0].draft, 'My wording');
  assert.equal(f.input().review.comments[0].decision, 'dismissed');
  assert.deepEqual(f.shown.map(item => item.id), [reply.id]);
  assert.deepEqual(f.stored.map(item => item.id), [reply.id]);
  await f.inbox.addAllComments(); assert.equal(f.input().review.comments.length, 3);
});

test('Add all stops on failed persistence, keeps remaining results and retries without replacing edits', async () => {
  const f = fixture();
  f.setStored(['one', 'two', 'three'].map(id => ({ ...result([comment(id, 'A second claim.')]), autoAddComments: false }) as WaitingResult));
  await f.inbox.refresh(); f.failAfter(1);
  await f.inbox.addAllComments();
  assert.equal(f.errors.length, 1); assert.equal(f.stored.length, 2); assert.equal(f.shown.length, 2);
  assert.deepEqual(f.input().review.comments.map(c => c.id), ['old', 'one', 'two']);
  f.dispatch({ effects: patchComments.of([{ id: 'two', fields: { draft: 'Edited after failure' } }]) });
  f.failAfter(null); await f.inbox.addAllComments();
  assert.equal(f.stored.length, 0); assert.equal(f.shown.length, 0);
  assert.deepEqual(f.input().review.comments.map(c => c.id), ['old', 'one', 'two', 'three']);
  assert.equal(f.input().review.comments[2].draft, 'Edited after failure');
  assert.equal(f.input().text, source);
});

test('Add all stops between results when closing starts and never clears uncertain anchors', async () => {
  const f = fixture(), flush = defer();
  f.setStored(['one', 'two'].map(id => ({ ...result([comment(id)]), autoAddComments: false }) as WaitingResult));
  f.dispatch({ changes: { from: 0, to: source.length, insert: 'Completely different passage.' } });
  await f.inbox.refresh(); f.holdFlush(flush.promise);
  const adding = f.inbox.addAllComments();
  for (let i = 0; i < 100 && f.input().review.comments.length === 1; i++) await new Promise(resolve => setTimeout(resolve, 2));
  assert.equal(f.input().review.comments.length, 2);
  const closing = f.gate.close(async () => {}, async () => {}, async () => {});
  flush.resolve(); await Promise.all([adding, closing]);
  assert.equal(f.stored.length, 1); assert.equal(f.shown.length, 1);
  assert.notEqual(f.input().review.comments[1].validity, 'current');
  assert.equal(f.input().text, 'Completely different passage.');
});


test('usable timing waits for persistence and controls, excludes withheld and uncertain edits, preserves one origin', async () => {
  const f = fixture(), originRequestId = randomUUID();
  const early = { ...result([comment('early')]), originRequestId, autoAddComments: true };
  f.setStored([early]); f.fail(true); await f.inbox.refresh(); assert.deepEqual(f.ready, []);
  f.fail(false); await f.inbox.refresh(); assert.deepEqual(f.ready, [{ id: originRequestId, mode: 'automatic' }]);
  f.setStored([{ ...result([comment('late', 'A second claim.')]), originRequestId }]);
  await f.inbox.refresh(); assert.equal(f.ready.length, 1);
  assert.equal(f.input().review.activeId, 'old'); assert.equal(f.input().text, source);

  const q = fixture(); q.discussion(false);
  const id = randomUUID(), question = { ...comment('question'), original: '', replacement: null, validity: 'missing' as const };
  q.setStored([{ ...result([question]), originRequestId: id }]); await q.inbox.refresh(); assert.equal(q.ready.length, 0);
  q.discussion(true); q.inbox.checkReady(); assert.deepEqual(q.ready, [{ id, mode: 'automatic' }]);

  const rejected = fixture();
  rejected.dispatch({ effects: patchComments.of([{ id: 'old', fields: { decision: 'dismissed' } }]) });
  rejected.setStored([{ ...result([comment('repeat')]), originRequestId: randomUUID() }]); await rejected.inbox.refresh();
  assert.deepEqual(rejected.ready, []);
  rejected.setStored([{ ...result([{ ...comment('uncertain'), validity: 'unconfirmed' }]), originRequestId: randomUUID() }]);
  await rejected.inbox.refresh(); assert.deepEqual(rejected.ready, []);

  const manual = fixture(() => false), final = { ...result(), originRequestId: randomUUID() };
  manual.setStored([final]); await manual.inbox.refresh(); assert.deepEqual(manual.ready, []);
  await manual.inbox.handle(final.id, 'adopted'); assert.deepEqual(manual.ready, [{ id: final.originRequestId, mode: 'manual' }]);
  manual.setStored([final]); await manual.inbox.handle(final.id, 'adopted'); assert.equal(manual.ready.length, 1);
});

test('retrying one request adds only its retained batches and leaves other reviews waiting', async () => {
  const f = fixture(() => false), requestId = randomUUID();
  const one = { ...result([comment('one')]), originRequestId: requestId };
  const unrelated = { ...result([comment('other')]), originRequestId: randomUUID() };
  f.setStored([one, unrelated]); await f.inbox.refresh();
  f.fail(true); await f.inbox.addAllComments([requestId]);
  assert.equal(f.stored.length, 2);
  f.dispatch({ effects: patchComments.of([{ id: 'one', fields: { draft: 'Author wording', decision: 'dismissed' } }]) });
  f.fail(false); await f.inbox.addAllComments([requestId]);
  assert.deepEqual(f.stored.map(r => r.id), [unrelated.id]);
  const kept = f.input().review.comments.filter(c => c.id === 'one');
  assert.equal(kept.length, 1); assert.equal(kept[0].draft, 'Author wording'); assert.equal(kept[0].decision, 'dismissed');
  assert(!f.input().review.comments.some(c => c.id === 'other'));
  assert.equal(f.input().text, source);
});
