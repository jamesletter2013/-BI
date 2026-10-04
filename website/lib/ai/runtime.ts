import 'server-only';
import { env } from 'cloudflare:workers';
import { AIError } from './types';
import type { ProviderConfig } from './providers';

export type AIRuntime=ProviderConfig & {DB?:D1Database};
export function runtime():AIRuntime{return env as unknown as AIRuntime}
export function userIdentity(request:Request){
  // Sites dispatch authenticates access and supplies these headers. Never use
  // this trust boundary on a generic host without replacing its authentication.
  const user=request.headers.get('oai-authenticated-user-id');
  const email=request.headers.get('oai-authenticated-user-email');
  return user&&email?user:null;
}
export function authorize(request:Request){
  const user=userIdentity(request);if(!user)throw new AIError(401,'sign_in_required','请先登录有权限访问工作台的账号。');
  const origin=request.headers.get('origin');
  if(origin!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site')throw new AIError(403,'wrong_origin','只允许从当前工作台发起分析。');
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw new AIError(415,'invalid_content_type','请求格式不正确。');
  return user;
}
export function responseJSON(body:unknown,status=200){return Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}})}
export function errorResponse(error:unknown){
  if(error instanceof AIError)return responseJSON({error:{code:error.code,message:error.message}},error.status);
  return responseJSON({error:{code:'unavailable',message:'分析服务暂时不可用，资料仍保留；没有自动重试。'}},503);
}
