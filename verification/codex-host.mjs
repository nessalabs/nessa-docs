// Explicit opt-in: exercises an already registered local server through Codex's
// actual app-server RPC. It does not register servers or change user config.
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const codex = process.env.NESSA_DOCS_CODEX_BINARY || 'codex';
const run = args => execFileSync(codex,args,{encoding:'utf8',stdio:['ignore','pipe','pipe']});
const registration = JSON.parse(run(['mcp','get','nessa-docs','--json']));
assert.equal(registration.enabled,true,'Register nessa-docs before this opt-in test');
assert.equal(registration.transport.type,'stdio');
assert.deepEqual(registration.transport.args,[root+'dist/server/server/mcp/main.js']);
assert(!registration.transport.env?.NESSA_DOCS_STORE,'This test requires memory mode');
assert(!registration.transport.env_vars?.includes('NESSA_DOCS_STORE'),'This test requires memory mode');
assert(!process.env.NESSA_DOCS_STORE,'This test requires memory mode');
// Supply reviewed process-only disables for other user-configured servers.
// `mcp list` can include generated plugin servers that cannot be overridden.
assert(process.env.NESSA_DOCS_CODEX_OVERRIDES,'Set NESSA_DOCS_CODEX_OVERRIDES to a reviewed JSON argv file');
const overrides = JSON.parse(await readFile(process.env.NESSA_DOCS_CODEX_OVERRIDES,'utf8'));
assert(Array.isArray(overrides) && overrides.length%2===0);
for(let i=0;i<overrides.length;i+=2){
  assert.equal(overrides[i],'-c');
  assert(/^mcp_servers\.[A-Za-z0-9_-]+\.enabled=false$/.test(overrides[i+1]));
  assert.notEqual(overrides[i+1],'mcp_servers.nessa-docs.enabled=false');
}
const version = run(['--version']).trim();
const child = spawn(codex,['app-server',...overrides],{cwd:root,stdio:['pipe','pipe','pipe']});
let sequence=0, stopped=false, diagnostics='';
const pending=new Map(); const events=[];
child.stderr.on('data',value=>{ diagnostics += String(value); if(diagnostics.length>8000)diagnostics=diagnostics.slice(-8000); });
const lines=createInterface({input:child.stdout});
lines.on('line',line=>{
  let message; try{message=JSON.parse(line);}catch{return;}
  if(message.id!==undefined && !message.method){const task=pending.get(message.id); if(task){pending.delete(message.id);clearTimeout(task.timer);message.error?task.reject(new Error(JSON.stringify(message.error))):task.resolve(message.result);}}
  else if(message.method){
    events.push(message);
    if(message.id!==undefined){child.stdin.write(JSON.stringify({id:message.id,error:{code:-32601,message:'Verification client does not handle interactive requests'}})+'\n');}
  }
});
child.on('exit',()=>{stopped=true; for(const task of pending.values()){clearTimeout(task.timer);task.reject(new Error('Codex app-server exited: '+diagnostics.replace(/sk-[A-Za-z0-9_-]+/g,'[redacted]').replace(/https?:\/\/[^\s]+/g,'[endpoint redacted]').replace(/[A-Za-z0-9+_=-]{40,}/g,'[long value redacted]')));}pending.clear();});
function rpc(method,params={}){const id=++sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Timed out: ${method}`));},30000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,params})+'\n');});}
const notify=(method,params={})=>child.stdin.write(JSON.stringify({method,params})+'\n');
const sample=(body)=>`---\nid: codex-host-demo\ntitle: Codex host demo\nkind: system\nstatus: fixture\nsummary: Synthetic diagram for actual Codex host testing.\nparent: null\nsources: []\ndiagramLinks: {}\n---\n# Codex host demo\n\n${body}\n\n\`\`\`mermaid\nflowchart LR\n A[Synthetic input] --> B[Verified result]\n\`\`\`\n`;
const calls=[];
try{
  const initialized=await rpc('initialize',{clientInfo:{name:'nessa_docs_host_verifier',title:'Nessa Docs host verification',version:'0.1.0'},capabilities:{experimentalApi:true}});notify('initialized');
  const thread=await rpc('thread/start',{cwd:root,ephemeral:true,sandbox:'read-only'});
  const threadId=thread.thread.id;
  let status;
  for(let attempt=0;attempt<40;attempt++){
    const list=await rpc('mcpServerStatus/list',{threadId,detail:'full',limit:100});
    status=list.data.find(item=>item.name==='nessa-docs');
    if(status?.tools && Object.keys(status.tools).length)break;
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  assert(status,'Registered server not found');
  assert.deepEqual(Object.values(status.tools).map(tool=>tool.name).sort(),['check_model','read_docs','replace_docs','show_docs']);
  const showTool = Object.values(status.tools).find(tool=>tool.name==='show_docs');
  assert.equal(showTool._meta?.ui?.resourceUri,'ui://nessa-docs/explorer-v1.html');
  assert.deepEqual(showTool._meta?.['openai/ui']?.entrypoints,[{type:'thread'}]);
  async function call(tool,args={}){const result=await rpc('mcpServer/tool/call',{threadId,server:'nessa-docs',tool,arguments:args});calls.push({tool,arguments:args,result});return result;}
  assert.equal((await call('read_docs')).isError,true);
  const first=await call('replace_docs',{expectedRevision:0,files:[{path:'docs/state/README.md',markdown:sample('Initial synthetic content.')}]});assert(!first.isError,JSON.stringify(first));
  assert.equal(first.structuredContent.snapshot.revision,1);assert.equal(first.structuredContent.snapshot.storage.kind,'memory');
  const shown=await call('show_docs');assert(!shown.isError);assert.equal(shown.structuredContent.snapshot.scope,first.structuredContent.snapshot.scope);
  const second=await call('replace_docs',{expectedRevision:1,files:[{path:'docs/state/README.md',markdown:sample('Updated synthetic content.')}]});assert(!second.isError);assert.equal(second.structuredContent.snapshot.revision,2);
  assert.equal((await call('replace_docs',{expectedRevision:1,files:[{path:'docs/state/README.md',markdown:sample('Stale synthetic update.')}]})).isError,true);
  const read=await call('read_docs');assert.equal(read.structuredContent.snapshot.revision,2);assert(read.structuredContent.snapshot.files[0].markdown.includes('Updated synthetic content.'));
  const report={ok:true,host:version+' app-server',initialized,threadId,runtimeStatus:status.runtimeStatus??null,serverInfo:status.serverInfo??null,tools:Object.values(status.tools).map(tool=>({name:tool.name,ui:tool._meta?.ui??null,entrypoints:tool._meta?.['openai/ui']?.entrypoints??null})),resources:status.resources.map(({uri,mimeType})=>({uri,mimeType})),calls,uiRenderingVerified:false,modelToolSelectionVerified:false};
  await mkdir(new URL('./results/',import.meta.url),{recursive:true});await writeFile(new URL('./results/codex-host.json',import.meta.url),JSON.stringify(report,null,2));
  console.log(JSON.stringify({ok:true,host:report.host,runtimeStatus:report.runtimeStatus,tools:report.tools,resources:report.resources,revisions:[1,2],staleWriteRejected:true,uiRenderingVerified:false}));
}finally{lines.close();child.stdin.end();if(!stopped)child.kill('SIGTERM');}
