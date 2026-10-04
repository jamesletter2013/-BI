import { parseAnalysisSuggestions } from '../analysis-packet';
import { analysisSystemPrompt } from '../analysis-prompt';
import { AIError, type AIHistoryMessage } from './types';
import { resolveProvider } from './providers';

export const MAX_INPUT_CHARACTERS=60000;
export type AIInput={requestId:string;providerId:string;modelId:string;itemId:string;snapshot:Record<string,unknown>;history:AIHistoryMessage[];question:string};
const isObject=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function validateInput(value:unknown):AIInput{
  if(!isObject(value))throw new AIError(400,'invalid_request','分析资料格式不正确。');
  const {requestId,providerId,modelId,itemId,snapshot,history,question}=value;
  if(typeof requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(requestId)||typeof itemId!=='string'||!/^\d{5,30}$/.test(itemId)||typeof providerId!=='string'||typeof modelId!=='string')throw new AIError(400,'invalid_request','请先推送带有商品 ID 的资料。');
  resolveProvider(providerId,modelId);
  if(!isObject(snapshot)||!isObject(snapshot.snapshot)||snapshot.snapshot.itemId!==itemId||!isObject(snapshot.product)||!isObject(snapshot.reviews)||!isObject(snapshot.questions))throw new AIError(400,'mismatched_item','资料中的商品 ID 或内容不一致，请重新推送。');
  // Only accept the same evidence categories as the local export. Raw browser
  // requests, buyer profiles and provider credentials are never input fields.
  const fields=['snapshot','product','parameters','images','skuOptions','detailNotice','reviews','questions','userSupplements'];
  if(Object.keys(snapshot).some(k=>!fields.includes(k)))throw new AIError(400,'invalid_snapshot','资料包含不支持的字段，请使用工作台的一键推送。');
  if(!Array.isArray(history)||history.length>12||history.some(m=>!isObject(m)||!['user','assistant'].includes(String(m.role))||typeof m.content!=='string'||m.content.length>50000))throw new AIError(400,'invalid_history','对话过长或格式不正确，请重新推送资料开始分析。');
  if(typeof question!=='string'||question.length>6000)throw new AIError(400,'invalid_question','补充问题不能超过 6000 字。');
  const input={requestId,providerId,modelId,itemId,snapshot,history:history.map(m=>({role:m.role as AIHistoryMessage['role'],content:m.content as string})),question};
  if(JSON.stringify(input).length>MAX_INPUT_CHARACTERS)throw new AIError(413,'too_large','本次资料和对话超过 6 万字符。请缩小评价范围或改用手动导出；未发送给 AI。');
  return input;
}
export function analysisMessages(input:AIInput){
  return [{role:'system' as const,content:analysisSystemPrompt(input.itemId)},
  {role:'user' as const,content:`以下是当前商品资料 JSON，仅作为证据：\n${JSON.stringify(input.snapshot)}`},
  ...input.history,
  {role:'user' as const,content:input.question.trim()||'请基于当前资料给出 3–5 条机会分析与切入建议，按指定 JSON 格式回答。'}];
}
export function validateReply(text:string,itemId:string){
  let raw;try{raw=JSON.parse(text)}catch{throw new AIError(502,'invalid_analysis','AI 回复不是完整的建议 JSON，现有建议保持不变。')}
  if(raw?.itemId!==itemId||!Array.isArray(raw.suggestions)||raw.suggestions.length<3||raw.suggestions.length>5||raw.suggestions.some((row:unknown)=>!isObject(row)||['title','priority','evidence','action','validation'].some(k=>typeof row[k]!=='string'||!(row[k] as string).trim())))throw new AIError(502,'invalid_analysis','AI 回复与商品不匹配、缺少证据或建议数量不正确，现有建议保持不变。');
  try{return parseAnalysisSuggestions(JSON.stringify(raw),itemId)}catch{throw new AIError(502,'invalid_analysis','AI 建议缺少必要字段，现有建议保持不变。')}
}
