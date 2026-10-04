import type { AIHistoryMessage, AIModel } from './types';
import { AIError } from './types';

export type ProviderConfig={DEEPSEEK_API_KEY?:string;AI_ENABLED?:string;AI_DAILY_USER_LIMIT?:string;AI_DAILY_TEAM_LIMIT?:string};
export const MAX_OUTPUT_TOKENS=4000;
export interface AIProvider {
  id:string;label:string;models:AIModel[];
  configured:(env:ProviderConfig)=>boolean;
  complete:(env:ProviderConfig,model:string,messages:({role:'system';content:string}|AIHistoryMessage)[],signal:AbortSignal,fetcher?:typeof fetch)=>Promise<{text:string;inputTokens:number|null;outputTokens:number|null}>;
}
function tokens(value:unknown){return Number.isSafeInteger(value)&&Number(value)>=0?Number(value):null}

// Server-only consumers. New providers implement this interface; the browser
// chooses registered IDs, never arbitrary URLs, API keys or system prompts.
const deepseek:AIProvider={
  id:'deepseek',label:'DeepSeek 官方',
  models:[{id:'deepseek-flash',label:'DeepSeek Flash'},{id:'deepseek-v4-pro',label:'DeepSeek V4 Pro'}],
  configured:env=>Boolean(env.DEEPSEEK_API_KEY?.trim()),
  async complete(env,model,messages,signal,fetcher=fetch){
    const response=await fetcher('https://api.deepseek.com/chat/completions',{
      method:'POST',redirect:'error',signal,
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${env.DEEPSEEK_API_KEY?.trim()}`},
      body:JSON.stringify({model,messages,stream:false,max_tokens:MAX_OUTPUT_TOKENS,thinking:{type:'disabled'},response_format:{type:'json_object'}}),
    });
    if(!response.ok){
      await response.body?.cancel();
      const message=response.status===401?'管理员配置的 DeepSeek 密钥无效，请联系管理员。':response.status===402?'DeepSeek 账户额度不足，请联系管理员。':response.status===429?'DeepSeek 当前限流，请稍后手动重试。':'AI 服务暂时不可用；没有自动重试，请稍后再试。';
      throw new AIError(502,'provider_error',message);
    }
    const raw=await readLimitedBody(response,100000);
    let result;try{result=JSON.parse(raw)}catch{throw new AIError(502,'invalid_response','AI 返回了无法识别的内容，请稍后手动重试。')}
    const choice=result?.choices?.[0];
    if(choice?.finish_reason!=='stop')throw new AIError(502,'incomplete_response','AI 回复被中断或超过输出限制；没有生成建议，也不会自动重试。');
    if(typeof choice?.message?.content!=='string'||!choice.message.content.trim())throw new AIError(502,'empty_response','AI 未返回分析内容，请稍后手动重试。');
    return {text:choice.message.content,inputTokens:tokens(result?.usage?.prompt_tokens),outputTokens:tokens(result?.usage?.completion_tokens)};
  },
};
export const providers:Readonly<Record<string,AIProvider>>=Object.freeze({deepseek});
export function resolveProvider(id:string,model:string){
  const provider=Object.hasOwn(providers,id)?providers[id]:undefined;
  if(!provider||!provider.models.some(m=>m.id===model))throw new AIError(400,'unknown_model','请选择管理员已配置的服务商和模型。');
  return provider;
}
export async function readLimitedBody(message:Request|Response,maxBytes:number){
  const reader=message.body?.getReader();if(!reader)return '';
  const decoder=new TextDecoder();let size=0,body='';
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw new AIError(413,'too_large','资料过长，请缩小评价范围、精简问答或改用手动导出；未发送给 AI。')}body+=decoder.decode(value,{stream:true})}body+=decoder.decode();return body}finally{reader.releaseLock()}
}
