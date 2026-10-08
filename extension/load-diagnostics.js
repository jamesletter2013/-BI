import { createLoadController } from './src/load-diagnostic-controller.mjs';
import { LIMITS, loadObservationMessage } from './src/load-diagnostic.mjs';
const el = id => document.getElementById(id);
let busy = false;
const reasons = { user_stopped: '已停止，可以预览并导出。', time_limit: '已达到 90 秒上限，记录已停止。', page_changed: '页面已离开当前商品，记录已停止。', http_rejected: '详情接口返回登录、拒绝或限流状态，诊断已停止；没有自动重试。', login_or_verification: '详情响应提示登录或验证，已停止；请在商品页正常处理，诊断不会代做验证。', response_limit: '已达到 12 条响应上限，记录已停止。', size_limit: '已达到响应大小限制，记录已停止，诊断可能不完整。', tab_unavailable: '无法确认商品标签，已停止。' };
const controller = createLoadController(globalThis.chrome || {}, render);
function controls() {
  const s = controller.session;
  el('start').disabled = busy || !controller.supported || Boolean(s?.active) || !el('consent').checked;
  el('consent').disabled = busy || Boolean(s?.active);
  el('stop').disabled = busy || !s?.active;
  el('download').disabled = busy || !s || s.active;
  el('clear').disabled = busy || !s;
}
function render() {
  const s = controller.session; controls();
  el('summary').hidden = !s;
  el('elapsed').textContent = s ? `商品 ${s.itemId} · 已记录 ${s.responses.length} 条详情响应 · ${Math.floor(((s.endedAt || Date.now()) - s.startedAt) / 1000)} / ${LIMITS.durationMs / 1000} 秒` : '';
  if (!s) { el('preview').textContent = ''; return; }
  const bound = s.responses.filter(r => r.diagnostic.matchedItem), dates = bound.flatMap(r => r.diagnostic.fields || []).filter(f => f.kind === 'date_candidate' && f.value);
  const pairs = [['商品 ID', s.itemId], ['已匹配商品响应', `${bound.length} 条`], ['日期候选', dates.length ? `${dates.length} 项（待核实，不会自动回填）` : '本次未观察到'], ['诊断范围', '当前商品页的允许列表详情响应，不覆盖所有来源']];
  const stats = s.observations;
  pairs.push(['网络完成事件', `${stats.networkEvents} 次`], ['详情接口匹配', `${stats.matchedEndpointEvents} 次（尚未核实商品归属）`],
    ['正文读取进度', `已完成 ${stats.bodyReadCompletions} / 已开始 ${stats.bodyReadAttempts} 次（完成含超时或读取失败）`],
    ['同商品导航', `${stats.sameProductNavigations} 次（不等于刷新已验证）`]);
  const labels = { outside_scope: '非目标域名或协议', unsupported_path: '不支持的路径形式', api_not_allowlisted: '接口不在允许列表', invalid_version: '接口版本格式不符', invalid_start_time: '缺少有效请求时间', before_start: '请求早于本次启动', response_limit: '超过响应数量限制' };
  pairs.push(['过滤原因计数', Object.entries(labels).map(([key, label]) => `${label}：${stats.filtered[key]}`).join('；')]);
  el('facts').replaceChildren();
  for (const [key, value] of pairs) { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = key; dd.textContent = value; el('facts').append(dt, dd); }
  el('observation').textContent = loadObservationMessage(s);
  el('preview').textContent = s.active ? '请先停止记录，再查看完整导出预览。' : JSON.stringify(controller.report(), null, 2);
  el('status').textContent = s.active ? '正在记录。现在请点击浏览器的刷新按钮一次；商品正常显示后点“停止记录”。' : (reasons[s.stopReason] || '记录已结束。') + (!s.responses.length ? ' 未捕获允许列表中的详情响应；仍可导出范围诊断，不能据此判断日期不存在。' : '');
}
el('consent').addEventListener('change', controls);
el('start').addEventListener('click', async () => {
  if (busy || !el('consent').checked || controller.session?.active) return;
  busy = true; controls();
  try { await controller.start(); }
  catch { el('status').textContent = '未开始：请在淘宝/天猫商品详情页按 F12 后选择“淘啊诊断”。若当前浏览器不支持该功能，请保留此提示，不要反复重装。'; }
  finally { busy = false; controls(); }
});
el('stop').addEventListener('click', () => controller.stop());
el('clear').addEventListener('click', () => { controller.clear(); el('consent').checked = false; el('status').textContent = '本次内存记录已清除。'; controls(); });
el('download').addEventListener('click', async () => {
  if (busy) return;
  const report = controller.report(); if (!report) return;
  busy = true; controls();
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json;charset=utf-8' }));
  try {
    await chrome.downloads.download({ url, filename: `淘啊-商品加载诊断-${report.itemId}-${Date.now()}.json`, saveAs: true });
    el('status').textContent = '已发起脱敏 JSON 下载。请把这个文件发来，不需要完整 HAR、Cookie 或 Token。';
  } catch { el('status').textContent = '下载未完成，记录仍保留，可再次导出。'; }
  finally { setTimeout(() => URL.revokeObjectURL(url), 60_000); busy = false; controls(); }
});
const timer = setInterval(() => { controller.tick(); if (controller.session?.active) render(); }, 1000);
window.addEventListener('pagehide', () => { clearInterval(timer); controller.dispose(); });
if (!controller.supported) el('status').textContent = '此页面须在商品页的开发者工具中打开：按 F12 → 淘啊诊断。若没有该页签，请确认修补包已重新加载，并关闭、重开 F12。';
controls();
