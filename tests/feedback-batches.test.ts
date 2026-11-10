import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ProjectService } from '../src/main/project-service.ts';
import { ReferenceService } from '../src/main/reference-service.ts';
import { AttachmentService } from '../src/main/attachment-service.ts';
import { CodexService } from '../src/main/codex-service.ts';
import { splitFeedback, feedbackBatchContext } from '../src/shared/feedback-batches.ts';
import { feedbackComments, feedbackDelivery, feedbackRecordSchema } from '../src/shared/feedback.ts';
import { commentSchema } from '../src/shared/contracts.ts';
import { captureContext } from '../src/shared/review.ts';

const source = 'A unique quotation.\nRepeated. Repeated.\n';
function response(prompt: string) {
  const payload = JSON.parse(prompt);
  return { items: payload.items.map((item: any) => ({ itemId: item.itemId, comments: [{
    category:'Clarity', title:'Consider this point', explanation:'Inspect issue ' + item.originalNumber,
    original:item.originalNumber === '2' ? 'Repeated.' : item.originalNumber === '3' ? 'Absent quotation.' : 'A unique quotation.',
    replacement:null, before:'', after:'', packages:[]
  }] })) };
}
async function fixture(t: TestContext) {
  const root = path.resolve('.test-runs', 'feedback-batches-' + randomUUID());
  await fs.mkdir(root, { recursive:true }); t.after(() => fs.rm(root, { recursive:true, force:true }));
  const file = path.join(root,'main.tex'); await fs.writeFile(file, source);
  const runtime = path.join(root,'runtime'), projects = new ProjectService(runtime), paper = await projects.open(file);
  const attachments = new AttachmentService({ pdfModulePath:fileURLToPath(new URL('../node_modules/pdfjs-dist/legacy/build/pdf.mjs',import.meta.url)) });
  const references = new ReferenceService(projects,path.join(runtime,'references'),attachments);
  const service = new CodexService(projects,path.join(root,'codex'),attachments,references);
  return { root,file,runtime,projects,paper,references,service };
}
const review = (n: number) => '\uFEFFReview introduction.\r\n\r\n' + Array.from({length:n},(_,i)=>(i+1)+'. Please inspect issue '+(i+1)+'.  \r\n\r\n').join('');

test('each batch reads fresh decisions while retaining prepared guidance and source', async t => {
  const f = await fixture(t);
  await f.projects.setPaperGuidance(f.paper.id, 'Prepared guidance.', { localEditsOnly: true, preserveVoice: true });
  const saved = await f.service.prepareFeedback({ projectId: f.paper.id, text: source, label: 'Trial', feedback: review(11) });
  await f.projects.setPaperGuidance(f.paper.id, 'Changed guidance.', { localEditsOnly: false, preserveVoice: false });
  const old = captureContext(source, commentSchema.parse({ id: 'old', title: 'Earlier decision', explanation: '', original: 'A unique quotation.',
    replacement: 'An exact quotation.', from: 0, to: 'A unique quotation.'.length, validity: 'current', decision: 'dismissed', rejectionReason: 'Reason after preparation.' }));
  const persist = async (comments: typeof old[]) => f.projects.persist({ projectId: f.paper.id, text: source, review: { ...f.projects.get(f.paper.id).review, comments } });
  await persist([old]);
  let calls = 0;
  const during = { ...old, id: 'during', replacement: 'A precise quotation.', rejectionReason: 'Rejected during generation.' };
  f.service.client.run = async (prompt, _schema, _progress, _effort, _fast, reader) => {
    calls++; assert(reader);
    const read = async (fileId: string) => (await reader.call('references_read', { fileId }) as any).excerpts[0].text;
    assert.equal(await read('current-draft'), source);
    assert.match(await read('paper-instructions'), /Prepared guidance/);
    assert.doesNotMatch(await read('paper-instructions'), /Changed guidance/);
    const decisions = await read('review-decisions');
    if (calls === 1) {
      assert.match(decisions, /Reason after preparation/);
      assert.doesNotMatch(decisions, /Rejected during generation/);
      await persist([{ ...old, decision: 'open' }, during]);
    } else {
      assert.match(decisions, /Rejected during generation/);
      assert.match(decisions, /Decision: open/);
    }
    const output = response(prompt);
    for (const item of output.items) item.comments = [{ ...item.comments[0], original: old.original, replacement: during.replacement }];
    return output;
  };
  const first = await f.service.resumeFeedback({ projectId: f.paper.id, id: saved.id, all: false }, () => {});
  assert.equal(feedbackComments(first, source, f.projects.get(f.paper.id).review.comments).length, 0, 'intake sees rejection during generation');
  const done = await f.service.resumeFeedback({ projectId: f.paper.id, id: saved.id, all: true }, () => {});
  assert.equal(calls, 2); assert.equal(done.comments.length, 11);
  await persist([{ ...old, decision: 'open' }, { ...during, decision: 'open' }]);
  assert.equal(feedbackComments(done, source, f.projects.get(f.paper.id).review.comments).length, 11);
});

test('feedback outcomes separate saved items, membership, rejected repeats and questions', async t => {
  const f = await fixture(t), saved = await f.service.prepareFeedback({ projectId: f.paper.id, text: source, label: 'Four items', feedback: review(4) });
  f.service.client.run = async prompt => {
    const output = response(prompt);
    output.items.forEach((item: any, i: number) => {
      item.comments = [{ ...item.comments[0], original: i === 3 ? '' : 'A unique quotation.', replacement: i === 3 ? null : ['Grammar.', 'Rejected wording.', 'Different wording.'][i] }];
    });
    return output;
  };
  const record = await f.service.resumeFeedback({ projectId: f.paper.id, id: saved.id, all: true }, () => {});
  const old = { ...record.comments[1], id: 'prior', decision: 'dismissed' as const };
  const offered = feedbackComments(record, source, [old]);
  assert.equal(offered.length, 3); assert.equal(offered[2].replacement, null);
  const added = [old, ...offered.map(c => ({ ...c, draft: c.replacement === null ? undefined : 'Author draft.' }))];
  assert.deepEqual(feedbackDelivery(record, source, added).map(e => e.status), ['in-comments', 'rejected', 'in-comments', 'in-comments']);
  assert.equal(feedbackComments(record, source, added).length, 0);
  assert.equal(feedbackDelivery(record, source, added)[0].current?.draft, 'Author draft.');
  assert.equal(feedbackDelivery(record, source, added)[1].rejection?.id, 'prior');
  const rejected = added.map(c => c.id === record.comments[0].id ? { ...c, decision: 'dismissed' as const, rejectionReason: 'Keep this.' } : c);
  assert.equal(feedbackDelivery(record, source, rejected)[0].current?.rejectionReason, 'Keep this.');
  assert.equal(feedbackDelivery(record, source, added.map(c => c.id === offered[0].id ? { ...c, decision: 'dismissed' } : c))[0].status, 'in-comments');
  assert.equal(feedbackComments(record, source, added.map(c => c.id === 'prior' ? { ...c, decision: 'open' } : c)).length, 1);
  assert.equal(feedbackComments(record, source, [old]).length, 3, 'Undo import restores availability');
  const two = { ...record, plan: { ...record.plan!, items: record.plan!.items.map((item, i) => i === 0 ? { ...item, commentIds: [record.comments[0].id, record.comments[1].id] } : item).filter((_item, i) => i !== 1) } };
  assert.equal(feedbackRecordSchema.parse(two).plan!.items.length, 3);
  assert.equal(feedbackDelivery(two, source, added).length, 4, 'item and comment counts remain distinct');
  assert.equal(await fs.readFile(f.file, 'utf8'), source);
});

test('numbered Markdown and JSON retain original numbers, introduction and fenced source blocks', () => {
  const raw = 'Intro\r\n7. First\r\n\x60\x60\x60tex\n1. Not another item\n\x60\x60\x60\n## **9.** Second\n';
  const plan = splitFeedback(raw);
  assert.equal(plan.items.length,2); assert.equal(plan.items[0].number,'7'); assert.equal(plan.items[1].number,'9');
  assert.equal(plan.introduction + plan.items.map(item=>item.text).join(''),raw);
  const nested = '1. Main concern\n   1. First subpoint\n   2. Second subpoint\n2. Next concern\n';
  assert.deepEqual(splitFeedback(nested).items.map(item=>item.number),['1','2']);
  assert.equal(splitFeedback(nested).items.map(item=>item.text).join(''),nested);
  const json = splitFeedback(JSON.stringify({document:'paper',comments:[{number:'Q1',comment:'first'},{id:39,comment:'second'}]}));
  assert.deepEqual(json.items.map(i=>i.number),['Q1','39']); assert.match(json.introduction,/paper/);
  assert.throws(()=>splitFeedback('[broken JSON'),/valid JSON/);
  assert.throws(()=>splitFeedback('1. '+ 'x'.repeat(60001)),/no text has been truncated/);
  assert.throws(()=>splitFeedback('😀'.repeat(600000)),/2 MB|too big|maximum/i);
});

test('46 review items are saved in batches, source and guidance remain captured, duplicate-looking numbered advice survives', async t => {
  const f = await fixture(t); let calls = 0;
  await f.projects.setPaperGuidance(f.paper.id,'Keep notation.',{localEditsOnly:true,preserveVoice:true});
  const raw=review(46);
  const saved = await f.service.prepareFeedback({projectId:f.paper.id,text:source,label:'Trial review',feedback:raw});
  assert.equal(calls,0); assert.equal(saved.plan!.items.length,46); assert.equal(saved.feedback,raw);
  await f.projects.setPaperGuidance(f.paper.id,'New instructions.',{localEditsOnly:false,preserveVoice:false});
  f.service.client.run = async (prompt, _schema, _progress, _effort, _fast, reader) => {
    calls++; const payload=JSON.parse(prompt);
    assert.equal(payload.paper, undefined); assert(!prompt.includes('Keep notation.')); assert(reader);
    assert.equal((await reader.call('references_read', { fileId: 'current-draft' }) as any).excerpts[0].text, source);
    const guidance = (await reader.call('references_read', { fileId: 'paper-instructions' }) as any).excerpts[0].text;
    assert.match(guidance, /Keep notation/); assert.doesNotMatch(guidance, /New instructions/);
    assert.match((await reader.call('references_read', { fileId: 'outside-feedback' }) as any).excerpts[0].text, /Please inspect issue/);
    const durable=await f.service.feedback.get(f.paper.id,saved.id);
    assert.equal(durable.comments.length,(calls-1)*10);
    return response(prompt);
  };
  const finished=await f.service.resumeFeedback({projectId:f.paper.id,id:saved.id,all:true},()=>{});
  assert.equal(calls,5); assert.equal(finished.status,'complete'); assert.equal(finished.comments.length,46);
  assert(finished.plan!.items.every(item=>item.complete && item.commentIds.length===1));
  assert.equal(finished.comments[1].validity,'ambiguous'); assert.equal(finished.comments[2].validity,'missing');
  assert.match(finished.comments[45].title,/^\[46\]/);
  assert.equal(feedbackComments(finished,source,finished.comments.slice(0,10)).length,36);
  assert.equal(feedbackComments(finished,source,finished.comments).length,0);
  assert.equal(feedbackComments(finished,'New. '+source,[])[0].validity,'unconfirmed');
  assert.equal(await fs.readFile(f.file,'utf8'),source);
  const reopenedProjects=new ProjectService(f.runtime); const reopened=await reopenedProjects.open(f.file);
  const reopenedService=new CodexService(reopenedProjects,path.join(f.root,'codex'));
  assert.deepEqual(await reopenedService.feedback.get(reopened.id,saved.id),finished);
  f.service.client.run=async()=>{throw Error('Completed review must not call Codex again');};
  assert.deepEqual(await f.service.resumeFeedback({projectId:f.paper.id,id:saved.id,all:true},()=>{}),finished);
});

test('a missing item fails just its batch; resumption keeps prior IDs and imports partial results', async t => {
  const f=await fixture(t), saved=await f.service.prepareFeedback({projectId:f.paper.id,text:source,label:'Trial',feedback:review(35)});
  let calls=0;
  f.service.client.run=async prompt=>{calls++; const result=response(prompt); if(calls===2)result.items.pop(); return result;};
  await assert.rejects(f.service.resumeFeedback({projectId:f.paper.id,id:saved.id,all:true},()=>{}),/every requested feedback item/);
  const partial=await f.service.feedback.get(f.paper.id,saved.id);
  assert.equal(partial.status,'failed'); assert.equal(partial.comments.length,10);
  assert.equal(feedbackComments(partial,source,[]).length,10);
  f.service.client.run=async prompt=>{calls++;return response(prompt);};
  const done=await f.service.resumeFeedback({projectId:f.paper.id,id:saved.id,all:true},()=>{});
  assert.equal(calls,5); assert.deepEqual(done.comments.slice(0,10),partial.comments); assert.equal(done.comments.length,35);
  assert.equal(done.error,''); assert.equal(done.feedback,saved.feedback);
});

for (const committed of [false, true]) test('batch storage failure never overwrites the last on-disk record, committed: ' + committed, async t => {
  const f = await fixture(t), saved = await f.service.prepareFeedback({ projectId: f.paper.id, text: source, label: 'Trial', feedback: review(1) });
  f.service.client.run = async prompt => response(prompt);
  const save = f.service.feedback.save.bind(f.service.feedback); let writes = 0;
  f.service.feedback.save = async (...args) => {
    writes++; if (committed) await save(...args);
    throw Error('Injected storage sync failure');
  };
  await assert.rejects(f.service.resumeFeedback({ projectId: f.paper.id, id: saved.id, all: true }, () => {}), /storage sync failure/);
  assert.equal(writes, 1, 'Do not write an older snapshot after a failed save');
  const durable = await f.service.feedback.get(f.paper.id, saved.id);
  assert.equal(durable.comments.length, committed ? 1 : 0);
  assert.equal(durable.plan!.items[0].complete, committed);
  f.service.feedback.save = save;
  if (committed) f.service.client.run = async () => { throw Error('The committed batch must not run again'); };
  const resumed = await f.service.resumeFeedback({ projectId: f.paper.id, id: saved.id, all: true }, () => {});
  assert.equal(resumed.comments.length, 1); assert.equal(resumed.status, 'complete');
  assert.equal(await fs.readFile(f.file, 'utf8'), source);
});

test('legacy feedback preserves a completed result when final storage reports a post-commit error', async t => {
  const f = await fixture(t), save = f.service.feedback.save.bind(f.service.feedback); let writes = 0, id = '';
  f.service.client.run = async () => ({ comments: [{ title: 'Inspect the quotation', explanation: 'Please clarify it.', original: 'A unique quotation.', replacement: null }] });
  f.service.feedback.save = async (...args) => {
    writes++; id = args[1].id; const result = await save(...args);
    if (writes === 2) throw Error('Injected storage sync failure');
    return result;
  };
  await assert.rejects(f.service.convertFeedback({ projectId: f.paper.id, text: source, label: 'Trial', feedback: 'Inspect the quotation.' }, () => {}), /storage sync failure/);
  assert.equal(writes, 2);
  const durable = await f.service.feedback.get(f.paper.id, id);
  assert.equal(durable.status, 'complete'); assert.equal(durable.comments.length, 1);
  assert.equal(await fs.readFile(f.file, 'utf8'), source);
});

test('cancellation rejects late output, preserves completed batches and permits resume after settling', async t => {
  const f=await fixture(t), saved=await f.service.prepareFeedback({projectId:f.paper.id,text:source,label:'Trial',feedback:review(24)});
  let entered!:()=>void, release!:()=>void;
  const waiting=new Promise<void>(done=>entered=done), hold=new Promise<void>(done=>release=done);
  let calls=0;
  f.service.client.run=async prompt=>{calls++; if(calls===2){entered();await hold;}return response(prompt);};
  const running=f.service.resumeFeedback({projectId:f.paper.id,id:saved.id,all:true},()=>{});
  const outcome=running.then(()=>null,error=>error);
  await waiting;
  await assert.rejects(f.service.resumeFeedback({projectId:f.paper.id,id:saved.id,all:true},()=>{}),/already running/);
  await f.service.cancel(); release(); assert.match(String(await outcome),/paused/); await f.service.settle();
  const partial=await f.service.feedback.get(f.paper.id,saved.id);
  assert.equal(partial.status,'paused'); assert.equal(partial.comments.length,10);
  f.service.client.run=async prompt=>response(prompt);
  const done=await f.service.resumeFeedback({projectId:f.paper.id,id:saved.id,all:true},()=>{});
  assert.equal(done.comments.length,24); assert.deepEqual(done.comments.slice(0,10),partial.comments);
});

test('saved context conversion reads exact large text through paper-scoped identity and survives context removal', async t => {
  const f=await fixture(t), raw=Array.from({length:41},(_,i)=>(i+1)+'. '+('A review observation. '.repeat(100))+'\r\n').join('');
  assert(raw.length>60000);
  const state=await f.references.paste(f.paper.id,{name:'Long review',text:raw});
  const contextId=state.roots[0].id;
  await f.references.change(f.paper.id,contextId,false);
  const saved=await f.service.prepareFeedback({projectId:f.paper.id,text:source,contextId});
  assert.equal(saved.feedback,raw); assert.equal(saved.label,'Long review'); assert.equal(saved.plan!.items.length,41);
  await f.references.change(f.paper.id,contextId,null);
  f.service.client.run=async prompt=>response(prompt);
  const one=await f.service.resumeFeedback({projectId:f.paper.id,id:saved.id,all:false},()=>{});
  assert.equal(one.comments.length,10); assert.equal(one.status,'paused');
  assert.equal(feedbackBatchContext(one).items[0].originalNumber,'11');
  await assert.rejects(f.service.prepareFeedback({projectId:f.paper.id,text:source,contextId}),/context|reference|available/i);
  const other=path.join(f.root,'other.tex'); await fs.writeFile(other,source); const p=await f.projects.open(other);
  await assert.rejects(f.service.feedback.get(p.id,saved.id),/identified/);
  assert.equal(await fs.readFile(f.file,'utf8'),source);
});

test('corrupt batch accounting is rejected and legacy complete records still parse', async t => {
  const f=await fixture(t), saved=await f.service.prepareFeedback({projectId:f.paper.id,text:source,label:'Trial',feedback:review(2)});
  assert.throws(()=>feedbackRecordSchema.parse({...saved,status:'complete'}),/accounting/);
  assert.throws(()=>feedbackRecordSchema.parse({...saved,plan:{...saved.plan,items:[saved.plan!.items[0],saved.plan!.items[0]]}}),/accounting/);
  const {plan,...legacy}=saved;
  assert(feedbackRecordSchema.parse({...legacy,status:'complete'}));
});
