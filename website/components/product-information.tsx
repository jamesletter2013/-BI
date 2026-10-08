'use client';
import { ExternalLink, Link2, PackageSearch, RefreshCw, Sparkles } from 'lucide-react';
import { ModuleCard } from '@/components/module-card';
import { productTitleLength, type ProductParameter } from '@/lib/product-parameters';
import { categoryDisplayName } from '@/lib/category-display';

type ProductInformationProps = {
  url: string; onUrlChange: (value: string) => void; checking: boolean; loadingSaved: boolean;
  onCapture: () => void; onLoadSaved: () => void; onAnalyze: () => void;
  product: { title: string; shop: string; price: string; positiveRate: string; serviceScore: string; mainImages: string[]; shopMetrics?: ProductParameter[]; capturedAt?: string; categoryPath?: string; categorySource?: string; listedAt?: string; listedAtSource?: string };
  itemId: string; status: string; sales: string; reviews: string; rating: string; note: string;
  onSalesChange: (value: string) => void; onReviewsChange: (value: string) => void;
  onRatingChange: (value: string) => void; onNoteChange: (value: string) => void;
};

function Field({ label, value, onChange, empty = '待采集', tooltip }: { label: string; value: string; onChange?: (value: string) => void; empty?: string; tooltip?: string }) {
  return <label className="min-w-0 rounded-lg bg-muted p-2.5 text-xs text-muted-foreground">{label}
    {onChange ? <input aria-label={label} value={value} onChange={event => onChange(event.target.value)} placeholder="待补充"
      className="mt-1 h-8 w-full min-w-0 rounded border border-border bg-white px-2 text-sm font-medium text-foreground" />
      : <span title={tooltip || value} className="mt-2 block break-words text-sm font-semibold text-foreground">{value || empty}</span>}
  </label>;
}

export function ProductInformation(props: ProductInformationProps) {
  const { product } = props;
  const metrics = product.shopMetrics || [];
  const overall = metrics.find(row => /^(综合体验|店铺评分)$/.test(row.name));
  const positive = metrics.find(row => /^(88VIP好评率|好评率)$/.test(row.name));
  const satisfaction = metrics.find(row => row.name === '客服满意度');
  const extraMetrics = metrics.filter(row => !/^(综合体验|店铺评分|客服满意度|88VIP好评率|好评率)$/.test(row.name));
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
      <div className="min-w-0"><p className="break-words text-sm font-semibold leading-5">{product.title || '待采集商品标题'}</p>
        {product.title && <p title="空格、汉字、字母、数字及标点均计入，换行不计" className="mt-1 text-xs text-muted-foreground">标题共 {productTitleLength(product.title)} 字（含空格）</p>}
      </div>
    </div>
    <div className="mt-3 grid grid-cols-2 gap-2">
      <Field label="当前到手价（元）" value={product.price} /><Field label="商品 ID" value={props.itemId} />
      <Field label="累计销量" value={props.sales} onChange={props.onSalesChange} /><Field label="评价数量" value={props.reviews} onChange={props.onReviewsChange} />
      <Field label={overall?.name || '店铺评分'} value={props.rating} onChange={props.onRatingChange} /><Field label={positive?.name || '好评率'} value={positive?.value || product.positiveRate} />
      <Field label="客服满意度" value={satisfaction?.value || ''} empty={product.capturedAt ? '未读取到' : '待采集'} /><Field label="店铺" value={product.shop} />
      {extraMetrics.map(row => <Field key={row.name} label={row.name} value={row.value} />)}
      <div className="col-span-2 grid" title={product.categorySource || '读取商品页明确标注的类目，不根据标题推测'}>
        <Field label="上架类目" value={categoryDisplayName(product.categoryPath)} tooltip={[product.categoryPath, product.categorySource].filter(Boolean).join('\n')} empty={product.capturedAt ? '未读取到' : '待采集'} />
      </div>
      <div className="col-span-2 grid" title={product.listedAtSource || '仅读取明确上架时间，不以“上市时间”代替'}>
        <Field label="上架时间" value={product.listedAt || ''} empty={product.capturedAt ? '未读取到' : '待采集'} />
      </div>
    </div>
    <p className="mt-3 rounded-md bg-[#fff7df] px-2.5 py-1.5 text-sm text-[#9a5b0c]">{props.status}</p>
    {/^https:\/\//.test(props.url) && <a href={props.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">查看原商品页 <ExternalLink className="size-3" /></a>}
    <label className="mt-3 block text-sm font-medium">页面备注<textarea value={props.note} onChange={event => props.onNoteChange(event.target.value)} rows={2} placeholder="记录活动、发货、包装或客服观察" className="mt-1 w-full resize-none rounded-lg border border-border px-2 py-1.5 text-sm" /></label>
    <button onClick={props.onAnalyze} className="mt-2 flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-white hover:bg-[#a73606]"><Sparkles className="size-3.5" />推送资料到分析对话</button>
  </ModuleCard>;
}
