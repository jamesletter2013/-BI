import { LIMITS, productIdFromPage, classifyDetailEndpoint, reduceDetailBody, createLoadSession, makeLoadReport } from './load-diagnostic.mjs';

// Callback-style Chrome APIs work in older Chromium/360 builds; new Promise results are also accepted.
export function responseContent(request, timeoutMs = 5000) {
  return new Promise(resolve => {
    let done = false;
    const finish = (content, encoding = '') => {
      if (done) return; done = true; clearTimeout(timer);
      if (content && typeof content === 'object') { encoding = content.encoding || ''; content = content.content; }
      resolve({ content: typeof content === 'string' ? content : '', encoding });
    };
    const timer = setTimeout(() => finish('', 'unavailable'), timeoutMs);
    try {
      const result = request.getContent(finish);
      if (result?.then) result.then(finish, () => finish('', 'unavailable'));
    } catch {
      try { const result = request.getContent(); if (result?.then) result.then(finish, () => finish('', 'unavailable')); else finish('', 'unavailable'); }
      catch { finish('', 'unavailable'); }
    }
  });
}

export function createLoadController(api, changed = () => {}, clock = Date.now) {
  let session = null, generation = 0, timeout = null, starting = false, disposed = false;
  const tabId = api.devtools?.inspectedWindow?.tabId;
  const network = api.devtools?.network;
  const supported = Number.isSafeInteger(tabId) && Boolean(network?.onRequestFinished?.addListener && network?.onNavigated?.addListener);
  const notify = () => changed(session);
  const getTab = () => new Promise((resolve, reject) => {
    let done = false;
    const finish = tab => { if (done) return; done = true; clearTimeout(timer); const error = api.runtime?.lastError; if (error || !tab) reject(Error('tab_unavailable')); else resolve(tab); };
    const timer = setTimeout(() => { if (done) return; done = true; reject(Error('tab_unavailable')); }, 5000);
    try { const result = api.tabs.get(tabId, finish); if (result?.then) result.then(finish, () => finish(null)); } catch { finish(null); }
  });
  function stop(reason = 'user_stopped') {
    if (!session?.active) return;
    session.active = false; session.endedAt = clock(); session.stopReason = reason;
    clearTimeout(timeout); timeout = null;
    network.onRequestFinished.removeListener(onRequest); network.onNavigated.removeListener(onNavigated);
    notify();
  }
  function tick() { if (session?.active && clock() - session.startedAt >= LIMITS.durationMs) stop('time_limit'); }
  function onNavigated(url) {
    if (!session?.active) return;
    session.observations.navigationEvents++;
    if (productIdFromPage(url) !== session.itemId) stop('page_changed');
    else { session.observations.sameProductNavigations++; notify(); }
  }
  async function onRequest(request) {
    tick();
    const current = session, currentGeneration = generation;
    if (!current?.active) return;
    const stats = current.observations;
    stats.networkEvents++;
    const { endpoint, reason } = classifyDetailEndpoint(request.request?.url);
    if (!endpoint) { stats.filtered[reason]++; return; }
    stats.matchedEndpointEvents++;
    const began = Date.parse(request.startedDateTime);
    // Do not read requests from before the explicit start (including old cached HAR entries).
    if (!Number.isFinite(began)) { stats.filtered.invalid_start_time++; return; }
    if (began < current.startedAt) { stats.filtered.before_start++; return; }
    if (current.reserved >= LIMITS.responses) { stats.filtered.response_limit++; return; }
    const alive = () => !disposed && generation === currentGeneration && session === current && current.active && clock() - current.startedAt < LIMITS.durationMs;
    try {
      const tab = await getTab();
      if (!alive()) return;
      if (productIdFromPage(tab.url) !== current.itemId) { stop('page_changed'); return; }
      if (current.reserved >= LIMITS.responses) { stats.filtered.response_limit++; return; }
      current.reserved++; current.pending = (current.pending || 0) + 1;
      const status = Number.isInteger(request.response?.status) && request.response.status >= 0 && request.response.status <= 599 ? request.response.status : 0;
      const entry = { ...endpoint, httpStatus: status };
      const declaredSize = request.response?.content?.size;
      if (status < 200 || status >= 300) entry.diagnostic = { state: 'http_error', fields: [] };
      else if (Number.isFinite(declaredSize) && declaredSize > LIMITS.bodyChars) entry.diagnostic = { state: 'body_limit', fields: [] };
      else {
        stats.bodyReadAttempts++;
        let { content, encoding } = await responseContent(request);
        if (!alive()) { content = ''; return; }
        stats.bodyReadCompletions++;
        const after = await getTab();
        if (!alive()) { content = ''; return; }
        if (productIdFromPage(after.url) !== current.itemId) { content = ''; stop('page_changed'); return; }
        if (encoding) entry.diagnostic = { state: encoding === 'unavailable' ? 'content_unavailable' : 'encoded_response_skipped', fields: [] };
        else if (content.length > LIMITS.bodyChars || current.bodyChars + content.length > LIMITS.totalChars) entry.diagnostic = { state: 'body_limit', fields: [] };
        else { current.bodyChars += content.length; entry.diagnostic = reduceDetailBody(content, current.itemId, clock()); }
        content = ''; // Never retain response text or put it in extension storage.
      }
      if (!alive()) return;
      current.responses.push(entry); current.pending--;
      if ([401, 403, 429].includes(status)) stop('http_rejected');
      else if (['verification_required', 'auth_required'].includes(entry.diagnostic.serviceState)) stop('login_or_verification');
      else if (entry.diagnostic.state === 'body_limit' || current.bodyChars >= LIMITS.totalChars) stop('size_limit');
      else if (current.reserved >= LIMITS.responses && !current.pending) stop('response_limit');
      else notify();
    } catch { if (alive()) stop('tab_unavailable'); }
  }
  return {
    supported,
    get session() { return session; },
    async start() {
      if (!supported || disposed) throw Error('unsupported');
      if (starting || session?.active) throw Error('already_started');
      starting = true;
      try {
        const tab = await getTab();
        if (disposed) throw Error('closed');
        const itemId = productIdFromPage(tab.url);
        if (!itemId) throw Error('not_product');
        generation++; session = createLoadSession(itemId, clock());
        network.onRequestFinished.addListener(onRequest); network.onNavigated.addListener(onNavigated);
        timeout = setTimeout(() => stop('time_limit'), LIMITS.durationMs); notify();
        return session;
      } finally { starting = false; }
    },
    stop, tick,
    report() { if (!session || session.active) return null; return makeLoadReport(session, api.runtime.getManifest().version, clock()); },
    clear() { stop(); generation++; session = null; notify(); },
    dispose() { disposed = true; stop('panel_closed'); generation++; session = null; },
  };
}
