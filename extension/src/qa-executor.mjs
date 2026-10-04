import { qaPageRequest } from './qa-page-request.mjs';
import { runQaResponseFlow, qaResultFromCheckpoint, validQaCheckpoint } from './qa-request-flow.mjs';

const messages = {
  batch_limit: '本批问大家已保存，将自动继续下一批；问大家结束后再读取评价。',
  manual_paused: '已暂停采集，已保存问大家进度。',
  invalid_checkpoint: '问大家进度无法校验，已保留原记录，未发送请求。',
  storage_unavailable: '进度保存失败，已停止自动继续，请检查浏览器存储。',
  size_limit: '问大家达到本地16MB安全限额，未声明完整。',
  list_limit: '问大家达到500页安全限额，未声明完整。',
  capture_stopped: '联合采集已停止，问答未继续发送请求，已保留实读内容。',
  sdk_unavailable: '商品页尚未提供请求 SDK，本次未发送问答请求。',
  sdk_requires_ui: '商品页 SDK 配置可能弹出登录或验证界面；已按全后台要求停止。',
  login_context_missing: '商品页未提供有效登录上下文，请确认已登录后重新采集。',
  login_required: '登录已失效，请自行登录后重新采集；未弹出登录窗口。',
  verification_required: '接口要求验证或拒绝访问，本次已停止，未自动打开验证界面。',
  rate_limited: '接口限流，本次已停止，请稍后重试。',
  account_changed: '采集期间登录账号发生变化，已停止本次问答采集。',
  request_timeout: '问答请求超时，已保留此前实读数据。',
  capture_timeout: '本次问答采集达到时间上限，已保留此前实读数据。',
  product_mismatch: '商品页已切换，已停止，未混入其他商品问答。',
  document_changed: '商品页已刷新、关闭或切换，已停止本次问答采集。',
  unsupported_browser: '浏览器未提供文档绑定能力，无法安全执行问答请求。',
  transport_failed: '问答请求执行失败，其他商品内容不受影响。',
  upstream_unsuccessful: '问答接口未返回成功结果；未把失败当作没有问答。',
  invalid_response_shape: '问答接口返回结构不符合已验证格式，已停止。',
  invalid_response_size: '问答接口返回数据超出安全大小，已停止。',
  detail_question_mismatch: '回答详情的问题 ID 不匹配，已停止，未混入其他问题。',
};
const safeCode = value => Object.hasOwn(messages, value) ? value : 'transport_failed';
const productId = value => {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && (u.hostname === 'item.taobao.com' || u.hostname.endsWith('.tmall.com'))
      && u.pathname === '/item.htm' ? u.searchParams.get('id') || '' : '';
  } catch { return ''; }
};
const fail = code => { throw Object.assign(new Error(code), { code }); };
const inflight = new Map();
function bounded(promise, ms = 14000) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('request_timeout'), { code: 'request_timeout' })), ms);
  })]).finally(() => clearTimeout(timer));
}

// Uses an already-open product document; this component never creates, focuses,
// reloads, closes, clicks or scrolls any tab. The existing image workflow remains.
export function collectQuestionsInBackground(tab, itemId, browser = chrome, options = {}) {
  const key = `${tab.windowId}:${itemId}`;
  if (inflight.has(key)) return inflight.get(key);
  const operation = collect(tab, itemId, browser, options).finally(() => inflight.delete(key));
  inflight.set(key, operation);
  return operation;
}

async function collect(tab, itemId, browser, options) {
  const started = Date.now();
  let lastCode = 'sdk_unavailable', usedExistingPage = false;
  let flow = null;
  let bound = options.binding || null;
  const contextId = bound?.contextId || crypto.randomUUID();
  const attempts = [];
  const unavailable = () => ({ items: [], total: null, totalExact: false, totalLabel: '', status: 'unavailable', message: '' });
  try {
    if (typeof itemId !== 'string' || !/^[1-9]\d{0,31}$/.test(itemId) || productId(tab.url) !== itemId) fail('product_mismatch');
    if (options.checkpoint && !validQaCheckpoint(options.checkpoint, itemId)) fail('invalid_checkpoint');
    const query = { url: ['https://*.taobao.com/*', 'https://*.tmall.com/*'] };
    if (Number.isInteger(tab.windowId)) query.windowId = tab.windowId;
    const siblings = await browser.tabs.query(query).catch(() => []);
    const candidates = [tab, ...siblings.filter(t => t.id !== tab.id && !t.discarded && productId(t.url) === itemId).slice(0, 5)];
    // Give native initialization a bounded chance without triggering UI loading.
    for (let round = 0; round < 3 && !bound; round++) {
      for (const candidate of candidates) {
        try {
          const live = await browser.tabs.get(candidate.id);
          if (productId(live.url) !== itemId) continue;
          const entries = await bounded(browser.scripting.executeScript({ target: { tabId: live.id, frameIds: [0] },
            world: 'MAIN', func: qaPageRequest, args: [itemId, null, contextId] }), 2500);
          const result = entries.find(x => x.frameId === 0);
          if (!result?.documentId) { lastCode = 'unsupported_browser'; continue; }
          if (!result.result?.ok) { lastCode = safeCode(result?.result?.code); continue; }
          bound = { tabId: live.id, documentId: result.documentId, contextId };
          usedExistingPage = live.id !== tab.id;
          break;
        } catch (error) {
          if (error?.code === 'capture_stopped') fail('capture_stopped');
          lastCode = 'document_changed';
        }
      }
      if (!bound && round < 2) await new Promise(r => setTimeout(r, 1000));
    }
    if (!bound) fail(lastCode);
    let lastRequest = 0;
    const send = async request => {
      if (Date.now() - started > 120000) fail('capture_timeout');
      const delay = 400 - (Date.now() - lastRequest);
      if (delay > 0) await new Promise(r => setTimeout(r, delay));
      let live;
      try { live = await browser.tabs.get(bound.tabId); } catch { fail('document_changed'); }
      if (productId(live.url) !== itemId) fail('product_mismatch');
      let entries;
      lastRequest = Date.now();
      try {
        entries = await bounded(browser.scripting.executeScript({
          target: { tabId: bound.tabId, documentIds: [bound.documentId] },
          world: 'MAIN', func: qaPageRequest, args: [itemId, request, contextId] }));
      } catch (error) { fail(['request_timeout', 'capture_stopped'].includes(error?.code) ? error.code : 'document_changed'); }
      const entry = entries.find(x => x.documentId === bound.documentId && x.frameId === 0);
      if (!entry) fail('document_changed');
      if (!entry.result?.ok) fail(safeCode(entry.result?.code));
      // Never retry failures in a different tab/account and never use DOM fallback.
      return entry.result.source;
    };
    // Queue time must not consume a page request's own timeout.
    const exchange = request => browser.scheduleRequest
      ? browser.scheduleRequest(() => send(request)) : send(request);
    flow = await runQaResponseFlow({ ...options, itemId, exchange });
    lastCode = flow.reason;
    attempts.push(...flow.steps);
  } catch (error) { lastCode = safeCode(error?.code); }
  const saved = flow?.result || (validQaCheckpoint(options.checkpoint, itemId) ? qaResultFromCheckpoint(options.checkpoint) : null);
  const qa = saved?.capture || unavailable();
  qa.capturedAt = new Date().toISOString();
  if (['login_required', 'verification_required', 'rate_limited', 'sdk_requires_ui'].includes(lastCode)) qa.status = 'blocked';
  const suffix = lastCode === 'done' ? (qa.status === 'empty' ? '接口已确认暂无问答。' : '问题及主回答已核对；跟帖未做完整采集。')
    : messages[lastCode] || `采集未全部完成（${lastCode}），只保留已读取内容。`;
  qa.message = `${qa.message || ''}${suffix}`;
  qa.diagnostics = { transport: 'page-native-mtop', transportImplemented: true, backgroundOnly: true,
    usedExistingPage, reason: lastCode, requestCount: attempts.length, elapsedMs: Date.now() - started,
    coverage: saved?.coverage || null, warnings: saved?.diagnostics || null,
    pageTrace: flow?.checkpoint?.trace || options.checkpoint?.trace || [],
    progress: flow?.checkpoint ? { stage: flow.checkpoint.stage, nextListPage: flow.checkpoint.nextListPage,
      detailIndex: flow.checkpoint.detailIndex, nextDetailPage: flow.checkpoint.nextDetailPage } : null };
  // Preserve ID/provenance-rich content locally; existing UI still uses items.
  if (saved) qa.records = saved.questions;
  return { qa, error: '', qaCheckpoint: flow?.checkpoint || options.checkpoint, qaBinding: bound };
}
