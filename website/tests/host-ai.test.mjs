import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {readHostAIStatus, analyzeWithHost, HOST_AI_WAITING} from '../lib/ai/host.ts';
import {hostAIAdapter} from '../lib/host-ai-adapter.ts';
const status={ready:true,message:'主站可用',usageNotice:'使用主站统一配额',termsVersion:'host-v1'};
const input={requestId:'test-request',itemId:'771669360776',snapshot:{},history:[],question:'分析',expectedTermsVersion:'host-v1'};
const options=()=>({signal:new AbortController().signal,onProgress:()=>{}});

test('default handoff is disconnected and never falls back to any network or provider',async()=>{
  const oldFetch=globalThis.fetch;let network=0;globalThis.fetch=()=>{network++;throw Error('Unexpected network');};
  try{
    assert.equal(hostAIAdapter,null);
    assert.deepEqual(await readHostAIStatus(hostAIAdapter),{ready:false,message:HOST_AI_WAITING,usageNotice:'',termsVersion:''});
    await assert.rejects(()=>analyzeWithHost(hostAIAdapter,input,options()),/待接入/);
    assert.equal(network,0);
  }finally{globalThis.fetch=oldFetch;}
});
test('ready requires host-provided usage terms; unavailable host remains unavailable',async()=>{
  await assert.rejects(()=>readHostAIStatus({getStatus:async()=>({...status,usageNotice:''})}),/状态不完整/);
  await assert.rejects(()=>readHostAIStatus({getStatus:async()=>({...status,termsVersion:''})}),/状态不完整/);
  assert.equal((await readHostAIStatus({getStatus:async()=>({...status,ready:false})})).ready,false);
});
test('delegates a request once without frontend model, API key, price or balance',async()=>{
  let calls=0;const received=[];
  const adapter={getStatus:async()=>status,analyze:async(body,opt)=>{calls++;received.push(body);opt.onProgress('requesting');return {...body,text:'host result'};}};
  assert.equal((await readHostAIStatus(adapter)).ready,true);
  const result=await analyzeWithHost(adapter,input,options());
  assert.equal(result.text,'host result');assert.equal(calls,1);assert.deepEqual(received,[input]);
  for(const key of ['apiKey','providerId','modelId','expectedPrice','balance'])assert(!Object.hasOwn(received[0],key));
});
test('cross-request and aborted replies cannot replace current results',async()=>{
  const adapter={getStatus:async()=>status,analyze:async()=>({...input,requestId:'wrong',text:'bad'})};
  await assert.rejects(()=>analyzeWithHost(adapter,input,options()),/不一致/);
  const controller=new AbortController();controller.abort();
  await assert.rejects(()=>analyzeWithHost(adapter,input,{signal:controller.signal,onProgress:()=>{}}),/取消/);
  const during=new AbortController();
  await assert.rejects(()=>analyzeWithHost({...adapter,analyze:async()=>{during.abort();return {...input,text:'late'};}},input,{signal:during.signal,onProgress:()=>{}}),/停止等待/);
});
test('independent settings, account routes and provider credentials are absent from handoff',()=>{
  const base=new URL('../',import.meta.url);
  for(const file of ['app/api','app/account','app/admin','lib/auth','lib/credits','.env.example'])assert(!fs.existsSync(new URL(file,base)),file);
  const panel=fs.readFileSync(new URL('components/opportunity-panel.tsx',base),'utf8');
  assert(!/accountFetch|accountClient|setDialog\('settings'\)|<select|href="\/(?:account|admin)"|deepseek|providerId|modelId/.test(panel));
  assert(panel.includes('AI 由 ai.taoa.cc 统一提供'));
  assert(!JSON.parse(fs.readFileSync(new URL('package.json',base))).dependencies['@supabase/supabase-js']);
});
test('extension no longer accepts personal AI messages; capture bridge still works',async()=>{
  const ext=new URL('../../extension/',import.meta.url);
  const manifest=JSON.parse(fs.readFileSync(new URL('manifest.json',ext)));
  assert.equal(manifest.options_page,'listing-diagnostics.html');
  assert(!manifest.optional_host_permissions);
  assert(!fs.existsSync(new URL('api-settings.html',ext)));
  const listeners={},sent=[],posted=[];
  const window={location:{origin:'https://workbench.example',href:'https://workbench.example/'},addEventListener:(event,fn)=>{listeners[event]=fn;},removeEventListener:()=>{},postMessage:m=>posted.push(m)};
  const chrome={runtime:{id:'test',onMessage:{addListener:()=>{},removeListener:()=>{}},sendMessage:async message=>{sent.push(message);return {ok:true,capture:{itemId:'test',capturedAt:'now',status:'success'}};}}};
  vm.runInNewContext(fs.readFileSync(new URL('bridge.js',ext),'utf8'),{window,chrome,URL,console});
  const event=type=>({source:window,origin:window.location.origin,data:{type,url:'https://item.taobao.com/item.htm?id=12345'},stopImmediatePropagation:()=>{}});
  listeners.message(event('TAOA_PERSONAL_START'));assert.equal(sent.length,0);
  listeners.message({...event('TAOA_START_CAPTURE'),origin:'https://other.example'});assert.equal(sent.length,0);
  listeners.message(event('TAOA_START_CAPTURE'));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(sent.length,1);assert.equal(sent[0].type,'TAOA_START_CAPTURE');assert(posted.some(m=>m.type==='TAOA_PRODUCT_CAPTURE'));
});
test('extension scripts parse and all manifest/HTML local resources exist',()=>{
  const root=fileURLToPath(new URL('../../extension/',import.meta.url));
  const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(path.join(dir,entry.name)):[path.join(dir,entry.name)]);
  const files=walk(root);
  for(const file of files.filter(file=>/\.m?js$/.test(file)))execFileSync(process.execPath,['--check',file]);
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json')));
  const refs=[manifest.background.service_worker,manifest.options_page,manifest.devtools_page,...Object.values(manifest.icons),...manifest.content_scripts.flatMap(script=>script.js)];
  for(const file of files.filter(file=>file.endsWith('.html'))){
    for(const match of fs.readFileSync(file,'utf8').matchAll(/(?:src|href)="([^"#]+)"/g)){
      if(!/^(?:https?:|data:)/.test(match[1]))refs.push(path.relative(root,path.resolve(path.dirname(file),match[1])));
    }
  }
  for(const ref of refs)assert(fs.existsSync(path.join(root,ref)),`Missing resource: ${ref}`);
});
