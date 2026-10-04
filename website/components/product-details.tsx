'use client';
import { Download, ImageIcon } from 'lucide-react';

export function ProductDetails({images,onPreview,onDownload}:{images:string[];onPreview:(src:string,label:string)=>void;onDownload:()=>void}) {
  return <section className="workbench-card flex h-[640px] min-h-0 flex-col overflow-hidden p-4" aria-label="图文详情固定区域">
    <div className="mb-2 flex shrink-0 items-center justify-between gap-2"><p className="text-xs font-semibold uppercase tracking-[.14em] text-muted-foreground">Product detail · {images.length} 张</p><button type="button" onClick={onDownload} disabled={!images.length} className="inline-flex items-center gap-1 rounded-md border border-input bg-secondary px-2 py-1 text-xs font-medium text-primary disabled:opacity-40"><Download className="size-3"/>一键打包下载</button></div>
    <details open className="group flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-[#fffcf9] [&::details-content]:min-h-0 [&::details-content]:flex-1 [&::details-content]:overflow-hidden">
      <summary className="cursor-pointer border-b border-border bg-white py-2 text-base font-semibold">图文详情 <span className="ml-2 text-xs font-normal text-muted-foreground">展开 / 收起</span></summary>
      <div className="module-scroll h-full" role="region" aria-label="图文详情图片列表" tabIndex={0}>
        {images.map((src,index)=><button type="button" key={`${src}-${index}`} onClick={()=>onPreview(src,`详情图 ${index+1}`)} className="block w-full cursor-zoom-in leading-none"><img src={src} alt={`详情图 ${index+1}`} loading="lazy" className="block h-auto w-full" referrerPolicy="no-referrer"/></button>)}
        {!images.length&&<div className="grid h-full min-h-48 place-items-center rounded-lg border border-dashed border-border p-5"><div className="text-center"><ImageIcon className="mx-auto size-8 text-muted-foreground"/><p className="mt-2 text-sm text-muted-foreground">采集成功后展示详情长图</p></div></div>}
      </div>
    </details>
  </section>;
}
