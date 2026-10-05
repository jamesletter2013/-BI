'use client';
import { ExternalLink, Link2, PackageSearch, RefreshCw, Sparkles } from 'lucide-react';
import { ModuleCard } from '@/components/module-card';

type ProductInformationProps = {
  url: string; onUrlChange: (value: string) => void; checking: boolean; loadingSaved: boolean;
  onCapture: () => void; onLoadSaved: () => void; onAnalyze: () => void;
  product: { title: string; shop: string; price: string; positiveRate: string; serviceScore: string; mainImages: string[] };
  itemId: string; status: string; sales: string; reviews: string; rating: string; note: string;
  onSalesChange: (value: string) => void; onReviewsChange: (value: string) => void;
  onRatingChange: (value: string) => void; onNoteChange: (value: string) => void;
};

function Field({ label, value, onChange }: { label: string; value: string; onChange?: (value: string) => void }) {
  return <label className="min-w-0 rounded-lg bg-muted p-2.5 text-xs text-muted-foreground">{label}
    {onChange ? <input aria-label={label} value={value} onChange={event => onChange(event.target.value)} placeholder="待补充"
      className="mt-1 h-8 w-full min-w-0 rounded border border-border bg-white px-2 text-sm font-medium text-foreground" />
      : <span title={value} className="mt-2 block break-words text-sm font-semibold text-foreground">{value || '待采集'}</span>}
  </label>;
}

export function ProductInformation(props: ProductInformationProps) {
  const { product } = props;
  return <ModuleCard label="商品信息" eyebrow="Product overview" actions={<span className="rounded bg-secondary px-2 py-1 text-xs text-primary">概况与补充</span>}>
    <label className="block text-sm font-medium" htmlFor="product-url">商品链接 / 商品 ID</label>
    <div className="relative mt-1.5"><Link2 className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <input id="product-url" value={props.url} onChange={event => props.onUrlChange(event.target.value)} className="h-9 w-full rounded-lg border border-border pl-8 pr-2 text-sm outline-none focus:border-primary" />
    </div>
    <button onClick={props.onCapture} disabled={props.checking} className="mt-2.5 flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-white hover:bg-[#a73606] disabled:opacity-60">
      <RefreshCw className={props.checking ? 'size-3.5 animate-spin' : 'size-3.5'} />{props.checking ? '正在后台采集' : '采集已打开的商品页'}
    </button>
    <p className="mt-1.5 text-xs leading-5 text-muted-foreground">V1.3.5 起不再新开商品页。请先打开对应商品并保持登录，采集期间保留标签；正常采集不切前台，需要验证时再显示商品页。</p>
    <button type="button" onClick={props.onLoadSaved} disabled={props.checking || props.loadingSaved} className="mt-2 w-full rounded-lg border border-input bg-white px-3 py-2 text-sm font-medium text-primary hover:bg-secondary disabled:opacity-50">{props.loadingSaved ? '正在读取已存评价…' : '读取已保存评价（不重采）'}</button>
    <div className="mt-4 flex items-start gap-2.5">
      <div className="size-12 shrink-0 overflow-hidden rounded-lg bg-muted">{product.mainImages[0]
        ? <img src={product.mainImages[0]} alt="商品" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
        : <div className="grid h-full place-items-center"><PackageSearch className="size-5 text-muted-foreground" /></div>}</div>
      <p className="min-w-0 break-words text-sm font-semibold leading-5">{product.title || '待采集商品标题'}</p>
    </div>
    <div className="mt-3 grid grid-cols-2 gap-2">
      <Field label="当前到手价（元）" value={product.price} /><Field label="商品 ID" value={props.itemId} />
      <Field label="累计销量" value={props.sales} onChange={props.onSalesChange} /><Field label="评价数量" value={props.reviews} onChange={props.onReviewsChange} />
      <Field label="店铺评分" value={props.rating} onChange={props.onRatingChange} /><Field label="好评率" value={product.positiveRate} />
      <Field label="客服满意度" value={product.serviceScore} /><Field label="店铺" value={product.shop} />
    </div>
    <p className="mt-3 rounded-md bg-[#fff7df] px-2.5 py-1.5 text-sm text-[#9a5b0c]">{props.status}</p>
    {/^https:\/\//.test(props.url) && <a href={props.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">查看原商品页 <ExternalLink className="size-3" /></a>}
    <label className="mt-3 block text-sm font-medium">页面备注<textarea value={props.note} onChange={event => props.onNoteChange(event.target.value)} rows={2} placeholder="记录活动、发货、包装或客服观察" className="mt-1 w-full resize-none rounded-lg border border-border px-2 py-1.5 text-sm" /></label>
    <button onClick={props.onAnalyze} className="mt-2 flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-white hover:bg-[#a73606]"><Sparkles className="size-3.5" />推送资料到分析对话</button>
  </ModuleCard>;
}
