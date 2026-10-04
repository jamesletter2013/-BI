import { reviewCounts, validateReviews } from './reviews';
import type { ReviewsCapture } from './reviews';

// An explicit allowlist: no buyer identity, media URL, request or auth fields.
// Export all saved records, independent of the UI's search/display limits.
export function reviewDetails(data: ReviewsCapture, exportedAt = new Date().toISOString()) {
  const safe = validateReviews(data, data.itemId);
  if (!safe || safe.items.length !== data.items.length) throw new Error('评价校验未通过，未导出不完整明细。');
  return {
    format: 'taoa-review-details', schemaVersion: 1, itemId: safe.itemId,
    capturedAt: safe.capturedAt, exportedAt, status: safe.status,
    jobState: safe.job?.state || 'unknown', snapshotOnly: true,
    fullCoverageVerified: false, counts: reviewCounts(safe.items),
    coverage: safe.coverage, scopes: safe.scopes, pagination: safe.pageTrace,
    items: safe.items.map(row => ({
      id: row.id, itemId: row.itemId, feedbackDate: row.feedbackDate,
      sku: row.sku, feedback: row.feedback, rateType: row.rateType,
      isDefault: row.isDefault, textKind: row.textKind, textTruncated: row.textTruncated,
      append: row.append ? { feedback: row.append.feedback, date: row.append.date } : null,
      sources: row.sources.map(source => ({scope: source.scope, page: source.page, profile: source.profile})),
    })),
  };
}

export function requestSavedReviews(itemId: string): Promise<ReviewsCapture> {
  if (!/^[1-9]\d{0,31}$/.test(itemId)) return Promise.reject(new Error('请输入商品链接或商品 ID。'));
  return new Promise((resolve, reject) => {
    const cleanup = () => { window.clearTimeout(timer); window.removeEventListener('message', receive); };
    const receive = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      if (event.data?.type !== 'TAOA_REVIEW_PROGRESS' || event.data.payload?.itemId !== itemId) return;
      const safe = validateReviews(event.data.payload, itemId);
      cleanup();
      if (!safe) reject(new Error('已保存评价校验未通过，原数据未改动。'));
      else resolve(safe);
    };
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error('未收到该商品的已保存评价。请确认在安装采集器的浏览器内打开；未发起重新采集。'));
    }, 8000);
    window.addEventListener('message', receive);
    // This existing extension operation reads IndexedDB only; it never resumes a job.
    window.postMessage({type: 'TAOA_REVIEW_STATUS', itemId}, window.location.origin);
  });
}
