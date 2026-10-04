const encoder = new TextEncoder();

function imageExtension(value, contentType = '') {
  try {
    const match = new URL(value).pathname.match(/\.(jpe?g|png|webp|avif)(?:$|[?#])/i);
    if (match) return match[1].toLowerCase().replace('jpeg', 'jpg');
  } catch {}
  if (/png/i.test(contentType)) return 'png';
  if (/webp/i.test(contentType)) return 'webp';
  if (/avif/i.test(contentType)) return 'avif';
  return 'jpg';
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = (value >>> 8) ^ crcTable[(value ^ byte) & 0xff];
  return (value ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function buildZip(entries) {
  const localParts = [];
  const centralParts = [];
  const { time, date } = dosDateTime();
  let localOffset = 0;
  let centralSize = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const checksum = crc32(entry.data);
    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, time, true);
    localView.setUint16(12, date, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, entry.data.length, true);
    localView.setUint32(22, entry.data.length, true);
    localView.setUint16(26, name.length, true);
    localView.setUint16(28, 0, true);
    local.set(name, 30);
    localParts.push(local, entry.data);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, time, true);
    centralView.setUint16(14, date, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, entry.data.length, true);
    centralView.setUint32(24, entry.data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, localOffset, true);
    central.set(name, 46);
    centralParts.push(central);

    localOffset += local.length + entry.data.length;
    centralSize += central.length;
  }

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, localOffset, true);
  endView.setUint16(20, 0, true);
  return new Blob([...localParts, ...centralParts, end], { type: 'application/zip' });
}

async function downloadArchive(rawUrls, group, rawItemId) {
  const urls = [...new Set((Array.isArray(rawUrls) ? rawUrls : []).filter((url) => typeof url === 'string' && /^https?:\/\//i.test(url)))].slice(0, 120);
  const folder = group === 'sku' ? 'SKU图' : group === 'detail' ? '详情图' : '主图';
  const itemId = String(rawItemId || '').replace(/\D/g, '').slice(0, 24) || '未命名商品';
  const entries = [];
  let failed = 0;

  for (let index = 0; index < urls.length; index += 1) {
    try {
      const response = await fetch(urls[index], { credentials: 'omit', cache: 'no-store' });
      if (!response.ok) throw new Error(String(response.status));
      const data = new Uint8Array(await response.arrayBuffer());
      if (!data.length) throw new Error('empty');
      const extension = imageExtension(urls[index], response.headers.get('content-type') || '');
      entries.push({
        name: `${folder}/${String(index + 1).padStart(2, '0')}.${extension}`,
        data,
      });
    } catch {
      failed += 1;
    }
  }

  if (!entries.length) throw new Error('图片读取失败，无法生成压缩包。');
  const archive = buildZip(entries);
  const objectUrl = URL.createObjectURL(archive);
  setTimeout(() => URL.revokeObjectURL(objectUrl), 300000);
  return {
    downloaded: entries.length,
    failed,
    objectUrl,
    filename: `淘啊竞品/${itemId}-${folder}.zip`,
  };
}

async function verifySkuImage(rawUrl) {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' || !/(?:^|\.)(?:alicdn\.com|alicdn\.net|taobaocdn\.com|tbcdn\.cn)$/i.test(url.hostname)) {
    throw new Error('不支持的 SKU 图片地址');
  }
  url.hash = '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let bitmap;
  try {
    const response = await fetch(url.href, {
      credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) throw new Error('响应不是图片');
    bitmap = await createImageBitmap(blob);
    if (bitmap.width < 16 || bitmap.height < 16) {
      throw new Error(`占位图片 ${bitmap.width}×${bitmap.height}`);
    }
    return { width: bitmap.width, height: bitmap.height, bytes: blob.size };
  } finally {
    clearTimeout(timer);
    bitmap?.close();
  }
}

async function validateSkuImageGroups(preferred = [], fallback = []) {
  const all = [...preferred, ...fallback].filter((url) => typeof url === 'string').slice(0, 160);
  const keys = [...new Set(all.map((url) => url.split('#')[0]))];
  const results = new Map();
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(6, keys.length) }, async () => {
    while (next < keys.length) {
      const url = keys[next++];
      try { results.set(url, { ok: true, ...await verifySkuImage(url) }); }
      catch (error) { results.set(url, { ok: false, error: String(error?.message || error) }); }
    }
  }));
  const valid = (values) => values.filter((url) => results.get(url.split('#')[0])?.ok);
  const primary = valid(preferred);
  const alternative = valid(fallback);
  // A failed early source must not overwrite a complete, verified DOM group.
  const images = primary.length >= alternative.length ? primary : alternative;
  return {
    images,
    dimensions: images.map((url) => ({ url, ...results.get(url.split('#')[0]) })),
    rejected: keys.filter((url) => !results.get(url)?.ok)
      .map((url) => ({ url, error: results.get(url)?.error })),
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  let task;
  if (message?.type === 'TAOA_BUILD_ZIP_OFFSCREEN') {
    task = downloadArchive(message.urls, message.group, message.itemId);
  } else if (message?.type === 'TAOA_VALIDATE_SKU_IMAGES') {
    task = validateSkuImageGroups(message.preferred, message.fallback);
  } else return false;
  task
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});
