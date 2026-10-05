importScripts('api-core.js');
let started = false;
self.onmessage = async ({ data }) => {
  if (started) return;
  started = true;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180000);
  let config = data.config;
  try {
    self.postMessage({ type: 'progress', stage: 'requesting' });
    const result = await TAOAAPI.complete(config, config.key, data.input.messages, controller.signal);
    if (controller.signal.aborted) throw new Error('请求已超时；服务商可能已计费，不自动重试。');
    self.postMessage({ type: 'progress', stage: 'organizing' });
    result.text = TAOAAPI.validateSuggestions(result.text, data.input.itemId);
    self.postMessage({ type: 'result', result });
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message || '后台请求失败，不自动重试。' });
  } finally {
    clearTimeout(timer); config = null; data.config = null; self.close();
  }
};
