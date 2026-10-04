import { authorize,runtime,responseJSON,errorResponse } from '@/lib/ai/runtime';
import { readLimitedBody,resolveProvider } from '@/lib/ai/providers';
import { validateInput,analysisMessages,validateReply } from '@/lib/ai/service';
import { actorHash,reserve,finish } from '@/lib/ai/quota';
import { AIError } from '@/lib/ai/types';

export const dynamic='force-dynamic';
export async function POST(request:Request){
  let reservation:{db:D1Database;id:string}|undefined;
  try{
    const user=authorize(request),config=runtime();
    if(config.AI_ENABLED!=='true')throw new AIError(503,'disabled','管理员尚未启用 AI 调用，请继续使用手动草稿。');
    if(!config.DB)throw new AIError(503,'quota_unavailable','用量保护尚未就绪，未发送给 AI。');
    let payload;try{payload=JSON.parse(await readLimitedBody(request,240000))}catch(error){if(error instanceof AIError)throw error;throw new AIError(400,'invalid_json','分析资料格式不正确。')}
    const input=validateInput(payload),provider=resolveProvider(input.providerId,input.modelId);
    if(!provider.configured(config))throw new AIError(503,'missing_key','所选服务商尚未配置密钥，请联系管理员。');
    await reserve(config.DB,input.requestId,await actorHash(user),`${input.providerId}/${input.modelId}`,config);
    reservation={db:config.DB,id:input.requestId};
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),90000);
    const cancel=()=>controller.abort();request.signal.addEventListener('abort',cancel,{once:true});
    let result;
    try{if(request.signal.aborted)controller.abort();result=await provider.complete(config,input.modelId,analysisMessages(input),controller.signal)}
    catch(error){if(controller.signal.aborted)throw new AIError(504,'timeout','分析超时或已取消；没有自动重试。服务商可能已计费，资料仍保留。');throw error}
    finally{clearTimeout(timer);request.signal.removeEventListener('abort',cancel)}
    const suggestions=validateReply(result.text,input.itemId);
    await finish(config.DB,input.requestId,'success',result.inputTokens,result.outputTokens);reservation=undefined;
    return responseJSON({itemId:input.itemId,requestId:input.requestId,provider:provider.label,model:input.modelId,suggestions,text:JSON.stringify({itemId:input.itemId,suggestions},null,2),usage:{inputTokens:result.inputTokens,outputTokens:result.outputTokens},notice:'仅基于本次文字资料；AI 建议需人工核实，未查看图片。'});
  }catch(error){
    if(reservation){try{await finish(reservation.db,reservation.id,'failed')}catch{/* Fail closed: the reservation continues to count. */}}
    return errorResponse(error);
  }
}
