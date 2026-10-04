(() => {
  // Re-injection repairs open tabs after reload without duplicating listeners.
  globalThis.__TAOA_BRIDGE_DISPOSE__?.();
  let lastCaptureKey = '';
  const post = (message) => window.postMessage(message, window.location.origin);
  const postCapture = (capture) => {
    if (!capture) return;
    const key = JSON.stringify([capture.capturedAt, capture.itemId, capture.status]);
    if (key === lastCaptureKey) return;
    lastCaptureKey = key;
    post({ type: 'TAOA_PRODUCT_CAPTURE', payload: capture });
  };
  const reportError = (type, error) => {
    const message = String(error?.message || error);
    post({ type, message: /context invalidated/i.test(message)
      ? '采集连接已失效，请刷新工作台后重试。' : message });
  };

  function onDelivery(message, _sender, sendResponse) {
    if (message?.type === 'TAOA_BRIDGE_PING') {
      sendResponse({ ok: true });
    } else if (message?.type === 'TAOA_REVIEW_PROGRESS') {
      post({ type: 'TAOA_REVIEW_PROGRESS', payload: message.reviewData });
      sendResponse({ ok: true });
    } else if (message?.type === 'TAOA_DELIVER_CAPTURE') {
      postCapture(message.capture);
      sendResponse({ ok: true });
    }
    return false;
  }

  function onPageMessage(event) {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const type = event.data?.type;
    if (!['TAOA_REQUEST_CAPTURE', 'TAOA_START_CAPTURE', 'TAOA_DOWNLOAD_IMAGES', 'TAOA_REVIEW_CONTROL', 'TAOA_REVIEW_STATUS'].includes(type)) return;
    // A detached old listener must allow the current bridge to receive requests.
    if (!chrome.runtime?.id) return;
    // Older versions left anonymous bubbling listeners behind on reload. Handle
    // only our request protocol during capture to stop those detached copies.
    event.stopImmediatePropagation();
    if (type === 'TAOA_REVIEW_CONTROL' || type === 'TAOA_REVIEW_STATUS') {
      Promise.resolve().then(() => chrome.runtime.sendMessage({ type,
        itemId: String(event.data.itemId || ''), jobId: String(event.data.jobId || ''),
        action: event.data.action === 'pause' ? 'pause' : 'resume',
      })).then(response => {
        if (!response?.ok) throw new Error(response?.error || '任务状态读取失败。');
        if (response.reviewData) post({ type: 'TAOA_REVIEW_PROGRESS', payload: response.reviewData });
      }).catch(error => reportError('TAOA_REVIEW_ERROR', error));
    }
    if (type === 'TAOA_REQUEST_CAPTURE') {
      if (new URL(window.location.href).searchParams.get('capture') !== '1') return;
      Promise.resolve().then(() => chrome.storage.local.get('taoaLastCapture'))
        .then(async ({ taoaLastCapture }) => {
          if (taoaLastCapture) {
            if (taoaLastCapture.reviewProgressItemId) {
              const response = await chrome.runtime.sendMessage({ type: 'TAOA_REVIEW_STATUS', itemId: taoaLastCapture.reviewProgressItemId });
              if (response?.ok) taoaLastCapture.reviewData = response.reviewData;
            }
            postCapture(taoaLastCapture);
            await chrome.storage.local.remove('taoaLastCapture');
          }
        }).catch((error) => reportError('TAOA_CAPTURE_ERROR', error));
    }
    if (type === 'TAOA_START_CAPTURE') {
      post({ type: 'TAOA_CAPTURE_STARTED' });
      // Catch synchronous context-invalidated errors as well as rejected promises.
      Promise.resolve().then(() => chrome.runtime.sendMessage({
        type, url: String(event.data.url || ''),
      })).then((response) => {
        if (!response?.ok) throw new Error(response?.error || '后台采集未返回结果。');
        // Request-response delivery also covers a failed tab broadcast.
        postCapture(response.capture);
      }).catch((error) => reportError('TAOA_CAPTURE_ERROR', error));
    }
    if (type === 'TAOA_DOWNLOAD_IMAGES') {
      Promise.resolve().then(() => chrome.runtime.sendMessage({
        type,
        urls: Array.isArray(event.data.urls) ? event.data.urls : [],
        group: event.data.group === 'sku' ? 'sku' : event.data.group === 'detail' ? 'detail' : 'main',
        itemId: String(event.data.itemId || ''),
      })).then((response) => {
        if (!response?.ok) throw new Error(response?.error || '图片打包失败。');
        post({
          type: 'TAOA_DOWNLOAD_RESULT',
          downloaded: Number(response.downloaded) || 0,
          failed: Number(response.failed) || 0,
        });
      }).catch((error) => reportError('TAOA_DOWNLOAD_ERROR', error));
    }
  }

  chrome.runtime.onMessage.addListener(onDelivery);
  window.addEventListener('message', onPageMessage, true);
  globalThis.__TAOA_BRIDGE_DISPOSE__ = () => {
    window.removeEventListener('message', onPageMessage, true);
    try { chrome.runtime.onMessage.removeListener(onDelivery); } catch {}
  };
})();
