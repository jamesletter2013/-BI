// Only recent-review tabs explicitly advertised by a successful response are
// eligible. No item IDs, guessed foldFlag, history, SKU enumeration or endpoint
// probing. The generic tab adapter still requires live acceptance testing.
export const REVIEW_SCOPES = Object.freeze({
  all: { label: '普通列表', code: '-8' },
  append: { label: '追评列表', code: '2' },
  media: { label: '图/视频补采', title: '图/视频', code: '7' },
  good: { label: '好评补采', title: '好评', code: '1' },
  neutral: { label: '中评补采', title: '中评', code: '0' },
  bad: { label: '差评补采', title: '差评', code: '-1' },
});
export const scopeKeys = Object.keys(REVIEW_SCOPES);
export const supplementalScope = scope => scopeKeys.includes(scope) && !['all', 'append'].includes(scope);
export function advertisedScopes(data) {
  const tabs = Array.isArray(data?.imprNewItemVOS) ? data.imprNewItemVOS.slice(0, 100) : [];
  return scopeKeys.filter(scope => supplementalScope(scope) && tabs.some(tab =>
    String(tab?.status) === '1' && tab?.title === REVIEW_SCOPES[scope].title && tab?.extraInfo?.labelType === 'tab'
    && tab.extraInfo.gray !== true && tab.extraInfo.gray !== 'true'
    && tab.extraInfo.rateType === REVIEW_SCOPES[scope].code));
}
