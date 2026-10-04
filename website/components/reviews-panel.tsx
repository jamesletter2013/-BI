'use client';
import { useEffect, useState, type ReactNode } from 'react';
import type { Review, ReviewsCapture } from '@/lib/reviews';
import { reviewDiagnostic, reviewScopeLabels, reviewCounts, reviewHasContent } from '@/lib/reviews';
import { collectionProgress } from '@/lib/collection-progress';
import { CollectionProgress } from '@/components/collection-progress';
import { reviewDetails } from '@/lib/review-export';
import { reviewRating, ratingLabels, ratingCounts, type ReviewRating } from '@/lib/review-rating';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

function ReviewRow({row,index}:{row:Review;index:number}){
  return <article className="rounded-lg border border-border bg-white p-3 text-sm leading-6">
    <p className="mb-1 text-xs font-medium text-foreground">{ratingLabels[reviewRating(row.rateType)]} · 平台评价标签</p>
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>评价 {index+1}</span><span>{row.feedbackDate||'日期未提供'}</span>{row.isDefault&&<span className="rounded bg-slate-100 px-1.5 text-muted-foreground">默认/未填写原评</span>}{row.textKind==='template'&&<span className="rounded bg-slate-100 px-1.5 text-muted-foreground">统一好评文案</span>}{row.append?.feedback&&<span className="rounded bg-secondary px-1.5 text-primary">有追评</span>}</div>
    {row.sku&&<p className="mt-1 break-words text-xs text-muted-foreground">规格：{row.sku}</p>}
    {row.sources.length>0&&<p className="text-xs text-muted-foreground">读取来源：{[...new Set(row.sources.map(s=>reviewScopeLabels[s.scope]||s.scope))].join('、')}</p>}
    <p className={`mt-1 whitespace-pre-wrap break-words ${row.isDefault?'text-muted-foreground':'text-foreground'}`}>{row.feedback||'原评无正文'}</p>
    {row.images.length>0&&<div className="mt-2 flex flex-wrap gap-1.5">{row.images.map(src=><a key={src} href={src} target="_blank" rel="noreferrer" aria-label="查看评价图片"><img src={src} alt="评价图片" loading="lazy" referrerPolicy="no-referrer" className="size-12 rounded border border-border object-cover"/></a>)}</div>}
    {row.video&&<a href={row.video} target="_blank" rel="noreferrer" className="text-xs text-primary underline">查看评价视频</a>}
    {row.append&&<div className="mt-2 rounded bg-secondary p-2"><p className="text-xs font-medium text-primary">追评 {row.append.date}</p><p className="mt-1 whitespace-pre-wrap break-words">{row.append.feedback||'追评无正文'}</p>{row.append.reply&&<p className="mt-1 text-xs text-muted-foreground">回复：{row.append.reply}</p>}
      {row.append.images.length>0&&<div className="mt-2 flex flex-wrap gap-1.5">{row.append.images.map(src=><a key={src} href={src} target="_blank" rel="noreferrer" aria-label="查看追评图片"><img src={src} alt="追评图片" loading="lazy" referrerPolicy="no-referrer" className="size-12 rounded border border-border object-cover"/></a>)}</div>}
      {row.append.video&&<a href={row.append.video} target="_blank" rel="noreferrer" className="text-xs text-primary underline">查看追评视频</a>}
    </div>}
    {row.textTruncated&&<p className="text-xs text-amber-700">正文过长，当前仅保留部分内容。</p>}
  </article>;
}
export function ReviewsPanel({data,checking,onControl,platformLabel='',supplement}:{data:ReviewsCapture|null;checking:boolean;platformLabel?:string;supplement?:ReactNode;onControl?:(action:'pause'|'resume')=>void}){
  const [visible,setVisible]=useState(20);
  const [query,setQuery]=useState('');
  const [filter,setFilter]=useState('all');
  const [rating,setRating]=useState('all');
  const [showReviews,setShowReviews]=useState(false);
  const [exportNotice,setExportNotice]=useState('');
  useEffect(()=>setVisible(20),[data?.job?.id,data?.itemId]);
  useEffect(()=>{setQuery('');setFilter('all');setRating('all');setShowReviews(false)},[data?.itemId]);
  useEffect(()=>setVisible(20),[query,filter,rating]);
  const items=data?.items||[],counts=reviewCounts(items),is50=data?.coverage?.requestProfile==='pc-all50-v1';
  const ratings=ratingCounts(items);
  const progress=collectionProgress('reviews',data,data?.qa||null,checking);
  const matching=items.filter(row=>(filter!=='text'||reviewHasContent(row))
    &&(rating==='all'||reviewRating(row.rateType)===rating)
    &&(filter!=='append'||row.append?.feedback)&&(filter!=='default'||row.isDefault||row.textKind==='template')
    &&(!query.trim()||[row.feedback,row.append?.feedback,row.sku].some(value=>value?.includes(query.trim()))));
  const declared=platformLabel||data?.scopes[0]?.platformTotal||'未知';
  function downloadDiagnostic(){if(!data)return;const blob=new Blob([JSON.stringify(reviewDiagnostic(data,declared),null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`评价采集诊断-${data.itemId}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function downloadDetails(){if(!data)return;try{
    const snapshot=reviewDetails(data),blob=new Blob([JSON.stringify(snapshot,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;
    a.download=`评价明细-${data.itemId}-${snapshot.exportedAt.replace(/[:.]/g,'-')}.json`;
    document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    setExportNotice(`已发起 ${snapshot.items.length} 条明细下载；是否保存成功请查看浏览器下载记录。`);
  }catch(error){setExportNotice(error instanceof Error?error.message:'明细导出失败，原数据未改动。')}}
  return <section className="workbench-card flex h-[640px] min-h-0 flex-col overflow-hidden p-4" aria-label="自动采集评价">
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border pb-3"><h2 className="text-base font-bold">商品评价</h2><span className="rounded bg-secondary px-2 py-1 text-xs text-primary">进度 · {progress.badge}</span></header>
    <CollectionProgress progress={progress} onControl={onControl}/>
    <div className="module-scroll mt-3" role="region" aria-label="评价内容" tabIndex={0}>
    {!data?checking?<p role="status" className="mt-2 text-sm text-muted-foreground">正在读取商品信息，随后先采问大家、再采评价…</p>:<p className="mt-2 text-sm leading-6 text-muted-foreground">采集器会自动保存评价进度并分批继续；支持近期补采的版本还会检查商品提供的筛选入口。</p>:<>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">页面标注 {declared} · 平台展示量，不作采集总量</p>
      <div className="mt-2 text-sm"><label htmlFor="review-rating-filter" className="font-medium">好中差评筛选</label>
        <select id="review-rating-filter" value={rating} onChange={e=>{setRating(e.target.value);setShowReviews(true)}} className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2">
          <option value="all">全部（{items.length}）</option>{(Object.keys(ratingLabels) as ReviewRating[]).map(key=><option key={key} value={key}>{ratingLabels[key]}（{ratings[key]}）</option>)}
        </select></div>
      <details className="mt-3 rounded-lg border border-border p-3"><summary className="cursor-pointer text-sm text-muted-foreground">采集详情与导出</summary><p className="mt-2 text-xs text-muted-foreground">按平台标签区分；未返回标签的保留为“未标明”。筛选结果在下方评价明细中查看。</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">非模板原评 {counts.content} 条 · 默认/未填写 {counts.default} 条 · 统一文案 {counts.template} 条 · 空原评 {counts.empty} 条 · 有正文追评 {counts.append} 条（追评不重复计数，短文/标点也保留）</p>
      <p className="text-xs leading-5 text-muted-foreground">含非模板正文的独立记录：{counts.contentRecords} 条（原评或追评有正文；不代表体验已核实）</p>
      <div className="mt-3 rounded-lg border border-border p-3 text-sm leading-6">
        <button type="button" onClick={downloadDetails} disabled={!items.length} className="rounded-md bg-primary px-3 py-2 font-medium text-white hover:bg-[#a73606] disabled:opacity-50">导出评价明细（JSON）</button>
        <p className="mt-1 text-muted-foreground">导出当前全部 {items.length} 条已存记录，含原评、追评、日期、规格和来源；不受搜索筛选影响，不含买家资料或登录凭据，不重新采集。</p>
        {data.job?.state==='running'&&<p className="text-amber-700">仍在采集中：导出的是当前快照，不是最终结果。</p>}
        {exportNotice&&<p role="status" className="mt-1 text-primary">{exportNotice}</p>}
      </div>
      {data.coverage&&<div className="mt-2 rounded-lg border border-border bg-secondary p-3 text-sm leading-6"><p className="font-medium text-primary">{is50?`50条分页 · 本轮新增记录 ${data.coverage.addedSinceStart??'待核对'} 条`:`近期补采：额外找回 ${data.coverage.supplementalAdded} 条独立评价`}</p>{is50&&<p className="text-xs text-muted-foreground">保留旧记录 {data.coverage.retainedCount??'待核对'} 条。新增记录可能是默认/统一文案，不等于缺失正文已补齐。</p>}<p className="text-xs text-muted-foreground">{data.coverage.discoveryDone?data.coverage.availableScopes.length?`接口提供入口：${data.coverage.availableScopes.map(s=>reviewScopeLabels[s]).join('、')}`:'当前响应未提供可用的额外筛选入口':'正在检查筛选入口'}。每个入口独立分页后按评价 ID 合并；是否补齐仍待核对。{is50?'不额外请求历史入口，普通接口实际范围以返回标注为准。':'不含历史评价。'}</p></div>}
      <div className="mt-2 space-y-2 rounded-lg bg-muted p-3 text-sm leading-6 text-muted-foreground">{[...new Set(['all','append',...data.scopes.map(s=>s.scope)])].map(scope=>{const s=data.scopes.find(row=>row.scope===scope);return <p key={scope}>{reviewScopeLabels[scope]}：{s?<>{s.readCount} 条 · {s.pages} 页{s.timePeriod?` · ${s.timePeriod}`:''}{s.uniqueAdded!==null?` · 去重新增 ${s.uniqueAdded} 条`:''}<br/><span className="text-xs">接口标注 {s.total??'未知'} 条 · {s.complete?'本入口数量核对通过':s.reason==='filter_not_available'?'当前商品未提供此入口，未请求':s.ended?`本入口已停止（${({count_mismatch:'数量不一致',repeated_page:'重复页',empty_page:'空继续页',pagination_unknown:'分页状态未知'} as Record<string,string>)[s.reason]||'尚未核对完整'}）`:'尚未读完'}{s.totalChanged?`；总数发生变化：首个 ${s.initialTotal}，最近 ${s.total}`:''}</span></>:'尚未读取'}</p>})}
      {data.scopes[0]?.platformTotal&&<p>平台标注：{data.scopes[0].platformTotal}（不是本次实读数量）</p>}
      {data.scopes[0]?.folded!==null&&data.scopes[0]?.folded!==undefined&&<p>平台另标折叠 {data.scopes[0].folded} 条；与已读/筛选结果是否重叠尚未核实，未接入独立折叠入口。</p>}
      {data.scopes.some(s=>s.history)&&<p>未接入独立历史评价入口；普通列表的实际时间范围见上方标注。</p>}
      <p>进度/停止说明：{data.message}</p></div>
      <p className="mt-2 text-sm leading-6 text-amber-800">近期完整性尚未确认：页面总量不能直接作为近期缺失量；各入口可能重叠，不能相加。默认/统一文案不计作具体体验，但其追评保留。</p>
      <details className="mt-3"><summary className="cursor-pointer text-sm text-primary">每页采集记录与诊断</summary><p className="mt-2 text-xs leading-5 text-muted-foreground">仅保留最近100页的分页计数；下载文件不含评价正文、买家资料或登录凭据。</p>
        {data.pageTrace?.length?<div className="mt-2 max-h-64 space-y-2 overflow-y-auto text-xs leading-5">{data.pageTrace.map((p,i)=><p key={i} className="rounded bg-muted p-2">{reviewScopeLabels[p.scope]}第 {p.page} 页{p.pageSize?`（请求每页 ${p.pageSize} 条）`:''}：返回 {p.returned} 条，本入口新增 {p.added} 条{p.uniqueAdded!==null?`，全局新增 ${p.uniqueAdded} 条`:''}<br/>还有下一页：{p.hasNext===null?'未提供':p.hasNext?'是':'否'} · 总页数：{p.totalPage??'未提供'} · 标注条数：{p.total??'未提供'}</p>)}</div>:<p className="mt-2 text-xs text-muted-foreground">旧采集记录未保存逐页字段，更新采集器后会自动记录。</p>}
        <button type="button" onClick={downloadDiagnostic} className="mt-2 rounded border border-input px-3 py-1.5 text-sm text-primary">下载采集诊断</button></details><p className="mt-2 text-xs text-muted-foreground">评价与追评为买家陈述，未核实为商品事实。</p></details>
      {items.length>0&&<details key={`${data.itemId}:${data.job?.id||''}`} open={showReviews} onToggle={e=>setShowReviews(e.currentTarget.open)} className="mt-3"><summary className="cursor-pointer text-sm font-medium text-primary">查看已采集的 {items.length} 条评价</summary>
        <label className="mt-3 block text-sm">搜索正文或规格<input value={query} onChange={e=>setQuery(e.target.value)} className="mt-1 w-full rounded border border-border px-2 py-1.5" placeholder="输入关键词"/></label>
        <div className="mt-2 text-sm"><p id="review-type-label">评价类型</p><Select value={filter} onValueChange={value=>setFilter(value||'all')} items={[{value:'all',label:'全部'},{value:'text',label:'有内容的评价/追评'},{value:'append',label:'含追评'},{value:'default',label:'默认/统一文案'}]}><SelectTrigger aria-labelledby="review-type-label" className="mt-1 w-full border-border"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">全部</SelectItem><SelectItem value="text">有内容的评价/追评</SelectItem><SelectItem value="append">含追评</SelectItem><SelectItem value="default">默认/统一文案</SelectItem></SelectContent></Select></div>
        <p className="mt-2 text-xs text-muted-foreground">匹配 {matching.length} 条（仅筛选已读数据，不发起新请求）</p>
        <div className="mt-2 space-y-2 pr-1">{matching.slice(0,visible).map((row,index)=><ReviewRow key={row.id} row={row} index={index}/>)}{visible<matching.length&&<button type="button" onClick={()=>setVisible(n=>n+20)} className="w-full rounded border border-input bg-secondary py-2 text-sm text-primary">显示后 20 条（已显示 {Math.min(visible,matching.length)}/{matching.length}）</button>}</div></details>}
    </>}{supplement}</div>
  </section>;
}
