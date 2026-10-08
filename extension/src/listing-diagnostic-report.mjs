// Extension-page coordinator. All browser I/O is injected for offline tests.
import { readPageListingFacts } from './listing-facts.mjs';

export function productIdFromUrl(value) {
  try {
    const url = new URL(value);
    const id = url.searchParams.get('id');
    return url.protocol === 'https:' && /^(?:item\.taobao\.com|(?:[^.]+\.)?tmall\.com)$/.test(url.hostname)
      && url.pathname === '/item.htm' && /^[1-9]\d{0,19}$/.test(id || '') ? id : '';
  } catch { return ''; }
}

export async function diagnoseProductTab(api, tabId, expectedItemId) {
  if (!Number.isSafeInteger(tabId) || tabId < 0 || !/^[1-9]\d{0,19}$/.test(expectedItemId || '')) throw Error('请选择有效的商品标签');
  const before = await api.tabs.get(tabId);
  if (productIdFromUrl(before.url) !== expectedItemId) throw Error('商品标签已变化，请刷新列表后重试');
  // Top frame only. No cookie access, request interception, retries or navigation.
  const results = await api.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: 'MAIN',
    func: readPageListingFacts, args: [expectedItemId, true] });
  const after = await api.tabs.get(tabId);
  if (after.url !== before.url || productIdFromUrl(after.url) !== expectedItemId) throw Error('诊断过程中页面发生变化，本次未导出');
  const top = results.find(entry => entry.frameId === 0)?.result;
  if (!top || top.itemId !== expectedItemId || !top.diagnostics) throw Error('未读到可诊断的当前商品页，请先确认商品正常显示');
  return {
    schema: 'taoa.listing-field-diagnostic.v1', generatedAt: new Date().toISOString(),
    extensionVersion: api.runtime.getManifest().version, itemId: expectedItemId,
    scope: 'existing-page-models-only', liveNetworkRequests: false, thirdPartyToolbarRead: false,
    facts: { categoryId: top.categoryId, categoryPath: top.categoryPath, categorySource: top.categorySource,
      listedAt: top.listedAt, listedAtSource: top.listedAtSource },
    diagnostics: top.diagnostics,
    interpretation: top.diagnostics.matchedSources.length
      ? '仅据本次已加载且绑定该商品 ID 的模型；缺失不能证明其他源也没有'
      : '未定位到绑定当前商品 ID 的详情模型，不能据此认定原始商品没有这些字段',
  };
}
