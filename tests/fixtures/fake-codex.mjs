#!/usr/bin/env node
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
fs.writeFileSync('server.pid', String(process.pid));
fs.writeFileSync('arguments.json', JSON.stringify(process.argv.slice(2)));
const input = readline.createInterface({ input: process.stdin });
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
const notification = (method, params) => send({ method, params: { threadId: 'thread-1', ...params } });
const requests = [];
const has = name => fs.existsSync(name);
const flags = process.argv.slice(2);
const features = Object.fromEntries(flags.flatMap((flag,i) => flag === '--disable' || flag === '--enable' ? [[flags[i+1],flag === '--enable']] : []));
let reviewConfig;
let referenceMode = '';
const toolCall = (id, tool, args = {}, extra = {}) => send({ id, method: 'item/tool/call', params: { threadId: 'thread-1', turnId: 'turn-1', callId: id, namespace: null, tool, arguments: args, ...extra } });
const referenceFinal = () => notification('turn/completed', { turn: { id: 'turn-1', status: 'completed', items: [{ type: 'agentMessage', text: '{"reply":"Reference checked","replacement":null,"packages":[]}' }] } });
input.on('line', line => {
  const message = JSON.parse(line);
  requests.push(message); fs.writeFileSync('requests.json', JSON.stringify(requests));
  const { id, method, params } = message;
  if (!method && referenceMode && id === 'ref-list') {
    toolCall('ref-read', 'references_read', { fileId: 'current-draft' });
    toolCall('ref-repeat', 'references_list', {}, { callId: 'ref-list' });
  }
  if (!method && referenceMode && id === 'ref-read') setTimeout(referenceFinal, 10);
  if (method && has('pause-' + method.replaceAll('/', '-'))) { notification('fixture/paused', { method }); return; }
  if (method === 'initialize') send({ id, result: { userAgent: `${process.env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE ?? params.clientInfo.name}/${has('unknown-version') ? '0.999.0' : '0.153.4'} (fixture)` } });
  if (method === 'config/read') {
    if (has('config-unavailable')) send({id,error:{code:-32601,message:'Unsupported config/read'}});
    else send({id,result:{config:{features:{...features,...(has('unsafe-feature')?{plugins:true}:{}),...(has('unsafe-code-host')?{code_mode_host:!features.code_mode_host}:{}),...(has('unsafe-skill-discovery')?{skip_host_skill_discovery:false}:{})},...(has('agents-unavailable')?{}:{agents:{enabled:has('agents-enabled')||!flags.includes('agents.enabled=false')}}),web_search:'disabled',project_doc_max_bytes:0,mcp_servers:{'probe.with.dots':{command:'unused',enabled:true},'probe-two':{command:'unused',enabled:true}}}}});
  }
  if (method === 'skills/list') {
    if (has('skills-unavailable')) { send({ id, error: { code: -32601, message: 'Unsupported skills/list' } }); return; }
    const skills = ['host-skill', 'already-disabled-skill'].map((name, i) => ({ name, description: 'Synthetic host metadata', path: path.join(process.cwd(), name, 'SKILL.md'), scope: 'user', enabled: i === 0, pluginId: null }));
    if (has('skills-malformed')) skills[0].path = 'relative/SKILL.md';
    if (has('skills-duplicate')) skills.push({ ...skills[0] });
    if (has('skills-oversized')) for (let i = 0; i < 1000; i++) skills.push({ ...skills[0], path: path.join(process.cwd(), 'extra-' + i, 'SKILL.md') });
    send({ id, result: { data: has('skills-incomplete') ? [] : [{ cwd: has('skills-wrong-cwd') ? path.dirname(process.cwd()) : process.cwd(), skills, errors: has('skills-error') ? [{ message: 'Synthetic discovery failure' }] : [] }] } });
  }
  if (method === 'thread/start') {
    reviewConfig=params.config;
    send({ id, result: { thread: { id: 'thread-1' }, approvalPolicy:has('wrong-policy')?'on-request':'never',sandbox:{type:'readOnly'},model: 'fixture-model', serviceTier: params.serviceTier === 'fast' ? (fs.existsSync('reject-fast') ? 'default' : 'priority') : null } });
  }
  if (method === 'mcpServerStatus/list') {
    let data=Object.keys(reviewConfig.mcp_servers).map(name=>({name,runtimeStatus:has('enabled-mcp')?'connected':'disabled',tools:has('available-tool')?{harmless_echo:{}}:{},resources:[],resourceTemplates:[]}));
    if(has('unexpected-mcp'))data.push({...data[0],name:'unexpected'});
    if(has('missing-mcp'))data=[];
    if(has('available-resource'))data[0].resources=[{uri:'probe://resource'}];
    if(has('malformed-inventory')){send({id,result:{data}});return;}
    if(has('repeated-cursor')){send({id,result:{data:[],nextCursor:'same'}});return;}
    if(has('paginate')){send({id,result:{data:params.cursor?data.slice(1):data.slice(0,1),nextCursor:params.cursor?null:'second'}});return;}
    send({id,result:{data,nextCursor:null}});
  }
  if (method === 'model/list') send({ id, result: { data: [{ id: 'fixture-model', model: 'fixture-model', inputModalities: has('text-only') ? ['text'] : ['text', 'image'], supportedReasoningEfforts: (fs.existsSync('only-medium') ? ['medium'] : ['low', 'medium', 'high', 'max']).map(reasoningEffort => ({ reasoningEffort })), serviceTiers: fs.existsSync('no-fast') ? [] : [{ id: 'priority' }] }], nextCursor: null } });
  if (method === 'turn/start') {
    const mode = params.input[0].text;
    const started = { id, result: { turn: { id: 'turn-1', status: 'inProgress' } } };
    if (has('delay-turn-response')) setTimeout(() => { send(started); fs.writeFileSync('turn-response-sent', ''); }, 40);
    else send(started);
    notification('turn/started', { turn: { id: 'turn-1' } });
    if (mode === 'reference-tools' || mode === 'reference-wait') {
      referenceMode = mode;
      toolCall('wrong-thread', 'references_read', { fileId: 'current-draft' }, { threadId: 'foreign' });
      toolCall('wrong-turn', 'references_read', {}, { turnId: 'foreign' });
      toolCall('wrong-namespace', 'references_read', {}, { namespace: 'foreign' });
      toolCall('wrong-tool', 'shell_command', { command: 'ignored' });
      send({ id: 'approval', method: 'item/commandExecution/requestApproval', params: { threadId: 'thread-1' } });
      toolCall(mode === 'reference-wait' ? 'ref-wait' : 'ref-list', mode === 'reference-wait' ? 'references_read' : 'references_list', mode === 'reference-wait' ? { fileId: 'current-draft' } : {});
      return;
    }
    if (mode === 'wait') return;
    if (mode === 'failure') { notification('turn/completed', { turn: { id: 'turn-1', status: 'failed', error: { message: 'Fixture model failure' }, items: [] } }); return; }
    const item = { id: 'answer-1', type: 'agentMessage', phase: 'final_answer', text: mode === 'invalid' ? 'not-json' : '{"reply":"Precise \\u03b8 advice","replacement":null,"packages":[]}' };
    notification('item/completed', { item: { ...item, id: 'commentary', phase: 'commentary', text: 'This is not the final result' } });
    // Fragment a JSONL record to exercise buffering rather than one event per chunk.
    const line = JSON.stringify({ method: 'item/completed', params: { threadId: 'thread-1', item } }) + '\n';
    process.stdout.write(line.slice(0, 19));
    setTimeout(() => {
      process.stdout.write(line.slice(19));
      notification('turn/completed', { turn: { id: 'turn-1', status: 'completed', items: mode === 'fallback' ? [] : [item] } });
    }, 10);
  }
  if (method === 'turn/interrupt') {
    send({ id, result: {} });
    if (!has('ack-only-interrupt')) notification('turn/completed', { turn: { id: 'turn-1', status: 'interrupted', items: [] } });
  }
});
input.on('close', () => { if (has('ignore-eof')) setInterval(() => {}, 1000); else process.exit(0); });
