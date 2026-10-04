'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Copy, MessageSquarePlus, Plus, ClipboardPaste, ListChecks, Download, Send, LoaderCircle } from 'lucide-react';
import type { AIStatus, AIResponse } from '@/lib/ai/types';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { buildAnalysisPacket, hasAnalysisData, parseAnalysisSuggestions, pushScopeLabels, type AnalysisInput, type AnalysisPacket, type AnalysisSuggestion, type ReviewPushScope } from '@/lib/analysis-packet';

type Message={id:number;text:string;kind:'question'|'reply'|'api';sent?:boolean;label?:string};
export type OpportunityPanelHandle={pushData:()=>void};
export const OpportunityPanel=forwardRef<OpportunityPanelHandle,{input:AnalysisInput;reviewScope?:ReviewPushScope}>(function OpportunityPanel({input,reviewScope='bad'},ref){
  const [packet,setPacket]=useState<AnalysisPacket|null>(null);
  const [messages,setMessages]=useState<Message[]>([]);
  const [question,setQuestion]=useState(''),[reply,setReply]=useState('');
  const [suggestions,setSuggestions]=useState<AnalysisSuggestion[]>([]);
  const [notice,setNotice]=useState(''),[mode,setMode]=useState('question');
  const [ai,setAi]=useState<AIStatus|null>(null),[aiStatusMessage,setAiStatusMessage]=useState('正在检查 AI 配置…');
  const [providerId,setProviderId]=useState('deepseek'),[modelId,setModelId]=useState('deepseek-flash');
  const [consent,setConsent]=useState(false),[sending,setSending]=useState(false),[suggestionOrigin,setSuggestionOrigin]=useState('');
  const pending=useRef<AbortController|null>(null),alive=useRef(true);
  useEffect(()=>{alive.current=true;const controller=new AbortController();fetch('/api/ai/status',{signal:controller.signal,cache:'no-store'}).then(async r=>{if(!r.ok)throw new Error();return await r.json() as AIStatus}).then(data=>{if(!Array.isArray(data.providers)||!data.limits)throw new Error();setAi(data);setAiStatusMessage(data.message)}).catch(()=>{if(!controller.signal.aborted)setAiStatusMessage('暂时无法读取 AI 配置；手动草稿仍可使用。')});return()=>{alive.current=false;controller.abort();pending.current?.abort()}},[]);
  const seq=useRef(0),transcript=useRef<HTMLDivElement>(null),composer=useRef<HTMLTextAreaElement>(null);
  function pushData(){
    if(pending.current){setNotice('分析进行中，请完成或取消后再更新资料。');return}
    if(!hasAnalysisData(input)){setNotice('请先采集商品资料。');return}
    const next=buildAnalysisPacket(input,reviewScope);
    setPacket(next);setSuggestions([]);setMessages([]);setReply('');setSuggestionOrigin('');setMode('question');
    setNotice('资料已推送，已开始新一轮草稿，尚未发送给 AI。可点击发送分析，或继续手动复制。');
    document.getElementById('opportunity')?.scrollIntoView({behavior:'smooth',block:'start'});
    requestAnimationFrame(()=>{transcript.current?.scrollTo({top:0});composer.current?.focus({preventScroll:true})});
  }
  useImperativeHandle(ref,()=>({pushData}));
  function draft(){return [packet?.text,...messages.filter(m=>m.kind==='question').map(m=>`补充要求：${m.text}`),question.trim()?`补充要求：${question.trim()}`:''].filter(Boolean).join('\n\n')}
  async function copyDraft(){try{await navigator.clipboard.writeText(draft());setNotice('已复制。粘贴给现有 AI 分析，再把回复粘贴回来。')}catch{setNotice('复制未成功，可下载资料 TXT，或展开资料后手动复制。')}}
  function downloadDraft(){const url=URL.createObjectURL(new Blob([draft()],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`竞品分析资料-${input.itemId||'待识别'}.txt`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setNotice('已发起 TXT 下载，图片以链接收录；原始采集数据未改动。')}
  function addQuestion(){if(!question.trim())return;setMessages(m=>[...m,{id:++seq.current,text:question.trim(),kind:'question'}]);setQuestion('');setNotice('问题已加入分析资料，尚未发送给 AI。');requestAnimationFrame(()=>transcript.current?.scrollTo({top:transcript.current.scrollHeight,behavior:'smooth'}))}
  function importReply(){if(!packet||pending.current)return;try{const result=parseAnalysisSuggestions(reply,packet.itemId);setSuggestions(result);setSuggestionOrigin('来自粘贴回复');setMessages(m=>[...m,{id:++seq.current,text:reply.trim(),kind:'reply'}]);setReply('');setNotice(`已从粘贴回复整理出 ${result.length} 条建议，显示在左侧；未经本站 AI 核验。`);requestAnimationFrame(()=>transcript.current?.scrollTo({top:transcript.current.scrollHeight,behavior:'smooth'}))}catch(error){setNotice(error instanceof Error?error.message:'回复读取失败；现有建议保持不变。')}}
  async function sendAnalysis(){
    if(!packet||!ai?.ready||!consent||pending.current)return;
    const currentQuestion=question.trim(),history=messages.slice(-12).map(m=>({role:m.kind==='question'?'user':'assistant',content:m.text}));
    const body={requestId:crypto.randomUUID(),providerId,modelId,itemId:packet.itemId,snapshot:packet.packet,history,question:currentQuestion};
    if(JSON.stringify(body).length>ai.limits.inputCharacters){setNotice('资料和对话超过 6 万字符，未发送。请缩小评价范围或改用手动导出；不会自动删减采集内容。');return}
    const controller=new AbortController();pending.current=controller;setSending(true);setNotice('正在分析文字资料，请稍候；不会自动重试。');
    const timeout=setTimeout(()=>controller.abort(),100000);
    try{
      const response=await fetch('/api/ai/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
      const result=await response.json() as AIResponse;
      if(!response.ok)throw new Error(result?.error?.message||'分析暂时失败，资料已保留。');
      if(result.itemId!==packet.itemId||result.requestId!==body.requestId)throw new Error('返回结果与本次资料不一致，未替换建议。');
      const parsed=parseAnalysisSuggestions(result.text,packet.itemId);
      if(!alive.current)return;
      setSuggestions(parsed);setSuggestionOrigin(`来自 ${result.provider}`);
      setMessages(m=>[...m.map(item=>({...item,sent:true})),...(currentQuestion?[{id:++seq.current,text:currentQuestion,kind:'question' as const,sent:true}]:[]),{id:++seq.current,text:result.text,kind:'api',label:`${result.provider} · ${result.model}`}]);setQuestion('');
      setNotice(`已生成 ${parsed.length} 条建议。${result.notice}${result.usage?.inputTokens!=null?` 输入 ${result.usage.inputTokens} / 输出 ${result.usage.outputTokens??'未知'} tokens。`:''}`);
      requestAnimationFrame(()=>transcript.current?.scrollTo({top:transcript.current.scrollHeight,behavior:'smooth'}));
    }catch(error){if(alive.current)setNotice(controller.signal.aborted?'分析已取消或超时；服务商可能已计费。资料与原有建议保留，不会自动重试。':error instanceof Error?error.message:'发送失败，资料已保留。')}
    finally{clearTimeout(timeout);pending.current=null;if(alive.current)setSending(false)}
  }
  return <section id="opportunity" className="workbench-card xl:col-span-3 p-4">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[.14em] text-muted-foreground">Opportunity</p><h2 className="mt-1 text-lg font-bold">机会分析与切入建议</h2></div>
      <button type="button" onClick={pushData} disabled={!hasAnalysisData(input)||sending} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-40"><MessageSquarePlus className="size-4"/>{packet?'更新资料，开始新一轮':'一键推送资料'}</button></div>
    <p className="my-3 text-sm leading-6 text-muted-foreground">推送已采资料 · 选择 AI 分析或手动草稿 · 建议回填左侧。评价范围：{pushScopeLabels[reviewScope]}。推送本身不调用 API。</p>
    <div className="grid items-start gap-4 lg:grid-cols-[1.2fr_1fr]">
      <section className="flex h-[700px] min-w-0 flex-col rounded-2xl border border-border bg-secondary/25" aria-label="机会建议列表">
        <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3"><h3 className="font-semibold">分析建议</h3><span className="text-sm text-primary">{suggestions.length?`${suggestions.length} 条 · ${suggestionOrigin}`:'等待分析回复'}</span></header>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4" tabIndex={0}>
          {!suggestions.length?<div className="rounded-xl border border-dashed border-input bg-white p-6 text-center"><ListChecks className="mx-auto size-8 text-primary"/><h4 className="mt-3 font-semibold">分析完成后，建议会显示在这里</h4><p className="mt-2 text-sm leading-6 text-muted-foreground">{packet?'资料已准备好。右侧发送分析，或粘贴现有 AI 回复，即可整理为建议卡片。':'先推送上方商品资料。这里保留给基于实际资料的分析建议。'}</p></div>
          :suggestions.map((s,i)=><article key={i} className="rounded-xl border border-border bg-white p-4"><div className="flex items-start gap-3"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold text-white">{i+1}</span><div className="min-w-0 flex-1"><h4 className="break-words text-base font-semibold">{s.title}</h4>{s.priority&&<p className="mt-1 text-sm text-primary">优先级：{s.priority}</p>}</div></div>{s.evidence&&<p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">依据：{s.evidence}</p>}<p className="mt-3 whitespace-pre-wrap break-words text-base leading-7">{s.action}</p>{s.validation&&<p className="mt-3 whitespace-pre-wrap break-words rounded-lg bg-secondary p-3 text-sm leading-6">验证：{s.validation}</p>}<button type="button" onClick={()=>{setQuestion(`针对建议 ${i+1}「${s.title}」，请进一步细化：\n${s.action}`);setMode('question');requestAnimationFrame(()=>composer.current?.focus({preventScroll:true}))}} className="mt-3 rounded-lg border border-input px-3 py-1.5 text-sm font-medium text-primary">继续讨论这条建议</button></article>)}
        </div>
      </section>
      <section className="flex h-[700px] min-w-0 flex-col overflow-hidden rounded-2xl border border-input bg-[#fffcf9]" aria-label="最终建议对话草稿">
        <header className="flex shrink-0 items-center justify-between gap-2 bg-[#773014] px-4 py-3 text-white"><h3 className="text-base font-semibold">分析对话</h3><span className="rounded-full bg-white/15 px-2 py-1 text-xs">{sending?'分析中':ai?.ready?'API 已启用':'手动模式'}</span></header>
        <div ref={transcript} role="log" aria-label="对话草稿记录" className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4" tabIndex={0}>
          <section aria-label="AI 服务配置" className="rounded-xl border border-border bg-white p-3">
            <div className="grid grid-cols-2 gap-2"><label className="text-sm font-medium">AI 服务商<select aria-label="AI 服务商" value={providerId} disabled={sending} onChange={e=>{setProviderId(e.target.value);setModelId(ai?.providers.find(p=>p.id===e.target.value)?.models[0]?.id||'')}} className="mt-1 w-full rounded-lg border border-input bg-white p-2 text-sm">{(ai?.providers||[{id:'deepseek',label:'DeepSeek 官方'}]).map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></label><label className="text-sm font-medium">模型<select aria-label="AI 模型" disabled={sending} value={modelId} onChange={e=>setModelId(e.target.value)} className="mt-1 w-full rounded-lg border border-input bg-white p-2 text-sm">{(ai?.providers.find(p=>p.id===providerId)?.models||[{id:'deepseek-flash',label:'DeepSeek Flash'}]).map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</select></label></div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{aiStatusMessage}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">本版只分析文字，不读取图片链接。密钥由管理员在服务端配置；后续可增加其他服务商。</p>
            {ai&&<p className="mt-1 text-xs leading-5 text-muted-foreground">每日每人最多 {ai.limits.userDaily} 次 / 团队 {ai.limits.teamDaily} 次；最多 6 万字符输入、{ai.limits.outputTokens} tokens 输出。失败尝试也计入次数；不是金额上限。</p>}
          </section>
          {!packet&&<div className="rounded-xl border border-dashed border-input p-5 text-center"><MessageSquarePlus className="mx-auto size-7 text-primary"/><p className="mt-3 font-medium">先把商品资料推送进来</p><p className="mt-2 text-sm leading-6 text-muted-foreground">商品信息、参数、主图、SKU、详情、问大家按已采集内容收录，评价默认只选差评。</p></div>}
          {packet&&<article className="rounded-2xl rounded-tr-sm border border-input bg-secondary p-3"><p className="font-medium text-primary">已推送的资料 · {sending?'发送分析中':messages.some(m=>m.kind==='api')?'已用于分析':'待发送'}</p><p className="mt-2 break-words text-sm leading-6">{packet.summary}</p><p className="mt-1 text-xs text-muted-foreground">{packet.packet.snapshot.collecting?'采集中快照，后续新增需再次更新。':'仅当前已采集快照。'} 图片仅为链接，本版在线分析不读取图片。</p>{!packet.packet.reviews.included&&<p className="mt-2 text-sm text-[#9a5b0c]">当前范围未采到评价，仍会推送其余资料；不代表商品没有差评。</p>}<details className="mt-2"><summary className="cursor-pointer text-sm font-medium text-primary">查看完整分析资料</summary><textarea aria-label="已推送分析资料" readOnly value={packet.text} className="mt-2 h-52 w-full resize-none rounded-lg border border-input bg-white p-2 text-sm leading-6"/></details></article>}
          {messages.map(m=><article key={m.id} className={`rounded-2xl p-3 ${m.kind!=='question'?'mr-3 border border-border bg-white':'ml-3 bg-secondary'}`}><p className="mb-2 text-xs font-medium text-primary">{m.kind==='api'?`${m.label} · 需人工核实`:m.kind==='reply'?'AI 回复 · 手动粘贴，未核验':`我的问题 · ${m.sent?'已发送':'待发送'}`}</p>{m.kind!=='question'?<details><summary className="cursor-pointer text-sm">查看回复原文</summary><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 [overflow-wrap:anywhere]">{m.text}</p></details>:<p className="whitespace-pre-wrap break-words text-sm leading-6">{m.text}</p>}</article>)}
          {sending&&<p className="flex items-center gap-2 text-sm text-primary" role="status"><LoaderCircle className="size-4 animate-spin"/>正在分析文字资料…</p>}
        </div>
        <div className="shrink-0 border-t border-border bg-white p-3">
          <label className="mb-2 flex items-start gap-2 text-sm leading-5"><Checkbox checked={consent} disabled={sending} onCheckedChange={value=>setConsent(Boolean(value))} className="mt-0.5"/>同意将当前资料发送至所选 AI，并使用公司 API 额度</label>
          <div className="mb-2 flex items-center gap-2"><button type="button" onClick={sendAnalysis} disabled={!packet||!ai?.ready||!consent||sending||!ai.providers.find(p=>p.id===providerId)?.configured} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-40">{sending?<LoaderCircle className="size-4 animate-spin"/>:<Send className="size-4"/>}{sending?'正在分析':'发送并生成建议'}</button>{sending&&<button type="button" onClick={()=>pending.current?.abort()} className="rounded-lg border border-input px-3 py-2 text-sm">取消等待</button>}</div>
          <p className="mb-2 text-xs leading-5 text-muted-foreground">发送本次快照、最近 12 条对话及当前问题；超长不会自动删减。更新资料会清空这一轮对话。</p>
          <div className="mb-3 flex flex-wrap gap-2"><button type="button" disabled={!packet} onClick={copyDraft} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm text-white disabled:opacity-40"><Copy className="size-4"/>复制分析资料</button><button type="button" disabled={!packet} onClick={downloadDraft} className="inline-flex items-center gap-1.5 rounded-lg border border-input px-3 py-2 text-sm text-primary disabled:opacity-40"><Download className="size-4"/>下载资料 TXT</button></div>
          <Tabs value={mode} onValueChange={value=>setMode(String(value))}><TabsList className="h-9 w-full"><TabsTrigger value="question">补充问题</TabsTrigger><TabsTrigger value="reply">粘贴 AI 回复</TabsTrigger></TabsList>
            <TabsContent value="question"><form onSubmit={event=>{event.preventDefault();addQuestion()}}><label className="sr-only" htmlFor="opportunity-question">补充问题或要求</label><textarea ref={composer} id="opportunity-question" disabled={sending} value={question} onChange={e=>setQuestion(e.target.value)} maxLength={6000} placeholder="例如：重点找出差评暴露的问题，给我 3 条切入建议。" className="mt-1 h-20 w-full resize-none rounded-lg border border-input bg-[#fffaf6] p-2 text-sm leading-6"/><button type="submit" disabled={!packet||!question.trim()||sending} className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-input px-3 py-1.5 text-sm text-primary disabled:opacity-40"><Plus className="size-4"/>加入草稿</button></form></TabsContent>
            <TabsContent value="reply"><label className="sr-only" htmlFor="analysis-reply">AI 分析回复</label><textarea id="analysis-reply" disabled={sending} value={reply} onChange={e=>setReply(e.target.value)} maxLength={50000} placeholder="粘贴 AI 完整回复（JSON 或按 1.、2.、3. 分条），最多 5 万字。" className="mt-1 h-20 w-full resize-none rounded-lg border border-input bg-[#fffaf6] p-2 text-sm leading-6"/><button type="button" disabled={!packet||!reply.trim()||sending} onClick={importReply} className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm text-white disabled:opacity-40"><ClipboardPaste className="size-4"/>整理为左侧建议</button></TabsContent>
          </Tabs>
          <p role="status" className="mt-2 text-xs leading-5 text-muted-foreground">{notice||'仅本页暂存；刷新或切换商品前请先复制。'}</p>
        </div>
      </section>
    </div>
  </section>;
});
