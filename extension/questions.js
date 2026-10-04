// Independent, bounded Q&A reader. No private APIs, credentials, image changes,
// purchases or posted questions. Only content in an identified 问大家 section.
(async () => {
  const MAX_QUESTIONS = 200;
  const MAX_ANSWERS = 30;
  const startedAt = Date.now();
  const deadline = startedAt + 45000;
  const startedUrl = location.href;
  const originalScroll = [window.scrollX, window.scrollY];
  const clean = (value, limit = 2000) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
  const text = (node) => clean(node?.innerText ?? node?.textContent);
  const headingPattern = /^问大家\s*(?:[·•:：（(]\s*)?([\d,]+(?:\.\d+)?\s*万?\+?)?\s*[）)]?$/;
  const controlPattern = /^(?:查看全部问答|查看全部问题|查看更多问答|查看更多问题|加载更多问答|更多问答|更多回答|查看\d+条回答|展开\d*条回答)\s*[>›»→]?$/;
  const questionControlPattern = /^(?:查看全部问答|查看全部问题|查看更多问答|查看更多问题|加载更多问答|更多问答)\s*[>›»→]?$/;
  // Stable class prefixes verified against the user's saved product HTML.
  // Match the prefix, never the build-specific CSS hash following "--".
  const sectionSelector = '[class*="askAnswerWrap--" i],[class*="AskAnswersWrap--"]';
  const drawerSelector = '[role="dialog"],[class*="askAnswerInfoDrawer--"]';
  const deniedPattern = /安全验证|滑动验证|拖动滑块|访问受限|访问被拒绝|请求过于频繁|请先登录|登录后查看/;
  const counts = [];
  const items = new Map();
  const clicked = new WeakMap();
  const panePositions = new Map();
  const paneStyles = new Map();
  const boundaryState = new WeakMap();
  const originalDialogs = new Set(document.querySelectorAll(drawerSelector));
  let matchedSections = 0;
  let matchedQuestionNodes = 0;
  let scrollSteps = 0;
  let sawSection = false;
  let blocked = false;
  let empty = false;
  let stopReason = '';
  let openedMore = false;
  let scrolled = false;
  let warmupSteps = 0;
  let warmupTarget = '';
  let rounds = 0;
  let exitReason = 'deadline';
  let firstSectionMs = null;
  let firstQuestionMs = null;
  const centeredSections = new WeakSet();
  const loadedCounts = [];
  let boundaryAttempts = 0;
  let resizedPanes = 0;
  let controlsClicked = 0;
  let paneDiagnostics = [];
  let discoveryRounds = 0;

  function visible(node) {
    if (!node || node.closest('script,style,template,[hidden],[aria-hidden="true"]')) return false;
    const style = getComputedStyle(node);
    return style.display !== 'none' && style.visibility !== 'hidden' && node.getClientRects().length > 0;
  }
  function leaves(root, selector) {
    return [...root.querySelectorAll(selector)].filter(visible);
  }
  function count(value) {
    const raw = clean(value);
    if (!/^\d[\d,]*(?:\.\d+)?万?\+?$/.test(raw)) return null;
    return { value: Math.round(Number(raw.replace(/[,万+]/g, '')) * (raw.includes('万') ? 10000 : 1)), exact: !/[万+]/.test(raw), label: raw };
  }
  function recordTotal(heading) {
    const match = text(heading).match(headingPattern);
    const parsed = match && count(match[1]);
    if (parsed) counts.push(parsed);
  }
  // Find a compact section around its actual heading, not a toolbar shortcut,
  // AI-generated suggested questions, reviews, or the whole product document.
  function roots() {
    const result = new Set();
    // Avoid scanning every div on a large product page when its dedicated
    // preview/list containers are present. Toolbar "问大家" isn't a section.
    for (const section of leaves(document, sectionSelector)) {
      const heading = leaves(section, '[class*="askAnswerTitle--"]').find(node => headingPattern.test(text(node)));
      if (!heading) continue;
      recordTotal(heading);
      result.add(section);
    }
    if (result.size) { matchedSections = Math.max(matchedSections, result.size); return [...result]; }
    const seenHeadings = new Set();
    // Test text first: computing layout for every div on a long detail page
    // can consume the entire budget before reaching the real Q&A section.
    for (const candidate of document.querySelectorAll('h2,h3,h4,div,span,p')) {
      if (!headingPattern.test(text(candidate)) || !visible(candidate)) continue;
      // The label, separator and count are often sibling spans. Promote to
      // their common heading BEFORE de-duplicating; never discard the count.
      let heading = candidate;
      while (heading.parentElement && heading.parentElement !== document.body && heading.parentElement !== document.documentElement && headingPattern.test(text(heading.parentElement))) heading = heading.parentElement;
      if (seenHeadings.has(heading)) continue;
      seenHeadings.add(heading);
      if (count(text(heading).match(headingPattern)?.[1])?.value === 0) {
        recordTotal(heading);
        result.add(heading);
        continue;
      }
      let parent = heading.parentElement;
      for (let depth = 0; parent && depth < 5; depth++, parent = parent.parentElement) {
        if (parent === document.body || parent === document.documentElement) break;
        const body = text(parent);
        if (body.length > 30000 || /用户评价\s*[·•]|参数信息|图文详情/.test(body)) break;
        const zero = count(text(heading).match(headingPattern)?.[1])?.value === 0;
        if (zero || body.length > text(heading).length + 1 && (/回答|问答|暂无提问|暂无问题|还没有人提问/.test(body) || parent.querySelector('[class*="question" i],[class*="answer" i]'))) {
          recordTotal(heading);
          result.add(parent);
          break;
        }
      }
    }
    matchedSections = Math.max(matchedSections, result.size);
    return [...result];
  }
  function validContent(value, minimum = 2) {
    return value.length >= minimum && !headingPattern.test(value) && !controlPattern.test(value)
      && !/^(?:问|答|提问|回答|我来回答|去提问|查看全部|暂无回答|暂无提问|暂无问题|还没有人提问|\d+\s*(?:条|个|人).*(?:回答|提问))$/.test(value);
  }
  function contentNodes(root, kind) {
    const exact = kind === 'question'
      ? '[class*="question--"],[class*="questionTitle--"]'
      : '[class*="answer--"],[class*="answerContent--"],[class*="initContent--"]';
    const known = leaves(root, exact).filter(node => validContent(contentText(node, kind), kind === 'answer' ? 1 : 2));
    if (known.length) return known.filter(node => !known.some(other => other !== node && node.contains(other)));
    const selector = kind === 'question'
      ? '[class*="question" i],[class*="askText" i],[class*="askTitle" i]'
      : '[class*="answer" i],[class*="reply" i]';
    const nodes = leaves(root, selector).filter(node => {
      const name = String(node.className || '');
      if (/icon|avatar|count|button|more|user|date|time|action/i.test(name)) return false;
      return validContent(text(node), kind === 'answer' ? 1 : 2);
    });
    // A wrapper containing several question cards is not itself a question.
    return nodes.filter(node => !nodes.some(other => other !== node && node.contains(other)));
  }
  function contentText(node, kind) {
    if (kind !== 'answer' || !node.querySelector('[class*="initTag--"],[class*="answerMeta--"]')) return text(node);
    const copy = node.cloneNode(true);
    copy.querySelectorAll('[class*="initTag--"],[class*="answerMeta--"]').forEach(badge => badge.remove());
    return text(copy);
  }
  function markerRows(root, marker) {
    const nodes = leaves(root, 'span,i,b,em,div,img').filter(node =>
      (text(node) === marker && ![...node.children].some(child => text(child) === marker))
      || (node.tagName === 'IMG' && node.getAttribute('alt') === marker));
    // An icon can have several wrappers before its neighbouring text. Returning
    // only parentElement reads the icon itself ("问") and loses the question.
    return [...new Set(nodes.map(node => {
      for (let row = node.parentElement, depth = 0; row && root.contains(row) && depth < 4; row = row.parentElement, depth++) {
        const value = stripMarker(text(row), marker);
        if (/更多回答|查看全部问答/.test(value)) return null;
        if (validContent(value, marker === '答' ? 1 : 2)) return row;
      }
      return null;
    }).filter(Boolean))];
  }
  function stripMarker(value, marker) {
    return clean(value).replace(new RegExp(`^${marker}(?:[：: \\t]+|(?=[\\u4e00-\\u9fff]))`), '').trim();
  }
  function textLeaves(root) {
    return leaves(root, 'div,span,p,b,strong,a').filter(node => {
      const value = text(node);
      return validContent(value, 1) && ![...node.children].some(child => text(child))
        && !/avatar|username|nickname|date|time/i.test(String(node.className || ''));
    });
  }
  function structuralCards(root) {
    const cards = new Map();
    // If the 问 badge is a background/SVG image, use the actual "更多回答"
    // footer to delimit one Q&A card, never the whole section/page.
    for (const footer of leaves(root, 'div,span,a,button')) {
      if (!/^更多回答\s*[>›»→]?$/.test(text(footer))) continue;
      for (let card = footer.parentElement, depth = 0; card && root.contains(card) && depth < 5; card = card.parentElement, depth++) {
        const footers = leaves(card, 'div,span,a,button').filter(node => /^更多回答\s*[>›»→]?$/.test(text(node)) && ![...node.children].some(child => /^更多回答/.test(text(child))));
        if (footers.length > 1) break;
        const content = textLeaves(card);
        if (content.length < 2 || !validContent(text(content[0]))) continue;
        // Do not mistake an answer's avatar/name row for a question card.
        const first = card.firstElementChild;
        if (first?.tagName === 'IMG' || first && /avatar|user/i.test(String(first.className || ''))) continue;
        cards.set(content[0], card);
        break;
      }
    }
    return cards;
  }
  function plainAnswerNodes(card, questionNode) {
    const result = [];
    // Only a subsequent avatar+single-text row is a structural answer. If the
    // row also contains names/dates or several texts, leave it unread instead
    // of guessing which text is the answer.
    for (const image of leaves(card, 'img')) {
      let row = image.parentElement;
      for (let depth = 0; row && card.contains(row) && depth < 3; depth++, row = row.parentElement) {
        if (row.contains(questionNode)) break;
        const parts = textLeaves(row);
        if (parts.length === 1 && (questionNode.compareDocumentPosition(parts[0]) & Node.DOCUMENT_POSITION_FOLLOWING)) {
          result.push(parts[0]);
          break;
        }
        if (parts.length > 1) break;
      }
    }
    return result;
  }
  function read(root) {
    sawSection = true;
    const body = text(root);
    blocked ||= deniedPattern.test(body);
    empty ||= /暂无提问|暂无问题|还没有人提问|暂无问答/.test(body);
    if (blocked) return;
    let questions = contentNodes(root, 'question').filter(node => !node.querySelector('[class*="answer" i],[class*="reply" i]'));
    if (!questions.length) questions = markerRows(root, '问');
    const structural = questions.length ? new Map() : structuralCards(root);
    if (!questions.length) questions = [...structural.keys()];
    matchedQuestionNodes = Math.max(matchedQuestionNodes, questions.length);
    for (const questionNode of questions) {
      const question = stripMarker(text(questionNode), '问');
      if (!validContent(question) || question.length > 1000) continue;
      const key = question.replace(/\s/g, '');
      if (!items.has(key) && items.size >= MAX_QUESTIONS) continue;
      let card = structural.get(questionNode) || questionNode.parentElement;
      for (let depth = 0; card && depth < 4; depth++, card = card.parentElement) {
        if (!root.contains(card) || questions.filter(node => card.contains(node)).length > 1) { card = null; break; }
        if (contentNodes(card, 'answer').length || markerRows(card, '答').length || /暂无回答|更多回答|\d+\s*(?:条|个|人).*回答/.test(text(card))) break;
        if (card === root) break;
      }
      const knownAnswers = card ? contentNodes(card, 'answer') : [];
      const answers = card ? [...knownAnswers, ...markerRows(card, '答'), ...(knownAnswers.length ? [] : plainAnswerNodes(card, questionNode))]
        .map(node => stripMarker(contentText(node, 'answer'), '答')).filter(value => validContent(value, 1) && value !== question) : [];
      const answerMatch = card && text(card).match(/(?:共\s*)?(\d+)\s*(?:条|个|人)\s*(?:回答|已回答)/);
      const answerTotal = answerMatch ? Number(answerMatch[1]) : card && /暂无回答/.test(text(card)) ? 0 : null;
      const existing = items.get(key);
      const merged = [...new Set([...(existing?.answers || []), ...answers])].slice(0, MAX_ANSWERS);
      items.set(key, { question, answers: merged, answerTotal: Math.max(existing?.answerTotal ?? -1, answerTotal ?? -1) < 0 ? null : Math.max(existing?.answerTotal ?? 0, answerTotal ?? 0) });
    }
  }
  function safeControl(root, questionsOnly = false) {
    const pattern = questionsOnly ? questionControlPattern : controlPattern;
    const candidates = leaves(root, 'button,[role="button"],a,div,span').filter(node => pattern.test(text(node)));
    // Taobao can render a clickable div/span with no button role. Exact action
    // text inside an identified Q&A section is required for that fallback.
    for (const node of candidates.sort((a, b) => Number(/^更多回答/.test(text(a))) - Number(/^更多回答/.test(text(b))))) {
      if (!controlPattern.test(text(node)) || clicked.get(node) === text(node.parentElement) || node.closest('[disabled],[aria-disabled="true"]')) continue;
      if (candidates.some(other => other !== node && node.contains(other))) continue;
      // Only in-page expansion. Never follow a Q&A app/deep link, login URL,
      // arbitrary new tab or JavaScript URL from a third-party page.
      const anchor = node.closest('a');
      if (anchor) {
        const href = anchor.getAttribute('href');
        if (href && href !== '#') continue;
        if (anchor.target && anchor.target !== '_self') continue;
      }
      return node;
    }
    return null;
  }
  function questionPane(sections) {
    const candidates = new Set();
    for (const root of sections) {
      // The saved 32-question page uses ContentArea with overflow:auto. Keep
      // it eligible AT THE BOTTOM and when the first 10 rows fit its height.
      // Both cases were incorrectly excluded by V1.0.2 before any scroll.
      for (const pane of leaves(root, '[class*="ContentArea--"]')) candidates.add(pane);
      for (const list of leaves(root, '[class*="qaListContainer--"]')) {
        for (let pane = list; pane && root.contains(pane); pane = pane.parentElement) {
          candidates.add(pane);
          if (pane === root) break;
        }
      }
      candidates.add(root);
    }
    const entries = [...candidates].filter(visible).map(pane => {
      const style = getComputedStyle(pane);
      return { pane, overflow: `${style.overflowY} ${style.overflow}` };
    });
    paneDiagnostics = entries.slice(0, 8).map(({ pane, overflow }) => ({
      className: String(pane.className || '').slice(0, 160),
      clientHeight: pane.clientHeight, scrollHeight: pane.scrollHeight,
      scrollTop: Math.round(pane.scrollTop), overflow,
      listHeight: pane.querySelector('[class*="qaListContainer--"]')?.scrollHeight || 0,
    }));
    return entries.find(({ pane, overflow }) => pane.clientHeight > 0 && /auto|scroll/.test(overflow))?.pane || null;
  }
  function advancePane(pane) {
    if (!panePositions.has(pane)) panePositions.set(pane, pane.scrollTop);
    // A tall window can fit all first-page rows without a scrollbar. Briefly
    // constrain ONLY the Q&A scroller so normal near-bottom loading can fire.
    // Never touch the product, SKU, reviews, or the document's overflow.
    if (pane.scrollHeight <= pane.clientHeight + 1 && pane.scrollHeight > 120 && !paneStyles.has(pane)) {
      paneStyles.set(pane, { value: pane.style.getPropertyValue('max-height'), priority: pane.style.getPropertyPriority('max-height') });
      // scrollHeight cannot be smaller than clientHeight. A two-row list may
      // be only 270px inside a 2429px pane; using the pane's scrollHeight
      // yielded a 480px box and still no scrollbar (real V1.0.3 diagnostics).
      const list = pane.querySelector('[class*="qaListContainer--"]');
      const measured = list && Math.max(list.scrollHeight, list.getBoundingClientRect().height);
      const contentHeight = measured > 0 ? Math.min(measured, pane.scrollHeight) : pane.scrollHeight;
      pane.style.setProperty('max-height', `${Math.max(60, Math.min(480, contentHeight - 40))}px`, 'important');
      resizedPanes++;
    }
    const max = Math.max(0, pane.scrollHeight - pane.clientHeight);
    const key = `${items.size}:${pane.scrollHeight}:${pane.clientHeight}`;
    let state = boundaryState.get(pane);
    if (!state || state.key !== key) {
      state = { key, attempts: 0, lastAt: -Infinity };
      boundaryState.set(pane, state);
    }
    if (pane.scrollTop < max - 2) {
      pane.scrollTop = Math.min(max, pane.scrollTop + Math.max(80, pane.clientHeight * 0.85));
      scrollSteps++;
      state.lastAt = Date.now();
      return true;
    }
    // At a batch boundary, wait for the response. A few bounded nudges allow
    // a previously-bottomed list to retry; unchanged data never causes a tight
    // request loop. The page's own handler remains responsible for loading.
    if (Date.now() - state.lastAt < 2500 || state.attempts >= 3) return false;
    if (max > 0) {
      pane.scrollTop = Math.max(0, max - 3);
      pane.scrollTop = max;
      scrollSteps++;
    }
    pane.dispatchEvent(new Event('scroll'));
    state.lastAt = Date.now();
    state.attempts++;
    boundaryAttempts++;
    return true;
  }
  function guard() {
    if (location.href !== startedUrl) { stopReason = '页面地址已变化，已停止问答采集。'; return false; }
    const dialogs = [...document.querySelectorAll('[role="dialog"],iframe')].filter(visible);
    blocked ||= dialogs.some(node => deniedPattern.test(text(node)) || /login|captcha|punish/i.test(node.getAttribute('src') || ''));
    if (blocked) { stopReason = '问答需要登录或验证，请在原商品页手动处理后重新采集。'; return false; }
    return Date.now() < deadline && items.size < MAX_QUESTIONS;
  }
  function warmMissingSection(step) {
    // Q&A mounts below reviews. Image prewarming scrolls a long detail page
    // quickly and restores the top; it does NOT prove this section is ready.
    // The review prefix and adjacent placeholder were verified in saved HTML.
    if (step === 0) {
      const target = leaves(document, sectionSelector)[0]
        || leaves(document, '[class*="Comments--"]')[0];
      if (target) {
        target.scrollIntoView({ block: 'end', behavior: 'instant' });
        warmupTarget = target.matches(sectionSelector) ? 'qa-container' : 'reviews-end';
        warmupSteps++;
        scrolled = true;
        return;
      }
    }
    // Give the focused area time to hydrate before moving. If there is no
    // known anchor, walk a bounded viewport range (not giant detail-height
    // jumps). No clicks, no reviews/AI questions used as Q&A data.
    if (step % 5 !== 0 || warmupSteps >= 8 || warmupTarget === 'qa-container') return;
    if (warmupTarget === 'reviews-end') {
      window.scrollTo({ top: window.scrollY + Math.max(200, window.innerHeight * 0.5), behavior: 'instant' });
    } else {
      window.scrollTo({ top: warmupSteps * Math.max(400, window.innerHeight * 0.8), behavior: 'instant' });
      warmupTarget = 'viewport-walk';
    }
    warmupSteps++;
    scrolled = true;
  }
  const wait = () => new Promise(resolve => setTimeout(resolve, Math.max(0, Math.min(350, deadline - Date.now()))));
  try {
    let stableSince = Date.now();
    for (let step = 0; step < 130 && guard(); step++) {
      rounds++;
      const sections = roots();
      const before = JSON.stringify([...items.values()]);
      sections.forEach(read);
      if (sections.length && firstSectionMs === null) firstSectionMs = Date.now() - startedAt;
      if (items.size && firstQuestionMs === null) firstQuestionMs = Date.now() - startedAt;
      if (items.size && loadedCounts.at(-1) !== items.size) loadedCounts.push(items.size);
      if (before !== JSON.stringify([...items.values()])) stableSince = Date.now();
      if (!guard()) break;
      // A toolbar/placeholder can resemble a section but contain no count or
      // questions. It must not suppress real Q&A prewarming (observed in the
      // background 0-row diagnostic: matchedSections=1, warmupSteps=0).
      const weakSectionOnly = !items.size && !empty && !counts.length
        && sections.every(root => !root.matches(sectionSelector));
      if (!sections.length || weakSectionOnly) {
        warmMissingSection(discoveryRounds++);
        await wait();
        continue;
      }
      const focusSection = sections.find(root => !centeredSections.has(root));
      if (focusSection) {
        focusSection.scrollIntoView({ block: 'center', behavior: 'instant' });
        centeredSections.add(focusSection);
        scrolled = true;
        await wait();
        continue;
      }
      const fullSections = sections.filter(root => root.querySelector('[class*="qaListContainer--"]'));
      const fullList = fullSections.length > 0;
      // Once a full drawer exists, ignore preview buttons behind its overlay.
      const activeSections = fullList ? fullSections : sections;
      const total = counts.sort((a, b) => b.value - a.value)[0];
      const reconciled = total?.exact && items.size === total.value;
      const control = reconciled ? null : activeSections.map(root => safeControl(root, true)).find(Boolean);
      const pane = reconciled ? null : questionPane(activeSections);
      if (control) {
        clicked.set(control, text(control.parentElement));
        openedMore = true;
        control.click();
        controlsClicked++;
        stableSince = Date.now();
      } else if (pane && advancePane(pane)) {
        stableSince = Date.now();
      } else if (!reconciled && !fullList && activeSections.map(root => safeControl(root)).find(Boolean)) {
        const answerControl = activeSections.map(root => safeControl(root)).find(Boolean);
        clicked.set(answerControl, text(answerControl.parentElement));
        openedMore = true;
        answerControl.click();
        controlsClicked++;
        stableSince = Date.now();
      } else {
        const settled = Date.now() - stableSince >= 1400;
        // No entry, no rows, or fewer rows than the known total are NOT a
        // completed capture. Keep waiting for mounting / async pagination.
        // Only explicit empty or a reconciled count can finish early.
        if (settled && (empty && !items.size && (!total || total.value === 0)
          || total?.exact && items.size === total.value)) {
          exitReason = items.size ? 'count-reconciled' : 'explicit-empty';
          break;
        }
      }
      await wait();
    }
    if (!blocked && location.href === startedUrl) roots().forEach(read);
    if (exitReason === 'deadline' && rounds >= 130 && Date.now() < deadline) exitReason = 'round-limit';
  } catch {
    exitReason = 'reader-error';
    stopReason = '问答读取中断，保留本次已读取内容。';
  } finally {
    if (location.href === startedUrl) {
      for (const [pane, saved] of paneStyles) {
        if (!pane.isConnected) continue;
        if (saved.value) pane.style.setProperty('max-height', saved.value, saved.priority);
        else pane.style.removeProperty('max-height');
      }
      for (const [pane, position] of panePositions) if (pane.isConnected) pane.scrollTop = position;
      if (openedMore) {
        for (const dialog of document.querySelectorAll(drawerSelector)) {
          if (originalDialogs.has(dialog) || !/问大家/.test(text(dialog)) || deniedPattern.test(text(dialog))) continue;
          const close = [...dialog.querySelectorAll('button,[role="button"]')].find(node => /^(关闭|关闭弹窗|Close)$/i.test(clean(node.getAttribute('aria-label') || node.getAttribute('title') || text(node))))
            || (dialog.matches('[class*="askAnswerInfoDrawer--"]') && dialog.querySelector('[class*="closeWrap--"]'));
          if (close) close.click();
        }
      }
      if (scrolled) window.scrollTo(...originalScroll);
    }
  }
  const values = [...items.values()];
  const total = counts.sort((a, b) => b.value - a.value)[0] || null;
  const complete = !stopReason && !blocked && total?.exact && values.length === total.value;
  const status = blocked ? 'blocked' : values.length ? (complete ? 'complete' : 'partial')
    : sawSection && (empty || total?.value === 0) ? 'empty' : sawSection ? 'unavailable' : 'not_found';
  return {
    items: values,
    total: total?.value ?? null,
    totalExact: total?.exact ?? false,
    totalLabel: total?.label ?? '',
    status,
    capturedAt: new Date().toISOString(),
    diagnostics: { reader: '1.0.4-qa-background', matchedSections, matchedQuestionNodes, scrollSteps,
      boundaryAttempts, resizedPanes, controlsClicked, loadedCounts, panes: paneDiagnostics,
      warmupSteps, warmupTarget, rounds, elapsedMs: Date.now() - startedAt,
      firstSectionMs, firstQuestionMs, visibility: document.visibilityState,
      exitReason: blocked ? 'blocked' : location.href !== startedUrl ? 'navigation' : items.size >= MAX_QUESTIONS ? 'limit' : exitReason },
    message: stopReason || (status === 'empty' ? '商品页明确显示暂无问答。'
      : status === 'not_found' ? '当前页面未发现“问大家”入口，可能未提供或尚未加载。'
      : status === 'unavailable' ? '未读取到可识别的问答内容，请在商品页展开“问大家”后重试。'
      : status === 'partial' ? '仅采集到当前已加载的问题，未读取的内容不会补写。' : '已读取页面标注数量的问题；回答仅展示实际读取到的内容。'),
  };
})();
