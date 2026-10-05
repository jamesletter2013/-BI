const $=id=>document.getElementById(id),requestId=location.hash.slice(1);
let job,config,started=false,finished=false;
const controller=new AbortController();
async function emit(event){const r=await chrome.runtime.sendMessage({type:'TAOA_PERSONAL_RUNNER_EVENT',requestId,event});if(!r?.ok)throw new Error(r?.error||'工作台连接已失效。');}
async function load(){
  const response=await chrome.runtime.sendMessage({type:'TAOA_PERSONAL_RUNNER_READ',requestId});if(!response?.ok)throw new Error(response?.error||'任务已失效。');
  job=response.job;config=response.config;
  if(job.startedAt)throw new Error('本次任务已发送。刷新分析页不能恢复原请求，也不会再次调用；服务商可能已计费。请返回工作台手动处理。');
  if(!config?.key || config.revision!==job.revision)throw new Error('配置已变化，请返回工作台重新提交。');
  $('destination').textContent=`使用配置：${config.name}\n接收地址：${TAOAAPI.endpoint(config)}\n模型：${config.model}\n商品 ID：${job.input.itemId}\n发送 ${job.input.messages.length} 条资料/对话，共 ${JSON.stringify(job.input.messages).length} 字符；输出上限 ${config.maxTokens} tokens。\n本次费用仅由这套 API 账户承担，不自动切换其他账户。第三方中转会同时收到密钥与这些资料，请确认你信任此域名。`;
  $('preview').textContent=job.input.messages.map(m=>`[${m.role}]\n${m.content}`).join('\n\n');
  $('send').disabled=false;$('status').textContent='尚未调用 API，等待你确认。';
}
$('send').addEventListener('click',async()=>{
  if(started||finished||!config)return;started=true;$('send').disabled=true;
  const timer=setTimeout(()=>controller.abort(),180000);
  try{
    // Ensure cancellation/cleared session cannot accidentally resurrect a job.
    const active=await chrome.runtime.sendMessage({type:'TAOA_PERSONAL_RUNNER_CLAIM',requestId});if(!active?.ok)throw new Error(active?.error||'任务已取消或失效。');
    await emit({type:'progress',stage:'requesting'});$('status').textContent='已发送至所选接口，正在等待 AI 回复…';
    const result=await TAOAAPI.complete(config,config.key,job.input.messages,controller.signal);
    if(controller.signal.aborted||finished)throw new Error('已取消等待；服务商可能已计费。');
    await emit({type:'progress',stage:'organizing'});
    result.text=TAOAAPI.validateSuggestions(result.text,job.input.itemId);
    $('result').textContent=result.text;$('result-panel').hidden=false;
    await emit({type:'result',result});finished=true;$('status').textContent='分析成功，建议已发送回工作台左侧。可以关闭此页。';
  }catch(error){finished=true;$('status').textContent=error.message;await emit({type:'error',message:error.message}).catch(()=>{});}
  finally{clearTimeout(timer);config=null;$('cancel').disabled=true;}
});
async function cancel(){
  if(finished)return;controller.abort();finished=true;$('send').disabled=true;$('cancel').disabled=true;
  $('status').textContent='已取消；若已发送，服务商可能已计费。';
  await emit({type:'error',message:$('status').textContent}).catch(()=>{});config=null;
}
$('cancel').addEventListener('click',cancel);
$('back').addEventListener('click',async()=>{if(job)await chrome.tabs.update(job.tabId,{active:true}).catch(()=>{});});
chrome.runtime.onMessage.addListener((m,sender)=>{if(sender.id===chrome.runtime.id&&m.type==='TAOA_PERSONAL_ABORT'&&m.requestId===requestId)void cancel();});
load().catch(error=>{$('status').textContent=error.message;void emit({type:'error',message:error.message}).catch(()=>{});});
