import { collectFeedbackInBackground } from './combined-executor.mjs';
import { collectReviewsInBackground } from './review-executor.mjs';
import { captureFromCheckpoint, freshCheckpoint, validCheckpoint, restartPreservingReviews } from './review-flow.mjs';
import { REVIEW_MESSAGES, validId } from './review-model.mjs';
import { createReviewStore } from './review-store.mjs';
import { freshQaCheckpoint, validQaCheckpoint, qaResultFromCheckpoint } from './qa-request-flow.mjs';

const prefix = 'taoa-reviews:';
const qaContinueMs = 1000;
const reviewContinueMs = 10000;
const unsafeResume = new Set(['record_limit', 'size_limit', 'page_limit', 'range_exhausted', 'repeated_page',
  'empty_page', 'pagination_unknown', 'invalid_checkpoint']);
export function createReviewJobs({ browser = chrome, store = createReviewStore(), publish = async () => {},
  combined = collectFeedbackInBackground, reviews = collectReviewsInBackground, onComplete = async () => {},
  schedule = setTimeout, cancel = clearTimeout, allowInteractiveVerification = false } = {}) {
  let busy = null, starting = false, tickPromise = null;
  const paused = new Set();
  const continuations = new Map();
  const alarm = (id, minutes) => browser.alarms.create(prefix + id, { delayInMinutes: minutes });
  const clearContinuation = id => {
    const timer = continuations.get(id);
    if (timer) cancel(timer.handle);
    continuations.delete(id);
  };
  const clear = id => { clearContinuation(id); return browser.alarms.clear(prefix + id); };
  // A short, best-effort continuation for successful saved batches. Keep the
  // durable alarm as a fallback if the worker sleeps; never retry a failed page.
  function continueSaved(job) {
    clearContinuation(job.itemId);
    const timer = { handle: null };
    continuations.set(job.itemId, timer);
    timer.handle = schedule(() => {
      return (async () => {
        const live = await store.get(job.itemId);
        if (continuations.get(job.itemId) !== timer) return;
        continuations.delete(job.itemId);
        if (!live || live.id !== job.id || live.phase !== 'queued' || live.stage !== job.stage
          || live.reason !== 'batch_limit' || paused.has(live.id)) return;
        if (busy || starting || tickPromise) { continueSaved(live); return; }
        await tick(live.itemId);
      })().catch(() => { /* The durable alarm will recheck stored state. */ });
    }, job.stage === 'qa' ? qaContinueMs : reviewContinueMs);
  }
  async function scheduleSaved(job) {
    await save(job); await clear(job.itemId);
    if (job.phase !== 'queued') return;
    // Packaged Chromium alarms have a 30-second minimum; the short timer
    // supplies the normal 10-second review wait without relying on that alarm.
    await alarm(job.itemId, job.stage === 'qa' ? 1 : 0.5);
    continueSaved(job);
  }
  const emit = async job => { try { await publish(publicResult(job)); } catch {} };
  function publicResult(job) {
    const result = captureFromCheckpoint(job.checkpoint, job.reason, job.diagnostics || {});
    if (job.qa) result.qa = job.qa;
    result.job = { id: job.id, state: job.phase === 'queued' || job.phase === 'executing' ? 'running' : job.phase,
      stage: job.stage === 'qa' ? 'qa' : 'reviews',
      canResume: job.phase === 'paused' && !unsafeResume.has(job.reason),
      updatedAt: job.updatedAt, nextRunAt: job.nextRunAt || '', reason: job.reason,
      verificationPending: job.verificationPending === true };
    if (job.message) result.message = job.message;
    if (job.phase === 'queued') result.message = job.stage === 'qa'
      ? '问大家进度已保存，正在自动连续采集；无需保持工作台打开。'
      : '本批已保存，约 10 秒后继续下一批；无需保持工作台打开。';
    if (job.phase === 'executing') result.message = '正在后台读取，已保存的进度如下。';
    if (job.stage === 'qa') result.message = `先采问大家（已读 ${job.qa?.items?.length || 0} 个问题），评价等待中。${result.message || ''}`;
    return result;
  }
  async function save(job) { job.updatedAt = new Date().toISOString(); await store.put(job); }
  function options(job) {
    return { checkpoint: job.checkpoint, binding: job.binding,
      shouldStop: () => paused.has(job.id),
      onCheckpoint: async checkpoint => { job.checkpoint = checkpoint; await save(job); await emit(job); } };
  }
  function qaOptions(job) {
    return { checkpoint: job.qaCheckpoint, binding: job.qaBinding, shouldStop: () => paused.has(job.id),
      allowInteractiveVerification,
      onVerification: async active => { job.verificationPending = active; await save(job); await emit(job); },
      onCheckpoint: async checkpoint => {
        const parsed = qaResultFromCheckpoint(checkpoint);
        const next = { ...job, qaCheckpoint: checkpoint, qa: parsed ? { ...parsed.capture,
          capturedAt: new Date().toISOString(), message: `${parsed.capture.message}问大家连续采集中，评价等待中。` } : job.qa };
        await save(next); Object.assign(job, next); await emit(job);
      } };
  }
  function combinedOptions(job) {
    return { qa: qaOptions(job), reviews: options(job), onQaFinished: async result => {
      job.stage = 'reviews'; job.qa = result.qa; job.qaCheckpoint = result.qaCheckpoint;
      await save(job); await emit(job);
    } };
  }
  async function finishCombined(job, result) {
    job.qa = result.qa;
    if (result.qaCheckpoint) job.qaCheckpoint = result.qaCheckpoint;
    if (result.qaBinding) job.qaBinding = result.qaBinding;
    if (result.qaFinished === false || result.qaPending) {
      job.stage = 'qa'; job.reason = result.qa.diagnostics?.reason || 'transport_failed';
      if (paused.has(job.id) && job.reason === 'batch_limit') job.reason = 'manual_paused';
      job.phase = job.reason === 'batch_limit' && job.qaBinding ? 'queued' : 'paused';
      job.message = result.qa.message;
      job.nextRunAt = job.phase === 'queued' ? new Date(Date.now() + qaContinueMs).toISOString() : '';
      await scheduleSaved(job);
      await emit(job); return publicResult(job);
    }
    job.stage = 'reviews';
    return finish(job, result.reviewData);
  }
  async function finish(job, result) {
    job.checkpoint = result.checkpoint || job.checkpoint;
    job.reason = result.diagnostics?.reason || 'transport_failed';
    job.diagnostics = result.diagnostics || {};
    job.message = result.message;
    if (result.binding) job.binding = result.binding;
    if (paused.has(job.id) && job.reason === 'batch_limit') job.reason = 'manual_paused';
    job.checkpoint.reason = job.reason;
    const complete = ['complete_scope', 'empty_scope'].includes(result.status);
    job.phase = job.reason === 'range_exhausted' ? 'exhausted' : complete ? 'complete' : job.reason === 'batch_limit' && job.binding ? 'queued' : 'paused';
    if (job.reason === 'manual_paused') job.message = REVIEW_MESSAGES.manual_paused;
    job.nextRunAt = job.phase === 'queued' ? new Date(Date.now() + reviewContinueMs).toISOString() : '';
    await scheduleSaved(job);
    await emit(job);
    if (complete) await onComplete(job);
    return publicResult(job);
  }
  async function fail(job, reason = 'interrupted') {
    job.verificationPending = false;
    job.phase = 'paused'; job.reason = reason; job.message = REVIEW_MESSAGES[reason];
    job.checkpoint.reason = reason; job.nextRunAt = '';
    await clear(job.itemId);
    try { await save(job); } catch { job.reason = 'storage_unavailable'; job.message = REVIEW_MESSAGES.storage_unavailable; }
    await emit(job); return publicResult(job);
  }
  async function pauseAll() {
    for (const job of await store.list()) if (['queued', 'executing'].includes(job.phase)) {
      paused.add(job.id); await clear(job.itemId);
      if (busy?.id !== job.id) await fail(job, 'manual_paused');
    }
    if (busy) await busy.promise;
  }
  function initial(tab, itemId, options = {}) {
    if (starting) return Promise.reject(new Error('采集任务正在运行，请等待或暂停后再开始。'));
    starting = true;
    return runInitial(tab, itemId, options).finally(() => { starting = false; });
  }
  async function runInitial(tab, itemId, { restart = false } = {}) {
    if (!validId(itemId)) throw new Error('商品 ID 无效');
    if (tickPromise) await tickPromise;
    await pauseAll();
    const previous = await store.get(itemId);
    if (previous && !validCheckpoint(previous.checkpoint, itemId)) throw new Error('旧评价进度无法校验，已保留原记录，未覆盖。');
    if (previous?.qaCheckpoint && !validQaCheckpoint(previous.qaCheckpoint, itemId)) throw new Error('旧问大家进度无法校验，已保留原记录，未覆盖。');
    const rescan = previous && (restart || previous.checkpoint.version < 3
      || ['complete', 'exhausted'].includes(previous.phase) || unsafeResume.has(previous.reason));
    const reuse = previous && !rescan;
    const job = { id: crypto.randomUUID(), itemId, tab, binding: null, phase: 'executing', reason: 'batch_limit',
      stage: 'qa', qaBinding: null,
      qaCheckpoint: reuse && previous.stage === 'qa' ? structuredClone(previous.qaCheckpoint) : freshQaCheckpoint(itemId),
      qa: reuse && previous.stage === 'qa' ? previous.qa : null,
      checkpoint: rescan ? restartPreservingReviews(previous.checkpoint, itemId)
        : reuse ? structuredClone(previous.checkpoint) : freshCheckpoint(itemId), updatedAt: '' };
    if (reuse) job.checkpoint.resumed = true;
    await save(job); await alarm(itemId, 3); // watchdog: crash pauses, never retries an unknown request
    const promise = (async () => {
      try {
        const result = await combined(tab, itemId, browser, combinedOptions(job));
        result.reviewData = await finishCombined(job, result);
        return result;
      } catch {
        const reviewData = await fail(job, 'storage_unavailable');
        return { qa: job.qa || { items: [], status: 'unavailable', message: '本轮未完成，请重试。' }, reviewData };
      } finally { busy = null; paused.delete(job.id); }
    })();
    busy = { id: job.id, promise }; return promise;
  }
  function tick(itemId) {
    if (tickPromise) return tickPromise;
    tickPromise = runTick(itemId).finally(() => { tickPromise = null; });
    return tickPromise;
  }
  async function runTick(itemId) {
    if (!validId(itemId)) return;
    if (starting) { await alarm(itemId, 1); return; }
    const job = await store.get(itemId);
    if (!job || !['queued', 'executing'].includes(job.phase)) return;
    if (job.checkpoint?.version !== 3) return fail(job, 'interrupted');
    if (job.stage === 'qa' && !validQaCheckpoint(job.qaCheckpoint, itemId)) return fail(job, 'invalid_checkpoint');
    if (busy) { await alarm(itemId, 1); return; }
    if (job.phase === 'executing') return fail(job, 'interrupted');
    clearContinuation(itemId);
    job.phase = 'executing'; job.nextRunAt = ''; await save(job); await alarm(itemId, 3);
    const promise = (async () => {
      try {
        if (job.stage === 'qa') return await finishCombined(job, await combined(job.tab, itemId, browser,
          combinedOptions(job)));
        return await finish(job, await reviews(job.tab, itemId, browser, options(job)));
      }
      catch { return fail(job, 'storage_unavailable'); }
      finally { busy = null; paused.delete(job.id); }
    })();
    busy = { id: job.id, promise }; return promise;
  }
  async function control(itemId, jobId, action) {
    const job = await store.get(itemId);
    if (!job || job.id !== jobId) throw new Error('任务已更新，请刷新后重新操作。');
    if (action === 'pause') { await pauseAll(); return publicResult(await store.get(itemId)); }
    if (action !== 'resume' || job.phase !== 'paused' || unsafeResume.has(job.reason)) throw new Error('请重新采集该商品。');
    if (busy || starting || tickPromise) throw new Error('另一个任务仍在收尾，请稍后继续。');
    await pauseAll();
    // This explicit user action revokes the in-memory pause as well as the
    // durable paused phase. Without this, the resumed flow sends zero requests.
    paused.delete(job.id);
    // Explicit user action may create a fresh native context, but must reuse the
    // same product tab. Alarms never rebind, open tabs or retry access failures.
    if (job.checkpoint.version < 3) job.checkpoint = restartPreservingReviews(job.checkpoint, itemId);
    job.binding = null; job.qaBinding = null; job.checkpoint.resumed = true; job.phase = 'queued';
    job.reason = 'batch_limit'; await save(job); return tick(itemId);
  }
  async function recover() {
    for (const job of await store.list()) {
      if (job.phase === 'executing' || job.phase === 'queued' && job.checkpoint?.version !== 3) await fail(job, 'interrupted');
      else if (job.phase === 'queued') {
        if (job.stage === 'qa' && job.reason === 'batch_limit') {
          job.nextRunAt = new Date(Date.now() + qaContinueMs).toISOString();
          await scheduleSaved(job); await emit(job);
        } else {
          job.nextRunAt = new Date(Date.now() + reviewContinueMs).toISOString();
          await scheduleSaved(job); await emit(job);
        }
      }
    }
  }
  return { initial, tick, control, recover, prefix, publicResult,
    get: async itemId => { const job = await store.get(itemId); return job ? publicResult(job) : null; } };
}
