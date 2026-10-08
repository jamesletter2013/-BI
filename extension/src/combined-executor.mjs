import { collectQuestionsInBackground } from './qa-executor.mjs';
import { collectReviewsInBackground } from './review-executor.mjs';
import { createCaptureScheduler, STOP_CODES } from './capture-scheduler.mjs';
import { captureFromCheckpoint, freshCheckpoint } from './review-flow.mjs';

const inflight = new Map();
const stopLabels = {
  login_required: '登录失效', verification_required: '要求验证或拒绝访问', rate_limited: '限流',
  sdk_requires_ui: '请求组件需要前台界面', account_changed: '账号变化',
  document_changed: '商品页刷新或关闭', product_mismatch: '商品变化',
  request_timeout: '请求超时', capture_timeout: '达到本轮时间上限',
};
const names = { qa: '问大家', reviews: '评价', capture: '联合采集' };

// No new tab/session. Only a supported native human-verification handoff may
// continue a challenged page; denied or failed requests are not retried.
export function collectFeedbackInBackground(tab, itemId, browser = chrome, options = {}) {
  const key = `${tab.windowId}:${itemId}`;
  if (inflight.has(key)) return inflight.get(key);
  const job = collect(tab, itemId, browser, options).finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}
async function collect(tab, itemId, browser, options) {
  const scheduler = createCaptureScheduler(options);
  const adapter = source => ({ tabs: browser.tabs, windows: browser.windows,
    scheduleRequest: operation => scheduler.run(source, operation), scripting: {
    executeScript: async spec => {
      const operation = async () => {
        scheduler.check();
        const entries = await browser.scripting.executeScript(spec);
        const entry = entries.find(x => x.frameId === 0 && (!spec.target.documentIds
          || spec.target.documentIds.includes(x.documentId)));
        const inlineVerification = options[source]?.allowInteractiveVerification === true
          && entry?.result?.code === 'verification_required' && entry.result.canOpenVerification === true
          && spec.args?.[3] !== true;
        if (STOP_CODES.has(entry?.result?.code) && !inlineVerification) scheduler.halt(source, entry.result.code);
        return entries;
      };
      return operation();
    },
  } });
  // Strict phase order, including automatic continuation: reviews never run
  // while Q&A has an unfinished batch or an unhandled access/transport failure.
  const questionResult = await collectQuestionsInBackground(tab, itemId, adapter('qa'), options.qa || {});
  const qaReason = questionResult.qa.diagnostics?.reason;
  const qaPending = qaReason === 'batch_limit';
  const qaFinished = ['done', 'partial_answers', 'list_limit', 'list_no_progress',
    'unknown_list_pagination', 'size_limit'].includes(qaReason);
  if (STOP_CODES.has(qaReason)) scheduler.halt('qa', qaReason);
  let reviewData;
  if (!qaFinished) {
    const checkpoint = options.reviews?.checkpoint || freshCheckpoint(itemId);
    reviewData = { ...captureFromCheckpoint(checkpoint, 'capture_stopped'), checkpoint,
      diagnostics: { reason: qaPending ? 'waiting_qa' : 'capture_stopped' },
      message: qaPending ? '先采集问大家，评价尚未启动；下一批自动继续。' : '问大家阶段已停止，评价未发起新请求。' };
  } else {
    await options.onQaFinished?.(questionResult);
    reviewData = await collectReviewsInBackground(tab, itemId, adapter('reviews'), options.reviews || {});
    if (STOP_CODES.has(reviewData.diagnostics?.reason)) scheduler.halt('reviews', reviewData.diagnostics.reason);
  }
  const schedule = scheduler.snapshot();
  const decorate = (data, source) => {
    data.diagnostics = { ...data.diagnostics, requestCount: schedule.requestCounts[source], schedule };
    if (data.diagnostics.reason !== 'capture_stopped') return;
    const why = schedule.stop;
    const count = schedule.requestCounts[source];
    // Do not label a peer's challenge as this endpoint failing. Nor claim the
    // peer completed simply because some preview rows were already available.
    data.status = data.items.length ? 'partial' : 'unavailable';
    data.message = `${names[source]}${count ? `已尝试 ${count} 次请求，后续分页未完成` : '请求尚未发起'}；`
      + `本轮因${names[why?.source] || '联合采集'}${stopLabels[why?.reason] || '停止'}停止。`
      + '已保留实读内容，未自动重试或打开验证界面。';
  };
  decorate(questionResult.qa, 'qa');
  decorate(reviewData, 'reviews');
  // A later Q&A challenge must cancel a previously successful review batch's
  // automatic continuation, without relabelling it as a review request failure.
  if (schedule.stop && reviewData.diagnostics.reason === 'batch_limit') {
    reviewData.diagnostics.reason = 'capture_stopped';
    if (reviewData.checkpoint) reviewData.checkpoint.reason = 'capture_stopped';
    decorate(reviewData, 'reviews');
  }
  return { ...questionResult, qaPending, qaFinished, reviewData };
}
