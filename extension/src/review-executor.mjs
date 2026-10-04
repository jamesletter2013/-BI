import { reviewPageRequest } from './review-page-request.mjs';
import { runReviewFlow, captureFromCheckpoint, validCheckpoint } from './review-flow.mjs';
import { safeReason, unavailableReviews } from './review-model.mjs';
export { unavailableReviews } from './review-model.mjs';
const inflight = new Map();
const fail = code => { throw Object.assign(new Error(code), { code }); };
const productId = value => {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && (u.hostname === 'item.taobao.com' || u.hostname === 'detail.tmall.com'
      || u.hostname.endsWith('.tmall.com')) && u.pathname === '/item.htm' ? u.searchParams.get('id') : null;
  } catch { return null; }
};
async function bounded(promise, ms) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('request_timeout'), { code: 'request_timeout' })), ms);
  })]); } finally { clearTimeout(timer); }
}
export function collectReviewsInBackground(tab, itemId, browser = chrome, options = {}) {
  const key = `${tab.windowId}:${itemId}`;
  if (inflight.has(key)) return inflight.get(key);
  const job = collect(tab, itemId, browser, options).finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}
async function collect(tab, itemId, browser, options) {
  const contextId = options.binding?.contextId || crypto.randomUUID();
  try {
    if (productId(tab.url) !== itemId) fail('product_mismatch');
    let bound = options.binding || null, lastCode = 'sdk_unavailable';
    const freshBinding = !bound;
    const query = { url: ['https://*.taobao.com/*', 'https://*.tmall.com/*'] };
    if (Number.isInteger(tab.windowId)) query.windowId = tab.windowId;
    const siblings = await browser.tabs.query(query).catch(() => []);
    const candidates = [tab, ...siblings.filter(t => t.id !== tab.id && !t.discarded && productId(t.url) === itemId).slice(0, 5)];
    for (let round = 0; round < 3 && !bound; round++) {
      for (const candidate of candidates) {
        let live;
        try { live = await browser.tabs.get(candidate.id); } catch { continue; }
        if (productId(live.url) !== itemId) continue;
        let entries;
        try { entries = await bounded(browser.scripting.executeScript({ target: { tabId: live.id, frameIds: [0] },
          world: 'MAIN', func: reviewPageRequest, args: [itemId, null, contextId] }), 2500); }
        catch (e) {
          if (e?.code === 'capture_stopped') fail('capture_stopped');
          lastCode = 'document_changed'; continue;
        }
        const entry = entries.find(x => x.frameId === 0);
        if (!entry?.documentId) { lastCode = 'unsupported_browser'; continue; }
        if (!entry.result?.ok) {
          lastCode = safeReason(entry?.result?.code);
          if (lastCode === 'sdk_requires_ui') fail(lastCode);
          continue;
        }
        bound = { tabId: live.id, documentId: entry.documentId };
        break;
      }
      if (!bound && round < 2) await new Promise(r => setTimeout(r, 750));
    }
    if (!bound) fail(lastCode);
    let lastRequest = 0;
    const send = async descriptor => {
      const wait = 600 - (Date.now() - lastRequest);
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      let live;
      try { live = await browser.tabs.get(bound.tabId); } catch { fail('document_changed'); }
      if (productId(live.url) !== itemId) fail('product_mismatch');
      lastRequest = Date.now();
      let entries;
      try { entries = await bounded(browser.scripting.executeScript({
        target: { tabId: bound.tabId, documentIds: [bound.documentId] }, world: 'MAIN',
        func: reviewPageRequest, args: [itemId, descriptor, contextId] }), 24000); }
      catch (e) { fail(['request_timeout', 'capture_stopped'].includes(e?.code) ? e.code : 'document_changed'); }
      const entry = entries.find(x => x.documentId === bound.documentId && x.frameId === 0);
      if (!entry) fail('document_changed');
      if (!entry.result?.ok) fail(safeReason(entry?.result?.code));
      return entry.result.source;
    };
    const result = await runReviewFlow({ itemId, ...options, refreshCapabilities: freshBinding && options.checkpoint?.scopeIndex > 0,
      exchange: descriptor => browser.scheduleRequest
      ? browser.scheduleRequest(() => send(descriptor)) : send(descriptor) });
    result.diagnostics.usedExistingPage = bound.tabId !== tab.id;
    result.binding = { ...bound, contextId };
    return result;
  } catch (e) {
    const reason = safeReason(e?.code);
    return validCheckpoint(options.checkpoint, itemId)
      ? { ...captureFromCheckpoint(options.checkpoint, reason), checkpoint: { ...options.checkpoint, reason } }
      : unavailableReviews(itemId, reason);
  }
}
