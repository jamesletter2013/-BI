(() => {
  if (globalThis.__TAOA_COLLECTOR_READY__) return;
  globalThis.__TAOA_COLLECTOR_READY__ = true;

  const clean = (value, max = 500) =>
    String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);

  const unique = (values, max = 100) =>
    [...new Set(values.map((value) => clean(value)).filter(Boolean))].slice(0, max);

  const uniqueUrls = (values, max = 100) =>
    [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))].slice(0, max);

  function absoluteUrl(value) {
    let source = clean(value, 6000)
      .replace(/\\u0026/gi, '&')
      .replace(/\\u003d/gi, '=')
      .replace(/\\u002f/gi, '/')
      .replace(/\\x2f/gi, '/')
      .replace(/\\x3a/gi, ':')
      .replace(/\\\//g, '/')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/^['"]+|['"]+$/g, '');
    if (/^(?:https?%3a)?%2f%2f/i.test(source)) {
      try { source = decodeURIComponent(source); } catch {}
    }
    if (!source || source.startsWith('data:') || source.startsWith('blob:')) return '';
    try {
      const url = new URL(source.startsWith('//') ? `https:${source}` : source, location.href);
      if (url.protocol === 'http:' && /(?:alicdn|taobaocdn|tbcdn)\./i.test(url.hostname)) {
        url.protocol = 'https:';
      }
      return url.href;
    } catch {
      return '';
    }
  }

  function urlsFromNode(node) {
    const values = [];
    const attributes = [
      'src', 'data-src', 'data-ks-lazyload', 'data-lazyload-src',
      'data-original', 'data-lazy', 'data-img', 'data-image',
      'data-actualsrc', 'data-url', 'data-oss-src',
    ];
    if (node instanceof HTMLImageElement && node.currentSrc) values.push(node.currentSrc);
    for (const name of attributes) values.push(node.getAttribute?.(name) || '');
    const srcset = node.getAttribute?.('srcset') || node.getAttribute?.('data-srcset') || '';
    srcset.split(',').forEach((part) => values.push(part.trim().split(/\s+/)[0] || ''));
    const style = `${node.getAttribute?.('style') || ''} ${getComputedStyle(node).backgroundImage || ''}`;
    for (const match of style.matchAll(/url\(["']?([^"')]+)["']?\)/gi)) values.push(match[1]);
    return uniqueUrls(values.map(absoluteUrl).filter((url) => url && !/\.(?:svg|gif)(?:\?|$)|logo|avatar|icon|sprite|loading|blank|placeholder|no[-_]?image|transparent|spacer|(?:^|[\/_-])1x1(?:[\/_\-?.]|$)|empty/i.test(url)), 20);
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

  function isPlatformAsset(value) {
    try {
      const url = new URL(value);
      return /^g\.alicdn\.com$/i.test(url.hostname)
        || /\/(?:tfs|tps)\//i.test(url.pathname)
        || /(?:gongyi|charity|taojinbi|coin|subsidy|promotion|activity|marketing)/i.test(url.href);
    } catch {
      return true;
    }
  }

  function merchantDetailUrls(values, ownerHints = []) {
    const urls = unique(values, 120);
    const counts = new Map();
    urls.forEach((url) => {
      const owner = assetOwnerKey(url);
      if (owner) counts.set(owner, (counts.get(owner) || 0) + 1);
    });
    const hintedOwners = new Set(ownerHints.map(assetOwnerKey).filter(Boolean));
    const rankedOwners = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    rankedOwners.filter(([, count]) => count >= 2).forEach(([owner]) => hintedOwners.add(owner));
    const merchantStart = urls.findIndex((url) => hintedOwners.has(assetOwnerKey(url)));
    return urls.filter((url, index) => {
      if (isPlatformAsset(url)) return false;
      if (merchantStart >= 0 && index < merchantStart) return false;
      return true;
    });
  }

  function deepRoots() {
    const roots = [document];
    for (let index = 0; index < roots.length; index += 1) {
      roots[index].querySelectorAll?.('*').forEach((node) => {
        if (node.shadowRoot && !roots.includes(node.shadowRoot)) roots.push(node.shadowRoot);
      });
    }
    return roots;
  }

  function queryDeep(selector) {
    const nodes = [];
    deepRoots().forEach((root) => root.querySelectorAll?.(selector).forEach((node) => nodes.push(node)));
    return [...new Set(nodes)];
  }

  const GENERIC_DETAIL_NOISE = /价格说明|被比较价格|标价[\/／]销售价|优惠券|领券|满减|平台补贴|运费险|退换货|猜你喜欢|看了又看|推荐商品|商品评价|用户评价|问大家|客服|物流信息|发票说明|售后服务|隐私政策|服务协议/i;

  function nodeHasGenericNoise(node) {
    let current = node;
    for (let depth = 0; current && depth < 2; depth += 1, current = current.parentElement) {
      const identity = [
        current.getAttribute?.('alt'),
        current.getAttribute?.('title'),
        current.getAttribute?.('aria-label'),
        current.getAttribute?.('id'),
        current.getAttribute?.('class'),
      ].join(' ');
      const nearbyText = clean(current.textContent, 260);
      if (GENERIC_DETAIL_NOISE.test(`${identity} ${nearbyText}`)) return true;
    }
    return false;
  }

  function detailRootNodes() {
    const selectors = [
      '#description', '#J_DivItemDesc', '#J_ItemDesc', '[id*="itemDesc" i]',
      '[class*="descV8" i]', '[class*="DescContent" i]', '[class*="desc-content" i]',
      '[class*="DetailContent" i]', '[class*="detail-content" i]',
    ];
    return [...new Set(selectors.flatMap((selector) => queryDeep(selector)))].filter((root) => {
      const identity = [root.getAttribute?.('id'), root.getAttribute?.('class'), root.getAttribute?.('data-spm')].join(' ');
      return !GENERIC_DETAIL_NOISE.test(identity);
    });
  }

  function hasDetailFrameHint() {
    return /(?:desc|detail|itemdesc|description)/i.test(location.href) || /^desc\.alicdn\.com$/i.test(location.hostname);
  }

  function merchantDetailFrame() {
    if (window.top === window) return false;
    const images = queryDeep('img').filter((node) => {
      if (!(node instanceof HTMLImageElement) || nodeHasGenericNoise(node)) return false;
      const rect = node.getBoundingClientRect();
      const width = node.naturalWidth || rect.width;
      const height = node.naturalHeight || rect.height;
      return width >= 240 && height >= 160;
    });
    if (hasDetailFrameHint() && images.length >= 1) return true;
    if (images.length < 2) return false;
    const pageHeight = Math.max(document.body?.scrollHeight || 0, document.documentElement.scrollHeight || 0);
    if (pageHeight < Math.max(1000, window.innerHeight * 1.2)) return false;
    const widths = images.map((node) => node.naturalWidth || node.getBoundingClientRect().width);
    const reference = widths.sort((a, b) => a - b)[Math.floor(widths.length / 2)];
    const aligned = widths.filter((width) => Math.abs(width - reference) <= Math.max(30, reference * 0.08)).length;
    const lefts = images.map((node) => node.getBoundingClientRect().left);
    const leftReference = lefts.sort((a, b) => a - b)[Math.floor(lefts.length / 2)];
    const leftAligned = lefts.filter((left) => Math.abs(left - leftReference) <= 32).length;
    return aligned >= Math.max(2, Math.ceil(images.length * 0.6))
      && leftAligned >= Math.max(2, Math.ceil(images.length * 0.6));
  }

  function imagesFrom(selectors, max = 80) {
    const output = [];
    for (const selector of selectors) {
      queryDeep(selector).forEach((node) => {
        urlsFromNode(node).forEach((url) => output.push(url));
      });
    }
    return unique(output, max);
  }

  function skuChoiceNodes() {
    const selectors = [
      '#J_isku .J_TSaleProp li', '#J_isku .J_TSaleProp a',
      '#J_isku [data-value]', '#J_isku [data-value-id]',
      '#J_DetailMeta .tb-sku li', '#J_DetailMeta .tb-sku a',
      '#J_DetailMeta .tb-prop li', '#J_DetailMeta .tb-prop a',
      '.J_TSaleProp li', '.J_TSaleProp a', '.tb-prop li', '.tb-prop a',
      '.tm-sale-prop li', '.tm-sale-prop a',
      '[class*="SkuContent" i] [role="radio"]', '[class*="SkuContent" i] button',
      '[class*="SkuItem" i]', '[class*="sku-item" i]',
      '[class*="SkuValue" i]', '[class*="sku-value" i]',
      '[data-testid*="sku" i] [role="radio"]', '[data-testid*="sku" i] button',
      '[data-testid*="sku" i] [data-value]',
      '[data-property*="颜色" i] li', '[data-property*="颜色" i] [role="radio"]',
      '[data-property*="款式" i] li', '[data-property*="款式" i] [role="radio"]',
      '[data-property*="规格" i] li', '[data-property*="规格" i] [role="radio"]',
      '[role="radiogroup"] [role="radio"]', '[role="radiogroup"] button',
      '[class*="sku" i] [role="radio"]', '[class*="sku" i] button', '[class*="sku" i] [data-value]',
    ];
    const candidates = [...new Set(selectors.flatMap((selector) => queryDeep(selector)))].filter((node) => {
      const text = clean(node.textContent, 100);
      const rect = node.getBoundingClientRect();
      if (node.matches?.('[disabled], [aria-disabled="true"]')) return false;
      if (rect.width < 10 || rect.height < 10 || rect.width > 460 || rect.height > 160) return false;
      return !/(?:加入购物车|立即购买|领券|客服|收藏|数量|配送|地址|查看全部|展开)/i.test(text);
    });
    // Old Taobao markup matches both an option <li> and its nested <a>.
    // Keep the deepest matching option so one SKU is not counted twice.
    const leaves = candidates.filter((node) => !candidates.some((other) => (
      other !== node && node.contains?.(other)
    )));
    return (leaves.length ? leaves : candidates).slice(0, 60);
  }

  function ownText(node, max = 80) {
    return clean([...node.childNodes]
      .filter((child) => child.nodeType === Node.TEXT_NODE)
      .map((child) => child.textContent || '')
      .join(' '), max);
  }

  function skuUrlsFromNode(node) {
    const values = [...urlsFromNode(node)];
    const attributes = [
      'data-pic', 'data-pic-url', 'data-thumb', 'data-thumb-url',
      'data-img-url', 'data-image-url', 'data-sku-image', 'data-sku-pic',
    ];
    attributes.forEach((name) => values.push(absoluteUrl(node.getAttribute?.(name) || '')));
    for (const pseudo of ['::before', '::after']) {
      let style = '';
      try { style = getComputedStyle(node, pseudo).backgroundImage || ''; } catch {}
      for (const match of style.matchAll(/url\(["']?([^"')]+)["']?\)/gi)) {
        values.push(absoluteUrl(match[1]));
      }
    }
    // Real 2x2 lazy placeholders have ordinary alicdn PNG URLs and no word
    // "placeholder". Filter before assigning an image to an option slot.
    return uniqueUrls(values.filter((value) => {
      if (!value) return false;
      const dimensions = value.match(/-tps-(\d+)-(\d+)\./i);
      return !dimensions || (Number(dimensions[1]) >= 16 && Number(dimensions[2]) >= 16);
    }), 20);
  }

  function selectSkuImagesForVisibleOptions(boundedUrls, optionSlots) {
    const bounded = [...new Set(boundedUrls)].slice(0, 80);
    const distinctSlots = new Set(optionSlots);
    // A large option grid resolving to one identical bitmap is Taobao's lazy
    // placeholder, not dozens of SKU photos. Never multiply that asset.
    if (optionSlots.length >= 8 && distinctSlots.size <= 1) return [];
    const slotted = [];
    optionSlots.slice(0, 80).forEach((url, index) => {
      const prior = optionSlots.slice(0, index).filter((item) => item === url).length;
      if (!prior) slotted.push(url);
      else slotted.push(`${url}#taoa-sku-option-${index + 1}`);
    });
    return slotted.length >= bounded.length && slotted.length ? slotted : bounded;
  }

  function skuImageNodesFromLabeledGroups() {
    const skuLabelPattern = /^(?:颜色分类|颜色|款式|规格|型号|套餐|外观|图案)\s*[:：]?$/;
    const stopLabelPattern = /^(?:尺码|尺寸|数量|购买数量|配送|服务|运费|发货|库存)\s*[:：]?$/;
    const imageSelector = [
      'img', 'source', '[data-src]', '[data-ks-lazyload]', '[data-original]',
      '[data-image]', '[data-pic]', '[data-thumb]', '[data-img-url]',
      '[data-image-url]', '[data-sku-image]', '[data-sku-pic]',
      '[style*="background-image"]',
    ].join(',');
    const output = [];

    queryDeep('*').filter((node) => {
      const direct = ownText(node);
      const nested = clean(node.textContent, 80);
      return skuLabelPattern.test(direct || nested);
    }).forEach((label) => {
      let group = label.parentElement;
      for (let depth = 0; group && depth < 5; depth += 1, group = group.parentElement) {
        const descendants = [...group.querySelectorAll('*')];
        const stop = descendants.find((node) => {
          if (!(label.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)) return false;
          const direct = ownText(node);
          const nested = clean(node.textContent, 80);
          return stopLabelPattern.test(direct || nested);
        });
        if (!stop) continue;
        const candidates = descendants.filter((node) => {
          if (!(label.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)) return false;
          if (stop && !(node.compareDocumentPosition(stop) & Node.DOCUMENT_POSITION_FOLLOWING)) return false;
          if (!node.matches?.(imageSelector) && !skuUrlsFromNode(node).length) return false;
          const rect = node.getBoundingClientRect?.();
          // Some Taobao option cards put the thumbnail on a CSS background
          // of the whole card (often ~200px wide), rather than on a small
          // <img>. Keep those image-backed cards while still rejecting large
          // unrelated page artwork.
          const cssBacked = skuUrlsFromNode(node).length > 0
            && !(node instanceof HTMLImageElement || node.matches?.('source'));
          const maxWidth = cssBacked ? 460 : 180;
          const maxHeight = cssBacked ? 160 : 180;
          return !rect || rect.width === 0 || rect.height === 0
            || (rect.width >= 8 && rect.height >= 8 && rect.width <= maxWidth && rect.height <= maxHeight);
        });
        const urls = uniqueUrls(candidates.flatMap(skuUrlsFromNode), 80);
        if (urls.length >= 1) {
          output.push(...candidates);
          break;
        }
      }
    });

    return [...new Set(output)];
  }

  function skuImagesFromPage() {
    // Current Taobao SSR layout: explicit option IDs inside the SKU-only root.
    // Avoid guessing parent boundaries and preserve repeated real images.
    const exactImages = queryDeep('#skuOptionsArea [data-vid] img');
    if (exactImages.length) {
      const slots = exactImages.flatMap((image) => {
        const loaded = image.complete && image.naturalWidth >= 16 && image.naturalHeight >= 16;
        const urls = loaded ? skuUrlsFromNode(image) : [
          'data-src', 'data-ks-lazyload', 'data-original', 'data-lazyload-src',
        ].map((name) => absoluteUrl(image.getAttribute?.(name) || '')).filter(Boolean);
        const imageUrl = urls.find((url) => !isPlatformAsset(url) && !/-tps-[0-9]-[0-9]\./i.test(url));
        return imageUrl ? [imageUrl] : [];
      });
      if (slots.length) {
        const seen = new Set();
        return slots.slice(0, 80).map((url, index) => {
          const duplicate = seen.has(url);
          seen.add(url);
          return duplicate ? `${url}#taoa-sku-option-${index + 1}` : url;
        });
      }
    }
    const output = [];
    const imageSelector = [
      'img', 'source', '[data-src]', '[data-ks-lazyload]', '[data-original]',
      '[data-image]', '[data-pic]', '[data-thumb]', '[data-img-url]',
      '[data-image-url]', '[data-sku-image]', '[data-sku-pic]',
      '[style*="background-image"]',
    ].join(',');
    const addNode = (node) => {
      if (node instanceof HTMLImageElement && node.complete
        && (node.naturalWidth < 8 || node.naturalHeight < 8)) return;
      const rect = node.getBoundingClientRect?.();
      if (rect?.width > 0 && rect?.height > 0
        && (rect.width < 8 || rect.height < 8 || rect.width > 180 || rect.height > 180)) return;
      skuUrlsFromNode(node).forEach((url) => output.push(url));
    };

    // Prefer the bounded “颜色/款式/规格” group and known SKU containers.
    // These selectors see every option in a grid, including options that do
    // not expose a role/data-value attribute on the clickable wrapper.
    const labeledNodes = skuImageNodesFromLabeledGroups();
    const labeledUrls = uniqueUrls(labeledNodes.flatMap(skuUrlsFromNode), 80)
      .filter((url) => !isPlatformAsset(url));
    const directSelectors = [
      '#J_isku .J_TSaleProp img', '#J_isku .J_TSaleProp [style*="background-image"]',
      '#J_DetailMeta .tb-sku img', '#J_DetailMeta .tb-sku [style*="background-image"]',
      '.tm-sale-prop img', '.tm-sale-prop [style*="background-image"]',
      '[class*="SkuContent" i] img', '[class*="SkuContent" i] [style*="background-image"]',
      '[class*="SkuItem" i] img', '[class*="SkuItem" i] [style*="background-image"]',
      '[class*="sku-item" i] img', '[class*="sku-item" i] [style*="background-image"]',
      '[data-testid*="sku" i] img', '[data-testid*="sku" i] [style*="background-image"]',
      '[data-property*="颜色" i] img', '[data-property*="款式" i] img',
      '[data-property*="规格" i] img', '[data-prop*="颜色" i] img',
      '[data-prop*="款式" i] img', '[data-prop*="规格" i] img',
    ];
    const directNodes = [...new Set(directSelectors.flatMap((selector) => queryDeep(selector)))];
    const directUrls = uniqueUrls(directNodes.flatMap((node) => {
      const rect = node.getBoundingClientRect?.();
      if (rect && rect.width > 0 && rect.height > 0
        && (rect.width < 8 || rect.height < 8 || rect.width > 180 || rect.height > 180)) return [];
      return skuUrlsFromNode(node);
    }), 80).filter((url) => !isPlatformAsset(url));
    const boundedUrls = uniqueUrls([...labeledUrls, ...directUrls], 80);
    const controls = skuChoiceNodes();
    const controlSlots = [];
    controls.forEach((control) => {
      const descendants = [...control.querySelectorAll?.(imageSelector) || []];
      const loadedImageUrls = descendants.filter((node) => (
        node instanceof HTMLImageElement && node.complete
        && node.naturalWidth >= 8 && node.naturalHeight >= 8
      )).flatMap(skuUrlsFromNode);
      const urls = uniqueUrls([
        ...loadedImageUrls,
        ...skuUrlsFromNode(control),
        ...descendants.flatMap(skuUrlsFromNode),
      ], 20).filter((url) => !isPlatformAsset(url));
      if (urls.length) controlSlots.push(urls[0]);
    });
    // Modern Taobao pages do not always expose role/data-value/class names on
    // their SKU buttons. In that layout, the bounded labeled group still has
    // one real <img> per visible option, even when several options share the
    // same URL. Count those DOM slots instead of collapsing them by URL.
    // Keep the deepest image-like node for each option. Older markup exposes
    // an <img>, while newer markup may put the thumbnail on a wrapper's
    // computed background/pseudo-element; choosing leaves handles both
    // without counting an option wrapper and its child twice.
    const labeledSlotNodes = labeledNodes.filter((node) => !labeledNodes.some((other) => (
      other !== node && node.contains?.(other)
    )));
    const labeledSlots = labeledSlotNodes.flatMap((node) => {
      const loadedUrl = node.complete && node.naturalWidth >= 8 && node.naturalHeight >= 8
        ? absoluteUrl(node.currentSrc || node.src)
        : '';
      const deferredUrls = [
        'data-src', 'data-ks-lazyload', 'data-original', 'data-lazyload-src',
        'data-image', 'data-pic', 'data-thumb', 'data-img-url', 'data-image-url',
        'data-sku-image', 'data-sku-pic',
      ].map((name) => absoluteUrl(node.getAttribute?.(name) || ''));
      // If a lazy-load attribute still points at a placeholder while the
      // browser has already rendered the real thumbnail, use the rendered
      // currentSrc first. Deferred attributes are only the fallback.
      const urls = uniqueUrls([loadedUrl, ...deferredUrls, ...skuUrlsFromNode(node)], 20)
        .filter((url) => !isPlatformAsset(url));
      const rect = node.getBoundingClientRect?.();
      const cssBacked = urls.length > 0
        && !(node instanceof HTMLImageElement || node.matches?.('source'));
      const maxWidth = cssBacked ? 460 : 180;
      const maxHeight = cssBacked ? 160 : 180;
      if (rect?.width > 0 && rect?.height > 0
        && (rect.width < 8 || rect.height < 8 || rect.width > maxWidth || rect.height > maxHeight)) return [];
      return urls.length ? [urls[0]] : [];
    }).slice(0, 80);
    const optionSlots = labeledSlots.length >= controlSlots.length ? labeledSlots : controlSlots;
    // Keep one entry per visible SKU option. Some sellers intentionally use
    // the same thumbnail for multiple sizes; preserve those slots with a
    // harmless fragment so the UI count still matches the source options.
    // A bounded selector can still contain a generic product image from a
    // SKU wrapper. Only return it when it is tied to an actual option slot;
    // otherwise a product without SKU thumbnails must stay empty.
    // A newer Taobao layout can render each thumbnail as a CSS/pseudo-element
    // without exposing a recognizable option button. The labeled group is
    // already bounded between the SKU label and the next property label, so
    // its URLs are safe to use as the final fallback instead of dropping to a
    // single page-world "currently selected" image.
    const boundedOptionSlots = optionSlots.length ? optionSlots : labeledSlots;
    const selectedUrls = boundedOptionSlots.length
      ? selectSkuImagesForVisibleOptions(boundedUrls, boundedOptionSlots)
      : [];
    // Use whichever strict path represents more visible SKU choices. A large
    // grid may only expose two outer controls but many bounded thumbnails;
    // another product may expose four controls that share just two image URLs.
    if (selectedUrls.length) {
      output.push(...selectedUrls);
    } else if (!optionSlots.length && !boundedUrls.length) {
      skuImageNodesFromLabeledGroups().forEach(addNode);
    }

    return uniqueUrls(output, 80).filter((url) => !isPlatformAsset(url)
      && !/(?:pixel|tracking|beacon|spacer|transparent|blank|placeholder|no[-_]?image|empty|(?:^|[\/_-])1x1(?:[\/_\-?.]|$)|[?&](?:w|width|h|height)=1(?:&|$))/i.test(url));
  }

  async function collectSkuImagesBySelection() {
    // In a background tab Taobao often hydrates the SKU grid a little after
    // the main/detail images. Poll briefly and keep the fullest result so a
    // fast first pass containing only the selected option cannot win.
    let best = [];
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const current = skuImagesFromPage();
      if (current.length >= best.length) best = current;
      if (best.length >= 80) break;
      if (attempt < 9) await new Promise((resolve) => setTimeout(resolve, 220));
    }
    return best;
  }

  function detailImagesFromDom(ownerHints = []) {
    const output = [];
    const roots = detailRootNodes();
    roots.forEach((root) => {
      if (!nodeHasGenericNoise(root)) urlsFromNode(root).forEach((url) => output.push(url));
      root.querySelectorAll?.('img,source,[data-src],[data-ks-lazyload],[data-lazyload-src],[data-original],[data-image],[style*="background-image"]').forEach((node) => {
        if (nodeHasGenericNoise(node)) return;
        urlsFromNode(node).forEach((url) => output.push(url));
      });
    });

    if (output.length < 2 && roots.length === 0 && merchantDetailFrame()) {
      queryDeep('img').forEach((node) => {
        if (!(node instanceof HTMLImageElement)) return;
        if (nodeHasGenericNoise(node)) return;
        const rect = node.getBoundingClientRect();
        const top = rect.top + window.scrollY;
        const width = node.naturalWidth || rect.width;
        const height = node.naturalHeight || rect.height;
        if (top >= 0 && width >= 240 && height >= 160) {
          urlsFromNode(node).forEach((url) => output.push(url));
        }
      });
    }

    const markup = [...document.scripts].map((script) => script.textContent || '').join('\n');
    for (const match of markup.matchAll(/(?:https?:)?\\?\/\\?\/[A-Za-z0-9._~!$&'()*+,;=:@%\/-]+\.(?:jpe?g|png|webp)(?:\?[^"'\\\s<]*)?/gi)) {
      const start = Math.max(0, match.index - 180);
      const context = markup.slice(start, match.index + match[0].length + 180);
      if (merchantDetailFrame() && /desc|detail|itemDesc|description|picUrl|imageList/i.test(context) && !GENERIC_DETAIL_NOISE.test(context)) {
        const raw = match[0].replace(/\\\//g, '/').replace(/^\/\//, 'https://');
        const url = absoluteUrl(raw);
        if (url) output.push(url);
      }
    }
    return merchantDetailUrls(output, ownerHints);
  }

  async function warmLazyDetails() {
    const originalY = window.scrollY;
    const originalBehavior = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = 'auto';
    const height = Math.max(document.body?.scrollHeight || 0, document.documentElement.scrollHeight || 0);
    const steps = Math.min(28, Math.max(6, Math.ceil(height / Math.max(window.innerHeight * 0.8, 650))));
    for (let index = 1; index <= steps; index += 1) {
      window.scrollTo(0, Math.min(height, (height * index) / steps));
      await new Promise((resolve) => setTimeout(resolve, 180));
    }
    window.scrollTo(0, originalY);
    document.documentElement.style.scrollBehavior = originalBehavior;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }

  function firstText(selectors, max = 300) {
    for (const selector of selectors) {
      const node = queryDeep(selector)[0];
      const value = node instanceof HTMLMetaElement ? node.content : node?.textContent;
      const text = clean(value, max);
      if (text) return text;
    }
    return '';
  }

  function collectTextItems(selectors, maxItems = 100, maxLength = 120) {
    const values = [];
    for (const selector of selectors) {
      queryDeep(selector).forEach((node) => {
        const text = clean(node.textContent, maxLength);
        if (text && text.length <= maxLength) values.push(text);
      });
    }
    return unique(values, maxItems);
  }

  function structuredProducts() {
    const found = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
      try {
        const parsed = JSON.parse(script.textContent || 'null');
        const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
        while (queue.length) {
          const value = queue.shift();
          if (!value || typeof value !== 'object') continue;
          if (Array.isArray(value)) { queue.push(...value); continue; }
          if (String(value['@type'] || '').toLowerCase() === 'product') found.push(value);
          if (value['@graph']) queue.push(value['@graph']);
        }
      } catch {}
    });
    return found;
  }

  function validTitle(value) {
    const text = clean(value, 300);
    if (text.length < 6 || /用户评价|商品评价|累计评价|客服|店铺优惠|平台补贴|开通88VIP|全网货源/i.test(text)) return '';
    return text.replace(/[-_｜|]\s*(淘宝网|天猫.*)$/i, '').trim();
  }

  function extractPrice(value) {
    const text = clean(value, 160);
    if (!text) return '';
    const marked = [...text.matchAll(/[¥￥]\s*(\d{1,7}(?:\.\d{1,2})?)/g)].map((match) => match[1]);
    const plain = text.match(/^\s*(\d{1,7}(?:\.\d{1,2})?)\s*$/)?.[1];
    const price = marked[0] || plain || '';
    return price ? `¥${price}` : '';
  }

  function extractShop(value) {
    const text = clean(value, 200);
    return text.match(/[\u4e00-\u9fa5A-Za-z0-9·（）()_-]{2,32}(?:旗舰店|专卖店|专营店|企业店|工厂店|官方店)/)?.[0] || '';
  }

  function metricFromPage(rawPageText, patterns, scriptKeys, max = 60) {
    const visibleText = clean(rawPageText, 18000);
    for (const pattern of patterns) {
      const match = visibleText.match(pattern);
      if (match?.[1]) return clean(match[1], max);
    }
    const markup = [...document.scripts].map((script) => script.textContent || '').join('\n');
    for (const key of scriptKeys) {
      const pattern = new RegExp(`["']?${key}["']?\\s*[:=]\\s*(?:["']([^"']{1,60})["']|([0-9][0-9,.]*(?:万|千|[wW])?\\+?%?))`, 'i');
      const match = markup.match(pattern);
      const value = clean(match?.[1] || match?.[2], max);
      if (value && /^[0-9]/.test(value)) return value;
    }
    return '';
  }

  function collectMetrics(rawPageText) {
    const quantity = '([0-9][0-9,.]*(?:万|千|[wW])?\\+?)';
    return {
      sales: metricFromPage(rawPageText, [
        new RegExp(`(?:累计销量|月销量|月销|已售|销量|付款人数|已付款)\\s*[:：+]?\\s*${quantity}`, 'i'),
      ], ['sellCount', 'soldCount', 'monthSellCount', 'soldQuantity', 'payCount']),
      reviewCount: metricFromPage(rawPageText, [
        new RegExp(`(?:累计评价|商品评价|用户评价|评价数量|评价)\\s*[（(]?\\s*[+:：]?\\s*${quantity}`, 'i'),
        new RegExp(`${quantity}\\s*条评价`, 'i'),
      ], ['reviewCount', 'commentCount', 'rateTotal', 'totalReviewCount']),
      shopRating: metricFromPage(rawPageText, [
        /(?:店铺评分|综合体验|宝贝描述|描述相符)\s*[:：]?\s*([0-5](?:\.[0-9]{1,2})?)/i,
      ], ['shopScore', 'dsrScore', 'descriptionMatchScore']),
      positiveRate: metricFromPage(rawPageText, [
        /(?:好评率|好评)\s*[:：]?\s*([0-9]+(?:\.[0-9]+)?%)/i,
      ], ['positiveRate', 'goodRate', 'goodRatePercentage']),
      serviceScore: metricFromPage(rawPageText, [
        /(?:客服满意度|客服服务|服务体验|卖家服务|服务态度)\s*[:：]?\s*([0-9]+(?:\.[0-9]+)?%|[0-5](?:\.[0-9]{1,2})?)/i,
      ], ['serviceScore', 'serviceRating', 'sellerServiceScore']),
    };
  }

  function attributePairsFromLines(rawPageText) {
    const labels = '品牌|型号|材质|风格|形状|产地|颜色分类|适用场景|工艺|尺寸|容量|是否手工|包装种类|餐具类型|图案|货号|适用人群|适用对象';
    const sameLine = new RegExp(`^(${labels})\\s*(?:[:：|｜]\\s*|\\s+)(.{1,80})$`);
    const labelOnly = new RegExp(`^(${labels})\\s*[:：|｜]?$`);
    const lines = String(rawPageText || '').split(/\n+/).map((line) => clean(line, 120)).filter(Boolean);
    const pairs = [];
    for (let index = 0; index < lines.length; index += 1) {
      const same = lines[index].match(sameLine);
      if (same?.[1] && same?.[2]) {
        pairs.push(`${same[1]}：${same[2]}`);
        continue;
      }
      const label = lines[index].match(labelOnly)?.[1];
      const value = lines[index + 1];
      if (label && value && value.length <= 80 && !labelOnly.test(value)) pairs.push(`${label}：${value}`);
    }
    return unique(pairs, 100);
  }

  function parseIds() {
    const url = new URL(location.href);
    const source = `${document.documentElement.innerHTML.slice(0, 180000)} ${location.href}`;
    const itemId = url.searchParams.get('id') || source.match(/(?:itemId|item_id)["'=:\s]+(\d{6,})/i)?.[1] || '';
    const skuId = url.searchParams.get('skuId') || source.match(/(?:skuId|sku_id)["'=:\s]+(\d{6,})/i)?.[1] || '';
    return { itemId, skuId };
  }

  function collectPage(collectedSkuImages = []) {
    const rawPageText = document.body?.innerText || '';
    const pageText = clean(rawPageText, 18000);
    const blocked = /访问被拒绝|当前访问存在风险|安全验证|滑动验证|请完成验证|punish/i.test(
      `${document.title} ${pageText.slice(0, 2500)} ${location.href}`,
    );

    const product = structuredProducts()[0] || {};
    const titleCandidates = [
      product.name,
      firstText(['meta[property="og:title"]']),
      firstText(['[class*="ItemTitle"]', '[class*="Title--"]', '.tb-detail-hd h1', '[data-testid="item-title"]']),
      document.title,
    ];
    const title = titleCandidates.map(validTitle).find(Boolean) || '';

    const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers;
    const priceCandidates = [
      offer?.price,
      firstText(['meta[property="product:price:amount"]']),
      ...collectTextItems(['[class*="Price--"]', '[class*="priceText"]', '[class*="PriceText"]', '[data-testid*="price"]', '.tm-price'], 20, 80),
      pageText.match(/[¥￥]\s*\d+(?:\.\d{1,2})?/)?.[0],
    ];
    const price = priceCandidates.map(extractPrice).find(Boolean) || '';

    const shopRaw = firstText([
      '[class*="ShopHeader"] [class*="name"]',
      '[class*="ShopInfo"] [class*="name"]',
      '[class*="shopName"]',
      '[class*="shop-name"]',
      'a[href*="shop"]',
    ], 200);
    const shop = extractShop(shopRaw) || extractShop(pageText) || '';

    const primaryImages = imagesFrom([
      '[class*="PicGallery"] img',
      '[class*="Thumbnail"] img',
      '[class*="gallery"] img',
      '[class*="Gallery"] img',
      '#J_UlThumb img',
      '.tb-thumb img',
      'main img',
    ], 40);

    const detailRoots = detailRootNodes();
    const detailImages = detailImagesFromDom(primaryImages);

    const allImages = imagesFrom(['img'], 160);
    const mainImages = (primaryImages.length ? primaryImages : allImages)
      .filter((url) => !detailImages.includes(url))
      .slice(0, 12);

    const skuImages = uniqueUrls([...collectedSkuImages, ...skuImagesFromPage()], 80);

    const skuOptions = collectTextItems([
      '[class*="Sku"] button',
      '[class*="sku"] button',
      '[class*="SkuItem"]',
      '[class*="skuItem"]',
      '[data-testid*="sku"] button',
      '[class*="Sku"] [role="button"]',
      '[class*="sku"] [role="button"]',
      '[class*="Sku"] span',
      '[class*="sku"] span',
    ], 100, 60).filter((text) => text.length >= 1 && text.length <= 40 && !/优惠|评价|客服|收藏|销量|发货|运费/.test(text));

    const attributes = unique([...collectTextItems([
      '[class*="Attribute"] li',
      '[class*="attribute"] li',
      '[class*="Params"] li',
      '[class*="params"] li',
      '[class*="Parameter"] li',
      '[class*="parameter"] li',
      '[class*="Property"] li',
      '[class*="property"] li',
      '[class*="Props"] li',
      '[class*="props"] li',
      '[class*="BasicContent"] li',
      '[class*="ItemParams"] li',
      '[data-testid*="parameter"]',
      '[class*="Attribute"] tr',
      '[class*="params"] tr',
    ], 100, 160).filter((text) => /[:：]/.test(text) && text.length <= 100), ...attributePairsFromLines(rawPageText)], 100);

    const { itemId, skuId } = parseIds();
    const metrics = collectMetrics(rawPageText);
    return {
      schemaVersion: 3,
      status: blocked ? 'blocked' : 'success',
      sourceUrl: location.href,
      finalUrl: location.href,
      title,
      shop,
      price: clean(price, 80),
      ...metrics,
      itemId,
      skuId,
      mainImages,
      skuImages,
      detailImages,
      skuOptions,
      attributes,
      pageText,
      capturedAt: new Date().toISOString(),
      message: blocked ? '页面要求验证或拒绝访问，采集已停止。' : '',
      frameUrl: location.href,
      isTopFrame: window.top === window,
      isDetailFrame: window.top !== window && (detailRoots.length > 0 || merchantDetailFrame()),
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'TAOA_CAPTURE_NOW') return false;
    warmLazyDetails()
      .then(() => collectSkuImagesBySelection())
      .then((skuImages) => sendResponse({ ok: true, capture: collectPage(skuImages) }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  });
})();
