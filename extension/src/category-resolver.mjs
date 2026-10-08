import dictionary from './category-data.json' with { type: 'json' };
import { isCategoryNavigationText } from './category-text.mjs';

const validId = value => typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value);
const normalizePath = value => typeof value === 'string' && value.length <= 500 && !isCategoryNavigationText(value)
  ? value.replace(/\s*[>＞›]\s*/g, ' > ').trim() : '';
const leaf = path => path.split(' > ').at(-1);
let bundledIndex;

// Only the packaged numeric ID/parent/name table is used. Never a title guess,
// third-party toolbar, query API, account credential or whole-page text search.
export function createCategoryResolver(data) {
  const rows = new Map(), conflicts = new Set();
  const metadata = data?.metadata;
  const date = metadata?.asOf;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !metadata?.source
      || !Array.isArray(data?.rows) || data.rows.length > 100_000) throw Error('类目表格式无效');
  const stamp = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== date || stamp > Date.now()) throw Error('类目表日期无效');
  for (const row of data.rows) {
    if (!Array.isArray(row) || row.length !== 4) continue;
    const [cid, parent, name, isParent] = row;
    if (!validId(cid) || !(parent === '0' || validId(parent)) || typeof name !== 'string'
        || !name.trim() || name.length > 150 || /[>\x00-\x1f]|<(?![=\d])|https?:/i.test(name)
        || ![0, 1].includes(isParent)) continue;
    const current = { cid, parent, name: name.trim(), isParent };
    const old = rows.get(cid);
    if (old && (old.name !== current.name || old.parent !== parent || old.isParent !== isParent)) conflicts.add(cid);
    else rows.set(cid, current);
  }
  function resolve(cid) {
    const base = { categoryId: cid, asOf: date, source: metadata.source, currentVerified: false };
    if (!validId(cid)) return { ...base, status: 'invalid_id', path: '' };
    if (rows.get(cid)?.isParent === 1) return { ...base, status: 'non_leaf', path: '' };
    const chain = [], seen = new Set();
    let cursor = cid;
    while (cursor !== '0') {
      if (seen.has(cursor)) return { ...base, status: 'cycle', path: '' };
      if (chain.length >= 16) return { ...base, status: 'too_deep', path: '' };
      if (conflicts.has(cursor)) return { ...base, status: 'conflict', path: '' };
      const row = rows.get(cursor);
      if (!row) return { ...base, status: chain.length ? 'missing_parent' : 'not_found', path: '' };
      seen.add(cursor); chain.unshift(row); cursor = row.parent;
    }
    const path = chain.map(row => row.name).join(' > ');
    return path.length <= 400 ? { ...base, status: 'local_reference', path, ids: chain.map(row => row.cid) }
      : { ...base, status: 'path_too_long', path: '' };
  }
  return { resolve, size: rows.size, metadata };
}

export function resolveLocalCategory(cid) {
  bundledIndex ||= createCategoryResolver(dictionary);
  return bundledIndex.resolve(cid);
}

// Enrich only a successful capture of the same product, after navigation checks
// in background.js. All non-category fields (including dates) are preserved.
export function enrichCategory(capture, snapshot, expectedItemId, resolve = resolveLocalCategory) {
  if (!validId(expectedItemId) || !capture || capture.status !== 'success'
      || capture.itemId !== expectedItemId) return capture;
  // Discard known UI contamination even when the optional page reader found no
  // reliable ID. A stale bad value must neither be displayed nor block lookup.
  if (isCategoryNavigationText(capture.categoryPath)) {
    const { categoryReference, ...clean } = capture;
    capture = { ...clean, categoryPath: '', categorySource: '' };
  }
  if (!snapshot || snapshot.itemId !== expectedItemId) return capture;
  if (snapshot.categoryIdConflict || snapshot.categoryNameConflict
      || snapshot.diagnostics?.categoryState === 'id_conflict') return capture;
  const cid = snapshot.categoryId;
  if (!validId(cid) || (capture.categoryId && capture.categoryId !== cid)) return capture;
  const existing = normalizePath(capture.categoryPath);
  const pagePath = normalizePath(snapshot.categoryPath);
  const result = { ...capture, categoryId: cid };
  // Do not reinterpret an already-enriched result or replace a complete page path.
  if (capture.categoryReference || existing.includes(' > ') || pagePath.includes(' > ')) return result;
  if (existing && pagePath && existing !== pagePath) return result;
  const matched = resolve(cid);
  const knownName = pagePath || existing;
  if (matched?.status === 'local_reference' && matched.categoryId === cid && matched.path
      && (!knownName || knownName === leaf(matched.path))) {
    // The existing website renders categoryPath but drops extra metadata. Keep
    // the reference warning visible in the value, not only in a hidden tooltip.
    return { ...result,
      categoryPath: `${matched.path}（本地表参考·${matched.asOf}）`,
      categorySource: `真实类目ID ${cid} · 本地表 ${matched.asOf} · 非实时官方核验`,
      categoryReference: { path: matched.path, asOf: matched.asOf, source: matched.source,
        currentVerified: false, categoryId: cid },
    };
  }
  if (knownName) return result; // A live name always wins over a stale dictionary.
  const reason = matched?.status === 'not_found' ? '本地表未收录'
    : matched?.status === 'non_leaf' ? '仅读到父级类目' : '本地表未能核实完整路径';
  return { ...result, categoryPath: `类目 ID：${cid}（${reason}，名称待补全）`,
    categorySource: `商品页真实类目ID；未按标题推测，不调用外部服务` };
}
