import { isCategoryNavigationText } from './category-text.mjs';

// Read bounded DOM field pairs, never split flattened body text by a category dictionary.
const tidy = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const text = node => tidy(node?.getAttribute?.('title') || node?.textContent);
const signature = node => `${node?.className || ''} ${node?.getAttribute?.('data-testid') || ''}`;
const labelHint = node => /(?:label|name|key|title)(?:\b|_|--)/i.test(signature(node));
const valueHint = node => /(?:value|content|desc)(?:\b|_|--)/i.test(signature(node));
const children = node => [...(node?.children || [])].filter(child => text(child) && !/^(SCRIPT|STYLE|BUTTON|SVG)$/.test(child.tagName));
const heading = /^(?:参数信息|商品参数|产品参数|规格参数|基本参数|基本信息|详细参数)$/;
const otherSection = /^(?:图文详情|商品详情|用户评价|商品评价|问大家|猜你喜欢|推荐商品|价格说明)$/;
const parameterSelector = '[class*="attribute" i],[class*="parameter" i],[class*="params" i],[class*="basicContent" i],[data-testid*="parameter" i],#J_AttrUL,#attributes';

// Use the seller's on-page title before metadata/browser tab titles. Do not
// rewrite product wording or collapse meaningful internal spaces.
export function normalizeProductTitle(value, metadata = false) {
  if (typeof value !== 'string') return '';
  let title = value.replace(/[\r\n]+/g, '').replace(/\t/g, ' ').trim();
  if (!title || title.length > 300) return '';
  if (metadata) {
    // Only known, delimited terminal site branding. Never remove occurrences
    // inside a product name or apply this rule to the actual visible title.
    const suffix = /\s*[-_—–|｜]\s*(?:(?:www\.)?(?:tmall\.com\s*(?:天猫)?|taobao\.com\s*(?:淘宝网?)?)|天猫(?:\s*(?:tmall\.com))?|淘宝网?)\s*$/i;
    for (let i = 0; i < 3 && suffix.test(title); i++) title = title.replace(suffix, '').trimEnd();
  }
  return /^(?:淘宝网?|天猫|商品详情|商品标题|待采集商品标题|访问被拒绝|安全验证)$/.test(title) ? '' : title;
}

export function collectProductTitle(doc, product = {}) {
  const selectors = [
    '#tbpcDetail_SkuPanelBody [class*="MainTitle--"]',
    '[class*="ItemTitle"] [class*="mainTitle" i]',
    '[class*="MainTitle--"]',
    '[data-testid="item-title"]',
    '.tb-detail-hd h1', '.tb-main-title', '#J_Title h3',
    '[class*="ItemTitle"] h1', '[class*="ItemTitle"] h2',
  ];
  const excluded = node => {
    for (let owner = node; owner && owner !== doc.body; owner = owner.parentElement) {
      if (/(?:recommend|review|comment|related|guess)/i.test(signature(owner))) return true;
    }
    return false;
  };
  const read = node => {
    if (!node.getClientRects().length || excluded(node)) return '';
    const visible = normalizeProductTitle(node.children.length ? node.innerText || node.textContent : node.textContent);
    const full = normalizeProductTitle(node.getAttribute('title'));
    if (full && !/(?:…|\.{3})$/.test(full) && tidy(full) === tidy(visible)) return full;
    if (visible && !/(?:…|\.{3})$/.test(visible)) return visible;
    if (full && !/(?:…|\.{3})$/.test(full)) return full;
    return '';
  };
  for (const selector of selectors) {
    for (const node of doc.querySelectorAll(selector)) {
      const title = read(node); if (title) return title;
    }
  }
  // Some layouts expose just a leaf title or a titled child. Do not flatten
  // the whole ItemTitle section, which may include badges and sales text.
  for (const container of doc.querySelectorAll('[class*="ItemTitle"],[class*="Title--"]')) {
    const candidates = container.children.length ? container.querySelectorAll('[title]') : [container];
    for (const node of candidates) {
      const title = read(node); if (title) return title;
    }
  }
  for (const candidate of [product?.name, doc.querySelector('meta[property="og:title"]')?.content, doc.title]) {
    const title = normalizeProductTitle(candidate, true); if (title) return title;
  }
  return '';
}

function validPair(name, value) {
  return name && name.length <= 60 && value && value.length <= 6000 && name !== value
    && !/[\n:：|｜]/.test(name) && !heading.test(name) && !otherSection.test(name)
    && !/^(?:展开|收起|更多|查看全部|加入购物车|立即购买)$/.test(value);
}

export function collectProductParameters(doc) {
  const result = [], seen = new Set(), consumed = new Set();
  const cardCache = new WeakMap();
  // Parameter highlights use value-above-label cards, often with hashed classes
  // or misleading "title/desc" names. Recognize their layout, not category names.
  const isTextSlot = node => {
    const parts = children(node);
    if (!parts.length) return !/^(IMG|INPUT|SELECT|TEXTAREA)$/.test(node.tagName);
    if (parts.length === 1) return isTextSlot(parts[0]);
    return parts.every(part => /^(SPAN|B|STRONG|EM|I|SMALL)$/.test(part.tagName) && isTextSlot(part));
  };
  const verticalCard = node => {
    if (cardCache.has(node)) return cardCache.get(node);
    cardCache.set(node, null);
    const parts = children(node);
    if (parts.length !== 2 || !parts.every(isTextSlot) || node.querySelector('button,input,select,textarea,a[href]')) return null;
    const [upper, lower] = parts;
    if (/(?:label|key|name)(?:\b|_|--)/i.test(signature(upper)) && /(?:value|content)(?:\b|_|--)/i.test(signature(lower))) return null;
    const value = text(upper), name = text(lower);
    if (!validPair(name, value)) return null;
    const a = upper.getBoundingClientRect(), b = lower.getBoundingClientRect();
    if (!a.width || !a.height || !b.width || !b.height || b.top < a.bottom - 3 || b.top - a.bottom > 48) return null;
    const overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    if (overlap < Math.min(a.width, b.width) * 0.5) return null;
    const styleNode = part => { const nested = children(part); return nested.length === 1 ? styleNode(nested[0]) : part; };
    const topStyle = doc.defaultView.getComputedStyle(styleNode(upper)), bottomStyle = doc.defaultView.getComputedStyle(styleNode(lower));
    const emphasized = Number(topStyle.fontWeight) > Number(bottomStyle.fontWeight)
      || parseFloat(topStyle.fontSize) > parseFloat(bottomStyle.fontSize);
    if (!emphasized) return null;
    const pair = [name, value]; cardCache.set(node, pair); return pair;
  };
  const summaryPair = node => {
    const pair = verticalCard(node);
    if (!pair) return null;
    // Repeated sibling cards are reliable even if every class is opaque. A
    // single card needs an explicit summary/card container inside the section.
    const peers = children(node.parentElement).filter(part => verticalCard(part));
    return peers.length >= 2 || /(?:card|feature|highlight|summary)/i.test(`${signature(node)} ${signature(node.parentElement)}`)
      ? pair : null;
  };
  const add = (name, value, owner) => {
    name = tidy(name).replace(/[:：]$/, '').trim(); value = tidy(value);
    if (!validPair(name, value) || /(?:…|\.\.\.)$/.test(name)) return false;
    const key = `${name}\0${value}`;
    if (!seen.has(key) && result.length < 200) { seen.add(key); result.push({ name, value }); }
    if (owner) consumed.add(owner);
    return true;
  };
  const roots = new Set(doc.querySelectorAll(parameterSelector));
  // The heading locates the section; it is not used as an unbounded text delimiter.
  for (const el of doc.querySelectorAll('h2,h3,h4,div,span')) {
    if (!heading.test(text(el)) || children(el).some(child => heading.test(text(child)))) continue;
    let parent = el.parentElement;
    for (let depth = 0; parent && parent !== doc.body && depth < 4; depth++, parent = parent.parentElement) {
      if (text(parent).length > 60000) break;
      if ([...parent.querySelectorAll('h2,h3,h4')].some(node => otherSection.test(text(node)))) break;
      const hasRows = parent.querySelectorAll('td,dd,li,[class*="value" i],[class*="item" i]').length >= 2;
      const hasCards = !hasRows && [...parent.querySelectorAll('div,li')].some(node => summaryPair(node));
      if (hasRows || hasCards) { roots.add(parent); break; }
    }
  }
  const outerRoots = [...roots].filter(root => ![...roots].some(other => other !== root && other.contains(root)));
  const visit = (node, depth = 0) => {
    if (depth > 18 || /^(SCRIPT|STYLE|BUTTON|SVG|A)$/.test(node.tagName)
      || /(?:recommend|review|comment|navigation|sku)/i.test(signature(node))) return false;
    if (otherSection.test(text(node))) return false;
    const parts = children(node);
    const card = summaryPair(node);
    if (card && add(card[0], card[1], node)) return true;
    // Semantic HTML already supplies exact boundaries, including multiple pairs per row.
    if (node.tagName === 'TR') {
      const cells = parts.filter(el => /^(TD|TH)$/.test(el.tagName));
      if (cells.length >= 2 && cells.length % 2 === 0) {
        for (let i = 0; i < cells.length; i += 2) add(text(cells[i]), text(cells[i + 1]), node);
        return consumed.has(node);
      }
    }
    if (node.tagName === 'DL') {
      for (let i = 0; i < parts.length - 1; i++) if (parts[i].tagName === 'DT' && parts[i + 1].tagName === 'DD') {
        add(text(parts[i]), text(parts[i + 1]), node);
      }
      if (consumed.has(node)) return true;
    }
    if (parts.length === 2) {
      const [a, b] = parts;
      const hinted = labelHint(a) && !labelHint(b) ? [a, b]
        : labelHint(b) && !labelHint(a) ? [b, a]
        : valueHint(a) && !valueHint(b) ? [b, a]
        : valueHint(b) && !valueHint(a) ? [a, b] : null;
      if (hinted && add(text(hinted[0]), text(hinted[1]), node)) return true;
    }
    // A value can itself contain many SKU option spans; these are not new parameter rows.
    if (/value(?:\b|_|--)/i.test(signature(node))) return false;
    let nested = false;
    for (const part of parts) nested = visit(part, depth + 1) || nested;
    if (nested) return true; // Never reinterpret a group of already parsed rows as one giant value.
    if (parts.length === 2) {
      const [a, b] = parts;
      // Ordinary rows: label on the left. Summary cards were handled above.
      const ar = a.getBoundingClientRect?.(), br = b.getBoundingClientRect?.();
      const horizontal = ar?.width > 0 && br?.width > 0 && Math.abs(ar.top - br.top) < 12 && br.left >= ar.right - 4;
      if (horizontal && !/(?:card|feature|highlight)/i.test(signature(node))
        && add(text(a), text(b), node)) return true;
    }
    // Old pages expose explicit "name: value" list items. Colons inside values survive.
    if (node.tagName === 'LI' || (!parts.length && /(?:row|item|property)/i.test(signature(node)))) {
      const match = text(node).match(/^([^:：]{1,60})[:：]\s*(.+)$/);
      if (match && add(match[1], match[2], node)) return true;
    }
    return false;
  };
  outerRoots.forEach(root => visit(root));
  return result;
}

// Listing facts are not inferred from the title, review dates, product launch
// dates, or IDs. This only reads already-present, explicitly labelled content.
export function collectListingInfo(doc, product = {}, parameters = []) {
  const result = { categoryPath: '', categorySource: '', listedAt: '', listedAtSource: '' };
  const categoryLabels = /^(?:上架类目|商品类目|所属类目|类目)$/;
  const dateLabels = /^(?:首次上架时间|上架时间|上架日期|上架)$/;
  const category = value => {
    const v = tidy(value).replace(/\s*[>＞›]\s*/g, ' > ');
    return v && v.length <= 500 && !/^\d+$/.test(v) && !/[{}:：]|https?:/i.test(v) && !isCategoryNavigationText(v)
      && !/^(?:类目|商品类目|上架类目|所属类目|未知|暂无|无|未读取到|查看|全部类目|选择类目)$/.test(v) ? v : '';
  };
  const date = value => {
    const match = tidy(value).match(/^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (!match) return '';
    const [, y, m, d, h, min, sec] = match;
    const actual = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    if (Number(y) < 1990 || actual.getUTCFullYear() !== Number(y) || actual.getUTCMonth() !== Number(m) - 1 || actual.getUTCDate() !== Number(d)
      || (h !== undefined && (Number(h) > 23 || Number(min) > 59 || Number(sec || 0) > 59))) return '';
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}${h === undefined ? '' : ` ${h.padStart(2, '0')}:${min}${sec === undefined ? '' : `:${sec}`}`}`;
  };
  const add = (label, value, source) => {
    if (categoryLabels.test(label)) {
      const safe = category(value);
      // Prefer the full path only when its leaf agrees with the displayed leaf.
      const leaf = path => path.split(' > ').at(-1);
      if (safe && (!result.categoryPath || (leaf(safe) === leaf(result.categoryPath) && safe.length > result.categoryPath.length))) {
        result.categoryPath = safe; result.categorySource = source;
      }
    }
    if (dateLabels.test(label) && !result.listedAt) {
      const safe = date(value); if (safe) { result.listedAt = safe; result.listedAtSource = source; }
    }
  };
  for (const row of parameters) add(row.name, row.value, '商品参数');
  if (typeof product.category === 'string') add('商品类目', product.category, '商品结构化信息');
  const excluded = node => {
    for (let owner = node; owner && owner !== doc.body; owner = owner.parentElement) {
      if (/(?:recommend|review|comment|related|guess)/i.test(signature(owner))) return true;
    }
    return false;
  };
  const values = node => {
    if (!node) return [];
    const nodes = [node, ...node.querySelectorAll('[title],[aria-label],[aria-describedby]')];
    const linked = nodes.flatMap(part => (part.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean).map(id => doc.getElementById(id))).filter(Boolean);
    return [...nodes, ...linked].flatMap(part => [part.textContent, part.getAttribute('title'), part.getAttribute('aria-label')]).map(tidy).filter(Boolean);
  };
  // A neighbouring dropdown can contain many navigation commands, not a field
  // value. Do not flatten such a container (or its linked menu) into a category.
  const controls = 'nav,button,input,select,textarea,[role="menu"],[role="menubar"],[role="menuitem"],[role="listbox"],[role="combobox"],[role="button"]';
  const visibleCategoryText = node => {
    let visited = 0, truncated = false;
    const read = (part, depth = 0) => {
      if (++visited > 120 || depth > 12) { truncated = true; return ''; }
      if (part.nodeType === 3) return part.nodeValue || '';
      if (part.nodeType !== 1 || /^(SCRIPT|STYLE|SVG)$/.test(part.tagName) || !part.getClientRects().length) return '';
      if (/^(hidden|collapse)$/.test(doc.defaultView.getComputedStyle(part).visibility)) return '';
      return [...part.childNodes].map(child => read(child, depth + 1)).join('');
    };
    const value = read(node);
    return truncated ? '' : tidy(value);
  };
  const categoryContainer = node => {
    if (!node || excluded(node) || node.matches(controls) || node.querySelector(controls)
        || /menu|dropdown|toolbar|navigation/i.test(signature(node))) return false;
    for (let owner = node.parentElement; owner && owner !== doc.body; owner = owner.parentElement) {
      if (owner.matches('nav,[role="menu"],[role="menubar"],[role="menuitem"],[role="listbox"]')
          || /menu|dropdown/i.test(signature(owner))) return false;
    }
    const links = node.querySelectorAll('a[href]');
    return links.length <= 1 || /[>＞›]/.test(node.textContent || '');
  };
  const categoryValues = node => {
    if (!categoryContainer(node) || !node.getClientRects().length) return [];
    const nodes = [node, ...node.querySelectorAll('[title],[aria-label],[aria-describedby]')].filter(part =>
      categoryContainer(part) && part.getClientRects().length);
    const linked = nodes.flatMap(part => (part.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean).map(id => doc.getElementById(id)))
      .filter(part => categoryContainer(part));
    return [...nodes.flatMap(part => [visibleCategoryText(part), part.getAttribute('title'), part.getAttribute('aria-label')]),
      ...linked.flatMap(part => [part.textContent, part.getAttribute('title'), part.getAttribute('aria-label')])]
      .map(tidy).filter(value => value && !isCategoryNavigationText(value));
  };
  const fieldValues = (label, node) => categoryLabels.test(label) ? categoryValues(node) : values(node);
  for (const node of doc.querySelectorAll('span,div,td,th,dt,dd,p,b,strong,label')) {
    if (excluded(node) || !node.getClientRects().length) continue;
    const raw = tidy(node.textContent);
    if (!raw || raw.length > 600) continue;
    const label = raw.replace(/\s*[:：]$/, '');
    if (categoryLabels.test(label) || dateLabels.test(label)) {
      for (const value of fieldValues(label, node.nextElementSibling)) add(label, value, '页面标注（含已显示工具栏，未独立核实）');
    } else {
      const match = raw.match(/^(上架类目|商品类目|所属类目|类目|首次上架时间|上架时间|上架日期|上架)\s*[:：]\s*(.+)$/);
      if (!match) continue;
      if (/(?:上架|SKU数|已售|销售额|评价|收藏)\s*[:：]/i.test(match[2])) continue;
      const isCategory = categoryLabels.test(match[1]);
      const value = isCategory ? visibleCategoryText(node).replace(/^(上架类目|商品类目|所属类目|类目)\s*[:：]\s*/, '') : match[2];
      if (!isCategory || categoryContainer(node)) add(match[1], value, '页面标注（含已显示工具栏，未独立核实）');
      for (const child of node.children) {
        for (const value of fieldValues(match[1], child)) add(match[1], value, '页面标注（含已显示工具栏，未独立核实）');
      }
    }
  }
  return result;
}

const metricNames = ['综合体验', '店铺评分', '宝贝质量', '宝贝描述', '描述相符', '物流速度', '服务保障', '服务体验', '服务态度', '卖家服务', '客服服务', '客服满意度', '88VIP好评率', '好评率', '及时发货率'];
const score = value => tidy(value).match(/^(?:[★☆⭐\s]*)((?:[0-4](?:\.\d{1,2})?|5(?:\.0{1,2})?))(?:分)?$/)?.[1] || '';
const rate = value => tidy(value).match(/^(100(?:\.0+)?|\d{1,2}(?:\.\d+)?)%$/)?.[0] || '';
const metricValue = (name, value) => /率$/.test(name) ? rate(value) : name === '客服满意度' ? rate(value) || score(value) : score(value);

const shopAreaSelector = '[class*="shop" i],[class*="seller" i],[class*="store" i],[data-testid*="shop" i]';
const shopNameSelector = '[class*="shopName" i],[class*="shop-name" i],[class*="shop_name" i],[class*="shopTitle" i],[class*="shop-title" i],[class*="sellerName" i],[class*="seller-name" i],[class*="storeName" i],[class*="store-name" i],[data-testid="shop-name"],[data-shop-name],.tb-shop-name';
const excludedShopContext = /(?:recommend|review|comment|related|similar|guess|attribute|parameter|sku)/i;
function inShopContext(node) {
  for (let parent = node; parent && parent.tagName !== 'BODY'; parent = parent.parentElement) {
    if (excludedShopContext.test(signature(parent))) return false;
  }
  return true;
}
function shopName(value) {
  const name = tidy(value).replace(/^店铺(?:名称)?\s*[:：]\s*/, '').replace(/\s*[>›»]+$/, '').trim();
  if (name.length < 2 || name.length > 100 || /[★☆⭐\n]/.test(name)
    || /^(?:店铺|商家|卖家|淘宝|天猫|淘宝网|店铺名称|店铺首页|进店(?:逛逛)?|进入店铺|查看店铺|全部商品|联系客服|和我联系|收藏(?:店铺)?|掌柜|客服)$/.test(name)
    || metricNames.some(label => name.includes(label))) return '';
  return name;
}
function shopNameNodes(doc) {
  const direct = [...doc.querySelectorAll(shopNameSelector)];
  const nested = [...doc.querySelectorAll(shopAreaSelector)].flatMap(root =>
    text(root).length <= 6000 ? [...root.querySelectorAll('[class*="name" i],[class*="title" i],a[href]')] : []);
  return [...new Set([...direct, ...nested])].filter(node => {
    if (!inShopContext(node)) return false;
    if (node.tagName !== 'A' || node.matches(shopNameSelector) || /name|title/i.test(signature(node))) return true;
    try {
      const url = new URL(node.getAttribute('href'), doc.baseURI);
      return /^(?:shop\d+\.taobao\.com|[a-z0-9-]+\.tmall\.com)$/i.test(url.hostname)
        && !/^(?:detail|list|login|search)\./i.test(url.hostname)
        && !/item|search|category/i.test(url.pathname);
    } catch { return false; }
  });
}
function nameFromNode(node) {
  // Keep the actual name, including spaces; no flagship / franchise suffix is required.
  return shopName(node.getAttribute('data-shop-name')) || shopName(node.getAttribute('title'))
    || shopName(node.getAttribute('aria-label')) || shopName(node.textContent);
}
export function collectShopName(doc) {
  return shopNameNodes(doc).map(nameFromNode).find(Boolean) || '';
}
function shopRoots(doc, extraRoots = []) {
  return [...new Set([...doc.querySelectorAll(shopAreaSelector), ...extraRoots])]
    .filter(root => inShopContext(root) && text(root).length <= 6000);
}

export function collectShopMetrics(doc, extraRoots = []) {
  const found = new Map();
  const add = (name, value) => { const safe = metricValue(name, value); if (safe && !found.has(name)) found.set(name, safe); };
  // Restrict to shop areas (including already-rendered hover cards), not review body text.
  const roots = shopRoots(doc, extraRoots);
  for (const root of roots) {
    if (text(root).length > 6000 || /(?:recommend|review|comment)/i.test(signature(root))) continue;
    const nodes = [root, ...root.querySelectorAll('div,span,li,dt,dd,td,th,p')];
    for (const node of nodes) {
      if (!inShopContext(node)) continue;
      const value = text(node);
      // Single metric with optional star glyphs; never consume a neighboring metric's number.
      for (const name of metricNames) if (value.startsWith(name)) add(name, value.slice(name.length).replace(/^\s*[:：]\s*/, ''));
      if (metricNames.includes(value)) {
        add(value, text(node.nextElementSibling));
        const parent = node.parentElement;
        if (parent && children(parent).length === 2 && text(parent).length < 90) {
          for (const part of children(parent)) if (part !== node) add(value, text(part));
        }
        // Labels and scores may be split by stars / icons and multiple wrappers.
        // Stop before a container with another metric, so service / quality scores
        // cannot silently become the overall shop score.
        for (let row = parent, depth = 0; row && root.contains(row) && depth < 3; row = row.parentElement, depth++) {
          const rowText = text(row);
          if (rowText.length > 120 || metricNames.some(other => other !== value && rowText.includes(other))) break;
          const values = [...new Set([...row.querySelectorAll('span,b,strong,em,i,div')]
            .filter(part => !part.contains(node)).map(part => metricValue(value, text(part))).filter(Boolean))];
          if (values.length === 1) add(value, values[0]);
        }
      }
      // Three headings followed by a separate row of three scores, as in the supplied shop card.
      const parts = children(node);
      if (parts.length === 2) {
        const names = children(parts[0]).map(text), values = children(parts[1]).map(text);
        if (names.length >= 2 && names.length === values.length && names.every(name => metricNames.includes(name))) names.forEach((name, i) => add(name, values[i]));
      }
    }
  }
  // Compact shop headers sometimes show stars + a number without a text label.
  // Only accept an explicit shop/overall rating element, or a rating element
  // alongside a verified shop-name node. Never use arbitrary bare page numbers.
  if (!found.has('综合体验') && !found.has('店铺评分')) {
    const nameNodes = shopNameNodes(doc).filter(node => nameFromNode(node));
    for (const root of roots) {
      const nodes = [root, ...root.querySelectorAll('[class*="rating" i],[class*="score" i],[class*="star" i]')];
      for (const node of nodes) {
        if (!inShopContext(node)) continue;
        const sig = signature(node), compact = sig.replace(/[-_]/g, '');
        const explicitOverall = /(?:shop|store|seller|overall)(?:rating|score)/i.test(compact);
        if (!explicitOverall && !/(?:rating|score)/i.test(sig)) continue;
        const parent = node.parentElement, rowText = text(parent);
        const hasShopName = parent && nameNodes.some(candidate => parent.contains(candidate));
        if (!explicitOverall && (!hasShopName || rowText.length > 250)) continue;
        if (/(?:service|logistic|quality|description)/i.test(sig)
          || metricNames.some(name => !/^(综合体验|店铺评分)$/.test(name) && text(node).includes(name))) continue;
        if (parent && !hasShopName && rowText.length < 120
          && metricNames.some(name => !/^(综合体验|店铺评分)$/.test(name) && rowText.includes(name))) continue;
        const safe = score(text(node)) || score(node.getAttribute('aria-label'));
        if (safe) add('店铺评分', safe);
      }
    }
  }
  return [...found].map(([name, value]) => ({ name, value }));
}

export async function readShopInfo(doc) {
  const shop = collectShopName(doc);
  const before = collectShopMetrics(doc);
  const result = { shop, shopMetrics: before };
  if (before.some(row => row.name === '综合体验' || row.name === '店铺评分') && before.some(row => /^(服务保障|客服满意度|服务体验)$/.test(row.name))) return result;
  const trigger = shopNameNodes(doc).find(node => nameFromNode(node) === shop && shop);
  if (!trigger) return result;
  const view = doc.defaultView;
  const popupSelector = '[role="tooltip"],[role="dialog"],[class*="popover" i],[class*="popup" i]';
  const isVisible = node => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0
    && view.getComputedStyle(node).visibility !== 'hidden';
  const existingPopups = new Set([...doc.querySelectorAll(popupSelector)].filter(isVisible));
  // Show only this existing shop card; no new tab, navigation, platform API or verification action.
  try {
    trigger.dispatchEvent(new view.MouseEvent('mouseover', { bubbles: true }));
    trigger.dispatchEvent(new view.MouseEvent('mouseenter'));
    // Shop cards render lazily; keep this bounded and merge already-read facts.
    for (let attempt = 0; attempt < 6; attempt++) {
      await new Promise(resolve => view.setTimeout(resolve, 250));
      const ownedIds = `${trigger.getAttribute('aria-controls') || ''} ${trigger.getAttribute('aria-describedby') || ''}`.split(/\s+/).filter(Boolean);
      const popups = [...doc.querySelectorAll(popupSelector)].filter(node => isVisible(node)
        && (ownedIds.includes(node.id) || (!existingPopups.has(node) && text(node).includes(shop))));
      for (const metric of collectShopMetrics(doc, popups)) {
        if (!result.shopMetrics.some(row => row.name === metric.name)) result.shopMetrics.push(metric);
      }
      result.shop = collectShopName(doc) || shop;
      if (result.shopMetrics.some(row => /^(综合体验|店铺评分)$/.test(row.name))) break;
    }
    return result;
  } finally {
    trigger.dispatchEvent(new view.MouseEvent('mouseout', { bubbles: true }));
    trigger.dispatchEvent(new view.MouseEvent('mouseleave'));
  }
}

export async function readShopMetrics(doc) {
  return (await readShopInfo(doc)).shopMetrics;
}
