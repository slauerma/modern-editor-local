import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProjectService } from '../src/main/project-service.ts';
import { CompileService } from '../src/main/compile-service.ts';
test('real SyncTeX locates prose, equation and floating caption; respects old/candidate snapshots and keeps source bytes', {timeout:90000},async()=>{
  const root=path.resolve('.test-runs','pdf-navigation-'+randomUUID()),paper=path.join(root,'paper with spaces');await fs.mkdir(paper,{recursive:true});
  const source='\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}\nThe first distinct paragraph introduces the allocation problem.\n\\newpage\nThe second page states the equilibrium condition.\n\\begin{equation}\n  x^2+y^2=1\n\\end{equation}\n\\begin{figure}[ht]\n\\centering\\rule{5cm}{2cm}\n\\caption{A distinctive floating diagram.}\n\\end{figure}\n\\end{document}\n';
  const file=path.join(paper,'main.tex');await fs.writeFile(file,source);
  const projects=new ProjectService(path.join(root,'runtime')), p=await projects.open(file), compiler=new CompileService(projects,path.join(root,'builds'));
  const receipt:any={sourceUnchanged:false,targets:[]};
  try {
    const built=await compiler.compile(p.id,source,'pdflatex');assert(built.success);assert(built.dependenciesVerified);
    const locate=(text:string,phrase:string,id=built.id)=>{const from=text.indexOf(phrase);assert(from>=0);return compiler.locatePdf({projectId:p.id,buildId:id,text,from,to:from+phrase.length});};
    for(const [phrase,page] of [['first distinct',1],['second page',2],['x^2+y^2=1',2],['distinctive floating',2]] as const){const hit=await locate(source,phrase);receipt.targets.push({phrase,hit});assert.equal(hit.kind,'mapped',JSON.stringify(hit));if(hit.kind==='mapped')assert.equal(hit.page,page);}
    const forward=await locate(source,'first distinct');assert.equal(forward.kind,'mapped');
    if(forward.kind!=='mapped')throw Error('Missing forward location');
    const reverse=(text:string,buildId=built.id)=>compiler.locateSource({projectId:p.id,buildId,text,page:forward.page,x:forward.x+forward.width/2,y:forward.y+forward.height/2});
    const back=await reverse(source);assert.equal(back.kind,'mapped',JSON.stringify(back));
    if(back.kind==='mapped')assert.match(source.slice(back.from,back.to),/first distinct/);
    const shifted=source.replace('The first','Earlier material.\nThe first');assert.equal((await locate(shifted,'second page')).kind,'mapped');
    const shiftedBack=await reverse(shifted);assert.equal(shiftedBack.kind,'mapped');
    if(shiftedBack.kind==='mapped')assert.match(shifted.slice(shiftedBack.from,shiftedBack.to),/first distinct/);
    assert.equal((await reverse(source.replace('first distinct','rewritten'))).kind,'compile');
    assert.equal((await reverse(source,'unknown-build')).kind,'compile');
    const changed=source.replace('second page states','revised page states');assert.equal((await locate(changed,'revised page')).kind,'compile');
    const candidate=await compiler.compile(p.id,changed,'pdflatex');assert(candidate.success);
    assert.equal((await locate(source,'second page',candidate.id)).kind,'compile');assert.equal((await locate(changed,'revised page',candidate.id)).kind,'mapped');
    const failed=await compiler.compile(p.id,source.replace('x^2+y^2=1','\\undefinedEditorProbe'), 'pdflatex');assert.equal(failed.success,false);assert.equal((await locate(source,'second page')).kind,'mapped');
    assert.equal((await locate(source,'second page','unavailable-build')).kind,'compile');
    await fs.writeFile(path.join(paper,'included.tex'),'An included paragraph uniquely belongs to another file.\n');
    const included=source.replace('The first distinct paragraph introduces the allocation problem.',String.raw`\input{included}`);
    const includedBuild=await compiler.compile(p.id,included,'pdflatex');assert(includedBuild.success);assert(includedBuild.dependenciesVerified);
    const includedHit=await reverse(included,includedBuild.id);assert.equal(includedHit.kind,'unavailable');
    if(includedHit.kind==='unavailable')assert.match(includedHit.reason,/included file/);
    const comparison=await compiler.compile(p.id,source,'pdflatex',undefined,undefined,'comparison');assert(comparison.success);
    const comparisonHit=await reverse(source,comparison.id);assert.equal(comparisonHit.kind,'unavailable');
    if(comparisonHit.kind==='unavailable')assert.match(comparisonHit.reason,/change marker/);
    receipt.reverse={back,shiftedBack,includedHit,comparisonHit};
    assert.equal(await fs.readFile(file,'utf8'),source);receipt.sourceUnchanged=true;receipt.passed=true;
  } finally {await compiler.stop();await fs.writeFile(path.join(root,'receipt.json'),JSON.stringify(receipt,null,2));console.log('SyncTeX receipt:',path.join(root,'receipt.json'));}
});
