// One shared FIFO for both readers. Each reader has at most one outstanding
// page, so the other reader can run before a long list resumes pagination.
export const STOP_CODES = new Set(['login_required', 'verification_required', 'rate_limited',
  'access_denied', 'verification_cancelled', 'verification_timeout',
  'sdk_requires_ui', 'account_changed', 'document_changed', 'product_mismatch', 'request_timeout']);
const stopped = () => Object.assign(new Error('capture_stopped'), { code: 'capture_stopped' });
export function createCaptureScheduler({ now = Date.now, sleep = ms => new Promise(r => setTimeout(r, ms)),
  intervalMs = 600, budgetMs = 120000 } = {}) {
  const started = now(), queue = [], counts = { qa: 0, reviews: 0 };
  let running = false, lastFinished = null, stop = null;
  const halt = (source, reason) => { stop ||= { source, reason }; };
  async function drain() {
    if (running) return;
    running = true;
    try {
      while (queue.length) {
        const job = queue.shift();
        if (!stop && lastFinished !== null) {
          const delay = intervalMs - (now() - lastFinished);
          if (delay > 0) await sleep(delay);
        }
        if (!stop && now() - started >= budgetMs) halt('capture', 'capture_timeout');
        if (stop) { job.reject(stopped()); continue; }
        counts[job.source]++;
        try { job.resolve(await job.operation()); }
        catch (error) {
          if (STOP_CODES.has(error?.code)) halt(job.source, error.code);
          job.reject(error);
        } finally { lastFinished = now(); }
      }
    } finally { running = false; }
  }
  return {
    halt,
    check() { if (stop) throw stopped(); },
    run(source, operation) {
      if (!Object.hasOwn(counts, source)) throw new Error('invalid_capture_source');
      return new Promise((resolve, reject) => {
        queue.push({ source, operation, resolve, reject });
        void drain();
      });
    },
    snapshot() { return { mode: 'interleaved', intervalMs, budgetMs, requestCounts: { ...counts },
      stop: stop ? { ...stop } : null }; },
  };
}
