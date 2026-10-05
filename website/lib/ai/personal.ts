import type { AIResponse } from './types';

export type PersonalAPIProfile = {
  id: string; name: string; configured: boolean; host: string; model: string;
  protocol: string; revision: string; maxTokens: number; thinking?: 'disabled' | 'enabled' | null; consentGranted?: boolean;
};
export type PersonalJobSummary = { requestId:string;itemId:string;status:'running'|'success'|'failed';stage:'requesting'|'organizing';createdAt:number;finishedAt?:number;profileName:string;model:string };
export type PersonalJob = PersonalJobSummary & {input:{requestId:string;itemId:string;messages:{role:string;content:string}[]};event?:{type:'result';result:AIResponse}|{type:'error';message:string}};
export type PersonalAPIStatus = { installed: boolean; version?: number; profiles: PersonalAPIProfile[]; jobs?:PersonalJobSummary[] };
type PersonalStage = 'confirming' | 'requesting' | 'organizing';
export function personalBridge(type: string, fields: Record<string, unknown> = {}, timeout = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const done = () => { clearTimeout(timer); window.removeEventListener('message', listener); };
    const listener = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== location.origin || event.data?.type !== 'TAOA_PERSONAL_REPLY' || event.data.id !== id) return;
      done();
      if (event.data.response?.ok) resolve(event.data.response);
      else reject(new Error(event.data.response?.error || '个人 API 操作失败。'));
    };
    const timer = setTimeout(() => { done(); reject(new Error('插件未响应。请安装或更新 V1.3.1 后刷新；已提交的任务请先查看后台记录，勿重复发送。')); }, timeout);
    window.addEventListener('message', listener);
    window.postMessage({ type, id, ...fields }, location.origin);
  });
}
export function watchPersonalAnalysis(requestId:string, signal:AbortSignal, progress:(stage:PersonalStage)=>void):Promise<AIResponse> {
  return new Promise((resolve, reject) => {
    let ended=false, timer:ReturnType<typeof setTimeout>|undefined;
    const done=()=>{ended=true;clearTimeout(timer);signal.removeEventListener('abort',abort);};
    // Detaching a viewer (closing, refreshing, switching products) is NOT cancellation.
    const abort=()=>{done();reject(new Error('已断开进度查看，后台任务不会因此停止；可从「后台任务」取回结果。'));};
    const poll=async()=>{
      try{
        const response=await personalBridge('TAOA_PERSONAL_JOB',{requestId});
        if(ended)return;
        const job=response.job as PersonalJob;
        if(job.requestId!==requestId)throw new Error('后台任务编号不一致。');
        if(job.event?.type==='result'){done();resolve(job.event.result);return;}
        if(job.event?.type==='error'){done();reject(new Error(job.event.message));return;}
        progress(job.stage);timer=setTimeout(poll,2000);
      }catch(error){if(!ended){done();reject(error);}}
    };
    if(signal.aborted){abort();return;}
    signal.addEventListener('abort',abort,{once:true});void poll();
  });
}
export async function runPersonalAnalysis(input: {requestId:string;itemId:string;messages:{role:string;content:string}[]}, profileId: string, revision: string, signal: AbortSignal, progress: (stage: PersonalStage) => void, confirmed = false): Promise<AIResponse> {
  if(signal.aborted)throw new Error('尚未发送。');
  await personalBridge('TAOA_PERSONAL_START',{input,profileId,revision,confirmed},10000);
  return watchPersonalAnalysis(input.requestId,signal,progress);
}
