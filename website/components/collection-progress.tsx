'use client';
import { useEffect, useState } from 'react';
import { Progress } from '@/components/ui/progress';
import type { CollectionProgress as ProgressData } from '@/lib/collection-progress';

export function CollectionProgress({progress, onControl}: {progress: ProgressData; onControl?: (action:'pause'|'resume')=>void}) {
  const [now,setNow] = useState<number|null>(null);
  useEffect(()=>{setNow(Date.now());const timer=window.setInterval(()=>setNow(Date.now()),1000);return()=>window.clearInterval(timer)},[]);
  const next = Date.parse(progress.nextRunAt), updated = Date.parse(progress.updatedAt);
  const remaining = now && Number.isFinite(next) ? Math.max(0,Math.ceil((next-now)/1000)) : null;
  const stale = progress.state === 'running' && now && Number.isFinite(updated) && now-updated>90000;
  return <div className="mt-3 shrink-0 rounded-xl border border-border bg-secondary/65 p-3" aria-label="采集实时进度">
    <p role="status" className={`text-sm font-medium leading-5 ${progress.state==='paused'?'text-[#a04418]':'text-primary'}`}>{progress.detail}</p>
    <div className="mt-2 grid grid-cols-2 gap-2">{progress.metrics.map(metric=><div key={metric.label}><p className="text-xs text-muted-foreground">{metric.label}</p><p className="mt-0.5 text-lg font-semibold tabular-nums">{metric.value}</p></div>)}</div>
    <div className="mt-2 space-y-2">{progress.bars.map(bar=>{
      const percent=bar.total===null?null:Math.min(100,Math.floor(bar.read/bar.total*100));
      return <div key={bar.label}><div className="mb-1 flex justify-between gap-2 text-xs text-muted-foreground"><span>{bar.label}</span><span className="tabular-nums">{bar.total===null?`${bar.read} / 总量待确认`:`${bar.read} / ${bar.total} · ${percent}%`}</span></div>
        <Progress aria-label={`${bar.label}进度`} value={percent} className={percent===null?'[&_[data-slot=progress-indicator]]:w-0':'[&_[data-slot=progress-track]]:h-1.5'}/>
      </div>;
    })}</div>
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <div>{progress.nextRunAt&&<p>{remaining===null?'等待下一批':remaining>0?`约 ${remaining} 秒后尝试继续`:'等待后台启动下一批'}</p>}<p>{Number.isFinite(updated)?`进度更新 ${new Date(updated).toLocaleTimeString('zh-CN',{hour12:false,timeZone:'Asia/Shanghai'})}`:'等待进度回传'}</p></div>
      {onControl&&progress.control&&<button type="button" onClick={()=>onControl(progress.control!)} className="rounded-md border border-input bg-white px-2 py-1 text-sm font-medium text-primary">{progress.control==='pause'?'暂停采集':'继续采集'}</button>}
    </div>
    {stale&&<p className="mt-1 text-xs text-[#a04418]">暂未收到新进度，请检查商品页；不会自动跳过验证。</p>}
  </div>;
}
