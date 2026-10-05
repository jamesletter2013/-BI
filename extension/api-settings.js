const $=id=>document.getElementById(id);
let saved=null,rows=[],busy=false,dirty=false;
const fields=['name','protocol','baseUrl','model','maxTokens','thinking'];
const hints={chat:'例如 https://api.deepseek.com 或 https://api.openai.com/v1；也可填写以 /chat/completions 结尾的完整地址。',claude:'例如 https://api.anthropic.com/v1；也可填写以 /messages 结尾的完整地址。',gemini:'例如 https://generativelanguage.googleapis.com/v1beta；无需附带模型名或 API Key。'};
function hint(){
  $('hint').textContent=hints[$('protocol').value];
  let official=false;try{official=new URL($('baseUrl').value).hostname==='api.deepseek.com';}catch{}
  $('modelHint').textContent=official?'DeepSeek 官方示例：deepseek-flash。必须完整填写模型 ID，包含连字符；不要填 deepseekflsh。其他模型请从官方控制台复制。':'模型 ID 与配置名称不同，请从服务商控制台准确复制。';
  $('thinkingField').hidden=!(official && $('protocol').value==='chat');
}
async function request(action,profile){
  const r=await chrome.runtime.sendMessage({type:'TAOA_PERSONAL_PROFILES',action,profile});
  if(!r?.ok)throw new Error(r?.error||'无法读取插件配置。');return r;
}
function lock(value){busy=value;for(const el of document.querySelectorAll('button,input,select'))el.disabled=value;
  for(const id of ['clear','delete','test'])$(id).disabled=value||!saved;
  $('revokeConsent').disabled=value||!saved?.consentGranted;
}
function renderList(){
  $('profiles').replaceChildren();
  const empty=document.createElement('option');empty.value='';empty.textContent='新增一套 API';$('profiles').append(empty);
  for(const row of rows){const o=document.createElement('option');o.value=row.id;o.textContent=`${row.name} · ${row.model}${row.configured?'':'（待填密钥）'}`;$('profiles').append(o);}
}
function choose(id){
  saved=rows.find(r=>r.id===id)||null;
  for(const field of fields)$(field).value=saved?.[field]??({protocol:'chat',maxTokens:4000,thinking:'disabled'}[field]||'');
  $('profiles').value=saved?.id||'';$('key').value='';dirty=false;hint();lock(false);
  $('consentState').textContent=saved?.consentGranted?'本套已确认：正常发送不再弹确认窗。':'本套尚未授权：首次发送时需确认。';
  $('status').textContent=saved?(saved.configured?'本套 API 已有会话密钥。留空保存会保留；更换域名必须重新填写密钥。':'本套配置已保留，请补填本次会话密钥。'):'填写新配置；每套 API 的地址、模型和密钥独立保存。';
}
async function reload(id){rows=(await request('list')).profiles;renderList();choose(id??rows[0]?.id);}
function mayDiscard(){return !dirty||confirm('当前有未保存的修改，是否放弃并切换？');}
$('settings').addEventListener('input',()=>{dirty=true;});
$('protocol').addEventListener('change',()=>{dirty=true;hint();});
$('baseUrl').addEventListener('input',hint);
$('profiles').addEventListener('change',()=>{if(mayDiscard())choose($('profiles').value);else $('profiles').value=saved?.id||'';});
$('add').addEventListener('click',()=>{if(mayDiscard()){choose('');$('name').focus();}});
$('settings').addEventListener('submit',async e=>{
  e.preventDefault();if(busy)return;
  try{
    const profile={...Object.fromEntries(fields.map(k=>[k,$(k).value])),id:saved?.id,revision:saved?.revision,key:$('key').value.trim()};
    const config=TAOAAPI.checkCompatibility(profile),origin=new URL(TAOAAPI.endpoint(config)).origin;
    // Keep the permission request attached to the user's save gesture.
    const permission=chrome.permissions.request({origins:[origin+'/*']});lock(true);
    if(!await permission)throw new Error('未授权接口域名，未保存。');
    const r=await request('save',profile);await reload(r.profile.id);
    $('status').textContent=`已保存「${r.profile.name}」。${r.profile.configured?'返回工作台可从下拉框选择。':'尚未填密钥，暂不能调用。'}未调用 API；其他配置未改动。`;
  }catch(error){$('status').textContent=error.message;}finally{lock(false);}
});
$('revokeConsent').addEventListener('click',async()=>{
  if(busy||!saved||!saved.consentGranted)return;
  if(dirty){$('status').textContent='请先保存或放弃当前修改，再撤销授权。';return;}
  const profile={id:saved.id,revision:saved.revision};lock(true);
  try{await request('revokeConsent',profile);await reload(profile.id);$('status').textContent='已撤销本套发送授权。下次发送需重新确认；配置和密钥未删除。';}
  catch(error){$('status').textContent=error.message;}finally{lock(false);}
});
for(const [id,action] of [['clear','clear'],['delete','delete']])$(id).addEventListener('click',async()=>{
  if(busy||!saved)return;
  if(!confirm(`${action==='delete'?'删除这套配置及其密钥':'清除这套配置的会话密钥'}：「${saved.name}」？其他 API 不受影响。`))return;
  const profile={id:saved.id,revision:saved.revision};lock(true);
  try{await request(action,profile);await reload(action==='delete'?'':profile.id);$('status').textContent=action==='delete'?'本套 API 已删除。其他配置未改动。':'已清除本套密钥。不会改用其他账户。';}
  catch(error){$('status').textContent=error.message;}finally{lock(false);}
});
$('test').addEventListener('click',async()=>{
  if(busy||!saved)return;
  if(dirty){$('status').textContent='请先保存修改，再测试本套配置。';return;}
  if(!saved.configured){$('status').textContent='请先填写并保存本套密钥。';return;}
  const c={...saved};
  try{TAOAAPI.checkCompatibility(c);}catch(error){$('status').textContent=error.message;return;}
  if(!confirm(`向「${c.name}」的 ${c.host} / ${c.model} 发送一次简短测试，可能产生费用。不发送商品数据，输出上限 256 tokens${TAOAAPI.thinkingMode(c)?'，使用普通模式（不改变已保存的分析模式）':''}，是否继续？`))return;
  lock(true);const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),90000);
  $('status').textContent='正在测试所选接口，未发送商品数据…';
  try{
    const current=(await request('list')).profiles.find(p=>p.id===c.id);
    const key=(await chrome.storage.session.get('taoaApiKeysV2')).taoaApiKeysV2?.[c.id];
    if(current?.revision!==c.revision||key?.revision!==c.revision||!key?.key)throw new Error('配置已变更或密钥已清除，请重新选择后测试。');
    await TAOAAPI.complete({...c,maxTokens:256,thinking:'disabled'},key.key,[{role:'system',content:'Reply briefly.'},{role:'user',content:'请只回复：连接成功'}],controller.signal);
    $('status').textContent=`「${c.name}」已返回有效文字，连接成功。分析格式仍以实际分析结果为准。`;
  }catch(error){$('status').textContent=error.message;}finally{clearTimeout(timer);lock(false);}
});
reload().catch(()=>{$('status').textContent='无法读取插件设置，请重新加载新版插件。';});
