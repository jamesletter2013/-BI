(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PriceCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const SEED = [];
  const normalize = value => String(value ?? '').trim().replace(/[\r\n]/g, '').normalize('NFKC').toUpperCase();
  const headerKey = value => normalize(value).replace(/[\s_（）()：:]/g, '');
  const aliases = {
    code: ['SKU商家编码', 'SKU商家代码', '商家编码', '商品编码', '产品编码', '商家外部编码', '外部商家编码', 'SKU编码', 'SKU', 'CODE'],
    name: ['规格名称', '颜色及规格', 'SKU名称', '销售属性', '规格', '商品名称', '商品标题', 'NAME'],
    tmall: ['天猫一口价', '一口价', 'SKU价格', '销售价格', '价格', 'TMALL'],
    sale: ['聚水潭卖价', '卖价', '销售价', '售价', 'SALE'],
    cost: ['聚水潭成本价', '成本价', 'COST'],
    kind: ['商品类型', '定价类型', 'KIND']
  };
  function parseMoney(value, decimals = 2) {
    let s = String(value ?? '').trim().normalize('NFKC');
    if (!s || ['—', '-', '--'].includes(s)) return null;
    s = s.replace(/^[¥￥]\s*/, '').replace(/\s*元$/, '');
    if (s.includes(',')) {
      if (!(new RegExp('^\\d{1,3}(,\\d{3})*(\\.\\d{1,' + decimals + '})?$')).test(s)) throw new Error('价格中的千位分隔符格式有误');
      s = s.replace(/,/g, '');
    }
    if (!(new RegExp('^\\d+(\\.\\d{1,' + decimals + '})?$')).test(s)) throw new Error(`价格需为非负数字，最多 ${decimals} 位小数`);
    const [yuan, fraction = ''] = s.split('.');
    const scaled = Number(yuan) * (10 ** decimals) + Number(fraction.padEnd(decimals, '0'));
    if (!Number.isSafeInteger(scaled) || scaled / (10 ** (decimals - 2)) > 99999999999) throw new Error('价格超出可处理范围');
    return scaled / (10 ** (decimals - 2));
  }
  function formatMoney(value) { return value === null || value === undefined ? '—' : (value / 100).toFixed(2); }
  function bundleSaleFromCost(cost) {
    if (cost === null || cost === undefined || !Number.isFinite(cost) || cost < 0) return null;
    // Costs are stored in cents; this preserves four decimal places in yuan.
    const units = Math.round(cost * 100);
    if (!Number.isSafeInteger(units) || units > 9999999999900) return null;
    // Divide by 0.3 and round the selling price once, to integer cents.
    return Math.floor((units + 15) / 30);
  }
  function resolvePricing(row) {
    const kind = row?.kind === 'bundle' ? 'bundle' : 'single';
    const cost = row?.cost ?? null;
    const sale = kind === 'bundle' ? bundleSaleFromCost(cost) : row?.sale ?? null;
    const source = kind === 'bundle' ? '组合成本 ÷ 0.3 计算' : row?.jstSource || '聚水潭原始卖价';
    const issue = kind === 'bundle' && cost === null ? '组合装缺少组合成本价' : sale === null ? (kind === 'bundle' ? '组合装成本无效，无法计算卖价' : '缺少聚水潭卖价') : '';
    return { kind, cost, sale, source, issue };
  }
  function difference(row) { const sale = resolvePricing(row).sale; return row?.tmall == null || sale === null ? null : row.tmall - sale; }
  function findColumn(headers, field, source) {
    let names = aliases[field];
    if (field === 'code' && source === 'jst') names = ['商品编码', '产品编码', ...names];
    if (source === 'bundle') {
      if (field === 'code') names = ['组合商品编码', '组合装商品编码', '组合编码', '组合装编码', ...names];
      if (field === 'cost') names = ['组合成本价', '组合总成本', '组合成本', ...names];
      if (field === 'name') names = ['组合颜色规格', '组合商品名称', '组合商品简称', ...names];
    }
    const keys = headers.map(headerKey);
    for (const name of names) { const i = keys.indexOf(headerKey(name)); if (i >= 0) return i; }
    return -1;
  }
  function detectHeader(rows, source) {
    let best = 0, score = -1;
    for (let i = 0; i < Math.min(30, rows.length); i++) {
      const hasCode = findColumn(rows[i], 'code', source) >= 0;
      const fields = source === 'jst' ? ['sale', 'cost'] : source === 'bundle' ? ['cost'] : source === 'tmall' ? ['tmall'] : ['tmall', 'sale'];
      const points = (hasCode ? 10 : 0) + fields.reduce((sum, f) => sum + (findColumn(rows[i], f, source) >= 0 ? 3 : 0), 0);
      if (points > score) { best = i; score = points; }
    }
    return best;
  }
  function parseDelimited(input) {
    const text = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    let quoted = false, sample = '';
    for (let i = 0, lines = 0; i < text.length && lines < 5; i++) {
      const c = text[i];
      if (c === '"') { if (quoted && text[i + 1] === '"') i++; else quoted = !quoted; }
      else if (!quoted) { sample += c; if (c === '\n') lines++; }
    }
    const delimiter = sample.includes('\t') ? '\t' : (sample.split(';').length > sample.split(',').length ? ';' : ',');
    const rows = []; let row = [], cell = ''; quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
        else if (quoted || cell === '') quoted = !quoted;
        else cell += c;
      } else if (c === delimiter && !quoted) { row.push(cell); cell = ''; }
      else if (c === '\n' && !quoted) { row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (quoted) throw new Error('文本引号未闭合，请重新复制完整表格');
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(c => String(c).trim()));
  }
  function buildImport(rows, map, source, existing, sourceName) {
    const problems = [], updates = new Map(); let skipped = 0, repeated = 0;
    const fields = source === 'bundle' ? ['cost'] : source === 'jst' ? ['sale', 'cost'] : source === 'tmall' ? ['tmall'] : ['tmall', 'sale', 'cost'];
    const required = source === 'bundle' ? ['cost'] : source === 'jst' ? ['sale'] : source === 'tmall' ? ['tmall'] : ['tmall', 'sale'];
    if (map.code < 0 || required.some(f => map[f] < 0)) throw new Error('请选择商品编码和所需价格列');
    for (let i = 0; i < rows.length; i++) {
      const cells = rows[i];
      if (!cells.some(c => String(c ?? '').trim())) continue;
      const code = String(cells[map.code] ?? '').trim();
      if (!code) { skipped++; continue; }
      if (code.length > 128 || /\t/.test(code)) { problems.push(`第 ${i + 1} 行：商品编码格式有误`); continue; }
      const update = { code };
      if (source === 'bundle') update.kind = 'bundle';
      else if (source === 'jst') update.kind = 'single';
      else if (source === 'combined' && map.kind >= 0 && String(cells[map.kind] ?? '').trim()) {
        const value = normalize(cells[map.kind]);
        if (['组合装', '组合', 'BUNDLE'].includes(value)) update.kind = 'bundle';
        else if (['普通商品', '普通', '单品', 'SINGLE'].includes(value)) update.kind = 'single';
        else { problems.push(`第 ${i + 1} 行：无法识别商品类型`); continue; }
      }
      if (map.name >= 0 && String(cells[map.name] ?? '').trim()) update.name = String(cells[map.name]).trim();
      try {
        for (const field of fields) if (map[field] >= 0) {
          const value = parseMoney(cells[map[field]], field === 'cost' ? 4 : 2);
          if (value !== null) update[field] = value;
        }
      } catch (e) { problems.push(`第 ${i + 1} 行（${code}）：${e.message}`); continue; }
      if (source !== 'bundle' && update.kind !== 'bundle' && !required.some(f => Object.hasOwn(update, f))) { skipped++; continue; }
      const key = normalize(code), prior = updates.get(key);
      if (prior) {
        const conflict = fields.some(f => prior[f] !== undefined && update[f] !== undefined && prior[f] !== update[f]) || (prior.kind && update.kind && prior.kind !== update.kind);
        if (conflict) { problems.push(`编码 ${code} 在本批次有不同价格，请先核对`); continue; }
        updates.set(key, { ...prior, ...update }); repeated++;
      } else updates.set(key, update);
    }
    const merged = new Map(existing.map(row => [normalize(row.code), { ...row }]));
    let added = 0, changed = 0;
    for (const [key, update] of updates) {
      const prior = merged.get(key);
      if (prior && update.kind && update.kind !== (prior.kind === 'bundle' ? 'bundle' : 'single')) { problems.push(`编码 ${update.code} 的普通商品与组合装类型冲突，请先核对`); continue; }
      if ((source === 'bundle' || (source === 'combined' && update.kind === 'bundle')) && update.cost === undefined) update.cost = null;
      const next = { code: update.code, name: '', kind: 'single', tmall: null, sale: null, cost: null, ...prior, ...update };
      if (update.tmall !== undefined) next.tmallSource = sourceName;
      if (next.kind === 'bundle') {
        next.sale = bundleSaleFromCost(next.cost); next.priceRule = 'cost-divide-0.3'; next.costSource = '组合成本价';
        next.jstSource = '组合成本 ÷ 0.3 计算';
        update.sale = next.sale;
        if (source === 'bundle') next.bundleSource = sourceName;
      } else if (update.sale !== undefined) next.jstSource = sourceName;
      merged.set(key, next); if (prior) changed++; else added++;
    }
    return { rows: [...merged.values()], preview: [...updates.values()], added, changed, skipped, repeated, problems };
  }
  function calculatePaste(text, catalog) {
    const lookup = new Map(catalog.map(r => [normalize(r.code), r]));
    const parsed = parseDelimited(text);
    const data = parsed.map(row => row.length === 1 ? String(row[0]).trim().split(/\s+/) : row.map(c => String(c).trim()));
    const items = [], usedPrices = new Set();
    const asPrice = value => { try { return parseMoney(value); } catch { return null; } };
    const finish = (code, tmall, row, error = '', skuName = '') => {
      const product = lookup.get(normalize(code));
      const pricing = resolvePricing(product), { sale, cost, kind } = pricing;
      const status = error || (tmall === null ? '缺少天猫价格' : !product ? '聚水潭未找到此编码' : pricing.issue || '匹配成功');
      const amount = status === '匹配成功' ? tmall - sale : null;
      // Divide the effective selling price by 0.55, rounding once to cents.
      const correctedTmall = amount !== null && amount < 0 ? Math.round(sale * 20 / 11) : null;
      items.push({ code, skuName: String(skuName).trim(), catalogName: product?.name || '', tmall, cost, sale, kind, priceSource: pricing.source, jstMargin: sale !== null && sale > 0 && cost !== null ? (sale - cost) / sale : null, difference: amount, correctedTmall, status, row });
    };
    const header = data.findIndex(row => findColumn(row, 'code', 'tmall') >= 0 && findColumn(row, 'tmall', 'tmall') >= 0);
    const hasColumnHeader = header >= 0 && (parsed[header].length > 1 || data.slice(header + 1).every(row => row.length === data[header].length));
    if (hasColumnHeader) {
      const codeIndex = findColumn(data[header], 'code', 'tmall'), priceIndex = findColumn(data[header], 'tmall', 'tmall');
      const nameHeaders = ['天猫SKU名称', 'SKU名称', 'SKU信息', 'SKU', '销售属性', '规格名称', '商品规格', '颜色及规格', '规格', '名称'];
      const headerKeys = data[header].map(headerKey);
      const nameIndex = nameHeaders.map(name => headerKeys.indexOf(headerKey(name))).find(i => i >= 0 && i !== codeIndex && i !== priceIndex) ?? -1;
      for (let i = header + 1; i < data.length; i++) {
        const code = String(data[i][codeIndex] ?? '').trim();
        if (!code) continue;
        finish(code, asPrice(data[i][priceIndex]), i + 1, '', nameIndex >= 0 ? data[i][nameIndex] ?? '' : '');
      }
      return items;
    }
    const isNamePart = value => value && !/^\d+\s*\/\s*\d+$/.test(value) && !['SKU', '价格', 'SKU商家编码', '商家编码', '商品编码', '一口价', '元', '¥', '￥'].includes(normalize(value));
    const descriptors = data.map(tokens => {
      const codeMatches = tokens.map((token, index) => lookup.has(normalize(token)) ? index : -1).filter(i => i >= 0);
      const prices = tokens.map((token, index) => ({ index, value: asPrice(token), decimal: /[.．]/.test(token) })).filter(p => p.value !== null && !codeMatches.includes(p.index));
      return { tokens, codeMatches, prices };
    });
    const inlineName = (descriptor, codeIndex, priceIndex) => descriptor.tokens.filter((token, index) => index !== codeIndex && index !== priceIndex && isNamePart(token)).join(' ');
    const verticalName = index => {
      const names = [];
      for (let step = 1; step <= 3; step++) {
        const neighbor = descriptors[index - step];
        if (!neighbor || neighbor.codeMatches.length || neighbor.prices.length || neighbor.tokens.every(token => !isNamePart(token))) break;
        names.unshift(neighbor.tokens.filter(isNamePart).join(' '));
      }
      return names.join(' ');
    };
    const firstCode = descriptors.findIndex(d => d.tokens.length === 1 && d.codeMatches.length === 1);
    const firstPrice = descriptors.findIndex(d => d.tokens.length === 1 && d.prices.length === 1);
    const priceBefore = firstPrice >= 0 && (firstCode < 0 || firstPrice < firstCode);
    for (let i = header >= 0 ? header + 1 : 0; i < descriptors.length; i++) {
      const d = descriptors[i];
      if (d.codeMatches.length > 1) { finish(d.tokens[d.codeMatches[0]], null, i + 1, '同一行出现多个编码，请每个 SKU 单独一行'); continue; }
      if (d.codeMatches.length === 1) {
        const code = d.tokens[d.codeMatches[0]];
        const decimals = d.prices.filter(p => p.decimal);
        if (d.prices.length === 1) { finish(code, d.prices[0].value, i + 1, '', inlineName(d, d.codeMatches[0], d.prices[0].index)); continue; }
        if (decimals.length === 1) { finish(code, decimals[0].value, i + 1, '', inlineName(d, d.codeMatches[0], decimals[0].index)); continue; }
        if (d.prices.length > 1) { finish(code, null, i + 1, '价格不明确，请加上 SKU、价格、商家编码表头'); continue; }
        let adjacentPrice = null, priceLine = -1;
        for (let step = 1; step <= 3; step++) {
          const index = i + (priceBefore ? -step : step), neighbor = descriptors[index];
          if (!neighbor || neighbor.codeMatches.length || usedPrices.has(index)) break;
          if (neighbor.tokens.length === 1 && neighbor.prices.length === 1) { adjacentPrice = neighbor.prices[0].value; priceLine = index; usedPrices.add(index); break; }
        }
        const name = inlineName(d, d.codeMatches[0], -1) || verticalName(priceBefore && priceLine >= 0 ? priceLine : i);
        finish(code, adjacentPrice, i + 1, '', name); continue;
      }
      // Unknown codes still receive an explicit unmatched result, never a zero price.
      if (d.tokens.length >= 2) {
        const candidates = d.tokens.filter(t => /^[a-z][a-z0-9_./+*#()-]*$/i.test(t));
        if (candidates.length === 1 && d.prices.length === 1) finish(candidates[0], d.prices[0].value, i + 1, '', inlineName(d, d.tokens.indexOf(candidates[0]), d.prices[0].index));
        else if (d.tokens.length === 2 && d.prices.length === 2) {
          const decimal = d.prices.filter(p => p.decimal);
          if (decimal.length === 1) finish(d.tokens[1 - decimal[0].index], decimal[0].value, i + 1);
          else finish(d.tokens[1], null, i + 1, '无法区分价格和编码，请加上表头');
        } else if (candidates.length === 1) finish(candidates[0], null, i + 1, '', inlineName(d, d.tokens.indexOf(candidates[0]), -1));
      }
    }
    return items;
  }
  return { SEED, normalize, parseMoney, formatMoney, difference, bundleSaleFromCost, resolvePricing, findColumn, detectHeader, parseDelimited, buildImport, calculatePaste };
});
