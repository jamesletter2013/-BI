export type ProductParameter = { name: string; value: string };

// Labels describe the page's parameter block, not a particular product or SKU.
const labels = [
  '微波炉适用性', '食品接触安全认证', '防烫设计', '是否可进洗碗机', '主体材质',
  '制作工艺', '碗口直径', '风格元素', '流行元素', '个性化定制', '主图来源',
  '适用空间', '碗体高度', '碗型分类', '防护包装类型', '边缘处理', '颜色分类', '适用场景',
  '适用人群', '适用对象', '包装种类', '餐具类型', '是否手工', '产品名称',
  '执行标准', '保质期', '净含量', '生产厂家', '生产企业', '生产日期',
  '批准文号', '备案编号', '适用肤质', '化妆品功效', '是否进口', '规格类型',
  '品牌', '型号', '材质', '风格', '形状', '产地', '工艺', '尺寸', '容量',
  '图案', '货号', '规格', '成分', '功效', '厚度', '重量', '数量',
].sort((a, b) => b.length - a.length);
const cardLabels = new Set(['微波炉适用性', '食品接触安全认证', '防烫设计', '材质', '是否可进洗碗机', '主体材质']);
const tidy = (s: string) => s.replace(/\s+/g, ' ').replace(/^[\s:：|｜]+|[\s|｜]+$/g, '').trim();

export function productParameters(attributes: string[], pageText = ''): ProductParameter[] {
  const pairs = new Map<string, string>();
  const add = (name: string, value: string, replace = false) => {
    name = tidy(name); value = tidy(value);
    if (!name || name.length > 30 || !value || labels.includes(value)
      || /^(?:加入购物车|立即购买|查看全部|更多|收起|展开)$/.test(value)) return;
    if (replace || !pairs.has(name)) pairs.set(name, value.slice(0, 500));
  };
  for (const raw of attributes) {
    const match = raw.match(/^\s*([^:：|｜]{1,30})[:：|｜]\s*(.+)$/);
    if (match) add(match[1], match[2]);
  }

  // Do not mine navigation, reviews or marketing copy as product facts.
  const headings = [...pageText.matchAll(/参数信息|商品参数|规格参数/g)];
  for (const heading of headings.reverse()) {
    const start = (heading.index || 0) + heading[0].length;
    const section = pageText.slice(start, start + 10000).split(/图文详情|商品详情|包装清单|价格说明|用户评价|商品评价|问大家/)[0];
    const matches = [...section.matchAll(new RegExp(labels.join('|'), 'g'))];
    if (matches.length < 2) continue; // Ignore a navigation heading with no fields.
    let firstNormal = 0;
    const prefix = tidy(section.slice(0, matches[0].index));
    // The feature cards show value ABOVE label; ordinary rows show label BEFORE value.
    if (prefix && prefix.length < 80 && cardLabels.has(matches[0][0])) {
      let previousEnd = 0;
      while (firstNormal < matches.length && cardLabels.has(matches[firstNormal][0])) {
        const match = matches[firstNormal];
        add(match[0], section.slice(previousEnd, match.index), true);
        previousEnd = (match.index || 0) + match[0].length;
        firstNormal++;
      }
    }
    for (let i = firstNormal; i < matches.length; i++) {
      const current = matches[i];
      add(current[0], section.slice((current.index || 0) + current[0].length, matches[i + 1]?.index ?? section.length), true);
    }
    break;
  }
  return [...pairs].slice(0, 100).map(([name, value]) => ({ name, value }));
}
