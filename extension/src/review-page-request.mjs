// Serialized into the product document's MAIN world. Keep self-contained.
// Use its native SDK/session; only an explicit handoff can show native validation.
// Never read cookies, copy signatures, click or solve a challenge.
export async function reviewPageRequest(itemId, descriptor = null, contextId = '', allowVerification = false) {
  const bad = code => ({ ok: false, code });
  const id = v => (typeof v === 'string' && /^[1-9]\d{0,31}$/.test(v)) || (Number.isSafeInteger(v) && v > 0);
  const samePage = () => {
    const u = new URL(location.href);
    return u.protocol === 'https:' && (u.hostname === 'item.taobao.com' || u.hostname === 'detail.tmall.com'
      || u.hostname.endsWith('.tmall.com')) && u.pathname === '/item.htm' && u.searchParams.get('id') === itemId;
  };
  const identity = () => {
    const info = window.__itempage_userinfo;
    if (!id(info?.userId) || (id(info.userNumId) && String(info.userId) !== String(info.userNumId))) return null;
    return String(info.userId);
  };
  const failure = raw => {
    const code = Array.isArray(raw?.ret) ? raw.ret.filter(v => typeof v === 'string').map(v => v.split('::')[0]).join(',') : '';
    if (/USER_INPUT_CANCEL/.test(code)) return bad('verification_cancelled');
    if (/USER_INPUT_FAILURE/.test(code)) return bad('verification_required');
    if (/SESSION_EXPIRED|SID_INVALID|AUTH_REJECT|NEED_LOGIN|NOT_LOGIN|TOKEN_EMPTY|TOKEN_EXPIRED/.test(code)) return bad('login_required');
    if (/LIMIT|FREQUENT|TRAFFIC/.test(code)) return bad('rate_limited');
    if (/ILLEGAL_ACCESS|ACCESS_DENIED/.test(code)) return bad('access_denied');
    if (/VALIDATE|RGV587|ASSIST_FLAG|USER_VALIDATE/.test(code)) {
      let canOpenVerification = false;
      try {
        const url = new URL(raw?.data?.url);
        canOpenVerification = /RGV587|ASSIST_FLAG/.test(code) && url.protocol === 'https:' && !url.username && !url.password
          && ['taobao.com', 'tmall.com'].some(d => url.hostname === d || url.hostname.endsWith('.' + d))
          && typeof window.lib?.mtop?.antiCreepRequest === 'function';
      } catch {}
      return { ...bad('verification_required'), canOpenVerification };
    }
    if (/ANTI/.test(code)) return bad('access_denied');
    return bad('upstream_unsuccessful');
  };
  try {
    if (typeof itemId !== 'string' || !id(itemId) || !samePage()) return bad('product_mismatch');
    const account = identity();
    if (account === null) return bad('login_context_missing');
    if (!/^[a-f0-9-]{36}$/.test(contextId)) return bad('invalid_response_shape');
    // Bind the whole pagination run to the same account without returning any
    // account identifier to the extension. Expired contexts are bounded/removed.
    const contexts = window.__TAOA_REVIEW_CONTEXTS__ ||= new Map();
    for (const [key, value] of contexts) if (Date.now() - value.started > 86400000) contexts.delete(key);
    if (descriptor === null && !contexts.has(contextId)) contexts.set(contextId, { account, itemId, started: Date.now(), filters: [] });
    const context = contexts.get(contextId);
    if (!context || context.itemId !== itemId) return bad('document_changed');
    if (context.account !== account) return bad('account_changed');
    context.started = Date.now();
    const sdk = window.lib?.mtop;
    if (!sdk || typeof sdk.request !== 'function') return bad('sdk_unavailable');
    const c = sdk.config || {};
    if (['LoginRequest', 'AntiCreep', 'AntiFlood', 'AntiFlool'].some(k => c[k])
      || (c.mainDomain && !['taobao.com', 'tmall.com'].includes(c.mainDomain))
      || (c.subDomain && c.subDomain !== 'm') || (c.prefix && c.prefix !== 'h5api')) return bad('sdk_requires_ui');
    if (descriptor === null) return { ok: true };
    const d = descriptor.data;
    const ordinary = d?.searchImpr === '-8' && d?.rateType === '';
    const pageSize = ordinary ? 50 : 20;
    if (descriptor.api !== 'mtop.taobao.rate.detaillist.get' || descriptor.version !== '6.0'
      || d?.auctionNumId !== itemId || !Number.isInteger(d.pageNo) || d.pageNo < 1 || d.pageNo > 1000
      || !((d.searchImpr === '-8' && d.rateType === '') || (['2', '7', '1', '0', '-1'].includes(d.searchImpr) && d.rateType === d.searchImpr))
      || descriptor.profile !== (ordinary ? 'pc-all50-v1' : 'pc-filter20-v1')
      || d.pageSize !== pageSize || d.showTrueCount !== false || d.orderType !== '' || d.expression !== '' || d.rateSrc !== 'pc_rate_list'
      || (ordinary ? Object.hasOwn(d, 'foldFlag') || Object.hasOwn(d, 'skuVids') : d.foldFlag !== '0' || d.skuVids !== '')) return bad('invalid_response_shape');
    if (!['-8', '2'].includes(d.searchImpr) && !context.filters?.includes(d.searchImpr)) return bad('filter_not_available');
    // Ordinary 50-row payload and omission of foldFlag/skuVids are observed.
    // Append/media retain the prior independent 20-row request contract.
    // Other supplemental tab mappings remain candidates. Tab values come
    // only from the current document's successful ordinary response. The tab
    // adapter is a candidate pending live comparison, not a verified full feed.
    const data = { showTrueCount: false, auctionNumId: itemId, pageNo: d.pageNo, pageSize,
      rateType: d.rateType, searchImpr: d.searchImpr, orderType: '', expression: '', rateSrc: 'pc_rate_list' };
    if (!ordinary) Object.assign(data, { skuVids: '', foldFlag: '0' });
    const obj = v => v && typeof v === 'object' && !Array.isArray(v);
    const pick = (v, keys) => {
      const out = {};
      if (!obj(v)) return out;
      for (const key of keys) {
        if (typeof v[key] === 'string') out[key] = v[key].slice(0, 5001);
        else if (typeof v[key] === 'boolean' || Number.isFinite(v[key])) out[key] = v[key];
      }
      return out;
    };
    const media = row => ({ feedPicPathList: [
      ...(Array.isArray(row?.feedPicPathList) ? row.feedPicPathList : []),
      ...(Array.isArray(row?.appendFeedPicPathList) ? row.appendFeedPicPathList : []),
    ].filter(x => typeof x === 'string').slice(0, 20).map(x => x.slice(0, 3000)),
      video: pick(row?.video, ['cloudVideoUrl', 'sourceVideoUrl']) });
    const minimize = raw => {
      if (!samePage()) return bad('product_mismatch');
      if (identity() !== account) return bad('account_changed');
      if (typeof raw === 'string') {
        if (raw.length > 2_000_000) return bad('invalid_response_size');
        raw = JSON.parse(raw); // Native SDK object/JSON only; never execute JSONP.
      }
      if (!obj(raw) || raw.api !== descriptor.api || raw.v !== descriptor.version) return bad('invalid_response_shape');
      if (!Array.isArray(raw.ret) || !raw.ret.length || !raw.ret.every(r => typeof r === 'string' && r.split('::')[0] === 'SUCCESS')) return failure(raw);
      const source = raw.data;
      if (!obj(source) || !Array.isArray(source.rateList) || source.rateList.length > pageSize) return bad('invalid_response_shape');
      if (source.rateList.some(row => row?.auctionNumId !== itemId)) return bad('product_mismatch');
      const tabTitles = { '7': '图/视频', '1': '好评', '0': '中评', '-1': '差评' };
      const tabs = (Array.isArray(source.imprNewItemVOS) ? source.imprNewItemVOS : []).slice(0, 100)
        .filter(x => Object.hasOwn(tabTitles, x?.extraInfo?.rateType) && x.title === tabTitles[x.extraInfo.rateType] && x.extraInfo.labelType === 'tab')
        .map(x => ({ title: x.title, status: String(x.status).slice(0, 5), extraInfo: {
          rateType: x.extraInfo.rateType, labelType: 'tab', gray: x.extraInfo.gray === true || x.extraInfo.gray === 'true' } }));
      if (d.searchImpr === '-8') context.filters = tabs.filter(x => x.status === '1' && !x.extraInfo.gray).map(x => x.extraInfo.rateType);
      const clean = { ...pick(source, ['hasNext', 'total', 'totalPage', 'timePeriodDesc', 'feedAllCountFuzzy',
        'feedAllCount', 'fuzzyRateCount', 'foldCount', 'historyCount', 'feedAppendCount']),
        imprNewItemVOS: tabs,
        rateList: source.rateList.map(row => ({ ...pick(row, ['id', 'auctionNumId', 'feedback', 'feedbackDate', 'skuValueStr', 'rateType']),
          ...media(row), appendedFeed: obj(row.appendedFeed) ? {
            ...pick(row.appendedFeed, ['appendedFeedback', 'createTime', 'intervalDay', 'reply']), ...media(row.appendedFeed) } : null })) };
      // No buyer IDs, nicknames, avatars or login context leave the document.
      return { ok: true, source: JSON.stringify({ api: raw.api, v: raw.v, ret: ['SUCCESS::OK'], data: clean }) };
    };
    return await new Promise(resolve => {
      let settled = false, timer;
      const finish = value => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
      const success = raw => { if (!settled) { try { finish(minimize(raw)); } catch { finish(bad('invalid_response_shape')); } } };
      const reject = raw => finish(failure(raw));
      timer = setTimeout(() => finish(bad(allowVerification ? 'verification_timeout' : 'request_timeout')), allowVerification ? 120000 : 22000);
      try {
        const returned = sdk.request({ api: descriptor.api, v: descriptor.version, data,
          appKey: '12574478', type: 'GET', dataType: 'jsonp', valueType: 'string', ecode: 1, timeout: 20000,
          H5Request: true, WindVaneRequest: false, LoginRequest: false, needLogin: false,
          // The platform's dialog receives human input; success is still parsed
          // and bound to this product/account before the cursor can advance.
          AntiCreep: allowVerification === true, AntiFlood: false, AntiFlool: false }, success, reject);
        if (returned && typeof returned.then === 'function') returned.then(success, reject);
      } catch { finish(bad('transport_failed')); }
    });
  } catch { return bad('transport_failed'); }
}
