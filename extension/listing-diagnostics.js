import { diagnoseProductTab, productIdFromUrl } from './src/listing-diagnostic-report.mjs';
const el = id => document.getElementById(id);
let tabs = [], busy = false, report = null;
function controls() {
  el('refresh').disabled = busy; el('productTab').disabled = busy;
  el('export').disabled = busy || !tabs.length; el('download').disabled = busy || !report;
}
function clearReport() {
  report = null; el('summary').hidden = true; el('preview').textContent = ''; controls();
}
async function refresh() {
  if (busy) return;
  clearReport(); busy = true; controls();
  try {
    tabs = (await chrome.tabs.query({ url: ['https://item.taobao.com/*', 'https://*.tmall.com/*'] }))
      .filter(tab => Number.isSafeInteger(tab.id) && productIdFromUrl(tab.url));
    el('productTab').replaceChildren();
    for (const tab of tabs) {
      const option = document.createElement('option'); option.value = String(tab.id);
      option.textContent = `商品 ${productIdFromUrl(tab.url)} · ${(tab.title || '商品页').slice(0, 70)}`;
      el('productTab').append(option);
    }
    el('status').textContent = tabs.length ? '选择商品后点击“诊断并导出 JSON”。' : '没有找到已打开的商品页。请先打开商品并正常登录，再刷新列表。';
  } catch {
    tabs = []; el('productTab').replaceChildren(); el('status').textContent = '读取标签列表失败，请检查插件是否已正常加载。';
  } finally { busy = false; controls(); }
}
const categoryLabels = { id_conflict: '类目 ID 冲突', page_name_found: '页面模型含类目名称', id_only_needs_dictionary: '已读到 ID；正式采集时尝试本地表补全', not_observed: '本次未观察到类目 ID 或名称' };
const dateLabels = { date_conflict: '同口径日期冲突', explicit_date_found: '已读到明确上架字段', explicit_field_invalid_or_empty: '上架字段存在，但值为空或格式无效', not_observed: '本次未观察到明确上架字段' };
function render() {
  el('summary').hidden = false; el('facts').replaceChildren();
  const pairs = [['商品 ID', report.itemId], ['类目 ID', report.facts.categoryId || '未读到'],
    ['类目状态', categoryLabels[report.diagnostics.categoryState] || '未知'],
    ['上架时间', report.facts.listedAt || '未读到'], ['日期状态', dateLabels[report.diagnostics.dateState] || '未知'],
    ['已匹配模型', `${report.diagnostics.matchedSources.length} 处`], ['说明', report.interpretation],
    ['范围限制', report.diagnostics.limitsReached ? '触及读取上限；诊断不完整' : '只检查受限范围的已加载模型，不保证覆盖页面全部数据']];
  for (const [key, value] of pairs) {
    const dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = key; dd.textContent = value; el('facts').append(dt, dd);
  }
  el('preview').textContent = JSON.stringify(report, null, 2);
}
async function download() {
  if (!report) return;
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename: `淘啊-类目上架诊断-${report.itemId}-${Date.now()}.json`, saveAs: true });
    el('status').textContent = '已发起诊断文件下载，请查看浏览器下载记录。把该 JSON 文件发来即可继续核验。';
  } catch { el('status').textContent = '诊断已完成，下载未发起。可点“重新下载本次诊断”再试；不会重复读取商品。'; }
  finally { setTimeout(() => URL.revokeObjectURL(url), 60_000); }
}
el('refresh').addEventListener('click', refresh);
el('productTab').addEventListener('change', clearReport);
el('download').addEventListener('click', async () => { if (busy) return; busy = true; controls(); try { await download(); } finally { busy = false; controls(); } });
el('export').addEventListener('click', async () => {
  if (busy) return;
  clearReport(); const tab = tabs.find(row => String(row.id) === el('productTab').value);
  if (!tab) return;
  busy = true; controls(); el('status').textContent = '正在检查已加载字段，不发起商品查询…';
  try {
    report = await diagnoseProductTab(chrome, tab.id, productIdFromUrl(tab.url)); render(); await download();
  } catch {
    el('status').textContent = '未完成诊断：请确认商品页已正常显示且未跳转。若需要登录或验证，请先在商品页正常完成，再刷新列表重试。';
  } finally { busy = false; controls(); }
});
refresh();
