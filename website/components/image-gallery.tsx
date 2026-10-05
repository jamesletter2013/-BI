'use client';
import { Download, ImageIcon } from 'lucide-react';
import { ModuleCard } from '@/components/module-card';

export function ImageGallery({ images, kind, onPreview, onDownload }: {
  images: string[]; kind: 'main' | 'sku'; onPreview: (src: string, label: string) => void; onDownload: () => void;
}) {
  const label = kind === 'main' ? '商品全部主图' : '商品 SKU 图';
  const imageLabel = kind === 'main' ? '主图' : 'SKU 图';
  return <ModuleCard label={label} eyebrow={kind === 'main' ? 'Product gallery' : 'Product SKU'} className="h-[312px]" actions={
    <div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">{images.length} 张</span>
      <button type="button" title="V1.3.5 起转换为 JPG 后打包" onClick={onDownload} disabled={!images.length} className="inline-flex items-center gap-1 rounded-md border border-input bg-secondary px-2 py-1 text-xs font-medium text-primary hover:bg-accent disabled:opacity-40"><Download className="size-3" />下载</button></div>
  }>
    {images.length ? <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">{images.map((src, i) => <div key={`${src}-${i}`} className="min-w-0 text-center">
      <button type="button" onClick={() => onPreview(src, `${imageLabel} ${i + 1}`)} className="aspect-square w-full cursor-zoom-in overflow-hidden rounded-lg border border-border bg-muted">
        <img src={src} alt={`${imageLabel} ${i + 1}`} loading="lazy" className="h-full w-full object-cover transition-transform hover:scale-105" referrerPolicy="no-referrer" />
      </button><span className="mt-1 block text-xs text-muted-foreground">{imageLabel} {i + 1}</span>
    </div>)}</div> : <div className="grid h-full min-h-24 place-items-center rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground"><div><ImageIcon className="mx-auto mb-2 size-6" />采集成功后展示{imageLabel}</div></div>}
  </ModuleCard>;
}
