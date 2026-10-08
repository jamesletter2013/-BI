// Pure, bounded response reduction. No requests, page execution, storage or raw export.
export const LIMITS = Object.freeze({ durationMs: 90_000, responses: 12, bodyChars: 2_000_000, totalChars: 8_000_000, nodes: 4000, depth: 16, fields: 60 });
export const DIAGNOSTIC_BUILD = '2026-10-07-detail-data-fix';
const DETAIL_APIS = new Set(['mtop.taobao.detail.getdetail', 'mtop.taobao.pcdetail.data.get', 'mtop.taobao.detail.data.get']);
const id = value => (typeof value === 'string' || Number.isSafeInteger(value)) && /^[1-9]\d{0,19}$/.test(String(value)) ? String(value) : '';
const own = (obj, key) => Object.getOwnPropertyDescriptor(obj || {}, key)?.value;
const itemKeys = ['itemId', 'item_id', 'num_iid', 'itemNumId', 'auctionId'];
const norm = key => key.toLowerCase().replace(/[_-]/g, '');
const dateFields = new Map([
  ...['firststartstime', 'firststarttime', 'firstlistingtime', 'firstlisttime', 'firstshelftime'].map(k => [k, '首次上架候选']),
  ...['listtime', 'listingtime', 'listingdate', 'listedat', 'putawaytime', 'onshelftime', 'upshelftime', 'shelftime'].map(k => [k, '上架候选']),
  ...['oldstarts', 'starts', 'starttime', 'created', 'createtime', 'gmtcreate', 'datepublished', 'releasedate'].map(k => [k, '含义待核实，不能直接作为上架时间']),
]);
const categoryKeys = new Set(['categoryid', 'cateid', 'catid', 'cid']);
const safePathKeys = new Set(['data', 'result', 'item', 'itemInfo', 'itemInfoModel', 'itemDO', 'itemPvItem', 'itemBase', 'detail', 'itemDetail', 'apiStack', 'value', 'category', 'categoryInfo', 'props', 'props2', 'propsList', 'components', 'global', 'params', 'fields', 'model', 'node', 'nodes', 'children', ...itemKeys]);
const forbidden = /cookie|token|session|sign|secret|auth|password|credential|header|account|buyer|seller|shop|address|phone|mobile|email|contact|review|recommend|related|rate|sku|trade|price|promotion|coupon|user|login|profile|customer|member|person|birth|gender|receiver|consignee/i;

export function productIdFromPage(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && /^(?:item\.taobao\.com|(?:[^.]+\.)?tmall\.com)$/.test(u.hostname) && u.pathname === '/item.htm' ? id(u.searchParams.get('id')) : ''; } catch { return ''; }
}

// Rejections contain a fixed reason only: never retain names/URLs from unrelated requests.
export function classifyDetailEndpoint(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') || !/^(?:h5api|acs)\.m\.(?:taobao|tmall)\.com$/.test(u.hostname)) return { reason: 'outside_scope' };
    const match = u.pathname.match(/^\/h5\/([^/]+)\/([^/]+)\/?$/i);
    if (!match) return { reason: 'unsupported_path' };
    const api = match[1].toLowerCase();
    if (!DETAIL_APIS.has(api)) return { reason: 'api_not_allowlisted' };
    if (!/^\d+\.\d+$/.test(match[2])) return { reason: 'invalid_version' };
    return { endpoint: { host: u.hostname, api, version: match[2] } };
  } catch { return { reason: 'outside_scope' }; }
}

export function detailEndpoint(value) { return classifyDetailEndpoint(value).endpoint || null; }

export function normalizedDate(value, now = Date.now()) {
  let v = typeof value === 'number' && Number.isFinite(value) ? String(value) : typeof value === 'string' && value.length <= 50 ? value.trim() : '';
  if (/^\d{10}$|^\d{13}$/.test(v)) {
    const ms = Number(v) * (v.length === 10 ? 1000 : 1);
    if (ms < Date.UTC(1990, 0, 1) || ms > now + 366 * 86_400_000) return '';
    v = new Date(ms + 8 * 3600_000).toISOString().slice(0, 19).replace('T', ' ');
  } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(v)) {
    const prefix = v.slice(0, 10), base = new Date(prefix + 'T00:00:00Z');
    const time = v.match(/T(\d{2}):(\d{2}):(\d{2})/);
    const offset = v.match(/[+-](\d{2}):(\d{2})$/);
    if (+time[1] > 23 || +time[2] > 59 || +time[3] > 59 || offset && (+offset[1] > 23 || +offset[2] > 59)) return '';
    if (!Number.isFinite(base.getTime()) || base.toISOString().slice(0, 10) !== prefix) return '';
    const ms = Date.parse(v);
    if (!Number.isFinite(ms)) return '';
    v = new Date(ms + 8 * 3600_000).toISOString().slice(0, 19).replace('T', ' ');
  }
  const m = v.match(/^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return '';
  const [, y, mo, da, h, mi, se] = m, d = new Date(Date.UTC(+y, +mo - 1, +da));
  if (+y < 1990 || +y > new Date(now).getUTCFullYear() + 1 || d.getUTCFullYear() !== +y || d.getUTCMonth() !== +mo - 1 || d.getUTCDate() !== +da || (h !== undefined && (+h > 23 || +mi > 59 || +(se || 0) > 59))) return '';
  return `${y}-${mo.padStart(2, '0')}-${da.padStart(2, '0')}${h === undefined ? '' : ` ${h.padStart(2, '0')}:${mi}${se === undefined ? '' : ':' + se}`}`;
}

function decode(text) {
  let s = text.trim();
  if (!/^[\[{]/.test(s)) {
    const wrapped = s.match(/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*\(\s*([\s\S]*)\s*\)\s*;?\s*$/);
    if (!wrapped) throw Error('not_json');
    s = wrapped[1];
  }
  return JSON.parse(s);
}

export function reduceDetailBody(body, expectedItemId, now = Date.now()) {
  const out = { state: 'invalid_json', serviceState: 'unknown', matchedItem: false, mismatchedModels: 0, limitsReached: false, fields: [] };
  if (!id(expectedItemId) || typeof body !== 'string' || body.length > LIMITS.bodyChars) { out.state = 'body_limit'; return out; }
  let root;
  try { root = decode(body); } catch { return out; }
  const ret = own(root, 'ret');
  const codes = Array.isArray(ret) ? ret.slice(0, 8).filter(x => typeof x === 'string').map(x => x.split('::')[0]) : [];
  out.serviceState = codes.some(x => /VALIDATE|RGV587|CAPTCHA|USER_VALIDATE/.test(x)) ? 'verification_required'
    : codes.some(x => /TOKEN|SESSION|LOGIN/.test(x)) ? 'auth_required'
      : codes.some(x => x === 'SUCCESS') ? 'success' : codes.length ? 'request_failed' : 'unknown';
  if (['verification_required', 'auth_required', 'request_failed'].includes(out.serviceState)) { out.state = 'service_rejected'; return out; }
  let nodes = 0, parsedChars = body.length;
  const seen = new WeakSet(), fieldSeen = new Set();
  const identity = obj => {
    const ids = [...new Set(itemKeys.map(k => id(own(obj, k))).filter(Boolean))];
    return ids.length > 1 ? 'conflict' : ids[0] || '';
  };
  function walk(value, path, bound = false, depth = 0) {
    if (depth > LIMITS.depth || ++nodes > LIMITS.nodes || out.fields.length >= LIMITS.fields) { out.limitsReached = true; return; }
    if (typeof value === 'string' && /^[\[{]/.test(value.trim())) {
      if (value.length > LIMITS.bodyChars || parsedChars + value.length > LIMITS.totalChars) { out.limitsReached = true; return; }
      parsedChars += value.length;
      try { value = JSON.parse(value); } catch { return; }
    }
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      if (value.length > 200) out.limitsReached = true;
      for (let i = 0; i < Math.min(value.length, 200); i++) walk(own(value, String(i)), `${path}[${i}]`, bound, depth + 1);
      return;
    }
    const direct = identity(value);
    if (direct && direct !== expectedItemId) { out.mismatchedModels++; return; }
    const nestedIds = ['item', 'itemInfoModel', 'itemDO', 'itemPvItem', 'itemInfo', 'itemBase'].map(k => identity(own(value, k))).filter(Boolean);
    if (nestedIds.some(v => v !== expectedItemId)) { out.mismatchedModels++; return; }
    bound ||= direct === expectedItemId || nestedIds.includes(expectedItemId);
    if (bound) out.matchedItem = true;
    const keys = Object.keys(value);
    if (keys.length > 250) out.limitsReached = true;
    for (const key of keys.slice(0, 250)) {
      if (out.fields.length >= LIMITS.fields || nodes > LIMITS.nodes) { out.limitsReached = true; return; }
      const k = norm(key), dateMeaning = dateFields.get(k), isCategory = categoryKeys.has(k);
      if (forbidden.test(key) || ['__proto__', 'prototype', 'constructor'].includes(key)) continue;
      // Arbitrary JSON property names can contain secrets. Never copy them to output.
      const segment = dateMeaning || isCategory ? k : safePathKeys.has(key) ? key : '[field]';
      const next = `${path}.${segment}`;
      const child = own(value, key);
      if (bound && (dateMeaning || isCategory)) {
        const clean = dateMeaning ? normalizedDate(child, now) : id(child);
        const fingerprint = `${next}|${clean}`;
        if (!fieldSeen.has(fingerprint)) {
          fieldSeen.add(fingerprint);
          out.fields.push({ path: next, field: k, kind: dateMeaning ? 'date_candidate' : 'category_id', value: clean,
            valueState: clean ? 'normalized' : child === null || child === '' ? 'empty' : 'invalid_or_unsupported',
            meaning: dateMeaning || '类目 ID', semanticsVerified: false });
          if (out.fields.length >= LIMITS.fields) { out.limitsReached = true; return; }
        }
      }
      if (child && (typeof child === 'object' || typeof child === 'string' && /^[\[{]/.test(child.trim()))) walk(child, next, bound, depth + 1);
    }
  }
  walk(root, '$');
  out.state = !out.matchedItem ? 'item_not_bound' : out.fields.some(f => f.kind === 'date_candidate' && f.value) ? 'date_candidates_found' : 'no_date_observed';
  return out;
}

export function createLoadSession(itemId, now = Date.now()) {
  if (!id(itemId)) throw Error('invalid_item');
  return { itemId, startedAt: now, endedAt: null, stopReason: '', active: true, reserved: 0, bodyChars: 0, responses: [],
    observations: { networkEvents: 0, matchedEndpointEvents: 0, bodyReadAttempts: 0, bodyReadCompletions: 0, navigationEvents: 0, sameProductNavigations: 0,
      filtered: { outside_scope: 0, unsupported_path: 0, api_not_allowlisted: 0, invalid_version: 0, invalid_start_time: 0, before_start: 0, response_limit: 0 } } };
}

export function loadObservationMessage(session) {
  if (!session) return '';
  const s = session.observations;
  if (!s.networkEvents) return '本次未收到网络完成事件；不能仅凭此确认是否刷新或浏览器是否转发了事件。';
  if (!s.matchedEndpointEvents) return '已收到网络事件，但未匹配允许列表中的详情接口；请查看过滤原因。';
  const incomplete = session.reserved - session.responses.length;
  if (!session.active && incomplete > 0) return `停止时有 ${incomplete} 条已接受请求未完成记录；迟到结果不会写入本次导出。`;
  if (!session.responses.length) return '已匹配详情接口，但尚无响应记录；请查看时间过滤计数与正文读取进度。';
  return '已记录详情响应；HTTP 成功不等于业务成功，仍需核对商品归属及字段含义。';
}

export function makeLoadReport(session, version, now = Date.now()) {
  return { schema: 'taoa.product-load-diagnostic.v1', generatedAt: new Date(now).toISOString(), extensionVersion: /^\d+\.\d+\.\d+$/.test(version) ? version : '',
    diagnosticBuild: DIAGNOSTIC_BUILD,
    itemId: session.itemId, startedAt: new Date(session.startedAt).toISOString(), endedAt: session.endedAt ? new Date(session.endedAt).toISOString() : '',
    scope: 'user_started_selected_tab_allowlisted_detail_responses', additionalProductRequests: false, thirdPartyServiceCalled: false,
    initiatorVerified: false, rawResponseIncluded: false, requestHeadersIncluded: false,
    stopReason: session.stopReason, responseCount: session.responses.length, limits: LIMITS, responses: session.responses,
    observations: { ...session.observations, filtered: { ...session.observations.filtered }, acceptedRequests: session.reserved,
      incompleteAcceptedRequests: session.reserved - session.responses.length,
      interpretation: '只计本次主动记录期间收到的事件，含可能在启动前发出的请求；每个被过滤事件仅记首个过滤原因。未匹配请求不保存域名、路径、参数或正文；同商品导航不等于已验证刷新。' },
    interpretation: '仅检查本次选定商品页、允许列表中的详情响应；字段均为待核实候选，不写回上架日期。无候选或未捕获不能证明其他响应没有日期。其他插件也可能调用同平台接口，本报告不证明请求发起方。' };
}
