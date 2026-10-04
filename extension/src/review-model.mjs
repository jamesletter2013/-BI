import { advertisedScopes } from './review-plan.mjs';
import { profileFor, pageSizeFor } from './review-profile.mjs';
export const REVIEW_API = 'mtop.taobao.rate.detaillist.get';
export const REVIEW_VERSION = '6.0';
export const REVIEW_LIMITS = Object.freeze({ pagesPerScope: 1000, records: 10000, elapsedMs: 20000, batchPages: 5, bytes: 16_000_000 });
export const validId = v => typeof v === 'string' && /^[1-9]\d{0,31}$/.test(v);
const object = v => v && typeof v === 'object' && !Array.isArray(v);
export const text = (v, max = 5000) => typeof v === 'string' ? v.trim().slice(0, max) : '';
export const count = v => /^(0|[1-9]\d*)$/.test(String(v)) && Number.isSafeInteger(Number(v)) ? Number(v) : null;
export const flag = v => v === true || v === 'true' ? true : v === false || v === 'false' ? false : null;
export const isDefaultReview = v => /该用户.{0,8}(?:未|没有).{0,8}(?:评价|评论)|系统默认(?:好评|评价)|此用户没有填写评价|^\d+天内买家未作出评价[。！!]?$/u.test(v);
export const reviewTextKind = v => !v ? 'empty' : isDefaultReview(v) ? 'default'
  : /^该用户觉得商品非常好[，,]给出好评[。！!]?$/u.test(v) ? 'template' : 'content';
function mediaUrl(v) {
  try {
    const u = new URL(typeof v === 'string' && v.startsWith('//') ? `https:${v}` : v);
    if (u.protocol !== 'https:' || u.username || u.password) return '';
    return ['alicdn.com', 'taobao.com', 'tmall.com'].some(d => u.hostname === d || u.hostname.endsWith(`.${d}`)) ? u.href : '';
  } catch { return ''; }
}
// User-supplied media response confirms appendFeedPicPathList on appendedFeed.
// Normalize both the raw append field and the minimized canonical field.
const pictures = row => [...new Set([
  ...(Array.isArray(row?.feedPicPathList) ? row.feedPicPathList : []),
  ...(Array.isArray(row?.appendFeedPicPathList) ? row.appendFeedPicPathList : []),
].map(mediaUrl).filter(Boolean))].slice(0, 20);
const video = row => mediaUrl(row?.video?.cloudVideoUrl || row?.video?.sourceVideoUrl);
export function normalizeReview(row, itemId, scope, page) {
  if (!object(row) || row.auctionNumId !== itemId || !validId(row.id)) throw Object.assign(new Error('product_mismatch'), { code: 'product_mismatch' });
  const a = object(row.appendedFeed) ? row.appendedFeed : null;
  const feedback = text(row.feedback);
  return { id: row.id, itemId, feedback, feedbackDate: text(row.feedbackDate, 100),
    sku: text(row.skuValueStr, 500), rateType: text(typeof row.rateType === 'number' ? String(row.rateType) : row.rateType, 30),
    isDefault: isDefaultReview(feedback), textKind: reviewTextKind(feedback), images: pictures(row), video: video(row),
    append: a ? { feedback: text(a.appendedFeedback), date: text(a.createTime, 100),
      intervalDay: text(a.intervalDay, 30), reply: text(a.reply), images: pictures(a), video: video(a) } : null,
    textTruncated: [row.feedback, a?.appendedFeedback, a?.reply].some(v => typeof v === 'string' && v.length > 5000),
    sources: [{ scope, page, profile: profileFor(scope) }] };
}
export function readReviewResponse(source, itemId, scope, page) {
  // User-saved fixtures may be JSONP. Strip a named wrapper; never evaluate it.
  let raw = source;
  if (typeof raw === 'string') {
    if (raw.length > 2_000_000) throw Object.assign(new Error('invalid_response_size'), { code: 'invalid_response_size' });
    const s = raw.trim();
    const wrapper = s.match(/^[A-Za-z_$][\w$]*\s*\(([\s\S]*)\)\s*;?$/);
    raw = JSON.parse(wrapper ? wrapper[1] : s);
  }
  const invalid = () => { throw Object.assign(new Error('invalid_response_shape'), { code: 'invalid_response_shape' }); };
  if (!object(raw) || raw.api !== REVIEW_API || raw.v !== REVIEW_VERSION || !Array.isArray(raw.ret)
      || !raw.ret.length || !raw.ret.every(r => typeof r === 'string' && r.split('::')[0] === 'SUCCESS')) invalid();
  const d = raw.data;
  if (!object(d) || !Array.isArray(d.rateList) || d.rateList.length > pageSizeFor(scope)) invalid();
  const items = d.rateList.map(r => normalizeReview(r, itemId, scope, page));
  return { items, hasNext: flag(d.hasNext), total: count(d.total), totalPage: count(d.totalPage),
    timePeriod: text(d.timePeriodDesc, 100), platformTotal: text(d.feedAllCountFuzzy || d.fuzzyRateCount || d.feedAllCount, 60),
    folded: count(d.foldCount), history: text(d.historyCount, 60), appendTotal: count(d.feedAppendCount),
    availableScopes: advertisedScopes(d) };
}
export function mergeReview(previous, incoming) {
  if (!previous) return incoming;
  const append = incoming.append || previous.append;
  // An ordinary/default view must not replace a saved non-template body.
  const rank = { empty: 0, default: 1, template: 2, content: 3 };
  const feedback = rank[reviewTextKind(incoming.feedback)] >= rank[reviewTextKind(previous.feedback)]
    ? incoming.feedback || previous.feedback : previous.feedback;
  return { ...previous, ...incoming, feedback,
    feedbackDate: incoming.feedbackDate || previous.feedbackDate, sku: incoming.sku || previous.sku,
    rateType: incoming.rateType || previous.rateType,
    images: [...new Set([...previous.images, ...incoming.images])], video: incoming.video || previous.video,
    isDefault: isDefaultReview(feedback),
    textKind: reviewTextKind(feedback),
    append: append ? { ...(previous.append || {}), ...append,
      feedback: append.feedback || previous.append?.feedback || '',
      date: append.date || previous.append?.date || '', intervalDay: append.intervalDay || previous.append?.intervalDay || '',
      reply: append.reply || previous.append?.reply || '', video: append.video || previous.append?.video || '',
      images: [...new Set([...(previous.append?.images || []), ...(append.images || [])])] } : null,
    textTruncated: previous.textTruncated || incoming.textTruncated,
    sources: [...previous.sources, ...incoming.sources].filter((s, i, all) => all.findIndex(x => x.scope === s.scope && x.page === s.page
      && x.profile === s.profile && x.scanId === s.scanId) === i).slice(-100) };
}
export const REVIEW_MESSAGES = {
  range_exhausted: '本次评价入口已结束或停止，仍有数量冲突或分页缺口；已保留各入口新增与停止原因，不代表全量补齐。',
  batch_limit: '本批已保存，将在后台继续下一批。',
  manual_paused: '已暂停并保存页码，点击继续评价可接着读取。',
  interrupted: '上次采集已中断，已保留保存的页码与内容；可主动继续。',
  storage_unavailable: '进度保存失败，已停止发送后续请求，请检查浏览器存储空间。',
  invalid_checkpoint: '保存的进度无法校验，未继续请求；请重新采集。',
  done: '本次已接入的评价入口已读完；折叠范围未确认，不代表缺失评价已全部补齐。未额外请求历史入口，普通列表时间范围以接口标注为准。',
  outside_recent_scope: '返回范围标记为历史评价，本次未采入，也未继续该入口。',
  filter_not_available: '当前商品响应未提供该筛选入口，本次未发送该入口请求。',
  capture_stopped: '联合采集已停止，评价未继续发送请求，已保留实读内容。',
  sdk_unavailable: '商品页请求组件尚未就绪，本次未读取评价。',
  sdk_requires_ui: '请求组件可能弹出登录或验证界面，已按后台要求停止。',
  login_context_missing: '商品页未提供登录上下文，请确认登录后重试。',
  login_required: '登录已失效，请自行登录后重新采集。',
  verification_required: '接口要求验证或拒绝访问，已停止，未绕过验证。',
  rate_limited: '接口限流，已停止并保留已读取的评价。',
  account_changed: '登录账号已变化，本次采集已停止。',
  request_timeout: '评价请求超时，已保留此前读取的内容。',
  capture_timeout: '评价采集达到时间上限，已保留此前读取的内容。',
  product_mismatch: '商品已切换或返回商品不匹配，已停止以避免混入其他商品评价。',
  document_changed: '商品页已刷新或关闭，已停止评价采集。',
  unsupported_browser: '浏览器缺少文档绑定能力，无法安全读取评价。',
  upstream_unsuccessful: '评价接口未返回成功结果，不能据此判定没有评价。',
  invalid_response_shape: '评价返回格式与已验证样本不同，已停止。',
  invalid_response_size: '评价返回超过安全大小限制，已停止。',
  transport_failed: '评价请求执行失败，其他商品内容不受影响。',
  page_limit: '达到本次分页上限，尚未全部读取。',
  record_limit: '达到本商品 10000 条安全上限，已保留内容，未宣称全部读完。',
  size_limit: '评价数据达到本次大小上限，已保留实读内容，尚未全部读取。',
  repeated_page: '接口重复返回已读内容，已停止翻页，不能判定读完。',
  empty_page: '接口仍提示有下一页但返回空页，已停止。',
  pagination_unknown: '接口未明确返回分页结束状态，已保留实读内容。',
  count_mismatch: '已到列表末页，但实读数量与该范围总数不一致。',
};
export const safeReason = code => Object.hasOwn(REVIEW_MESSAGES, code) ? code : 'transport_failed';
export const blockedReason = code => ['sdk_requires_ui', 'login_required', 'verification_required', 'rate_limited'].includes(code);
export function unavailableReviews(itemId, reason = 'transport_failed') {
  reason = safeReason(reason);
  return { schemaVersion: 1, itemId, status: blockedReason(reason) ? 'blocked' : 'unavailable',
    items: [], scopes: [], capturedAt: new Date().toISOString(), message: REVIEW_MESSAGES[reason],
    diagnostics: { transport: 'page-native-mtop', backgroundOnly: true, reason, requestCount: 0 } };
}
