import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProjectService } from '../src/main/project-service.ts';
import { atomicWrite, digest } from '../src/main/files.ts';
import { documentStatePath } from '../src/main/document-state.ts';

async function fixture(source = '\uFEFFfirst\r\nline\r\n', write = atomicWrite) {
  const root = path.resolve('.test-runs','history-'+randomUUID()); await fs.mkdir(root,{recursive:true});
  const file=path.join(root,'main.tex');await fs.writeFile(file,source);
  const service=new ProjectService(path.join(root,'runtime'),write), p=await service.open(file);
  return { root,file,service,p, save:(text:string)=>service.save({projectId:p.id,text,review:p.review}) };
}
test('Save history keeps exact bytes, establishes a fixed original, and selecting a saved version survives Save/reopen',async()=>{
  const f=await fixture(), original=await fs.readFile(f.file);
  const first=await f.save('second\nline\n');assert.equal(first.baseline?.text,original.toString());
  await f.save('third\nline\n');const history=await f.service.versionHistory(f.p.id);assert.equal(history.versions.length,3);
  const id=digest('\uFEFFsecond\r\nline\r\n');assert(history.versions.some(v=>v.id===id));
  const baseline=await f.service.compareSavedVersion(f.p.id,id);assert.equal(baseline.text,'\uFEFFsecond\r\nline\r\n');
  assert.equal(await fs.readFile(f.file,'utf8'),'\uFEFFthird\r\nline\r\n');
  await f.save('fourth\nline\n');const reopened=await f.service.open(f.file);assert.equal(reopened.baseline?.sourceHash,baseline.sourceHash);
  const count=(await f.service.versionHistory(reopened.id)).versions.length;
  await f.service.save({projectId:reopened.id,text:reopened.text,review:reopened.review});assert.equal((await f.service.versionHistory(reopened.id)).versions.length,count);
});
test('folder budget prunes oldest unprotected versions across sibling roots and discloses the protected minimum',async()=>{
  const f=await fixture('0'+'.'.repeat(399999));
  for(let i=1;i<=5;i++) await f.save(i+'.'.repeat(399999));
  const sibling=path.join(f.root,'copy.tex');await fs.writeFile(sibling,'a'+'.'.repeat(399999));const q=await f.service.open(sibling);
  for(let i=1;i<=5;i++) await f.service.save({projectId:q.id,text:`b${i}`+'.'.repeat(399998),review:q.review});
  const before=await f.service.versionHistory(q.id);assert(before.folderBytes>=4800000);
  const limited=await f.service.setHistoryBudget(q.id,1000000);
  assert(limited.folderBytes<before.folderBytes);assert(limited.folderBytes>limited.budgetBytes);assert(limited.notices.some(n=>n.includes('protected')));
  assert(limited.versions.some(v=>v.protectedReason==='Pinned comparison version'));
  assert.equal(await fs.readFile(f.file,'utf8'),'5'+'.'.repeat(399999));assert.equal(await fs.readFile(sibling,'utf8'),'b5'+'.'.repeat(399998));
  const reopened=await f.service.open(f.file);assert.equal((await f.service.versionHistory(reopened.id)).budgetBytes,1000000);
});
test('returning to older content preserves the actual previous Save through unchanged Save, reopen, delete and budget',async()=>{
  const content=(letter:string)=>letter+'.'.repeat(399999), f=await fixture(content('A'));
  for(const letter of ['B','C','D','B','E','E']) await f.save(content(letter));
  const reopened=await f.service.open(f.file), previous=digest(content('B'));
  const before=await f.service.versionHistory(reopened.id);assert(before.versions.find(v=>v.id===previous)?.protectedReason);
  await assert.rejects(f.service.deleteSavedVersion(reopened.id,previous),/protected/);
  const after=await f.service.setHistoryBudget(reopened.id,1000000);assert(after.versions.some(v=>v.id===previous&&v.protectedReason));
  assert.equal(await fs.readFile(f.file,'utf8'),content('E'));
});
test('a pending failed Save cannot displace committed history; duplicate checkpoint metadata protects all versions',async()=>{
  const content=(letter:string)=>letter+'.'.repeat(399999);let fail=false;
  const f=await fixture(content('A'),async(file,data,before)=>{if(fail&&file.endsWith('/main.tex'))throw new Error('Injected source failure');await atomicWrite(file,data,before);});
  for(const letter of ['B','C','D','B','E','E'])await f.save(content(letter));
  fail=true;await assert.rejects(f.save(content('F')),/Injected source failure/);
  const previous=digest(content('B'));const after=await f.service.setHistoryBudget(f.p.id,1000000);
  assert(after.versions.some(v=>v.id===previous&&v.protectedReason));assert.equal(await fs.readFile(f.file,'utf8'),content('E'));
  const checkpoints=path.join(documentStatePath(f.file),'save-checkpoints.json');await fs.writeFile(checkpoints,JSON.stringify({schemaVersion:1,rootFile:'main.tex',original:digest(content('A')),hashes:[digest(content('E')),digest(content('E'))]}));
  const corrupted=await f.service.versionHistory(f.p.id);assert(corrupted.versions.every(v=>v.protectedReason));assert(corrupted.notices.length);
  await assert.rejects(f.service.deleteSavedVersion(f.p.id,previous),/nothing was deleted/);
});
test('first original survives failed checkpoint finalization and failed baseline creation, then is recovered exactly on a later Save',async()=>{
  for(const boundary of ['checkpoint','baseline']){
    let fail=true;const content=(letter:string)=>letter+'.'.repeat(399999);
    const f=await fixture(content('A'),async(file,data,before)=>{
      if(fail&&((boundary==='baseline'&&file.endsWith('/baseline.json'))||(boundary==='checkpoint'&&file.endsWith('/save-checkpoints.json')&&!JSON.parse(String(data)).pending)))throw new Error('Injected history maintenance failure');
      await atomicWrite(file,data,before);
    });
    const result=await f.save(content('B'));assert.match(result.historyNotice,/Source saved/);assert.equal(await fs.readFile(f.file,'utf8'),content('B'));
    fail=false;const p=await f.service.open(f.file);for(const letter of ['C','D'])await f.service.save({projectId:p.id,text:content(letter),review:p.review});
    assert.equal(f.service.get(p.id).baseline?.text,content('A'));
    const history=await f.service.setHistoryBudget(p.id,1000000);assert(history.versions.some(v=>v.id===digest(content('A'))&&v.protectedReason));
  }
});
test('manual deletion cannot remove protected or corrupted checkpoints, and never changes source or baseline',async()=>{
  const f=await fixture('zero');for(const s of ['one','two','three','four']) await f.save(s);
  const version=digest('one'), file=path.join(documentStatePath(f.file),'backups',`source-${version}.tex`);
  await fs.writeFile(file,'tampered');await fs.utimes(file,new Date(0),new Date(0));await assert.rejects(f.service.deleteSavedVersion(f.p.id,version),/checksum/);assert.equal(await fs.readFile(file,'utf8'),'tampered');
  await fs.writeFile(file,'one');await fs.utimes(file,new Date(0),new Date(0));
  const baseline=f.service.get(f.p.id).baseline;await f.service.deleteSavedVersion(f.p.id,version);await assert.rejects(fs.stat(file),{code:'ENOENT'});
  await assert.rejects(f.service.deleteSavedVersion(f.p.id,digest('four')),/protected/);
  assert.equal(await fs.readFile(f.file,'utf8'),'four');assert.deepEqual(f.service.get(f.p.id).baseline,baseline);
});
test('a failed source Save never prunes old versions and its journal protects both recovery hashes',async()=>{
  let fail=false;
  const f=await fixture('zero',async(file,data,before)=>{if(fail&&file.endsWith('/main.tex'))throw new Error('Injected Save failure');await atomicWrite(file,data,before);});
  for(const s of ['one','two','three'])await f.save(s);
  const before=(await f.service.versionHistory(f.p.id)).versions.map(v=>v.id);fail=true;
  await assert.rejects(f.save('intended'),/Injected/);
  const after=await f.service.versionHistory(f.p.id);assert(before.every(id=>after.versions.some(v=>v.id===id)));
  assert(after.versions.find(v=>v.id===digest('intended'))?.protectedReason);
  assert.equal(await fs.readFile(f.file,'utf8'),'three');
});
test('history-maintenance failure reports a successful Save honestly, preserving the original backup',async()=>{
  const f=await fixture('original',async(file,data,before)=>{if(file.endsWith('/baseline.json'))throw new Error('History unavailable');await atomicWrite(file,data,before);});
  const result=await f.save('new');assert.match(result.historyNotice??'',/Source saved.*history needs attention/i);
  assert.equal(result.diskHash,digest('new'));assert.equal(await fs.readFile(f.file,'utf8'),'new');
  assert.equal(await fs.readFile(path.join(documentStatePath(f.file),'backups',`source-${digest('original')}.tex`),'utf8'),'original');
});
test('damaged checkpoint metadata survives persist, Save and reopen without pruning any folder history',async()=>{
  const content=(letter:string)=>letter+'.'.repeat(399999), f=await fixture(content('A'));
  await f.save(content('B'));await f.service.setHistoryBudget(f.p.id,1000000);await f.save(content('C'));
  const home=documentStatePath(f.file), checkpoints=path.join(home,'save-checkpoints.json');
  const damaged=Buffer.from('{ damaged checkpoint metadata\r\n');await fs.writeFile(checkpoints,damaged);
  const draft={projectId:f.p.id,text:content('D'),review:{...f.p.review,activeId:'checkpoint-draft-position'}};
  await f.service.persist(draft);assert.equal(await fs.readFile(f.file,'utf8'),content('C'));
  const saving=new ProjectService(path.join(f.root,'runtime')), recovered=await saving.open(f.file);
  assert.equal(recovered.text,draft.text);assert.equal(recovered.recovered,true);assert.equal(recovered.review.activeId,draft.review.activeId);
  const result=await saving.save({projectId:recovered.id,text:recovered.text,review:recovered.review});
  assert.equal(result.diskHash,digest(draft.text));assert.match(result.historyNotice,/Source saved.*save-checkpoints\.json.*preserved.*deletion.*paused/i);
  assert.equal(await fs.readFile(f.file,'utf8'),draft.text);assert.deepEqual(await fs.readFile(checkpoints),damaged);
  await assert.rejects(fs.stat(path.join(home,'recovery/save.json')),{code:'ENOENT'});
  assert.equal(JSON.parse(await fs.readFile(path.join(home,'recovery/session.json'),'utf8')).baseDiskHash,result.diskHash);
  const reopening=new ProjectService(path.join(f.root,'runtime')), reopened=await reopening.open(f.file);
  assert.equal(reopened.text,draft.text);assert.equal(reopened.recovered,false);assert.equal(reopened.review.activeId,draft.review.activeId);
  await reopening.save({projectId:reopened.id,text:content('E'),review:reopened.review});
  const history=await reopening.versionHistory(reopened.id);
  assert.equal(history.budgetBytes,1000000);assert(history.folderBytes>history.budgetBytes);
  for(const letter of ['A','B','C','D','E'])assert.equal(await fs.readFile(path.join(home,'backups',`source-${digest(content(letter))}.tex`),'utf8'),content(letter));
  assert(history.versions.every(v=>v.protectedReason));assert(history.notices.some(n=>/deletion.*paused/.test(n)));
  await assert.rejects(reopening.deleteSavedVersion(reopened.id,digest(content('B'))),/nothing was deleted/);
  assert.equal(reopened.baseline?.text,content('A'));
  // A healthy sibling must not prune its unprotected versions while folder protection is uncertain.
  const sibling=path.join(f.root,'copy.tex');await fs.writeFile(sibling,'zero');
  const other=new ProjectService(path.join(f.root,'other-runtime')), q=await other.open(sibling);
  for(const text of ['one','two','three'])await other.save({projectId:q.id,text,review:q.review});
  const siblingVersion=path.join(documentStatePath(sibling),'backups',`source-${digest('one')}.tex`);
  assert.equal(await fs.readFile(siblingVersion,'utf8'),'one');
  await assert.rejects(other.deleteSavedVersion(q.id,digest('one')),/nothing was deleted/);
  await assert.rejects(other.setHistoryBudget(q.id,1000000),/could not be verified/);
  assert.deepEqual(await fs.readFile(checkpoints),damaged);assert.equal(await fs.readFile(f.file,'utf8'),content('E'));
});
test('damaged optional checkpoints never hide journal, backup or guarded source write failures',async()=>{
  for(const stage of ['journal','backup','source']){
    let fail=false;
    const f=await fixture('original',async(file,data,before)=>{
      if(fail&&(stage==='journal'?file.endsWith('/save.json'):stage==='backup'?file.includes('/backups/'):file.endsWith('/main.tex')))throw new Error(`Injected ${stage} failure`);
      await atomicWrite(file,data,before);
    });
    await f.save('previous');const checkpoints=path.join(documentStatePath(f.file),'save-checkpoints.json');
    const damaged='{ preserved damage';await fs.writeFile(checkpoints,damaged);
    await f.service.persist({projectId:f.p.id,text:'draft',review:f.p.review});fail=true;
    await assert.rejects(f.save('draft'),new RegExp(`Injected ${stage} failure`));
    assert.equal(await fs.readFile(f.file,'utf8'),'previous');assert.equal(await fs.readFile(checkpoints,'utf8'),damaged);
    const reopened=await new ProjectService(path.join(f.root,'runtime')).open(f.file);assert.equal(reopened.text,'draft');
  }
});
test('linked or unowned sibling history blocks deletion and preserves outside files',async()=>{
  const f=await fixture('zero');for(const s of ['one','two','three','four'])await f.save(s);
  const home=documentStatePath(f.file), backups=path.join(home,'backups'), kept=path.join(home,'backups-kept');
  await fs.rename(backups,kept);await fs.symlink(kept,backups);
  await assert.rejects(f.service.deleteSavedVersion(f.p.id,digest('one')),/nothing was deleted/);
  assert.equal(await fs.readFile(path.join(kept,`source-${digest('one')}.tex`),'utf8'),'one');
  await fs.unlink(backups);await fs.rename(kept,backups);
  const foreign=path.join(path.dirname(home),digest('other.tex'));await fs.mkdir(foreign);await fs.writeFile(path.join(foreign,'document.json'),JSON.stringify({schemaVersion:1,rootFile:'../other.tex'}));
  await assert.rejects(f.service.setHistoryBudget(f.p.id,1000000),/could not be verified/);
  assert.equal(await fs.readFile(f.file,'utf8'),'four');
});
