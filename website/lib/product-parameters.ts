export type ProductParameter = { name: string; value: string };
const tidy = (value: string) => value.replace(/\s+/g, ' ').trim();

export function normalizeParameters(input: unknown): ProductParameter[] {
  if (!Array.isArray(input)) return [];
  const result: ProductParameter[] = [], seen = new Set<string>();
  for (const row of input.slice(0, 200)) {
    if (!row || typeof row.name !== 'string' || typeof row.value !== 'string') continue;
    const name = tidy(row.name).replace(/[:：]$/, '').trim(), value = tidy(row.value);
    if (!name || name.length > 60 || !value || value.length > 6000 || /(?:…|\.\.\.)$/.test(name)) continue;
    const key = name + '\0' + value;
    if (!seen.has(key)) { seen.add(key); result.push({ name, value }); }
  }
  return result;
}

export function productParameters(attributes: string[], _pageText = '', structured?: ProductParameter[]): ProductParameter[] {
  // An empty structured result is authoritative. Never guess missing rows from body text.
  if (structured !== undefined) return normalizeParameters(structured);
  // Compatibility only: old explicit pairs. Flattened text has lost its row/card boundaries.
  return normalizeParameters(attributes.flatMap(raw => {
    const match = raw.match(/^\s*([^:：|｜]{1,60})[:：|｜]\s*(.+)$/);
    return match ? [{ name: match[1], value: match[2] }] : [];
  }));
}

const metricNames = new Set(['综合体验', '店铺评分', '宝贝质量', '宝贝描述', '描述相符', '物流速度', '服务保障', '服务体验', '服务态度', '卖家服务', '客服服务', '客服满意度', '88VIP好评率', '好评率', '及时发货率']);
export function normalizeShopMetrics(input: unknown): ProductParameter[] {
  return normalizeParameters(input).filter(row => metricNames.has(row.name)
    && (/率$/.test(row.name) || (row.name === '客服满意度' && row.value.endsWith('%')) ? /^(?:100(?:\.0+)?|\d{1,2}(?:\.\d+)?)%$/.test(row.value)
      : /^(?:[0-4](?:\.\d{1,2})?|5(?:\.0{1,2})?)$/.test(row.value)));
}

export function productTitleLength(title: string) { return Array.from(title.replace(/[\r\n]/g, '')).length; }
