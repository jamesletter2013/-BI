// Capture only documents the user already opened. Never create, navigate or close a tab.
globalThis.TAOACAPTURETABS = (() => {
  function identity(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/item.htm'
          || !(url.hostname === 'item.taobao.com' || url.hostname === 'tmall.com' || url.hostname.endsWith('.tmall.com'))) return null;
      const id = url.searchParams.get('id');
      return /^[1-9]\d{0,31}$/.test(id || '') ? { id, sku: url.searchParams.get('skuId') || '' } : null;
    } catch { return null; }
  }
  async function findExisting(browser, url) {
    const wanted = identity(url);
    if (!wanted) throw new Error('请输入有效的淘宝或天猫商品链接。');
    const tabs = await browser.tabs.query({ url: ['https://item.taobao.com/*', 'https://*.tmall.com/*'] });
    const candidates = tabs.filter(tab => {
      const item = identity(tab.pendingUrl || tab.url);
      return Number.isInteger(tab.id) && !tab.discarded && item?.id === wanted.id
        && (!wanted.sku || item.sku === wanted.sku);
    }).sort((a, b) => Number(b.active) - Number(a.active) || (b.lastAccessed || 0) - (a.lastAccessed || 0));
    for (const candidate of candidates) {
      const live = await browser.tabs.get(candidate.id).catch(() => null);
      const item = identity(live?.pendingUrl || live?.url);
      if (live && !live.discarded && item?.id === wanted.id && (!wanted.sku || item.sku === wanted.sku)) return live;
    }
    throw new Error('请先在当前浏览器打开对应商品页并保持登录，再点击采集。已休眠的标签需先打开唤醒；采集器不会新开商品页。');
  }
  return { identity, findExisting };
})();
