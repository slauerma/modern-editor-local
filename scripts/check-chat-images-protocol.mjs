// Real installed Codex app-server, synthetic local HTTP provider, no account.
// Verifies typed image delivery at the model boundary. This does not evaluate
// a model's visual understanding or answer quality.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const appRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sha=x=>createHash('sha256').update(x).digest('hex');
if(process.argv[2]==='--worker'){
  const [directory,binary,imagePath]=process.argv.slice(3);
  const {CodexClient}=await import('../src/main/codex-client.ts');
  const {chatOutputSchema}=await import('../src/shared/help-chat.ts');
  const client=new CodexClient(directory,binary),children=[];
  const send=client.send.bind(client);
  client.send=envelope=>{const child=client.child;if(child&&!children.some(p=>p.pid===child.pid)){const record={pid:child.pid,closed:false};children.push(record);child.once('close',(code,signal)=>Object.assign(record,{closed:true,code,signal}));}return send(envelope);};
  const timeout=setTimeout(()=>void client.cancel(),60000);
  try{
    const image='data:image/png;base64,'+(await fs.readFile(imagePath)).toString('base64');
    const result=await client.run('Describe the attached synthetic image. This is a local protocol check.',chatOutputSchema,()=>{},'medium',false,undefined,{purpose:'help',images:[image]});
    assert.equal(result.reply,'SYNTHETIC_IMAGE_RECEIVED');assert.equal(result.suggestion,null);
    assert(children.length>0&&children.every(p=>p.closed));
    console.log(JSON.stringify({passed:true,children}));
  }finally{clearTimeout(timeout);await client.cancel();}
}else{
  assert(process.argv.length===3,'Usage: node --experimental-strip-types scripts/check-chat-images-protocol.mjs /absolute/path/to/codex');
  const binary=path.resolve(process.argv[2]),root=path.join(appRoot,'.test-runs','chat-image-protocol-'+Date.now()),codexHome=path.join(root,'synthetic-codex-home');
  await fs.mkdir(codexHome,{recursive:true});
  const crc32=buffer=>{let crc=-1;for(const b of buffer){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return(crc^-1)>>>0;};
  const chunk=(type,data)=>{const name=Buffer.from(type),length=Buffer.alloc(4),checksum=Buffer.alloc(4);length.writeUInt32BE(data.length);checksum.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([length,name,data,checksum]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(2,0);header.writeUInt32BE(2,4);header[8]=8;header[9]=2;
  const pixels=Buffer.from([0,255,0,0,0,255,0,0,0,0,255,255,255,255]);
  const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
  const imagePath=path.join(root,'synthetic.png');await fs.writeFile(imagePath,png);
  const requests=[];let failure,child,outcome;
  const service=http.createServer(async(req,res)=>{try{
    assert.equal(req.headers.authorization,undefined,'No account token may reach the local fixture');assert.equal(req.method,'POST');assert(req.url?.startsWith('/v1/responses'));
    let body='';for await(const part of req){body+=part;if(body.length>2000000)throw new Error('Unexpected request size');}
    const payload=JSON.parse(body),images=[];
    function visit(value){if(!value||typeof value!=='object')return;if(value.type==='input_image')images.push(value);for(const item of Object.values(value))if(typeof item==='object')Array.isArray(item)?item.forEach(visit):visit(item);}
    visit(payload.input);assert.equal(images.length,1);assert.equal(images[0].image_url,'data:image/png;base64,'+png.toString('base64'));
    requests.push({path:req.url,model:payload.model,authorizationPresent:false,imageCount:images.length,imageSha256:sha(png),imageType:images[0].type});assert(requests.length<=2);
    const item={id:'msg_synthetic_image',type:'message',role:'assistant',status:'completed',phase:'final_answer',content:[{type:'output_text',text:JSON.stringify({reply:'SYNTHETIC_IMAGE_RECEIVED',suggestion:null}),annotations:[]}]};
    const response={id:'resp_synthetic_image',object:'response',created_at:Math.floor(Date.now()/1000),model:payload.model,status:'completed',output:[item],error:null,incomplete_details:null,usage:{input_tokens:10,output_tokens:10,total_tokens:20,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}};
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache',Connection:'close'});const event=value=>res.write(`event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`);
    event({type:'response.created',sequence_number:0,response:{...response,status:'in_progress',output:[]}});event({type:'response.output_item.added',sequence_number:1,output_index:0,item:{...item,status:'in_progress',content:[]}});event({type:'response.output_item.done',sequence_number:2,output_index:0,item});event({type:'response.completed',sequence_number:3,response});res.end();
  }catch(e){failure=String(e);res.writeHead(500);res.end('Synthetic fixture rejected the request');}});
  try{
    await new Promise((resolve,reject)=>{service.once('error',reject);service.listen(0,'127.0.0.1',resolve);});
    const config=`model = "gpt-5.6-sol"\nmodel_provider = "synthetic_protocol_probe"\n[model_providers.synthetic_protocol_probe]\nname = "Synthetic local protocol fixture"\nbase_url = "http://127.0.0.1:${service.address().port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\nsupports_websockets = false\nrequest_max_retries = 0\nstream_max_retries = 0\nstream_idle_timeout_ms = 10000\n`;
    await fs.writeFile(path.join(codexHome,'config.toml'),config);
    child=spawn(process.execPath,['--experimental-strip-types',fileURLToPath(import.meta.url),'--worker',path.join(root,'request'),binary,imagePath],{cwd:root,env:{PATH:process.env.PATH,HOME:process.env.HOME,CODEX_HOME:codexHome,RUST_LOG:'error'},stdio:['ignore','pipe','pipe'],detached:true});
    console.log('Owned protocol worker PID',child.pid);let stdout='',stderr='';child.stdout.on('data',x=>{stdout+=x;});child.stderr.on('data',x=>{stderr+=x;});
    const timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGTERM');}catch{}},75000);
    const code=await new Promise((resolve,reject)=>{child.once('close',resolve);child.once('error',reject);});clearTimeout(timer);
    if(code!==0)throw new Error('Protocol worker failed: '+stderr.slice(-3000));
    outcome=JSON.parse(stdout.trim().split('\n').at(-1));assert(outcome.passed);assert(!failure,failure);assert(requests.length>0);
    assert.equal(await fs.readFile(path.join(codexHome,'config.toml'),'utf8'),config);outcome={...outcome,workerPid:child.pid,workerExited:true,requests,configPreserved:true,passed:true};console.log('PASS real Codex delivered the synthetic screenshot as input_image; no account credentials used.');
  }catch(e){outcome={passed:false,error:String(e),requests};throw e;}
  finally{service.closeAllConnections();await new Promise(resolve=>service.close(resolve));await fs.writeFile(path.join(root,'results.json'),JSON.stringify(outcome,null,2)+'\n');console.log('Evidence',root);}
}
