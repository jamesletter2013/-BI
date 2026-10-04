// Self-contained: Chrome serializes this function into the product's MAIN world.
// Only two read APIs are allowed. No cookies, signing, eval, third-party plugin
// internals, UI actions or raw response/profile data cross the extension bridge.
export async function qaPageRequest(itemId, descriptor = null, contextId = '') {
  const bad = code => ({ ok: false, code });
  const validId = v => (typeof v === 'string' && /^[1-9]\d{0,31}$/.test(v))
    || (Number.isSafeInteger(v) && v > 0);
  const samePage = () => {
    const u = new URL(location.href);
    return u.protocol === 'https:' && (u.hostname === 'item.taobao.com'
      || u.hostname === 'detail.tmall.com' || u.hostname.endsWith('.tmall.com'))
      && u.pathname === '/item.htm' && u.searchParams.get('id') === itemId;
  };
  const readIdentity = () => {
    // This exact global/field is present in the user-supplied saved product HTML.
    // Do not substitute the seller ID, analytics UID, a cookie, or a saved account.
    const info = window.__itempage_userinfo;
    if (!validId(info?.userId)) return null;
    if (validId(info.userNumId) && String(info.userId) !== String(info.userNumId)) return null;
    return info.userId;
  };
  const configSafe = sdk => {
    const c = sdk.config || {};
    // Some SDK versions OR global flags with per-call flags. Fail closed when
    // a global config could launch login/challenge UI; never modify that config.
    if (['LoginRequest', 'AntiCreep', 'AntiFlood', 'AntiFlool'].some(k => c[k])) return false;
    return (!c.mainDomain || ['taobao.com', 'tmall.com'].includes(c.mainDomain))
      && (!c.subDomain || c.subDomain === 'm') && (!c.prefix || c.prefix === 'h5api');
  };
  const failure = value => {
    const codes = Array.isArray(value?.ret) ? value.ret.filter(x => typeof x === 'string').join(',') : '';
    if (/SESSION_EXPIRED|SID_INVALID|AUTH_REJECT|NEED_LOGIN|NOT_LOGIN|TOKEN_EMPTY|TOKEN_EXPIRED/.test(codes)) return bad('login_required');
    if (/VALIDATE|RGV587|ASSIST_FLAG|ANTI|ILLEGAL_ACCESS|ACCESS_DENIED|USER_VALIDATE/.test(codes)) return bad('verification_required');
    if (/LIMIT|FREQUENT|TRAFFIC/.test(codes)) return bad('rate_limited');
    return bad('upstream_unsuccessful');
  };
  try {
    if (typeof itemId !== 'string' || !validId(itemId) || !samePage()) return bad('product_mismatch');
    const userId = readIdentity();
    if (userId === null) return bad('login_context_missing');
    if (!/^[a-f0-9-]{36}$/.test(contextId)) return bad('invalid_response_shape');
    // Identity stays in the product document; only an opaque run ID is saved.
    const contexts = window.__TAOA_QA_CONTEXTS__ ||= new Map();
    for (const [key, value] of contexts) if (Date.now() - value.started > 86400000) contexts.delete(key);
    if (descriptor === null && !contexts.has(contextId)) contexts.set(contextId, { itemId, account: String(userId), started: Date.now() });
    const context = contexts.get(contextId);
    if (!context || context.itemId !== itemId) return bad('document_changed');
    if (context.account !== String(userId)) return bad('account_changed');
    context.started = Date.now();
    const sdk = window.lib?.mtop;
    if (!sdk || typeof sdk.request !== 'function') return bad('sdk_unavailable');
    if (!configSafe(sdk)) return bad('sdk_requires_ui');
    if (descriptor === null) return { ok: true }; // read-only readiness probe

    const d = descriptor.data;
    const page = n => Number.isSafeInteger(n) && n >= 1 && n <= 1000;
    let data;
    if (descriptor.api === 'mtop.taobao.wdj.list.merge.search' && descriptor.version === '1.0') {
      if (d?.itemId !== itemId || !page(d.page)) return bad('invalid_request');
      data = { itemId, userId, pageSize: 10, page: d.page, type: 'mix_group', tagId: '',
        extraInfo: JSON.stringify({ searchText: '' }), ecode: 0, biz: 'pc' };
    } else if (descriptor.api === 'mtop.taobao.social.ugc.post.detail' && descriptor.version === '2.0') {
      if (!validId(d?.id) || typeof d.params !== 'string') return bad('invalid_request');
      const p = JSON.parse(d.params);
      if (!page(p.pageNum) || !validId(p.firstAnswerId)) return bad('invalid_request');
      data = { id: String(d.id), userId, params: JSON.stringify({ pageNum: p.pageNum, pageSize: 10,
        firstAnswerId: String(p.firstAnswerId), from: 'answer', searchFoldingList: false,
        pageVersion: 'v2', channel: 0 }), ecode: 0, biz: 'pc' };
    } else return bad('unsupported_api');

    // Copy only fields consumed by the strict response readers. Limit arrays one
    // past their reader caps so truncation remains detectable, never "complete".
    const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
    const pick = (v, keys) => {
      if (!record(v)) return null;
      const o = {};
      for (const k of keys) if (typeof v[k] === 'string') o[k] = v[k].slice(0, 2001);
      else if (typeof v[k] === 'boolean' || Number.isFinite(v[k])) o[k] = v[k];
      return o;
    };
    const rows = (v, n, transform) => Array.isArray(v) ? v.slice(0, n).map(transform) : null;
    const minimize = raw => {
      if (!samePage()) return bad('product_mismatch');
      if (String(readIdentity()) !== String(userId)) return bad('account_changed');
      if (typeof raw === 'string') {
        if (raw.length > 2_000_000) return bad('invalid_response_size');
        raw = JSON.parse(raw); // SDK returns objects/JSON, never evaluate JSONP
      }
      if (!record(raw) || raw.api !== descriptor.api || raw.v !== descriptor.version) return bad('invalid_response_shape');
      if (!Array.isArray(raw.ret) || !raw.ret.length || !raw.ret.every(r => typeof r === 'string' && r.split('::')[0] === 'SUCCESS')) return failure(raw);
      const s = raw.data;
      if (!record(s)) return bad('invalid_response_shape');
      let clean;
      if (descriptor.version === '1.0') {
        if (s.item?.itemId !== itemId) return bad('product_mismatch');
        clean = { ...pick(s, ['questionTotal', 'total', 'hasNext', 'foldingHasNext', 'foldingCount']),
          item: pick(s.item, ['itemId']), questionList: rows(s.questionList, 201, q => ({
            ...pick(q, ['itemId', 'questionId', 'questionTitle', 'answerCount']),
            topAnswerList: rows(q?.topAnswerList, 31, a => pick(a,
              ['questionId', 'answerId', 'answerTitle', 'isAiAnswer', 'mergedAnswerHasMore'])) })) };
      } else {
        if (s.refId !== itemId) return bad('product_mismatch');
        if (s.id !== data.id) return bad('detail_question_mismatch');
        clean = { ...pick(s, ['refId', 'id', 'title', 'questionCount', 'mergedAnswerHasMore']),
          list: { ...pick(s.list, ['success', 'isEnd', 'nextPage', 'totalCount']),
            list: rows(s.list?.list, 31, a => ({
              ...pick(a, ['id', 'title', 'isAiAnswer', 'mergedAnswerHasMore']),
              firstCommentVO: pick(a?.firstCommentVO, ['content']) })) } };
      }
      return { ok: true, source: JSON.stringify({ api: raw.api, v: raw.v, ret: ['SUCCESS::OK'], data: clean }) };
    };
    return await new Promise(resolve => {
      let settled = false;
      let timer;
      const finish = value => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
      const success = raw => { if (settled) return; try { finish(minimize(raw)); } catch { finish(bad('invalid_response_shape')); } };
      const reject = raw => finish(failure(raw));
      // Local timeout bounds even a callback-only or broken SDK. A late SDK
      // response is ignored; no retries or UI challenges are started by us.
      timer = setTimeout(() => finish(bad('request_timeout')), 12000);
      try {
        const returned = sdk.request({ api: descriptor.api, v: descriptor.version, data,
          appKey: '12574478', type: 'GET', dataType: 'jsonp', ecode: 0, timeout: 10000,
          H5Request: true, WindVaneRequest: false, LoginRequest: false, needLogin: false,
          AntiCreep: false, AntiFlood: false, AntiFlool: false }, success, reject);
        if (returned && typeof returned.then === 'function') returned.then(success, reject);
      } catch { finish(bad('transport_failed')); }
    });
  } catch { return bad('transport_failed'); }
}
