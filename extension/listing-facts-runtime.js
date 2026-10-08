"use strict";
var TAOALISTING = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // Taoa-Competitor-Collector-1.3.8/src/listing-facts.mjs
  var listing_facts_exports = {};
  __export(listing_facts_exports, {
    mergeListingFacts: () => mergeListingFacts,
    readPageListingFacts: () => readPageListingFacts
  });
  function readPageListingFacts(expectedItemId, diagnosticMode = false) {
    const empty = { itemId: "", categoryId: "", categoryPath: "", categorySource: "", listedAt: "", listedAtSource: "" };
    const own = (obj, key) => {
      try {
        return Object.getOwnPropertyDescriptor(obj, key)?.value;
      } catch {
        return void 0;
      }
    };
    const text = (v, max = 500) => typeof v === "string" && v.length <= max ? v.replace(/\s+/g, " ").trim() : "";
    const id = (v) => (typeof v === "string" || typeof v === "number" && Number.isSafeInteger(v)) && /^(?:[1-9]\d{0,19})$/.test(String(v)) ? String(v) : "";
    const first = (obj, keys, clean) => keys.map((k) => clean(own(obj, k))).find(Boolean) || "";
    const identity = (obj) => {
      const ids2 = [...new Set(["itemId", "item_id", "num_iid", "itemNumId", "auctionId"].map((k) => id(own(obj, k))).filter(Boolean))];
      return ids2.length > 1 ? "conflict" : ids2[0] || "";
    };
    const categoryIds = (obj) => [...new Set(["categoryId", "category_id", "cateId", "catId", "cid", "leafCategoryId", "leafCatId"].map((key) => id(own(obj, key))).filter(Boolean))];
    const categoryId = (obj) => {
      const values = categoryIds(obj);
      return values.length === 1 ? values[0] : "";
    };
    const categoryName = (v) => {
      const value = text(v).replace(/\s*[>＞›]\s*/g, " > ");
      return value && !/^\d+$/.test(value) && !/[{}<>]|https?:|暂无|未读取|未知/.test(value.replace(/ > /g, "")) ? value : "";
    };
    let pageUrl;
    try {
      pageUrl = new URL(location.href);
    } catch {
      return empty;
    }
    const expected = id(expectedItemId);
    if (!expected || pageUrl.protocol !== "https:" || !/^(?:item\.taobao\.com|(?:[^.]+\.)?tmall\.com)$/.test(pageUrl.hostname) || pageUrl.pathname !== "/item.htm" || pageUrl.searchParams.get("id") !== expected || window.top !== window) return empty;
    const categories = [], dates = [], maps = [];
    const matchedSources = [], observedDateFields = [];
    let mismatchedModels = 0, limitsReached = false;
    const noteDate = (obj, key, source, meaning) => {
      let descriptor;
      try {
        descriptor = Object.getOwnPropertyDescriptor(obj, key);
      } catch {
        return;
      }
      if (!descriptor || observedDateFields.length >= 60) return;
      observedDateFields.push({
        source,
        field: key,
        meaning,
        readable: "value" in descriptor,
        validDate: "value" in descriptor && Boolean(normalizedDate(descriptor.value))
      });
    };
    const seen = /* @__PURE__ */ new WeakSet();
    let visits = 0, mapVisits = 0, jsonBytes = 0;
    const parse = (v) => {
      if (typeof v !== "string" || !/^\s*[\[{]/.test(v)) return null;
      if (v.length > 1e6 || jsonBytes + v.length > 4e6) {
        limitsReached = true;
        return null;
      }
      jsonBytes += v.length;
      try {
        return JSON.parse(v);
      } catch {
        return null;
      }
    };
    const normalizedDate = (value) => {
      let v = typeof value === "number" ? String(value) : text(value, 60);
      if (/^\d{10}$|^\d{13}$/.test(v)) {
        const ms = Number(v) * (v.length === 10 ? 1e3 : 1);
        const d2 = new Date(ms + 8 * 36e5);
        if (!Number.isFinite(d2.getTime())) return "";
        v = d2.toISOString().slice(0, 19).replace("T", " ");
      } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(v)) {
        const prefix = v.slice(0, 10), d2 = /* @__PURE__ */ new Date(prefix + "T00:00:00Z");
        if (!Number.isFinite(d2.getTime()) || d2.toISOString().slice(0, 10) !== prefix) return "";
        const ms = Date.parse(v);
        if (!Number.isFinite(ms)) return "";
        v = new Date(ms + 8 * 36e5).toISOString().slice(0, 19).replace("T", " ");
      }
      const m = v.match(/^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
      if (!m) return "";
      const [, y, mo, da, h, mi, se] = m;
      const d = new Date(Date.UTC(+y, +mo - 1, +da));
      if (+y < 1990 || +y > (/* @__PURE__ */ new Date()).getUTCFullYear() + 1 || d.getUTCFullYear() !== +y || d.getUTCMonth() !== +mo - 1 || d.getUTCDate() !== +da || h !== void 0 && (+h > 23 || +mi > 59 || +(se || 0) > 59)) return "";
      return `${y}-${mo.padStart(2, "0")}-${da.padStart(2, "0")}${h === void 0 ? "" : ` ${h.padStart(2, "0")}:${mi}${se === void 0 ? "" : `:${se}`}`}`;
    };
    const dateFields = [
      ["first_starts_time", "\u9996\u6B21\u4E0A\u67B6"],
      ["firstListingTime", "\u9996\u6B21\u4E0A\u67B6"],
      ["firstListTime", "\u9996\u6B21\u4E0A\u67B6"],
      ["list_time", "\u4E0A\u67B6\uFF08\u975E\u9996\u6B21\u53E3\u5F84\uFF09"],
      ["listTime", "\u4E0A\u67B6\uFF08\u975E\u9996\u6B21\u53E3\u5F84\uFF09"],
      ["listingTime", "\u4E0A\u67B6"],
      ["listingDate", "\u4E0A\u67B6"],
      ["listedAt", "\u4E0A\u67B6"],
      ["putawayTime", "\u4E0A\u67B6"]
    ];
    function readItem(obj, source) {
      if (diagnosticMode && matchedSources.length < 60) matchedSources.push(source);
      const cat = own(obj, "category");
      const itemCategoryIds = [.../* @__PURE__ */ new Set([...categoryIds(obj), ...categoryIds(cat)])];
      const name = first(obj, ["categoryPath", "fullCategoryName", "categoryName", "cateName", "catName"], categoryName) || first(cat, ["categoryName", "name"], categoryName) || categoryName(cat);
      if (itemCategoryIds.length) for (const cid2 of itemCategoryIds) categories.push({ id: cid2, name, source });
      else if (name) categories.push({ id: "", name, source });
      for (const [key, meaning] of dateFields) {
        if (diagnosticMode) noteDate(obj, key, source, meaning);
        const value = normalizedDate(own(obj, key));
        if (value) dates.push({ value, key, source, meaning, rank: meaning === "\u9996\u6B21\u4E0A\u67B6" ? 0 : 1 });
      }
      if (diagnosticMode) for (const key of ["created", "gmt_create", "gmtCreate", "startTime", "starts", "releaseDate", "datePublished"]) {
        noteDate(obj, key, source, "\u53E3\u5F84\u672A\u8BC1\u5B9E\uFF0C\u4E0D\u4F5C\u4E3A\u4E0A\u67B6\u65F6\u95F4");
      }
    }
    function readMap(value, source, depth = 0, parent = "") {
      if (!value || typeof value !== "object") return;
      if (depth > 8 || maps.length >= 1e3 || mapVisits++ >= 2e3) {
        limitsReached = true;
        return;
      }
      if (Array.isArray(value)) {
        for (let i = 0; i < Math.min(value.length, 300); i++) readMap(own(value, String(i)), source, depth + 1, parent);
        return;
      }
      const cid2 = categoryId(value) || id(own(value, "id"));
      const name = first(value, ["categoryName", "cateName", "catName", "name"], categoryName);
      const pid = first(value, ["parent_cid", "parentCid", "parentId"], (v) => v === 0 || v === "0" ? "0" : id(v)) || parent;
      if (cid2 && name) maps.push({ id: cid2, name, parent: pid, source });
      for (const k of ["children", "childCategories"]) readMap(own(value, k), source, depth + 1, cid2);
    }
    function inspect(obj, source, depth = 0, bound = false, itemScope = false) {
      if (typeof obj === "string") obj = parse(obj);
      if (!obj || typeof obj !== "object" || Array.isArray(obj) || seen.has(obj)) return;
      if (depth > 9 || visits++ >= 350) {
        limitsReached = true;
        return;
      }
      seen.add(obj);
      const found = identity(obj);
      if (found && found !== expected) {
        mismatchedModels++;
        return;
      }
      const item = own(obj, "item");
      const nestedId = identity(item);
      if (nestedId && nestedId !== expected) {
        mismatchedModels++;
        return;
      }
      const matching = found === expected || nestedId === expected;
      bound ||= matching;
      if (matching || bound && itemScope) readItem(obj, source);
      if (bound) {
        for (const key of ["category", "categoryInfo", "categoryTree", "categoryList", "itemCats"]) readMap(own(obj, key), `${source}.${key}`);
        const path = own(obj, "categoryPath");
        if (Array.isArray(path) && path.length > 0 && path.length <= 10) {
          const rows = path.map((v) => ({ id: categoryId(v) || id(own(v, "id")), name: first(v, ["name", "categoryName"], categoryName) }));
          if (rows.every((v) => v.id && v.name)) maps.push(...rows.map((v, i) => ({ ...v, parent: i ? rows[i - 1].id : "0", source: `${source}.categoryPath` })));
        }
      }
      for (const key of ["data", "detail", "itemDetail", "item", "itemInfoModel", "itemInfo", "itemDO", "itemPvItem", "props", "pageData", "loaderData", "initialData"]) {
        inspect(own(obj, key), `${source}.${key}`, depth + 1, bound, /^(item|itemInfoModel|itemInfo|itemDO|itemPvItem)$/.test(key));
      }
      const stack = own(obj, "apiStack");
      if (Array.isArray(stack)) for (let i = 0; i < Math.min(stack.length, 5); i++) inspect(own(own(stack, String(i)), "value"), `${source}.apiStack`, depth + 1, bound);
    }
    const roots = ["__ICE_APP_DATA__", "__INIT_DATA__", "__INITIAL_STATE__", "__PRELOADED_STATE__", "__NEXT_DATA__", "__SSR_DATA__", "__TAOBAO_DETAIL_DATA__", "__ITEM_DATA__", "PAGE_DATA", "pageData", "_pageData", "detailData", "itemData", "g_config", "g_bizdata"];
    for (const key of roots) inspect(own(window, key), key);
    const bid = document.querySelector('form[name="bidForm"] input[name="x_id"]');
    const bizItem = own(own(window, "g_bizdata"), "itemPvItem");
    if (id(bid?.value) === expected && !identity(bizItem) && bizItem && typeof bizItem === "object") readItem(bizItem, "g_bizdata.itemPvItem");
    for (const node of document.querySelectorAll('form[name="bidForm"]>input[name="x_id"], form[name="bidForm"]')) {
      for (const key of Object.getOwnPropertyNames(node).filter((k) => /^__react(?:Fiber|Props)\$/.test(k)).slice(0, 4)) {
        let fiber = own(node, key);
        for (let depth = 0; fiber && depth < 14; depth++, fiber = own(fiber, "return")) {
          for (const props of [fiber, own(fiber, "memoizedProps")]) {
            inspect(own(props, "detail"), "\u5546\u54C1\u8BE6\u60C5\u6A21\u578B");
            inspect(own(props, "itemDetail"), "\u5546\u54C1\u8BE6\u60C5\u6A21\u578B");
          }
        }
      }
    }
    for (const script of [...document.querySelectorAll('script[type="application/json"],script[type="application/ld+json"]')].slice(0, 20)) inspect(parse(script.textContent || ""), "\u5546\u54C1\u5185\u5D4CJSON");
    const ids = [...new Set(categories.map((v) => v.id).filter(Boolean))];
    const cid = ids.length === 1 ? ids[0] : "";
    let categoryPath = "", categorySource = "", categoryNameConflict = false;
    const options = ids.length > 1 ? [] : categories.filter((v) => v.name && (!v.id || v.id === cid));
    if (cid) {
      const grouped = /* @__PURE__ */ new Map();
      for (const row of maps) {
        const previous = grouped.get(row.id);
        if (!previous) grouped.set(row.id, row);
        else if (previous.name !== row.name || previous.parent !== row.parent) grouped.set(row.id, { conflict: true });
      }
      let current = cid, parts = [], walked = /* @__PURE__ */ new Set(), source = "";
      while (current && current !== "0" && parts.length < 10 && !walked.has(current)) {
        walked.add(current);
        const row = grouped.get(current);
        if (row?.conflict) categoryNameConflict = true;
        if (!row || row.conflict) break;
        parts.unshift(row.name);
        source ||= row.source;
        current = row.parent;
      }
      if (parts.length && (!current || current === "0")) options.push({ name: parts.join(" > "), source: `${source}\uFF08\u6309\u7C7B\u76EEID\u6620\u5C04\uFF09` });
      else if (grouped.get(cid)?.name) options.push({ name: grouped.get(cid).name, source: `${grouped.get(cid).source}\uFF08\u4EC5\u53F6\u5B50\u7C7B\u76EE\uFF09` });
    }
    const leaves = [...new Set(options.map((v) => v.name.split(" > ").at(-1)))];
    if (leaves.length === 1) {
      const best = options.sort((a, b) => b.name.split(" > ").length - a.name.split(" > ").length)[0];
      if (options.every((v) => v.name === best.name || best.name.endsWith(` > ${v.name}`))) {
        categoryPath = best.name;
        categorySource = `\u5546\u54C1\u7ED3\u6784\u5316\u6570\u636E ${best.source}`.slice(0, 120);
      }
    }
    if (options.length && !categoryPath) categoryNameConflict = true;
    const rank = Math.min(...dates.map((v) => v.rank));
    const selectedDates = dates.filter((v) => v.rank === rank);
    const uniqueDates = [...new Set(selectedDates.map((v) => v.value))];
    const date = uniqueDates.length === 1 ? selectedDates[0] : null;
    if (location.href !== pageUrl.href) return empty;
    const result = {
      itemId: expected,
      categoryId: cid,
      categoryPath,
      categorySource,
      categoryIdConflict: ids.length > 1,
      categoryNameConflict,
      listedAt: date?.value || "",
      listedAtSource: date ? `\u5546\u54C1\u7ED3\u6784\u5316\u6570\u636E ${date.key} \xB7 ${date.meaning}` : ""
    };
    if (diagnosticMode) result.diagnostics = {
      scope: "\u4EC5\u68C0\u67E5\u5F53\u524D\u5546\u54C1\u5DF2\u52A0\u8F7D\u6A21\u578B\uFF1B\u4E0D\u662F\u5B8C\u6574\u7F51\u7EDC\u54CD\u5E94\uFF0C\u7F3A\u5931\u4E0D\u4EE3\u8868\u5E73\u53F0\u6240\u6709\u63A5\u53E3\u5747\u65E0\u6B64\u5B57\u6BB5",
      matchedSources: [...new Set(matchedSources)],
      mismatchedModels,
      limitsReached,
      categoryState: ids.length > 1 ? "id_conflict" : categoryPath ? "page_name_found" : cid ? "id_only_needs_dictionary" : "not_observed",
      categoryCandidates: categories.slice(0, 30),
      pageDictionaryRows: maps.length,
      dateState: uniqueDates.length > 1 ? "date_conflict" : date ? "explicit_date_found" : observedDateFields.some((v) => !v.meaning.startsWith("\u53E3\u5F84\u672A\u8BC1\u5B9E")) ? "explicit_field_invalid_or_empty" : "not_observed",
      observedDateFields
    };
    return result;
  }
  function mergeListingFacts(capture, snapshot, expectedItemId) {
    if (!snapshot || !expectedItemId || snapshot.itemId !== expectedItemId || capture.itemId !== expectedItemId || capture.status !== "success") return capture;
    const result = { ...capture, categoryId: /^\d{1,20}$/.test(snapshot.categoryId) ? snapshot.categoryId : "" };
    if (snapshot.categoryPath) {
      const existing = String(capture.categoryPath || "");
      const leaf = (s) => s.split(/\s*[>＞›]\s*/).at(-1);
      if (!existing || leaf(existing) !== leaf(snapshot.categoryPath) || existing.split(" > ").length < snapshot.categoryPath.split(" > ").length) {
        result.categoryPath = snapshot.categoryPath;
        result.categorySource = snapshot.categorySource;
      }
    }
    if (snapshot.listedAt) {
      result.listedAt = snapshot.listedAt;
      result.listedAtSource = snapshot.listedAtSource;
    }
    return result;
  }
  return __toCommonJS(listing_facts_exports);
})();
