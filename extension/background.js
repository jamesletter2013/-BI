importScripts('qa-runtime.js');
importScripts('reviews-runtime.js');
importScripts('feedback-runtime.js');
importScripts('review-jobs-runtime.js');
importScripts('api-core.js', 'api-profiles.js', 'api-background.js');
importScripts('capture-tabs.js');
const WORKBENCH_URL = 'https://taoa-competitor-lab.jamesletter2013.chatgpt.site/';
const reviewJobs = TAOAJOBS.createReviewJobs({ publish: publishReviewProgress, allowInteractiveVerification: true });
const reviewRecovery = reviewJobs.recover().catch(() => undefined);
async function publishReviewProgress(reviewData) {
  await chrome.storage.local.set({ taoaLastReviewDiagnostics: {
    ...reviewData.diagnostics, itemId: reviewData.itemId, status: reviewData.status,
    readCount: reviewData.items.length, scopes: reviewData.scopes, job: reviewData.job,
    extensionVersion: chrome.runtime.getManifest().version,
  } }).catch(() => undefined);
  // No foreground navigation or newly opened workbench for incremental updates.
  const tabs = await chrome.tabs.query({ url: `${WORKBENCH_URL}*` });
  for (const tab of tabs) {
    try {
      await ensureWorkbenchBridge(tab.id);
      await chrome.tabs.sendMessage(tab.id, { type: 'TAOA_REVIEW_PROGRESS', reviewData });
    } catch {}
  }
}
const PRODUCT_URLS = [
  /^https:\/\/item\.taobao\.com\/item\.htm/i,
  /^https:\/\/detail\.tmall\.com\/item\.htm/i,
  /^https:\/\/[^/]+\.tmall\.com\/item\.htm/i,
];

function isProductUrl(url = '') {
  return PRODUCT_URLS.some((pattern) => pattern.test(url));
}

function compactProductUrl(value) {
  try {
    const url = new URL(value);
    if (!isProductUrl(url.href)) return null;
    const id = url.searchParams.get('id');
    const skuId = url.searchParams.get('skuId');
    const compact = new URL(`${url.origin}${url.pathname}`);
    if (id) compact.searchParams.set('id', id);
    if (skuId) compact.searchParams.set('skuId', skuId);
    return compact.href;
  } catch {
    return null;
  }
}

function collectSkuImagesFromPageWorld() {
  const output = [];
  let structuredSkuSlots = [];
  let structuredSkuCombinationCount = 0;
  const labeledDomSkuCandidates = [];
  let propertyPicSlots = [];
  const seenUrls = new Set();
  const seenObjects = new WeakSet();
  let visitedObjects = 0;

  const strongSkuKey = /^(?:sku(?:base|core|data|model|map|props?|list|items?|images?|pics?|2info)|saleprops?|specprops?|variant(?:s|options?|values?)|property(?:images?|pics?)|prop(?:images?|pics?))$/i;
  const imageKey = /^(?:image|imageurl|imageuri|img|imgurl|pic|picurl|picture|pictureurl|thumbnail|thumb|src|url|skupic|skupicurl|skuimage|skuimageurl)$/i;
  const valueIdentityKey = /^(?:vid|pid|skuid|valueid|propid|propertyid|propvalueid|valuename|propname|propertyname)$/i;
  const skuContextText = /(?:skuBase|skuMap|sku2Info|skuData|skuList|skuProps?|saleProps?|specProps?|variants?|skuImage|skuPic|propImages?|propertyImages?|propValueId|valueId|propertyId|颜色分类|款式|规格)/i;

  const keyName = (value) => String(value || '').replace(/[^a-z0-9]/gi, '');

  function normalize(value) {
    let source = String(value || '').trim()
      .replace(/\\u0026/gi, '&')
      .replace(/\\u003d/gi, '=')
      .replace(/\\u002f/gi, '/')
      .replace(/\\x2f/gi, '/')
      .replace(/\\x3a/gi, ':')
      .replace(/\\\//g, '/')
      .replace(/&amp;/gi, '&')
      .replace(/^['"]+|['"]+$/g, '');
    if (/^(?:https?%3a)?%2f%2f/i.test(source)) {
      try { source = decodeURIComponent(source); } catch {}
    }
    if (!source || source.startsWith('data:') || source.startsWith('blob:')) return '';
    try {
      const url = new URL(source.startsWith('//') ? `https:${source}` : source, location.href);
      if (!/^https?:$/.test(url.protocol)) return '';
      if (url.protocol === 'http:' && /(?:alicdn|taobaocdn|tbcdn)\./i.test(url.hostname)) url.protocol = 'https:';
      if (!/(?:alicdn|taobaocdn|tbcdn)\./i.test(url.hostname)) return '';
      if (/^g\.alicdn\.com$/i.test(url.hostname) || /\/(?:tfs|tps)\//i.test(url.pathname)) return '';
      if (!/\.(?:jpe?g|png|webp|avif)(?:[_.?]|$)/i.test(url.href)) return '';
      if (/(?:gongyi|charity|taojinbi|coin|subsidy|promotion|activity|marketing|logo|avatar|icon|sprite|loading|blank|placeholder|transparent|spacer|empty)/i.test(url.href)) return '';
      if (/(?:^|[\/_-])1x1(?:[\/_\-?.]|$)|[?&](?:w|width|h|height)=1(?:&|$)/i.test(url.href)) return '';
      // Taobao's lazy image is a real, successfully loaded PNG, not a broken
      // request: ...-tps-2-2.png. Never turn it into 25 "SKU images" via hashes.
      const dimensions = url.pathname.match(/-tps-(\d+)-(\d+)\./i);
      if (dimensions && (Number(dimensions[1]) < 16 || Number(dimensions[2]) < 16)) return '';
      return url.href;
    } catch {
      return '';
    }
  }

  function add(value) {
    const url = normalize(value);
    if (!url || seenUrls.has(url)) return;
    seenUrls.add(url);
    output.push(url);
  }

  function firstImage(value, depth = 0) {
    if (value == null || depth > 8) return '';
    if (typeof value === 'string') {
      const direct = normalize(value);
      if (direct) return direct;
      if (value.length <= 100000 && /^[\[{]/.test(value.trim())) {
        try { return firstImage(JSON.parse(value), depth + 1); } catch {}
      }
      return '';
    }
    if (typeof value !== 'object') return '';
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = firstImage(item, depth + 1);
        if (found) return found;
      }
      return '';
    }
    let keys;
    try { keys = Object.keys(value); } catch { return ''; }
    const ordered = [...keys].sort((left, right) => {
      const leftImage = imageKey.test(keyName(left)) ? 0 : 1;
      const rightImage = imageKey.test(keyName(right)) ? 0 : 1;
      return leftImage - rightImage;
    });
    for (const key of ordered) {
      const found = firstImage(value[key], depth + 1);
      if (found) return found;
    }
    return '';
  }

  function keepSkuBaseSlots(value) {
    if (!value || typeof value !== 'object') return;
    let skuBase;
    try {
      if (value.skuBase && typeof value.skuBase === 'object') {
        skuBase = value.skuBase;
      } else {
        const candidateProps = value.props;
        const looksLikeSkuProps = Array.isArray(candidateProps)
          && candidateProps.some((prop) => prop && typeof prop === 'object'
            && (prop.pid != null || prop.propId != null || prop.propertyId != null)
            && (Array.isArray(prop.values) || Array.isArray(prop.valueList)));
        if (!looksLikeSkuProps) return;
        skuBase = value;
      }
    } catch { return; }

    let rawProps;
    let rawSkus;
    try {
      rawProps = skuBase.props;
      rawSkus = skuBase.skus;
    } catch { return; }
    if (!rawProps || typeof rawProps !== 'object') return;

    const props = Array.isArray(rawProps) ? rawProps : Object.values(rawProps);
    const propertyImages = [];

    for (const prop of props) {
      if (!prop || typeof prop !== 'object') continue;
      let rawValues;
      try { rawValues = prop.values ?? prop.valueList ?? prop.children; } catch { continue; }
      if (!rawValues || typeof rawValues !== 'object') continue;
      const values = Array.isArray(rawValues) ? rawValues : Object.values(rawValues);
      for (const option of values) {
        if (!option || typeof option !== 'object') continue;
        const image = firstImage({
          image: option.image,
          imageUrl: option.imageUrl,
          pic: option.pic,
          picUrl: option.picUrl,
          skuPic: option.skuPic,
        });
        if (!image) continue;
        propertyImages.push(image);
      }
    }
    if (!propertyImages.length) return;

    const skus = rawSkus && typeof rawSkus === 'object'
      ? (Array.isArray(rawSkus) ? rawSkus : Object.values(rawSkus))
      : [];
    structuredSkuCombinationCount = Math.max(structuredSkuCombinationCount, skus.length);

    // skuBase.skus is the Cartesian set of purchasable combinations. A product
    // with five pictured colors and five text-only sizes therefore has 25 SKU
    // records but only five SKU images. The image-bearing property values are
    // the authoritative picture slots; never multiply them by other properties.
    if (propertyImages.length > structuredSkuSlots.length) {
      structuredSkuSlots = propertyImages.slice(0, 80);
    }
  }

  function keepPropertyPicGroup(value) {
    let parsed = value;
    if (typeof parsed === 'string') {
      const attempts = [
        parsed,
        parsed.replace(/&quot;|&#34;/gi, '"'),
        parsed.replace(/\\"/g, '"').replace(/\\\//g, '/'),
      ];
      parsed = null;
      for (const attempt of attempts) {
        try {
          parsed = JSON.parse(attempt);
          break;
        } catch {}
      }
    }
    if (!parsed || typeof parsed !== 'object') return;
    const entries = Array.isArray(parsed) ? parsed : Object.values(parsed);
    const slots = entries.map((entry) => firstImage(entry)).filter(Boolean).slice(0, 80);
    if (slots.length > propertyPicSlots.length) propertyPicSlots = slots;
  }

  function keepPropertyPicUrlsFromText(source) {
    const text = String(source || '');
    if (!/propertyPics/i.test(text)) return;
    const keyPattern = /propertyPics/gi;
    let keyMatch;
    let inspected = 0;
    while ((keyMatch = keyPattern.exec(text)) && inspected < 12) {
      inspected += 1;
      const colon = text.indexOf(':', keyMatch.index + keyMatch[0].length);
      if (colon < 0 || colon - keyMatch.index > 100) continue;
      const start = text.indexOf('{', colon + 1);
      if (start < 0 || start - colon > 100) continue;
      let depth = 0;
      let quote = '';
      let escaped = false;
      let end = -1;
      const limit = Math.min(text.length, start + 3000000);
      for (let index = start; index < limit; index += 1) {
        const char = text[index];
        if (quote) {
          if (escaped) escaped = false;
          else if (char === '\\') escaped = true;
          else if (char === quote) quote = '';
          continue;
        }
        if (char === '"' || char === "'") {
          quote = char;
          continue;
        }
        if (char === '{') depth += 1;
        else if (char === '}') {
          depth -= 1;
          if (depth === 0) {
            end = index + 1;
            break;
          }
        }
      }
      if (end < 0) continue;
      const block = text.slice(start, end);
      const before = propertyPicSlots.length;
      keepPropertyPicGroup(block);
      if (propertyPicSlots.length > before) continue;
      const urls = [];
      const urlPattern = /(?:https?:)?\\?\/\\?\/[A-Za-z0-9._~!$&'()*+,;=:@%\/-]+\.(?:jpe?g|png|webp|avif)(?:\?[^"'\\\s<]*)?/gi;
      for (const match of block.matchAll(urlPattern)) {
        const url = normalize(match[0]);
        if (url) urls.push(url);
      }
      if (urls.length > propertyPicSlots.length) propertyPicSlots = urls.slice(0, 80);
    }
  }

  function identifySlots(values) {
    const seen = new Map();
    return values.map((value, index) => {
      const count = (seen.get(value) || 0) + 1;
      seen.set(value, count);
      return count === 1 ? value : `${value}#taoa-sku-option-${index + 1}`;
    });
  }

  function walk(value, insideSku = false, depth = 0) {
    if (!value || depth > 16 || visitedObjects > 18000) return;
    if (typeof value === 'string') {
      if (insideSku && value.length >= 2 && value.length <= 200000 && /^[\[{]/.test(value.trim())) {
        try { walk(JSON.parse(value), true, depth + 1); } catch {}
      }
      return;
    }
    if (typeof value !== 'object') return;
    keepSkuBaseSlots(value);
    if (output.length >= 80 || seenObjects.has(value)) return;
    seenObjects.add(value);
    visitedObjects += 1;

    let keys;
    try { keys = Object.keys(value).slice(0, 500); } catch { return; }
    const normalizedKeys = keys.map(keyName);
    const hasVariantIdentity = normalizedKeys.some((key) => valueIdentityKey.test(key));
    const hasImageField = normalizedKeys.some((key) => imageKey.test(key));
    const isVariantObject = hasVariantIdentity && hasImageField;

    const orderedKeys = [...keys].sort((left, right) => {
      const leftPriority = strongSkuKey.test(keyName(left)) ? 0 : 1;
      const rightPriority = strongSkuKey.test(keyName(right)) ? 0 : 1;
      return leftPriority - rightPriority;
    });

    for (const key of orderedKeys) {
      if (output.length >= 80 || visitedObjects > 18000) break;
      let child;
      try { child = value[key]; } catch { continue; }
      const normalizedKey = keyName(key);
      if (/^property(?:pics|images)$/.test(normalizedKey)) keepPropertyPicGroup(child);
      const entersSku = insideSku || strongSkuKey.test(normalizedKey) || isVariantObject;
      // Do not treat an arbitrary image field on a top-level skuData object
      // as an option thumbnail. It must belong to a concrete variant object
      // carrying an option identity, or be handled by propertyPics below.
      if (typeof child === 'string' && entersSku && imageKey.test(normalizedKey)
        && (isVariantObject || hasVariantIdentity)) add(child);
      if (child && typeof child === 'object') walk(child, entersSku, depth + 1);
      else if (typeof child === 'string' && entersSku && /^[\[{]/.test(child.trim())) {
        try { walk(JSON.parse(child), true, depth + 1); } catch {}
      }
    }
  }

  const preferredRoots = [
    '__ICE_APP_DATA__', '__INIT_DATA__', '__INITIAL_STATE__', '__PRELOADED_STATE__',
    '__NEXT_DATA__', '__SSR_DATA__', '__TAOBAO_DETAIL_DATA__', '__ITEM_DATA__',
    'PAGE_DATA', 'pageData', '_pageData', 'detailData', 'itemData', 'skuData',
    'g_config', 'Hub',
  ];
  let dynamicRoots = [];
  try {
    dynamicRoots = Object.keys(window)
      .filter((name) => /(?:sku|item|detail|init|state|props|data)/i.test(name))
      .slice(0, 160);
  } catch {}

  [...new Set([...preferredRoots, ...dynamicRoots])].forEach((name) => {
    let value;
    try { value = window[name]; } catch { return; }
    if (!value || (typeof value !== 'object' && typeof value !== 'string')) return;
    walk(value, /sku/i.test(name), 0);
  });

  // New Taobao/Tmall detail pages keep the complete detail model on React's
  // internal fiber attached to the bid form input instead of a window global.
  // This mirrors the stable path used by mature SKU download extensions.
  try {
    const nodes = document.querySelectorAll(
      'form[name="bidForm"]>input[name="x_id"], form[name="bidForm"]',
    );
    nodes.forEach((node) => {
      let keys = [];
      try {
        keys = Object.getOwnPropertyNames(node)
          .filter((key) => /^__react(?:Fiber|Props)\$/i.test(key));
      } catch {}
      for (const key of keys) {
        let fiber;
        try { fiber = node[key]; } catch { continue; }
        for (let depth = 0; fiber && depth < 14; depth += 1) {
          for (const props of [fiber.memoizedProps, fiber.pendingProps]) {
            if (!props || typeof props !== 'object') continue;
            try {
              if (props.detail && typeof props.detail === 'object') {
                keepSkuBaseSlots(props.detail);
              }
              if (props.skuBase && typeof props.skuBase === 'object') {
                keepSkuBaseSlots(props);
              }
            } catch {}
          }
          try { fiber = fiber.return; } catch { break; }
        }
      }
    });
  } catch {}

  // The rendered option list can contain sold-out or legacy choices omitted
  // from skuBase. Read the nearest DOM group headed by 颜色/款式/规格 so every
  // thumbnail the shopper can actually see is retained as an SKU slot.
  try {
    const labelPattern = /^(?:颜色分类|颜色|款式|规格|型号|套餐|外观|图案)\s*[:：]?$/;
    const labels = [...document.querySelectorAll('div,span,label,p')]
      .filter((node) => labelPattern.test(String(node.textContent || '').replace(/\s+/g, ' ').trim()));
    labels.forEach((label) => {
      let group = label.parentElement;
      for (let depth = 0; group && depth < 6; depth += 1, group = group.parentElement) {
        const images = [...group.querySelectorAll('img')];
        if (images.length < 2 || images.length > 80) continue;
        const slots = images.map((image) => firstImage([
          ...((image.complete && (image.naturalWidth < 16 || image.naturalHeight < 16))
            ? [] : [image.currentSrc, image.src]),
          image.getAttribute?.('data-src'),
          image.getAttribute?.('data-ks-lazyload'),
          image.getAttribute?.('data-lazyload-src'),
          image.getAttribute?.('data-original'),
          image.getAttribute?.('data-image'),
        ])).filter(Boolean).slice(0, 80);
        if (slots.length >= 2) {
          const signature = slots.join('\n');
          if (!labeledDomSkuCandidates.some((candidate) => candidate.join('\n') === signature)) {
            labeledDomSkuCandidates.push(slots);
          }
        }
        break;
      }
    });
  } catch {}

  try {
    document.querySelectorAll('script').forEach((script) => {
      if (output.length >= 80) return;
      const source = String(script.textContent || '');
      if (!skuContextText.test(source)) return;
      keepPropertyPicUrlsFromText(source);
      let parsedJson = false;
      if ((script.type || '').toLowerCase().includes('json') && source.length <= 6000000) {
        try {
          walk(JSON.parse(source), false, 0);
          parsedJson = true;
        } catch {}
      }
      if (parsedJson) return;
      const urlPattern = /(?:https?:)?\\?\/\\?\/[A-Za-z0-9._~!$&'()*+,;=:@%\/-]+\.(?:jpe?g|png|webp|avif)(?:\?[^"'\\\s<]*)?/gi;
      for (const match of source.matchAll(urlPattern)) {
        const index = match.index || 0;
        // Inline fallback is deliberately strict: the SKU marker and image
        // field must both occur before the URL. This prevents a product/main
        // image appearing just before a later skuBase object from leaking in.
        const before = source.slice(Math.max(0, index - 180), index);
        if (!skuContextText.test(before)) continue;
        // A generic `skuData.image` field is often the product's main image.
        // Inline fallback URLs must also have a concrete option identity (or
        // propertyPics marker) nearby before they can be treated as SKU art.
        if (!/(?:propertyPics|vid|valueId|propValueId|skuId|sku_id|propertyId|propId)/i.test(before)) continue;
        if (!/(?:image|img|pic|thumb|src|url)["']?\s*[:=]\s*["']?\s*$/i.test(before.slice(-110))) continue;
        add(match[0]);
      }
    });
  } catch {}

  try { keepPropertyPicUrlsFromText(document.documentElement?.innerHTML || ''); } catch {}

  const structured = identifySlots(structuredSkuSlots).slice(0, 80);
  const labeledCandidates = labeledDomSkuCandidates
    .map((slots) => identifySlots(slots).slice(0, 80));
  let labeledDom = [];
  if (structured.length) {
    // Use a rendered group only when its slot count exactly corroborates the
    // structured image options. A larger ancestor can include gallery art and
    // must not inflate the SKU image count.
    labeledDom = labeledCandidates
      .find((candidate) => candidate.length === structured.length) || [];
  } else {
    labeledDom = labeledCandidates
      .sort((left, right) => right.length - left.length)[0] || [];
  }
  const propertyPics = identifySlots(propertyPicSlots).slice(0, 80);
  let selectedSource = 'none';
  let best = [];
  if (labeledDom.length) {
    best = labeledDom;
    selectedSource = 'labeledDom';
  } else if (structured.length) {
    best = structured;
    selectedSource = 'structuredPropertyOptions';
  } else if (propertyPics.length) {
    best = propertyPics;
    selectedSource = 'propertyPics';
  } else if (output.length) {
    best = output.slice(0, 80);
    selectedSource = 'genericFallback';
  }
  try {
    window.__TAOA_SKU_DIAGNOSTICS__ = {
      structuredCount: structured.length,
      structuredCombinationCount: structuredSkuCombinationCount,
      labeledDomCount: labeledDom.length,
      labeledDomCandidateCounts: labeledCandidates.map((candidate) => candidate.length),
      propertyPicsCount: propertyPics.length,
      genericOutputCount: output.length,
      selectedSource,
    };
  } catch {}
  return best;
}

function setBadge() {
  // Keep the existing gold T artwork; no busy, success or error overlays.
  chrome.action.setBadgeText({ text: '' }).catch(() => undefined);
}
setBadge(); // Clear a badge retained from an earlier extension version.

function mergeUnique(values, max = 120) {
  return [...new Set(values.filter((value) => typeof value === 'string' && /^https?:\/\//i.test(value)))].slice(0, max);
}

function selectBestSkuImages(pageWorldValues, domValues) {
  const pageWorld = mergeUnique(Array.isArray(pageWorldValues) ? pageWorldValues : [], 80);
  const dom = mergeUnique(Array.isArray(domValues) ? domValues : [], 80);
  // The page-world path reads structured SKU data and the exact labeled option
  // group. Treat it as authoritative whenever available. The legacy DOM path
  // scans a wider area and is usually only a fallback because it can include
  // gallery or recommendation images. However, some hydrated pages expose only
  // the currently selected picture in page-world data while the strictly
  // bounded rendered option group contains the full list. In that specific
  // one/two-picture case, prefer the fuller DOM group.
  if (!pageWorld.length) return dom;
  if (pageWorld.length <= 2 && dom.length > pageWorld.length) return dom;
  return pageWorld;
}

let creatingOffscreenDocument;

async function ensureOffscreenDocument() {
  const url = chrome.runtime.getURL('offscreen.html');
  const exists = chrome.runtime.getContexts
    ? (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] })).length > 0
    : (await clients.matchAll()).some(client => client.url === url);
  if (exists) return;
  if (!creatingOffscreenDocument) {
    creatingOffscreenDocument = chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['BLOBS', 'WORKERS'],
      justification: '打包商品图片，并使用独立 Worker 执行用户确认的 AI 请求，不打开标签页。',
    }).finally(() => {
      creatingOffscreenDocument = undefined;
    });
  }
  await creatingOffscreenDocument;
}

async function validateSkuImages(preferred, fallback = []) {
  if (!preferred.length && !fallback.length) return { images: [], dimensions: [], rejected: [] };
  await ensureOffscreenDocument();
  const response = await chrome.runtime.sendMessage({
    type: 'TAOA_VALIDATE_SKU_IMAGES', preferred, fallback,
  });
  if (!response?.ok || !Array.isArray(response.images)) {
    throw new Error(response?.error || 'SKU 图片验证失败，请重试采集。');
  }
  return response;
}

async function downloadImages(rawUrls, group, rawItemId) {
  const urls = mergeUnique(Array.isArray(rawUrls) ? rawUrls : [], 120);
  if (!urls.length) throw new Error('没有可打包的图片。');
  await ensureOffscreenDocument();
  const response = await chrome.runtime.sendMessage({
    type: 'TAOA_BUILD_ZIP_OFFSCREEN',
    urls,
    group,
    itemId: rawItemId,
  });
  if (!response?.ok) throw new Error(response?.error || '图片打包失败。');
  if (!response.objectUrl || !response.filename) throw new Error('压缩包生成结果无效。');
  await chrome.downloads.download({
    url: response.objectUrl,
    filename: response.filename,
    conflictAction: 'uniquify',
    saveAs: false,
  });
  return { downloaded: Number(response.downloaded) || 0, failed: Number(response.failed) || 0, format: response.format };
}

function assetOwnerKey(value) {
  try {
    const path = new URL(value).pathname;
    return path.match(/\/(?:imgextra|bao\/uploaded)\/i\d+\/(\d{5,})\//i)?.[1]
      || path.match(/\/i\d+\/(\d{5,})\//i)?.[1]
      || '';
  } catch {
    return '';
  }
}

function merchantDetailUrls(values, mainImages = []) {
  const urls = mergeUnique(values, 120);
  const counts = new Map();
  urls.forEach((url) => {
    const owner = assetOwnerKey(url);
    if (owner) counts.set(owner, (counts.get(owner) || 0) + 1);
  });
  const allowedOwners = new Set(mainImages.map(assetOwnerKey).filter(Boolean));
  const rankedOwners = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  rankedOwners.filter(([, count]) => count >= 2).forEach(([owner]) => allowedOwners.add(owner));
  const merchantStart = urls.findIndex((url) => allowedOwners.has(assetOwnerKey(url)));
  return urls.filter((url, index) => {
    if (/^https?:\/\/g\.alicdn\.com\//i.test(url) || /\/(?:tfs|tps)\//i.test(url)) return false;
    if (/(?:gongyi|charity|taojinbi|coin|subsidy|promotion|activity|marketing)/i.test(url)) return false;
    if (merchantStart >= 0 && index < merchantStart) return false;
    return true;
  });
}

async function waitForComplete(tabId, timeoutMs = 25000) {
  const current = await chrome.tabs.get(tabId);
  if (current.status === 'complete') return current;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error('商品页面加载超时。'));
    }, timeoutMs);

    function onUpdated(updatedTabId, changeInfo, tab) {
      if (updatedTabId !== tabId || changeInfo.status !== 'complete') return;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve(tab);
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

function qaProductId(value) {
  try {
    if (!isProductUrl(value)) return '';
    const id = new URL(value).searchParams.get('id') || '';
    return /^\d+$/.test(id) ? id : '';
  } catch { return ''; }
}

// Readiness probe only: no clicks, scrolling, activation or network requests.
// Called in the isolated page context; never reads another extension's state.
function probeQuestionReadiness() {
  const shown = node => !node.closest('[hidden],[aria-hidden="true"]')
    && getComputedStyle(node).display !== 'none' && getComputedStyle(node).visibility !== 'hidden'
    && node.getClientRects().length > 0;
  const sections = [...document.querySelectorAll('[class*="askAnswerWrap--" i],[class*="AskAnswersWrap--"]')].filter(shown);
  const rows = new Set(sections.flatMap(section => [...section.querySelectorAll('[class*="questionTitle--"],[class*="question--"]')].filter(shown)));
  const blocked = [...document.querySelectorAll('[role="dialog"],iframe')].filter(shown).some(node =>
    /安全验证|滑动验证|拖动滑块|访问受限|访问被拒绝|请求过于频繁|请先登录|登录后查看/.test(node.innerText || node.textContent || '')
    || /login|captcha|punish/i.test(node.getAttribute('src') || ''));
  return { itemId: new URL(location.href).searchParams.get('id') || '', questionNodes: rows.size, blocked };
}

function mergeQuestionAttempts(previous, next) {
  if (!previous || !previous.items.length) return next;
  if (!next.items.length) return next.status === 'blocked'
    ? { ...previous, status: 'blocked', message: next.message, diagnostics: { ...next.diagnostics } }
    : previous; // An unloaded page cannot erase real rows.
  const map = new Map();
  for (const item of [...previous.items, ...next.items]) {
    const key = String(item.question || '').replace(/\s+/g, ' ').trim();
    if (!key || !map.has(key) && map.size >= 200) continue;
    const prior = map.get(key);
    const totals = [prior?.answerTotal, item.answerTotal].filter(Number.isFinite);
    map.set(key, { ...item, question: key,
      answers: [...new Set([...(prior?.answers || []), ...(item.answers || [])])].slice(0, 30),
      answerTotal: totals.length ? Math.max(...totals) : null });
  }
  const totals = [previous, next].filter(x => x.totalExact && Number.isFinite(x.total)).map(x => x.total);
  const conflict = previous.diagnostics?.totalConflict || next.diagnostics?.totalConflict || new Set(totals).size > 1;
  const totalSource = [previous, next].filter(x => Number.isFinite(x.total)).sort((a, b) => b.total - a.total)[0];
  const total = totalSource?.total ?? null;
  const items = [...map.values()];
  const complete = !conflict && next.status !== 'blocked' && totalSource?.totalExact && items.length === total;
  return { ...next, items, total, totalExact: !!totalSource?.totalExact, totalLabel: totalSource?.totalLabel || '',
    status: next.status === 'blocked' ? 'blocked' : complete ? 'complete' : 'partial',
    message: next.status === 'blocked' ? next.message : conflict ? '同一商品页的问答总数不一致，保留实读内容并标记部分采集。'
      : complete ? '已合并同一商品页实际加载的问答，问题数量已核对。' : '已合并同一商品页实读问答，未读取内容不会补写。',
    diagnostics: { ...next.diagnostics, totalConflict: !!conflict } };
}

// V1.0.5 uses real page-native requests. The prior DOM routine below is retained
// only for source history and is deliberately not used as an automatic fallback.
async function collectQuestionsInBackground(tab, itemId) {
  return TAOAQA.collectQuestionsInBackground(tab, itemId);
}

async function legacyDomQuestionCollection(tab, itemId) {
  const attempts = [];
  let error = '';
  let result = null;
  let usedExistingPage = false;
  // A capture of a different/navigated product may never borrow another ID.
  const id = qaProductId(tab.url || '');
  const matchedId = id && (!itemId || String(itemId) === id);
  let candidates = [tab];
  if (matchedId) {
    const query = { url: ['https://*.taobao.com/*', 'https://*.tmall.com/*'] };
    if (Number.isInteger(tab.windowId)) query.windowId = tab.windowId;
    const siblings = await chrome.tabs.query(query).catch(() => []);
    candidates.push(...siblings.filter(other => other.id !== tab.id && !other.discarded
      && qaProductId(other.url || '') === id).slice(0, 5));
  }
  const probes = await Promise.all(candidates.map(async candidate => {
    try {
      const values = await chrome.scripting.executeScript({ target: { tabId: candidate.id, frameIds: [0] }, func: probeQuestionReadiness });
      const probe = values[0]?.result;
      return { tab: candidate, blocked: !!probe?.blocked,
        ready: matchedId && probe?.itemId === id ? Math.max(0, Number(probe.questionNodes) || 0) : 0 };
    } catch { return { tab: candidate, ready: 0 }; }
  }));
  // Prefer a same-product page that already has rows. Do not activate tabs,
  // refresh user pages, read unrelated products, or repeatedly create pages.
  const ready = probes.filter(x => x.ready > 0 && !x.blocked).sort((a, b) => b.ready - a.ready);
  const ordered = (probes[0].blocked ? [probes[0]] : [...ready, probes[0]])
    .filter((x, i, all) => all.findIndex(y => y.tab.id === x.tab.id) === i).slice(0, 2);
  for (const candidate of ordered) {
    try {
      const live = await chrome.tabs.get(candidate.tab.id);
      if (id && qaProductId(live.url || '') !== id) continue;
      const values = await chrome.scripting.executeScript({ target: { tabId: live.id, frameIds: [0] }, files: ['questions.js'] });
      const qa = values.find(x => x.frameId === 0)?.result || values[0]?.result;
      if (!qa || !Array.isArray(qa.items)) throw new Error('问答脚本未返回有效结果');
      const after = await chrome.tabs.get(live.id);
      if (id && qaProductId(after.url || '') !== id) continue;
      attempts.push({ tabId: live.id, source: live.id === tab.id ? 'capture-page' : 'existing-product-page',
        status: qa.status, readCount: qa.items.length, total: qa.total, ...qa.diagnostics });
      usedExistingPage ||= live.id !== tab.id && qa.items.length > 0;
      result = mergeQuestionAttempts(result, qa);
      if (['complete', 'empty', 'blocked'].includes(qa.status)) break;
    } catch (cause) { error = String(cause?.message || '问答脚本执行失败').slice(0, 160); }
  }
  result ||= { items: [], total: null, totalExact: false, totalLabel: '', status: 'unavailable',
    capturedAt: new Date().toISOString(), message: '问答采集未完成，其他商品内容不受影响。' };
  if (usedExistingPage) result.message = `已从打开的同一商品页补采；${result.message || ''}`;
  result.diagnostics = { ...result.diagnostics, backgroundOnly: true, usedExistingPage,
    candidatePages: probes.map(x => ({ tabId: x.tab.id, questionNodes: x.ready })), attempts };
  return { qa: result, error: result.items.length ? '' : error };
}

async function collectFromTab(tabId) {
  await reviewRecovery;
  const tab = await chrome.tabs.get(tabId);
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId }).catch(() => [{ frameId: 0, url: tab.url || '' }]);
    // Read the page-world model AFTER the collector has warmed lazy content.
    // Previously an early 25-placeholder snapshot beat 25 real late DOM URLs.
    const results = await Promise.all(frames.map(async (frame) => {
        try {
          // Restore a detached collector in tabs opened before an update.
          // The collector's guard keeps injection idempotent in connected tabs.
          await chrome.scripting.executeScript({
            target: { tabId, frameIds: [frame.frameId] },
            files: ['collector.js'],
          });
          const response = await chrome.tabs.sendMessage(tabId, { type: 'TAOA_CAPTURE_NOW' }, { frameId: frame.frameId });
          return response?.ok && response.capture ? { frameId: frame.frameId, capture: response.capture } : null;
        } catch { return null; }
      }));
    const pageWorldSkuResult = await (async () => {
        const items = await chrome.scripting.executeScript({
          target: { tabId, frameIds: [0] },
          world: 'MAIN',
          func: collectSkuImagesFromPageWorld,
        });
        const diagnosticsItems = await chrome.scripting.executeScript({
          target: { tabId, frameIds: [0] },
          world: 'MAIN',
          func: () => window.__TAOA_SKU_DIAGNOSTICS__ || {},
        });
        return {
          images: items.flatMap((item) => Array.isArray(item.result) ? item.result : []),
          diagnostics: diagnosticsItems[0]?.result || {},
        };
      })().catch(() => ({ images: [], diagnostics: {} }));
    const pageWorldSkuImages = pageWorldSkuResult.images;
    const captures = results.filter(Boolean);
    if (!captures.length) throw new Error('页面内容未准备好。');
    const top = captures.find((item) => item.frameId === 0)?.capture || captures[0].capture;
    const domSkuImages = captures.flatMap((item) => item.capture.skuImages || []);
    const frameDetailImages = captures.flatMap((item) => {
      if (item.frameId === 0) return item.capture.detailImages || [];
      return item.capture.isDetailFrame === true ? item.capture.detailImages || [] : [];
    });
    const detailImages = merchantDetailUrls(frameDetailImages, top.mainImages || [])
      .filter((url) => !(top.mainImages || []).includes(url));
    const candidateSkuImages = selectBestSkuImages(pageWorldSkuImages, domSkuImages);
    const validation = await validateSkuImages(candidateSkuImages, domSkuImages);
    const skuImages = validation.images;
    await chrome.storage.local.set({
      taoaLastSkuDiagnostics: {
        extensionVersion: chrome.runtime.getManifest().version,
        itemId: top.itemId || '',
        pageWorldCount: pageWorldSkuImages.length,
        domCount: domSkuImages.length,
        finalCount: skuImages.length,
        candidateCount: candidateSkuImages.length,
        verifiedCount: skuImages.length,
        rejectedImages: validation.rejected,
        verifiedDimensions: validation.dimensions,
        ...pageWorldSkuResult.diagnostics,
        capturedAt: new Date().toISOString(),
      },
    }).catch(() => undefined);
    // Q&A is independent: a missing/blocked section must never discard images.
    const { qa, reviewData, error: qaError } = await reviewJobs.initial(tab, top.itemId).catch(error => ({
      qa: { items: [], total: null, totalExact: false, totalLabel: '', status: 'unavailable',
        capturedAt: new Date().toISOString(), message: '问答采集未完成，其他商品内容不受影响。' },
      reviewData: TAOAREVIEWS.unavailableReviews(top.itemId, 'transport_failed'),
      error: '问答及评价联合采集执行失败',
    }));
    const qaDiagnostics = {
      ...qa.diagnostics,
      extensionVersion: chrome.runtime.getManifest().version,
      itemId: top.itemId || '',
      tabId,
      tabActive: tab.active === true,
      status: qa.status,
      total: qa.total,
      readCount: qa.items.length,
      capturedAt: qa.capturedAt,
      executionError: qaError,
    };
    qa.diagnostics = qaDiagnostics;
    // The current workbench already renders qa.message. Surface the executing
    // version here without changing the workbench layout or other sections.
    qa.message = `V${qaDiagnostics.extensionVersion} · ${qaError ? '问答脚本执行失败；' : ''}${qa.message || ''}`;
    // Delivery acknowledgements clear taoaLastCapture. Keep the small Q&A-only
    // diagnostic record locally so a subsequent failure can be investigated.
    await chrome.storage.local.set({ taoaLastQaDiagnostics: qaDiagnostics }).catch(() => undefined);
    // Both readers have completed or stopped; one shared queue controls their
    // request spacing and preserves both partial results after a challenge.
    await chrome.storage.local.set({ taoaLastReviewDiagnostics: {
      ...reviewData.diagnostics, extensionVersion: chrome.runtime.getManifest().version,
      itemId: top.itemId, status: reviewData.status, readCount: reviewData.items.length,
      capturedAt: reviewData.capturedAt, scopes: reviewData.scopes,
    } }).catch(() => undefined);
    return {
      ...top,
      qa,
      reviewData,
      sourceUrl: tab.url || top.sourceUrl,
      finalUrl: tab.url || top.finalUrl,
      sales: top.sales || captures.find((item) => item.capture.sales)?.capture.sales || '',
      reviewCount: top.reviewCount || captures.find((item) => item.capture.reviewCount)?.capture.reviewCount || '',
      shopRating: top.shopRating || captures.find((item) => item.capture.shopRating)?.capture.shopRating || '',
      positiveRate: top.positiveRate || captures.find((item) => item.capture.positiveRate)?.capture.positiveRate || '',
      serviceScore: top.serviceScore || captures.find((item) => item.capture.serviceScore)?.capture.serviceScore || '',
      mainImages: mergeUnique(top.mainImages || [], 12),
      // SKU controls may live in a separate same-origin frame. Keep all DOM
      // frame results so the main frame's single placeholder cannot hide the
      // complete option set from another frame.
      skuImages,
      detailImages,
      skuOptions: [...new Set(captures.flatMap((item) => item.capture.skuOptions || []))].slice(0, 100),
      attributes: [...new Set(captures.flatMap((item) => item.capture.attributes || []))].slice(0, 100),
    };
  } catch (error) {
    const finalUrl = tab.url || '';
    const blocked = /alicdn\.com\/punish|访问被拒绝|deny/i.test(`${finalUrl} ${tab.title || ''}`);
    return {
      schemaVersion: 3,
      status: blocked ? 'blocked' : 'failed',
      sourceUrl: finalUrl,
      finalUrl,
      title: tab.title || '',
      shop: '',
      price: '',
      sales: '',
      reviewCount: '',
      shopRating: '',
      positiveRate: '',
      serviceScore: '',
      itemId: '',
      skuId: '',
      mainImages: [],
      skuImages: [],
      detailImages: [],
      skuOptions: [],
      attributes: [],
      pageText: '',
      capturedAt: new Date().toISOString(),
      message: blocked ? '淘宝/天猫拒绝了本次页面访问。' : String(error?.message || error),
    };
  }
}

async function ensureWorkbenchBridge(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'TAOA_BRIDGE_PING' });
    if (response?.ok) return;
  } catch {}
  await chrome.scripting.executeScript({ target: { tabId }, files: ['bridge.js'] });
}

async function reconnectWorkbenches() {
  const tabs = await chrome.tabs.query({ url: `${WORKBENCH_URL}*` });
  await Promise.all(tabs.filter((tab) => tab.id).map((tab) =>
    ensureWorkbenchBridge(tab.id).catch(() => undefined)));
}

async function deliverCapture(capture) {
  // Retain the result until a live workbench bridge acknowledges delivery.
  // Large lists remain in IndexedDB, not duplicated into storage.local.
  await chrome.storage.local.set({ taoaLastCapture: { ...capture, reviewData: null,
    reviewProgressItemId: capture.reviewData?.itemId || '' } });
  const workbenchTabs = await chrome.tabs.query({ url: `${WORKBENCH_URL}*` });
  if (workbenchTabs.length === 0) {
    await chrome.tabs.create({ url: `${WORKBENCH_URL}?capture=1`, active: true });
    return;
  }

  let delivered = false;
  for (const tab of workbenchTabs) {
    if (!tab.id) continue;
    try {
      await ensureWorkbenchBridge(tab.id);
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: 'TAOA_DELIVER_CAPTURE', capture,
      });
      if (response?.ok) delivered = true;
    } catch {}
  }
  if (delivered) await chrome.storage.local.remove('taoaLastCapture');
}

async function runCapture(tabId) {
  setBadge('…', '#2563eb');
  const capture = await collectFromTab(tabId);
  await deliverCapture(capture);
  setBadge(capture.status === 'success' ? 'OK' : '!', capture.status === 'success' ? '#059669' : '#d97706');
  return capture;
}

const pendingCaptures = new Map();
async function openAndCapture(rawUrl) {
  const productUrl = compactProductUrl(rawUrl);
  if (!productUrl) throw new Error('请输入有效的淘宝或天猫商品链接。');
  const identity = TAOACAPTURETABS.identity(productUrl);
  if (!identity) throw new Error('商品链接缺少有效的商品 ID。');
  if (pendingCaptures.has(identity.id)) return pendingCaptures.get(identity.id);
  const task = (async () => {
    const productTab = await TAOACAPTURETABS.findExisting(chrome, productUrl);
    setBadge('…', '#2563eb');
    if (productTab.status !== 'complete') await waitForComplete(productTab.id);
    const live = await chrome.tabs.get(productTab.id);
    const current = TAOACAPTURETABS.identity(live.pendingUrl || live.url);
    if (current?.id !== identity.id || (identity.sku && current.sku !== identity.sku)) {
      throw new Error('商品页已切换，请保持对应商品页后重试。');
    }
    const capture = await runCapture(productTab.id);
    if (capture.status === 'blocked') {
      // Bring the existing platform page forward for the user; never solve its challenge.
      await chrome.tabs.update(productTab.id, { active: true }).catch(() => undefined);
      if (Number.isInteger(live.windowId)) await chrome.windows.update(live.windowId, { focused: true }).catch(() => undefined);
    }
    return capture;
  })();
  pendingCaptures.set(identity.id, task);
  try { return await task; } finally { pendingCaptures.delete(identity.id); }
}

chrome.action.onClicked.addListener(async (tab) => {
  try {
    if (!tab.id || !isProductUrl(tab.url || '')) {
      await chrome.tabs.create({ url: WORKBENCH_URL, active: true });
      return;
    }
    await runCapture(tab.id);
  } catch (error) {
    setBadge('!', '#dc2626');
    await deliverCapture({
      schemaVersion: 3,
      status: 'failed',
      sourceUrl: tab.url || '',
      finalUrl: tab.url || '',
      title: tab.title || '',
      shop: '',
      price: '',
      sales: '',
      reviewCount: '',
      shopRating: '',
      positiveRate: '',
      serviceScore: '',
      itemId: '',
      skuId: '',
      mainImages: [],
      skuImages: [],
      detailImages: [],
      skuOptions: [],
      attributes: [],
      pageText: '',
      capturedAt: new Date().toISOString(),
      message: String(error?.message || error),
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (['TAOA_REVIEW_CONTROL', 'TAOA_REVIEW_STATUS'].includes(message?.type)) {
    if (!sender.tab?.url?.startsWith(WORKBENCH_URL)) return false;
    const task = reviewRecovery.then(() => message.type === 'TAOA_REVIEW_STATUS' ? reviewJobs.get(String(message.itemId || ''))
      : reviewJobs.control(String(message.itemId || ''), String(message.jobId || ''), message.action));
    task.then(reviewData => sendResponse({ ok: true, reviewData }))
      .catch(() => sendResponse({ ok: false, error: '无法继续该任务。请确认商品页仍打开，或重新采集同一商品以接续已保存进度。' }));
    return true;
  }
  if (message?.type === 'TAOA_START_CAPTURE') {
    openAndCapture(message.url)
      .then((capture) => sendResponse({ ok: true, capture }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }
  if (message?.type === 'TAOA_DOWNLOAD_IMAGES') {
    downloadImages(message.urls, message.group, message.itemId)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }
  return false;
});

// Existing content scripts are not automatically renewed on extension updates.
chrome.runtime.onInstalled.addListener(() => reconnectWorkbenches().catch(() => undefined));
chrome.runtime.onStartup.addListener(() => {
  reconnectWorkbenches().catch(() => undefined);
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name.startsWith(reviewJobs.prefix)) reviewRecovery.then(() => reviewJobs.tick(alarm.name.slice(reviewJobs.prefix.length))).catch(() => undefined);
});
reconnectWorkbenches().catch(() => undefined);
