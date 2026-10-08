// Pure offline verification utility. No built-in data or remote lookups.
const id = value => (typeof value === 'string' || Number.isSafeInteger(value)) && /^(?:0|[1-9]\d{0,19})$/.test(String(value)) ? String(value) : '';
const name = value => typeof value === 'string' && value.length <= 150 && value.trim()
  && !/[\x00-\x1f<>]|https?:\/\//i.test(value) ? value.trim() : '';

export function parseCategoryText(text) {
  if (typeof text !== 'string' || text.length > 8_000_000) throw new Error('类目文件过大或格式无效');
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim());
  if (lines.length > 100_000) throw new Error('类目行数超过诊断上限');
  return lines.map((line, index) => {
    const match = line.match(/^(\d+),(\d+),'(.*)',([01])$/);
    if (!match) throw new Error(`第 ${index + 1} 行不是预期的类目数据格式`);
    return { cid: match[1], parent_cid: match[2], name: match[3].replace(/''/g, "'"), is_parent: match[4] === '1' };
  });
}

export function createCategoryIndex(rows, metadata = {}) {
  if (!Array.isArray(rows) || rows.length > 100_000) throw new Error('无效类目字典');
  const index = new Map(), conflicts = new Set();
  let invalidRows = 0;
  for (const row of rows) {
    const cid = id(row?.cid), parent = id(row?.parent_cid), label = name(row?.name);
    if (!cid || cid === '0' || !parent || !label) { invalidRows++; continue; }
    const value = { cid, parent_cid: parent, name: label, deleted: row.status === 'deleted' };
    const old = index.get(cid);
    if (old && (old.name !== label || old.parent_cid !== parent || old.deleted !== value.deleted)) conflicts.add(cid);
    else index.set(cid, value);
  }
  const source = typeof metadata.source === 'string' ? metadata.source.slice(0, 500) : '';
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(metadata.asOf || '') ? metadata.asOf : '';
  // This module is for verification only; a declared date is not a current-data guarantee.
  function resolve(value) {
    const cid = id(value), chain = [], seen = new Set();
    const base = { categoryId: cid, source, asOf, productionReady: false };
    if (!cid || cid === '0') return { ...base, status: 'invalid_id', path: '' };
    let cursor = cid;
    while (cursor !== '0') {
      if (seen.has(cursor)) return { ...base, status: 'cycle', path: '' };
      if (chain.length >= 16) return { ...base, status: 'too_deep', path: '' };
      if (conflicts.has(cursor)) return { ...base, status: 'conflict', path: '' };
      const row = index.get(cursor);
      if (!row) return { ...base, status: chain.length ? 'missing_parent' : 'not_found', missingId: cursor, path: '' };
      if (row.deleted) return { ...base, status: 'deleted', path: '' };
      seen.add(cursor); chain.unshift(row); cursor = row.parent_cid;
    }
    return { ...base, status: 'resolved_reference_only', path: chain.map(row => row.name).join(' > '), ids: chain.map(row => row.cid) };
  }
  return { resolve, stats: { inputRows: rows.length, indexedIds: index.size, conflictingIds: conflicts.size, invalidRows },
    findExactName: value => [...index.values()].filter(row => row.name === value).map(row => ({ cid: row.cid, ...resolve(row.cid) })) };
}
