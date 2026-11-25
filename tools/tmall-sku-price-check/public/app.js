(async function () {
  'use strict';
  const C = window.PriceCore, $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const initial = window.INITIAL_CATALOG?.records ?? C.SEED;
  let records = initial.map(r => ({ ...r })), lookup = new Map(), filter = 'all', page = 1, updatedAt = '', db;
  let matrix = [], sheets = [], headerRow = 0, pendingImport = null, importName = '', toastTimer, inputTimer;
  let batchResults = [], batchTimer;
  const formatCost = value => value == null ? '' : (value / 100).toFixed(4).replace(/\.?0+$/, '');
  const costNumberFormat = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 4, useGrouping: false });
  const formatCostDisplay = value => value == null ? '—' : costNumberFormat.format(value / 100);
  const marginNumberFormat = new Intl.NumberFormat('zh-CN', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
  const formatMargin = value => value == null ? '—' : marginNumberFormat.format(value);
  const marginHint = row => row.sale === null ? '缺少聚水潭卖价' : row.cost === null ? '缺少聚水潭成本' : row.sale === 0 ? '聚水潭卖价为 0，无法计算毛利' : `（${C.formatMoney(row.sale)} − ${formatCostDisplay(row.cost)}）÷ ${C.formatMoney(row.sale)}`;
  function reductionMarkup(row, index) {
    if (row.difference === null) return '—';
    const amount = C.formatMoney(row.difference);
    return `<span class="reduction-copy-wrap"><span class="reduction-amount">${amount}</span><button type="button" class="reduction-cell-copy" data-copy-reduction-row="${index}" title="复制本行减钱 ${amount}" aria-label="复制 ${esc(row.skuName || row.code)} 的减钱 ${amount}"><svg class="copy-icon" width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="7" y="7" width="9" height="10" rx="1.5" stroke="currentColor" stroke-width="1.5"/><path d="M12 4V3H4v10h1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg><svg class="copied-icon" width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m4 10 4 4 8-8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button></span>`;
  }
  const formatInput = value => value == null ? '' : C.formatMoney(value);
  const validRecords = list => Array.isArray(list) && list.every(r => typeof r.code === 'string' && r.code.trim() && ['tmall', 'sale'].every(f => r[f] === null || (Number.isSafeInteger(r[f]) && r[f] >= 0)) && (r.cost == null || (typeof r.cost === 'number' && Number.isFinite(r.cost) && r.cost >= 0)));
  function toast(message) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false; toastTimer = setTimeout(() => $('toast').hidden = true, 5000); }
  async function database() {
    if (db) return db;
    db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('sku-price-check-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('data');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('存储被其他窗口占用'));
    });
    return db;
  }
  async function restore() {
    try {
      const databaseRef = await database();
      const saved = await new Promise((resolve, reject) => {
        const request = databaseRef.transaction('data', 'readonly').objectStore('data').get('catalog');
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      if (saved) { if (!validRecords(saved.records)) throw new Error('已保存的数据格式异常'); records = saved.records; updatedAt = saved.updatedAt; }
    } catch (e) { $('storage-state').textContent = '浏览器保存不可用，请导出备份'; toast('无法读取本机保存，已载入初始资料。'); }
  }
  async function persist() {
    try {
      const databaseRef = await database(); const date = new Date().toISOString();
      await new Promise((resolve, reject) => {
        const transaction = databaseRef.transaction('data', 'readwrite');
        transaction.objectStore('data').put({ records, updatedAt: date }, 'catalog');
        transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error);
      });
      updatedAt = date; $('storage-state').textContent = '更新已保存到当前浏览器'; return true;
    } catch (e) { $('storage-state').textContent = '本次更新尚未保存，请导出备份'; toast('本机保存失败，本次数据仍可查询，请导出价格备份。'); return false; }
  }
  function refresh() {
    lookup = new Map(records.map(r => [C.normalize(r.code), r]));
    const ready = records.filter(r => C.difference(r) !== null).length;
    $('catalog-count').textContent = records.length.toLocaleString();
    $('all-count').textContent = records.length.toLocaleString(); $('ready-count').textContent = ready.toLocaleString(); $('missing-count').textContent = (records.length - ready).toLocaleString();
    $('source-title').textContent = `已载入 ${records.length.toLocaleString()} 个商品编码`;
    $('source-description').textContent = !records.length ? '请先导入聚水潭商品资料；格式示例使用虚构编码' : updatedAt ? '包含本机补录及导入的价格' : '商品资料已载入，粘贴天猫价格即可计算';
    renderQuery(); renderTable(); calculateBatch();
  }
  function query(code, shouldScroll = false) {
    if (shouldScroll) document.querySelector('.utility-details').open = true;
    $('sku-input').value = code; $('suggestions').hidden = true; renderQuery();
    if (shouldScroll) document.querySelector('.query-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function renderQuery() {
    const code = C.normalize($('sku-input').value); $('clear-query').hidden = !code;
    const record = lookup.get(code);
    if (!code) { $('query-result').innerHTML = '<div class="empty-result"><h3>输入编码开始查询</h3><p>先导入聚水潭商品资料，价格齐全后即可计算减钱。</p><button class="button secondary small" data-query="DEMO-SKU-001">试查 DEMO-SKU-001</button></div>'; return; }
    if (!record) { $('query-result').innerHTML = `<div class="empty-result"><h3>未找到这个商品编码</h3><p>请核对编码是否完整，或导入对应商品资料。<br><code>${esc($('sku-input').value.trim())}</code></p><button class="button secondary small" data-new="${esc($('sku-input').value.trim())}">补录这个商品</button></div>`; return; }
    const diff = C.difference(record), missing = diff === null;
    const source = record.productName ? `${record.productName} · ${record.name}` : record.name || '未填写规格';
    const pricePanel = (label, value, meta) => `<div class="price-panel"><div class="price-label">${label}</div><div class="price-number">${value === null ? '<span class="missing-value">待补价格</span>' : `<span class="currency">¥</span>${C.formatMoney(value)}`}</div><div class="price-meta" title="${esc(meta)}">${esc(meta || '尚未提供')}</div></div>`;
    $('query-result').innerHTML = `<div class="result-section"><div class="result-heading"><div><p class="product-name">${esc(source)}</p><div class="product-code">${esc(record.code)}</div></div><span class="badge ${missing ? 'missing' : 'ready'}">${missing ? '价格待补充' : '编码匹配成功'}</span></div><div class="calculation">${pricePanel('天猫 SKU 一口价', record.tmall, record.tmallSource)}<div class="operator" aria-hidden="true">−</div>${pricePanel('聚水潭卖价', record.sale, record.jstSource)}<div class="operator" aria-hidden="true">＝</div><div class="price-panel difference-panel ${diff < 0 ? 'negative' : ''}"><div class="price-label">一口价 − 卖价</div><div class="price-number">${missing ? '<span style="font-size:22px">待补价格</span>' : `<span class="currency">¥</span>${C.formatMoney(diff)}`}</div><div class="price-meta">${missing ? (record.tmall === null ? '补录天猫一口价后即可计算' : '补录聚水潭卖价后即可计算') : diff < 0 ? '一口价低于聚水潭卖价' : '减钱 / 件'}</div></div></div><div class="result-actions"><span>${missing ? '同一编码的两项价格填写完整后自动计算。' : `${C.formatMoney(record.tmall)} − ${C.formatMoney(record.sale)} = ${C.formatMoney(diff)} 元`}</span><button class="text-button" data-edit="${esc(record.code)}">${record.tmall === null ? '补录天猫一口价' : '修改价格'}</button></div></div>`;
  }
  function suggestions() {
    const key = C.normalize($('sku-input').value), box = $('suggestions');
    if (!key || lookup.has(key)) { box.hidden = true; return; }
    const matches = []; for (const r of records) { if (C.normalize(r.code).includes(key)) matches.push(r); if (matches.length === 7) break; }
    box.innerHTML = matches.map(r => `<button type="button" data-query="${esc(r.code)}"><code>${esc(r.code)}</code><span>${esc(r.name)}</span></button>`).join(''); box.hidden = !matches.length;
  }
  function renderTable() {
    const keyword = C.normalize($('table-search').value);
    let list = records.filter(r => (filter === 'all' || (filter === 'ready' ? C.difference(r) !== null : C.difference(r) === null)) && (!keyword || C.normalize(r.code + ' ' + r.name + ' ' + (r.productName || '')).includes(keyword)));
    if (!keyword) list.sort((a, b) => Number(C.difference(a) === null) - Number(C.difference(b) === null));
    const size = 20, pages = Math.max(1, Math.ceil(list.length / size)); page = Math.min(page, pages);
    const slice = list.slice((page - 1) * size, page * size);
    const priceCell = value => value === null ? '<span class="missing-value">待补录</span>' : C.formatMoney(value);
    $('catalog-body').innerHTML = slice.length ? slice.map(r => { const diff = C.difference(r); return `<tr><td><button class="code-button" data-query="${esc(r.code)}">${esc(r.code)}</button></td><td class="spec-cell" title="${esc((r.productName || '') + ' ' + r.name)}">${esc(r.name || r.productName || '—')}</td><td class="numeric">${priceCell(r.tmall)}</td><td class="numeric">${priceCell(r.sale)}</td><td class="numeric ${diff === null ? 'missing-value' : diff < 0 ? 'negative-value' : 'positive-value'}">${diff === null ? '—' : C.formatMoney(diff)}</td><td class="last-col"><button class="row-edit" data-edit="${esc(r.code)}" aria-label="编辑 ${esc(r.code)} 的价格">编辑</button></td></tr>`; }).join('') : '<tr><td colspan="6" style="text-align:center;padding:40px">没有符合条件的商品</td></tr>';
    $('table-summary').textContent = `共 ${list.length.toLocaleString()} 条 · 每页 ${size} 条`;
    $('page-number').textContent = `${page} / ${pages}`; $('prev-page').disabled = page === 1; $('next-page').disabled = page === pages;
  }
  function calculateBatch() {
    clearTimeout(batchTimer); batchTimer = null;
    const text = $('tmall-paste').value.trim();
    try {
      batchResults = text ? C.calculatePaste(text, records) : [];
      const success = batchResults.filter(r => r.difference !== null).length;
      const missingNameRows = batchResults.flatMap((r, index) => r.skuName.trim() ? [] : [index + 1]);
      const missingNames = missingNameRows.length;
      $('batch-count').textContent = batchResults.length.toLocaleString();
      $('batch-summary').textContent = text ? (batchResults.length ? `已计算 ${success} 条${batchResults.length > success ? `，另有 ${batchResults.length - success} 条待核对` : ''}${missingNames ? ` · ${missingNames} 条未提供天猫 SKU 名称` : ''} · 同一编码的不同 SKU 分行显示` : '未识别到价格与编码，请粘贴 SKU 名称、价格和商家编码，可点击“填入格式示例”查看格式。') : '减钱 = 天猫价格 − 聚水潭卖价 · 按天猫 SKU 名称对照单品宝';
      $('batch-empty').hidden = !!batchResults.length; $('batch-table-wrap').hidden = !batchResults.length;
      $('copy-results').disabled = !batchResults.length;
      $('copy-name-reduction').disabled = !batchResults.length || missingNames > 0 || success !== batchResults.length;
      $('copy-name-reduction').title = missingNames ? `第 ${missingNameRows.slice(0, 8).join('、')}${missingNames > 8 ? ' 等' : ''} 行缺少天猫 SKU 名称，请补充后复制` : success !== batchResults.length ? '有尚未计算的 SKU，请先核对价格或编码' : '一次复制名称和减钱两列，每个 SKU 一行，不含表头';
      $('copy-reduction').disabled = !batchResults.length || success !== batchResults.length;
      $('copy-reduction').title = batchResults.length && success !== batchResults.length ? '有尚未计算的 SKU，请先核对价格或编码，以免复制后行序错位' : '仅复制金额，每行一个，不含表头，保持当前 SKU 顺序';
      $('batch-body').innerHTML = batchResults.map((r, index) => `<tr class="${r.difference === null ? 'batch-error-row' : ''}"><td class="batch-sku-name">${r.skuName ? `<strong>${esc(r.skuName)}</strong>` : `<span class="missing-value">未提供天猫 SKU 名称</span>${r.catalogName ? `<small>聚水潭参考规格：${esc(r.catalogName)}</small>` : ''}`}</td><td class="numeric batch-reduction ${r.difference === null ? 'missing-value' : r.difference < 0 ? 'negative-value' : 'positive-value'}">${reductionMarkup(r, index)}</td><td class="batch-code">${esc(r.code)}</td><td class="numeric batch-tmall">${C.formatMoney(r.tmall)}</td><td class="numeric batch-cost">${formatCostDisplay(r.cost)}</td><td class="numeric batch-sale">${C.formatMoney(r.sale)}</td><td class="numeric batch-margin ${r.jstMargin === null ? 'missing-value' : r.jstMargin < 0 ? 'negative-value' : ''}" title="${esc(marginHint(r))}">${formatMargin(r.jstMargin)}</td><td class="batch-match"><span class="batch-status ${r.difference === null ? '' : 'good'}">${esc(r.status)}</span></td></tr>`).join('');
    } catch (e) { batchResults = []; $('batch-count').textContent = '0'; $('batch-summary').textContent = e.message; $('copy-results').disabled = true; $('copy-reduction').disabled = true; $('copy-name-reduction').disabled = true; $('batch-empty').hidden = false; $('batch-table-wrap').hidden = true; }
  }
  $('tmall-paste').addEventListener('input', () => { clearTimeout(batchTimer); $('copy-results').disabled = true; $('copy-reduction').disabled = true; $('copy-name-reduction').disabled = true; $('batch-body').querySelectorAll('[data-copy-reduction-row]').forEach(button => button.disabled = true); batchTimer = setTimeout(calculateBatch, 150); });
  $('calculate-paste').addEventListener('click', calculateBatch);
  $('clear-paste').addEventListener('click', () => { $('tmall-paste').value = ''; calculateBatch(); clearTimeout(toastTimer); $('toast').hidden = true; $('tmall-paste').focus(); });
  $('fill-example').addEventListener('click', () => { $('tmall-paste').value = "SKU\t价格\tsku商家编码\n演示小号\t20.00\tDEMO-SKU-001\n演示中号\t30.00\tDEMO-SKU-002\n演示大号\t40.00\tDEMO-SKU-003\n演示小号✅\t25.00\tDEMO-SKU-001\n演示中号✅\t35.00\tDEMO-SKU-002\n演示大号✅\t45.00\tDEMO-SKU-003"; calculateBatch(); });
  $('copy-results').addEventListener('click', async () => {
    const tsvCell = value => { const text = String(value ?? ''); return /["\t\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text; };
    const output = [['天猫SKU名称', '减钱', 'SKU商家编码', '天猫价格', '聚水潭成本', '聚水潭卖价', '聚水潭毛利', '匹配状态'], ...batchResults.map(r => [r.skuName, C.formatMoney(r.difference), r.code, C.formatMoney(r.tmall), formatCostDisplay(r.cost), C.formatMoney(r.sale), formatMargin(r.jstMargin), r.status])].map(r => r.map(tsvCell).join('\t')).join('\n');
    try { await navigator.clipboard.writeText(output); toast('计算结果已复制，可直接粘贴到表格'); }
    catch { toast('浏览器未允许复制，请选中结果表后复制。'); }
  });
  $('copy-reduction').addEventListener('click', async () => {
    clearTimeout(batchTimer); calculateBatch();
    if (!batchResults.length || batchResults.some(r => r.difference === null)) return;
    const output = batchResults.map(r => C.formatMoney(r.difference)).join('\n');
    try { await navigator.clipboard.writeText(output); toast(`已复制 ${batchResults.length} 行减钱金额，不含表头，顺序与 SKU 一致`); }
    catch { toast('浏览器未允许复制，请允许剪贴板访问后重试。'); }
  });
  $('copy-name-reduction').addEventListener('click', async () => {
    clearTimeout(batchTimer); calculateBatch();
    if (!batchResults.length || batchResults.some(r => !r.skuName.trim() || r.difference === null)) return;
    const tsvCell = value => { const text = String(value); return text.includes('"') ? '"' + text.replace(/"/g, '""') + '"' : text; };
    const rows = batchResults.map(r => [r.skuName.replace(/\r\n|\r|\n|\t/g, ' '), C.formatMoney(r.difference)]);
    const output = rows.map(row => row.map(tsvCell).join('\t')).join('\n');
    try { await navigator.clipboard.writeText(output); toast(`已复制 ${rows.length} 行名称和减钱，可直接粘贴为两列`); }
    catch { toast('浏览器未允许复制，请允许剪贴板访问后重试。'); }
  });
  $('batch-body').addEventListener('click', async event => {
    const button = event.target.closest('[data-copy-reduction-row]');
    if (!button || button.disabled) return;
    const row = batchResults[Number(button.dataset.copyReductionRow)];
    if (!row || row.difference === null) return;
    const amount = C.formatMoney(row.difference);
    try {
      await navigator.clipboard.writeText(amount);
      button.classList.add('is-copied'); button.title = `已复制 ${amount}`;
      toast(`已复制减钱 ${amount}`);
      setTimeout(() => { button.classList.remove('is-copied'); button.title = `复制本行减钱 ${amount}`; }, 1400);
    } catch { toast('浏览器未允许复制，请允许剪贴板访问后重试。'); }
  });
  function editRecord(code = '', isNew = false) {
    const row = isNew ? null : lookup.get(C.normalize(code));
    $('edit-original').value = row?.code || ''; $('edit-code').value = row?.code || code;
    $('edit-code').readOnly = !!row; $('edit-name').value = row?.name || '';
    $('edit-tmall').value = formatInput(row?.tmall); $('edit-sale').value = formatInput(row?.sale); $('edit-cost').value = formatCost(row?.cost);
    $('edit-title').textContent = row ? '编辑商品价格' : '新增商品'; $('edit-error').textContent = ''; $('edit-dialog').showModal();
    if (row?.tmall === null) $('edit-tmall').focus(); else if (row) $('edit-name').focus();
  }
  $('edit-form').addEventListener('submit', async event => {
    event.preventDefault(); $('edit-error').textContent = '';
    try {
      const code = $('edit-code').value.trim(), original = $('edit-original').value;
      if (!code || /[\r\n\t]/.test(code)) throw new Error('请填写有效的商品编码');
      if (!original && lookup.has(C.normalize(code))) throw new Error('这个编码已存在，请从商品表中编辑该商品');
      const prior = lookup.get(C.normalize(original)) || {};
      const item = { ...prior, code, name: $('edit-name').value.trim(), tmall: C.parseMoney($('edit-tmall').value), sale: C.parseMoney($('edit-sale').value), cost: C.parseMoney($('edit-cost').value, 4) };
      if (item.tmall !== prior.tmall) item.tmallSource = '手动补录'; if (item.sale !== prior.sale) item.jstSource = '手动补录';
      if (original) records = records.map(r => C.normalize(r.code) === C.normalize(original) ? item : r); else records.push(item);
      $('edit-dialog').close(); $('sku-input').value = code; page = 1; refresh(); if (await persist()) { toast('商品价格已保存'); refresh(); }
    } catch (e) { $('edit-error').textContent = e.message; }
  });
  function clearPreview() { pendingImport = null; $('import-preview').hidden = true; $('confirm-import').disabled = true; $('import-error').textContent = ''; }
  function sourceHelp() {
    const source = $('import-source').value;
    $('source-help').textContent = source === 'jst' ? '匹配「商品编码」与「卖价」。成本价可一并保存，不参与减钱计算。' : source === 'tmall' ? '匹配「SKU 商家编码」与该 SKU 的「一口价 / 价格」。每个编码单独一行。' : '用于恢复本工具导出的备份，包含两边价格及可选成本价。';
  }
  function openImport() { sourceHelp(); $('import-dialog').showModal(); }
  function fillHeaders() {
    clearPreview();
    if (!matrix.length) throw new Error('未读到表格内容');
    const headers = matrix[headerRow] || [];
    const source = $('import-source').value, fields = source === 'jst' ? ['code', 'sale', 'cost', 'name'] : source === 'tmall' ? ['code', 'tmall', 'name'] : ['code', 'tmall', 'sale', 'cost', 'name'];
    const titles = { code: '商品编码', name: '规格名称（可选）', tmall: '天猫一口价', sale: '聚水潭卖价', cost: '成本价（可选）' };
    $('mapping-fields').innerHTML = fields.map(field => `<label class="field">${titles[field]}<select data-map="${field}"><option value="-1">不导入此列</option>${headers.map((h, i) => `<option value="${i}">${i + 1}. ${esc(String(h || '（空表头）'))}</option>`).join('')}</select></label>`).join('');
    document.querySelectorAll('[data-map]').forEach(select => select.value = String(C.findColumn(headers, select.dataset.map, source)));
    $('import-mapping').hidden = false;
  }
  function setMatrix(rows, name) {
    matrix = rows; importName = name; headerRow = C.detectHeader(rows, $('import-source').value);
    $('header-select').innerHTML = rows.slice(0, 30).map((r, i) => `<option value="${i}">第 ${i + 1} 行：${esc(r.slice(0, 4).join(' / ').slice(0, 65))}</option>`).join('');
    $('header-select').value = String(headerRow); fillHeaders();
  }
  function prepareImport() {
    clearPreview();
    try {
      const map = { code: -1, name: -1, sale: -1, cost: -1, tmall: -1 };
      document.querySelectorAll('[data-map]').forEach(select => map[select.dataset.map] = Number(select.value));
      const result = C.buildImport(matrix.slice(headerRow + 1), map, $('import-source').value, records, importName || '粘贴导入');
      pendingImport = result;
      $('import-summary').textContent = `可导入 ${result.preview.length.toLocaleString()} 个编码：新增 ${result.added.toLocaleString()} 个，更新 ${result.changed.toLocaleString()} 个。${result.skipped ? `跳过 ${result.skipped} 行（缺编码或所需价格）。` : ''}${result.repeated ? `合并 ${result.repeated} 行相同价格的重复编码。` : ''}`;
      $('import-problems').textContent = result.problems.slice(0, 8).join('\n') + (result.problems.length > 8 ? `\n另有 ${result.problems.length - 8} 项问题，请核对源表。` : '');
      const source = $('import-source').value, fields = source === 'jst' ? ['sale', 'cost'] : source === 'tmall' ? ['tmall'] : ['tmall', 'sale', 'cost'];
      const titles = { sale: '聚水潭卖价', tmall: '天猫一口价', cost: '成本价' };
      $('preview-head').innerHTML = '<tr><th>商品编码</th>' + fields.map(f => `<th class="numeric">${titles[f]}</th>`).join('') + '</tr>';
      $('preview-body').innerHTML = result.preview.slice(0, 6).map(r => `<tr><td>${esc(r.code)}</td>${fields.map(f => `<td class="numeric">${r[f] === undefined ? '保留原值' : f === 'cost' ? formatCost(r[f]) : C.formatMoney(r[f])}</td>`).join('')}</tr>`).join('');
      $('import-preview').hidden = false; $('confirm-import').disabled = !!result.problems.length || !result.preview.length;
    } catch (e) { $('import-error').textContent = e.message; }
  }
  $('file-input').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    clearPreview(); $('import-mapping').hidden = true; matrix = []; sheets = [];
    $('file-label').textContent = '正在读取文件…';
    try {
      if (file.size > 80 * 1024 * 1024) throw new Error('文件超过 80 MB，请拆分后导入');
      if (/\.(csv|tsv|txt)$/i.test(file.name)) {
        const bytes = await file.arrayBuffer(); let text;
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { text = new TextDecoder('gb18030').decode(bytes); }
        sheets = [{ name: file.name, rows: C.parseDelimited(text) }];
      } else {
        if (!window.XLSX) throw new Error('Excel 读取组件未加载，请重新打开网页');
        const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false, nodim: true });
        sheets = workbook.SheetNames.map(name => {
          const sheet = workbook.Sheets[name];
          // Some ERP exports set !ref to A1 despite including a full table.
          let maxR = 0, maxC = 0;
          for (const address of Object.keys(sheet)) if (address[0] !== '!') { const cell = XLSX.utils.decode_cell(address); maxR = Math.max(maxR, cell.r); maxC = Math.max(maxC, cell.c); }
          sheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
          return { name, rows: XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' }) };
        });
      }
      if (!sheets.length) throw new Error('文件中没有工作表');
      $('sheet-select').innerHTML = sheets.map((s, i) => `<option value="${i}">${esc(s.name)}</option>`).join(''); $('sheet-field').hidden = sheets.length < 2;
      setMatrix(sheets[0].rows, file.name); $('file-label').textContent = file.name;
      prepareImport();
    } catch (e) { $('import-error').textContent = '读取失败：' + e.message; $('file-label').textContent = '重新选择资料文件'; }
  });
  $('read-paste').addEventListener('click', () => {
    clearPreview();
    try { if (!$('paste-input').value.trim()) throw new Error('请先粘贴含表头的商品资料'); sheets = []; $('sheet-field').hidden = true; setMatrix(C.parseDelimited($('paste-input').value), '粘贴导入'); prepareImport(); }
    catch (e) { $('import-error').textContent = e.message; }
  });
  $('sheet-select').addEventListener('change', () => { const sheet = sheets[Number($('sheet-select').value)]; setMatrix(sheet.rows, $('file-input').files[0]?.name || sheet.name); prepareImport(); });
  $('header-select').addEventListener('change', () => { headerRow = Number($('header-select').value); fillHeaders(); });
  $('import-source').addEventListener('change', () => { sourceHelp(); if (matrix.length) { headerRow = C.detectHeader(matrix, $('import-source').value); $('header-select').value = String(headerRow); fillHeaders(); } else clearPreview(); });
  $('mapping-fields').addEventListener('change', clearPreview);
  $('paste-input').addEventListener('input', clearPreview);
  $('preview-import').addEventListener('click', prepareImport);
  $('confirm-import').addEventListener('click', async () => {
    if (!pendingImport || pendingImport.problems.length || !pendingImport.preview.length) return;
    const total = pendingImport.preview.length; records = pendingImport.rows; pendingImport = null; page = 1; refresh();
    $('import-dialog').close(); $('import-preview').hidden = true; $('confirm-import').disabled = true;
    if (await persist()) { toast(`已导入 ${total.toLocaleString()} 个编码，价格已更新`); refresh(); }
  });
  $('export-data').addEventListener('click', () => {
    const csvCell = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
    const rows = [['商品编码', '规格名称', '天猫一口价', '聚水潭卖价', '聚水潭成本价'], ...records.map(r => [r.code, r.name, formatInput(r.tmall), formatInput(r.sale), formatCost(r.cost)])];
    const csv = '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a'); link.href = url; link.download = '商品价格备份_' + new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }) + '.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  });
  $('reset-data').addEventListener('click', async () => {
    if (!confirm('清空当前浏览器保存的商品资料？建议先导出价格备份。')) return;
    records = initial.map(r => ({ ...r })); updatedAt = ''; page = 1; refresh();
    if (await persist()) { toast('已清空本机商品资料'); refresh(); }
  });
  $('query-form').addEventListener('submit', event => { event.preventDefault(); $('sku-input').value = $('sku-input').value.trim(); $('suggestions').hidden = true; renderQuery(); });
  $('sku-input').addEventListener('input', () => { renderQuery(); suggestions(); });
  $('sku-input').addEventListener('keydown', event => { if (event.key === 'Escape') $('suggestions').hidden = true; });
  $('clear-query').addEventListener('click', () => { query(''); $('sku-input').focus(); });
  $('open-import').addEventListener('click', openImport); $('add-record').addEventListener('click', () => editRecord('', true));
  $('table-search').addEventListener('input', () => { clearTimeout(inputTimer); inputTimer = setTimeout(() => { page = 1; renderTable(); }, 120); });
  $('prev-page').addEventListener('click', () => { if (page > 1) { page--; renderTable(); } });
  $('next-page').addEventListener('click', () => { page++; renderTable(); });
  document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
    filter = button.dataset.filter; page = 1;
    document.querySelectorAll('[data-filter]').forEach(b => { b.classList.toggle('active', b === button); b.setAttribute('aria-pressed', String(b === button)); }); renderTable();
  }));
  document.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (button?.dataset.query !== undefined) query(button.dataset.query, !!button.closest('tbody'));
    if (button?.dataset.edit !== undefined) editRecord(button.dataset.edit);
    if (button?.dataset.new !== undefined) editRecord(button.dataset.new, true);
    if (button?.dataset.close) $(button.dataset.close).close();
    if (!event.target.closest('#query-form')) $('suggestions').hidden = true;
  });
  refresh(); await restore(); refresh();
})();
