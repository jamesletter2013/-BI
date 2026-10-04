import { productParameters } from '@/lib/product-parameters';
import { ModuleCard } from '@/components/module-card';

export function ProductParameters({ attributes, pageText, checking = false }: {
  attributes: string[]; pageText: string; checking?: boolean;
}) {
  const rows = checking ? [] : productParameters(attributes, pageText);
  return <ModuleCard label="商品参数信息" eyebrow="Product specifications" actions={
    <span className="shrink-0 rounded-full bg-secondary px-2.5 py-1 text-sm text-primary">{rows.length ? `${rows.length} 项` : checking ? '读取中' : '待采集'}</span>
  }>
    {rows.length ? <dl className="overflow-hidden rounded-xl border border-border">
      {rows.map(({ name, value }) => <div key={name} className="grid grid-cols-[minmax(88px,.8fr)_minmax(0,1.5fr)] gap-3 border-b border-border px-3 py-3 text-sm leading-6 last:border-0 even:bg-muted/50">
        <dt className="break-words text-muted-foreground">{name}</dt><dd className="break-words font-medium text-foreground">{value}</dd>
      </div>)}
    </dl> : <p className="mt-4 rounded-xl bg-muted p-4 text-sm leading-6 text-muted-foreground">{checking ? '正在读取商品页参数…' : '采集后展示商品页已读取的参数；未读取到的字段不推测。'}</p>}
  </ModuleCard>;
}
