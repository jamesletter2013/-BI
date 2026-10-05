(() => {
  const tasks = new Map();
  const internal = sender => sender.id === chrome.runtime.id && !sender.tab
    && sender.url === chrome.runtime.getURL('background.js');
  function dispose(id) {
    const task = tasks.get(id); if (!task) return;
    clearTimeout(task.timer); task.worker?.terminate(); tasks.delete(id);
  }
  async function start(id, task) {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'TAOA_PERSONAL_OFFSCREEN_CLAIM', requestId: id });
      if (!response?.ok) throw new Error(response?.error || '任务无法领取。');
      if (tasks.get(id) !== task) return;
      const worker = task.worker = new Worker('api-worker.js');
      let delivery = Promise.resolve();
      worker.onmessage = ({ data: event }) => {
        delivery = delivery.then(async () => {
          if (tasks.get(id) !== task) return;
          const saved = await chrome.runtime.sendMessage({ type: 'TAOA_PERSONAL_OFFSCREEN_EVENT', requestId: id, event });
          if (!saved?.ok) throw new Error('结果未保存。');
          if (event.type !== 'progress') dispose(id);
        }).catch(() => dispose(id));
      };
      worker.onerror = () => { void fail(id, '插件内部执行异常，未自动重试；请检查服务商用量。'); };
      worker.postMessage({ input: response.input, config: response.config });
      response.config = null;
    } catch { await fail(id, '插件后台任务未能执行。没有自动重试，请检查配置和任务状态。'); }
  }
  async function fail(id, message) {
    if (!tasks.has(id)) return;
    try { await chrome.runtime.sendMessage({ type: 'TAOA_PERSONAL_OFFSCREEN_EVENT', requestId: id, event: { type: 'error', message } }); }
    catch { /* A later status read reports this lost executor as interrupted. */ }
    finally { dispose(id); }
  }
  chrome.runtime.onMessage.addListener((m, sender, respond) => {
    if (!m?.type?.startsWith('TAOA_AI_OFFSCREEN_') || !internal(sender)) return false;
    if (m.type === 'TAOA_AI_OFFSCREEN_STATE') { respond({ active: tasks.has(m.requestId) }); return false; }
    if (m.type === 'TAOA_AI_OFFSCREEN_ABORT') { dispose(m.requestId); respond({ ok: true }); return false; }
    if (m.type !== 'TAOA_AI_OFFSCREEN_START') return false;
    if (!tasks.has(m.requestId)) {
      const task = { worker: null, timer: setTimeout(() => void fail(m.requestId, '后台请求超时；服务商可能已计费，不自动重试。'), 195000) };
      tasks.set(m.requestId, task);
      // Respond before claiming to avoid a background queue deadlock.
      respond({ ok: true }); void start(m.requestId, task);
    } else respond({ ok: true });
    return false;
  });
})();
