// Shared by extension-owned pages and offline tests. Never runs in a website.
globalThis.TAOAAPI = (() => {
  const formats = ['chat', 'claude', 'gemini'];
  function endpoint(settings) {
    if (!formats.includes(settings.protocol)) throw new Error('请选择支持的接口格式。');
    const model = String(settings.model || '').trim();
    if (!model || model.length > 200 || /[\s?#]/.test(model)) throw new Error('请填写有效的模型 ID，不是模型显示名称。');
    let url;
    try { url = new URL(String(settings.baseUrl || '').trim()); } catch { throw new Error('请填写完整 HTTPS 接口地址。'); }
    // Do not turn a user-configurable API into a local-network or credential proxy.
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !host.includes('.') || /(^|\.)(localhost|local|internal|test)$/.test(host) || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':') || host.endsWith('.'))
      throw new Error('仅支持公网 HTTPS 域名；地址不能带密钥、查询参数、账号或锚点。');
    let p = url.pathname.replace(/\/+$/, '');
    if (settings.protocol === 'chat' && !p.endsWith('/chat/completions')) p += '/chat/completions';
    if (settings.protocol === 'claude' && !p.endsWith('/messages')) p = (p || '/v1') + '/messages';
    if (settings.protocol === 'gemini') {
      if (p.includes(':generateContent')) throw new Error('Gemini 请填写版本基础地址，例如 https://generativelanguage.googleapis.com/v1beta；模型单独填写。');
      p = (p || '/v1beta') + '/models/' + encodeURIComponent(model) + ':generateContent';
    }
    url.pathname = p;
    return url.href;
  }
  function settings(value) {
    const result = { protocol: value.protocol, baseUrl: String(value.baseUrl || '').trim(), model: String(value.model || '').trim(), maxTokens: Number(value.maxTokens || 4000), thinking: value.thinking || 'disabled', revision: value.revision };
    endpoint(result);
    if (!Number.isInteger(result.maxTokens) || result.maxTokens < 256 || result.maxTokens > 16000) throw new Error('输出上限请填写 256–16000 的整数。');
    if (!['disabled','enabled'].includes(result.thinking)) throw new Error('请选择普通分析或深度思考。');
    return result;
  }
  function validateInput(value) {
    if (!value || !/^[0-9a-f-]{36}$/i.test(value.requestId || '') || !/^\d{5,30}$/.test(value.itemId || '') || !Array.isArray(value.messages) || value.messages.length < 2 || value.messages.length > 15)
      throw new Error('分析资料格式不正确，请重新推送。');
    const messages = value.messages.map((m, i) => {
      if (!m || !['system','user','assistant'].includes(m.role) || (m.role === 'system' && i !== 0) || typeof m.content !== 'string') throw new Error('分析对话格式不正确。');
      return {role:m.role, content:m.content};
    });
    if (messages[0].role !== 'system' || JSON.stringify(messages).length > 70000) throw new Error('资料过长或缺少分析规则，请缩小评价范围。');
    return {requestId:value.requestId, itemId:value.itemId, messages};
  }
  function checkCompatibility(config) {
    const s=settings(config),host=new URL(endpoint(s)).hostname;
    // Only reject known misspellings on the official host, not future/custom model IDs.
    if(host==='api.deepseek.com') {
      if(s.protocol!=='chat')throw new Error('DeepSeek 官方接口请选择「通用 Chat Completions」格式。尚未调用 API。');
      if(['deepseekflsh','deepseek-flsh','deepseekflash'].includes(s.model.toLowerCase()))
        throw new Error('模型 ID 疑似拼写错误：DeepSeek Flash 应填写 deepseek-flash（含连字符），请到插件设置修改。尚未调用 API。');
    }
    return s;
  }
  function thinkingMode(config) {
    return config.protocol==='chat' && new URL(endpoint(config)).hostname==='api.deepseek.com' ? (config.thinking || 'disabled') : null;
  }
  function buildRequest(config, key, messages) {
    const s = checkCompatibility(config);
    if (typeof key !== 'string' || !key.trim() || key.length > 4096 || /[\r\n]/.test(key)) throw new Error('请在插件设置中填写 API Key。');
    const headers = {'Content-Type':'application/json'};
    let body;
    if (s.protocol === 'chat') {
      headers.Authorization = 'Bearer ' + key.trim();
      body = {model:s.model, messages, stream:false, max_tokens:s.maxTokens};
      const mode=thinkingMode(s);if(mode)body.thinking={type:mode};
    } else if (s.protocol === 'claude') {
      headers['x-api-key'] = key.trim(); headers['anthropic-version'] = '2023-06-01';
      headers['anthropic-dangerous-direct-browser-access'] = 'true';
      body = {model:s.model, system:messages.filter(m=>m.role==='system').map(m=>m.content).join('\n'), messages:messages.filter(m=>m.role!=='system'), max_tokens:s.maxTokens, stream:false};
    } else {
      headers['x-goog-api-key'] = key.trim();
      body = {systemInstruction:{parts:messages.filter(m=>m.role==='system').map(m=>({text:m.content}))}, contents:messages.filter(m=>m.role!=='system').map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:m.content}]})), generationConfig:{maxOutputTokens:s.maxTokens}};
    }
    return {url:endpoint(s), init:{method:'POST',headers,body:JSON.stringify(body),redirect:'error',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer'}};
  }
  function reply(data, protocol, config) {
    let text, inputTokens, outputTokens, truncated;
    if (protocol === 'chat') {
      text = data.choices?.[0]?.message?.content; inputTokens=data.usage?.prompt_tokens; outputTokens=data.usage?.completion_tokens; truncated=data.choices?.[0]?.finish_reason==='length';
    } else if (protocol === 'claude') {
      text=data.content?.filter(p=>p.type==='text').map(p=>p.text).join('\n'); inputTokens=data.usage?.input_tokens; outputTokens=data.usage?.output_tokens; truncated=data.stop_reason==='max_tokens';
    } else {
      text=data.candidates?.[0]?.content?.parts?.filter(p=>!p.thought && typeof p.text==='string').map(p=>p.text).join('\n'); inputTokens=data.usageMetadata?.promptTokenCount; outputTokens=data.usageMetadata?.candidatesTokenCount; truncated=data.candidates?.[0]?.finishReason==='MAX_TOKENS';
    }
    if (truncated) {
      const reasoning=data.usage?.completion_tokens_details?.reasoning_tokens;
      const detail=Number.isSafeInteger(reasoning)&&reasoning>0?`其中思考消耗 ${reasoning} tokens。`:'';
      const hint=config && thinkingMode(config)==='enabled'?'可切换普通分析，或手动调高输出上限。':'可在插件「更多设置」手动调高单次输出上限。';
      throw new Error(`回复达到输出上限，未替换建议。${detail}${hint}不会自动重试，再次发送可能计费。`);
    }
    if (typeof text !== 'string' || !text.trim() || text.length > 50000) throw new Error('接口没有返回可用文字，请检查协议与模型是否匹配。');
    const tokens = v => Number.isSafeInteger(v) && v >= 0 ? v : null;
    return {text, usage:{inputTokens:tokens(inputTokens),outputTokens:tokens(outputTokens)}};
  }
  function validateSuggestions(text, itemId) {
    let value;
    try { value=JSON.parse(text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'')); } catch { throw new Error('AI 未按要求返回建议 JSON，原建议保持不变；请手动重试或换用支持结构化回答的模型。'); }
    if (value?.itemId!==itemId || !Array.isArray(value.suggestions) || value.suggestions.length<3 || value.suggestions.length>5 || value.suggestions.some(row=>!row || ['title','priority','evidence','action','validation'].some(k=>typeof row[k]!=='string'||!row[k].trim()))) throw new Error('建议与商品不匹配或字段缺失，原建议保持不变。');
    return JSON.stringify(value);
  }
  async function complete(config, key, messages, signal, fetcher=fetch) {
    const request=buildRequest(config,key,messages);
    let response;
    try { response=await fetcher(request.url,{...request.init,signal}); } catch { throw new Error(signal.aborted?'已取消或超时；服务商可能已计费，不会自动重试。':'接口连接失败或发生重定向。请检查地址、权限和网络；不会改用公司额度。'); }
    if (!response.ok) {
      const detail=await errorDetail(response);
      throw new Error(`${detail}（HTTP ${response.status}）。未自动重试，未使用公司额度。`);
    }
    const reader=response.body?.getReader(); if(!reader)throw new Error('接口返回了空响应。');
    let size=0; const chunks=[];
    try { while(true){const {done,value}=await reader.read();if(done)break; size+=value.length;if(size>1048576)throw new Error('接口响应过大，已停止读取。');chunks.push(value);} } finally {await reader.cancel().catch(()=>{});}
    const all=new Uint8Array(size);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.length;}
    let data;try{data=JSON.parse(new TextDecoder().decode(all));}catch{throw new Error('接口没有返回 JSON，请核对接口格式及完整地址。');}
    const result=reply(data,config.protocol,config);
    // Provider errors are never surfaced verbatim; also scrub accidental echoes.
    result.text=result.text.split(key.trim()).join('[密钥已隐藏]');
    return result;
  }
  async function errorDetail(response) {
    const fallback={400:'请求参数不正确，请核对模型 ID、接口格式和资料长度',401:'密钥无效或已失效',402:'账户余额不足，请到服务商控制台检查',403:'接口拒绝访问或模型未授权',404:'接口路径或模型不存在',413:'资料超过接口限制，请缩小评价范围',422:'请求字段不符合接口要求，请核对协议、模型和输出上限',429:'额度不足或请求过于频繁'}[response.status] || '服务商请求失败';
    if(![400,404,422].includes(response.status)){await response.body?.cancel().catch(()=>{});return fallback;}
    // Classify a small structured error locally; never expose/log the provider's raw text.
    const reader=response.body?.getReader();if(!reader)return fallback;
    let size=0;const chunks=[];
    try{
      while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>16384)return fallback;chunks.push(value);}
      const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
      const data=JSON.parse(new TextDecoder().decode(bytes)),error=data?.error;
      const info=[error?.code,error?.type,error?.param,error?.message].filter(v=>typeof v==='string').join(' ').toLowerCase();
      if(/model[_ -]?(not[_ -]?found|not[_ -]?exist|invalid)|(?:invalid|unknown|unsupported) model|model.{0,80}(does not exist|not found|not supported|not available)/.test(info))return '模型 ID 不存在或不可用，请从服务商控制台复制准确 ID（不要填显示名称）';
      if(/context[_ -]?(length|window)|too many tokens|maximum context|input.{0,30}too (long|large)/.test(info))return '资料或对话超过模型上下文限制，请缩小评价范围或开始新一轮';
      if(/max[_ -]?(tokens|output[_ -]?tokens)|maximum output/.test(info))return '输出上限不符合模型要求，请在插件「更多设置」调整 tokens';
      return fallback;
    }catch{return fallback;}finally{await reader.cancel().catch(()=>{});}
  }
  return {settings,endpoint,thinkingMode,checkCompatibility,validateInput,buildRequest,reply,validateSuggestions,complete};
})();
