import type { ReviewsCapture } from './reviews';

export function captureProgress(data: ReviewsCapture | null, checking = false) {
  if (!data) return { badge: checking ? '读取商品页' : '等待开始', detail: checking ? '正在读取商品信息' : '开始采集后自动显示进度', needsAttention: false };
  const job = data.job, qa = job?.stage === 'qa';
  const pages = data.scopes.reduce((n, s) => n + s.pages, 0);
  const count = qa ? `已读 ${data.qa?.items.length || 0} 个问题` : `已读 ${data.items.length} 条`;
  const active = qa ? '问大家采集中 · 评价等待中' : `评价采集中 · ${pages} 页`;
  if (job?.state === 'paused' || data.status === 'blocked') return {
    badge: '已暂停', detail: data.message || '采集已暂停，请检查商品页后继续。', needsAttention: true,
  };
  if (job?.state === 'complete') return { badge: count, detail: '本轮采集已完成', needsAttention: false };
  if (job?.state === 'exhausted') return { badge: count, detail: '本轮已结束 · 部分数据未读取', needsAttention: false };
  if (job?.state === 'running' || checking) return { badge: count, detail: active, needsAttention: false };
  return { badge: count, detail: ['complete_scope', 'empty_scope'].includes(data.status) ? '当前范围已读完' : '当前为已保存的部分数据', needsAttention: false };
}
