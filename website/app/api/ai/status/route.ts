import { runtime,userIdentity,companyAllowed,responseJSON,errorResponse } from '@/lib/ai/runtime';
import { providers,MAX_OUTPUT_TOKENS } from '@/lib/ai/providers';
import { MAX_INPUT_CHARACTERS } from '@/lib/ai/service';
import { limits } from '@/lib/ai/quota';

export const dynamic='force-dynamic';
export async function GET(request:Request){
  try{
    const config=runtime(),authenticated=Boolean(userIdentity(request)),enabled=config.AI_ENABLED==='true';
    const list=Object.values(providers).map(p=>({id:p.id,label:p.label,models:p.models,configured:p.configured(config)}));
    const allowed=companyAllowed(userIdentity(request),config);
    const ready=allowed&&enabled&&!!config.DB&&list.some(p=>p.configured);
    return responseJSON({enabled,authenticated,companyAllowed:allowed,ready,providers:allowed?list:[],limits:{inputCharacters:MAX_INPUT_CHARACTERS,outputTokens:MAX_OUTPUT_TOKENS,...limits(config)},
      message:!allowed?'公司额度未向此账号开放。请配置个人 API，或使用手动草稿。':!list.some(p=>p.configured)?'等待管理员配置 DeepSeek 密钥；手动草稿仍可使用。':!enabled?'管理员尚未启用 AI 调用；手动草稿仍可使用。':!authenticated?'请登录获准访问工作台的账号后使用 AI。':!config.DB?'用量保护尚未就绪，请联系管理员。':'管理员已启用 API；点击发送才会调用。实际连通性以分析结果为准。'});
  }catch(error){return errorResponse(error)}
}
