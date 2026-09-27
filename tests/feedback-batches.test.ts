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
import { feedbackComments, feedbackRecordSchema } from '../src/shared/feedback.ts';

const source = 'A unique quotation.\nRepeated. Repeated.\n';
function response(prompt: string) {
  const payload = JSON.parse(prompt);
  return { items: payload.items.map((item: any) => ({ itemId: item.itemId, comments: [{
    category:'Clarity', title:'Consider this point', explanation:item.feedback,
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
  f.service.client.run = async prompt => {
    calls++; const payload=JSON.parse(prompt);
    assert.equal(payload.paper,source); assert.equal(payload.paperInstructions,'Keep notation.'); assert(payload.editPolicy);
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
