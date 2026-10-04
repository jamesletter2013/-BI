"use strict";
var TAOAREVIEWS = (() => {
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

  // Taoa-Competitor-Collector-1.0.12/src/review-executor.mjs
  var review_executor_exports = {};
  __export(review_executor_exports, {
    collectReviewsInBackground: () => collectReviewsInBackground,
    unavailableReviews: () => unavailableReviews
  });

  // Taoa-Competitor-Collector-1.0.12/src/review-page-request.mjs
  async function reviewPageRequest(itemId, descriptor = null, contextId = "") {
    const bad = (code) => ({ ok: false, code });
    const id = (v) => typeof v === "string" && /^[1-9]\d{0,31}$/.test(v) || Number.isSafeInteger(v) && v > 0;
    const samePage = () => {
      const u = new URL(location.href);
      return u.protocol === "https:" && (u.hostname === "item.taobao.com" || u.hostname === "detail.tmall.com" || u.hostname.endsWith(".tmall.com")) && u.pathname === "/item.htm" && u.searchParams.get("id") === itemId;
    };
    const identity = () => {
      const info = window.__itempage_userinfo;
      if (!id(info?.userId) || id(info.userNumId) && String(info.userId) !== String(info.userNumId)) return null;
      return String(info.userId);
    };
    const failure = (raw) => {
      const code = Array.isArray(raw?.ret) ? raw.ret.filter((v) => typeof v === "string").join(",") : "";
      if (/SESSION_EXPIRED|SID_INVALID|AUTH_REJECT|NEED_LOGIN|NOT_LOGIN|TOKEN_EMPTY|TOKEN_EXPIRED/.test(code)) return bad("login_required");
      if (/VALIDATE|RGV587|ASSIST_FLAG|ANTI|ILLEGAL_ACCESS|ACCESS_DENIED|USER_VALIDATE/.test(code)) return bad("verification_required");
      if (/LIMIT|FREQUENT|TRAFFIC/.test(code)) return bad("rate_limited");
      return bad("upstream_unsuccessful");
    };
    try {
      if (typeof itemId !== "string" || !id(itemId) || !samePage()) return bad("product_mismatch");
      const account = identity();
      if (account === null) return bad("login_context_missing");
      if (!/^[a-f0-9-]{36}$/.test(contextId)) return bad("invalid_response_shape");
      const contexts = window.__TAOA_REVIEW_CONTEXTS__ ||= /* @__PURE__ */ new Map();
      for (const [key, value] of contexts) if (Date.now() - value.started > 864e5) contexts.delete(key);
      if (descriptor === null) contexts.set(contextId, { account, itemId, started: Date.now(), filters: [] });
      const context = contexts.get(contextId);
      if (!context || context.itemId !== itemId) return bad("document_changed");
      if (context.account !== account) return bad("account_changed");
      context.started = Date.now();
      const sdk = window.lib?.mtop;
      if (!sdk || typeof sdk.request !== "function") return bad("sdk_unavailable");
      const c = sdk.config || {};
      if (["LoginRequest", "AntiCreep", "AntiFlood", "AntiFlool"].some((k) => c[k]) || c.mainDomain && !["taobao.com", "tmall.com"].includes(c.mainDomain) || c.subDomain && c.subDomain !== "m" || c.prefix && c.prefix !== "h5api") return bad("sdk_requires_ui");
      if (descriptor === null) return { ok: true };
      const d = descriptor.data;
      const ordinary = d?.searchImpr === "-8" && d?.rateType === "";
      const pageSize = ordinary ? 50 : 20;
      if (descriptor.api !== "mtop.taobao.rate.detaillist.get" || descriptor.version !== "6.0" || d?.auctionNumId !== itemId || !Number.isInteger(d.pageNo) || d.pageNo < 1 || d.pageNo > 1e3 || !(d.searchImpr === "-8" && d.rateType === "" || ["2", "7", "1", "0", "-1"].includes(d.searchImpr) && d.rateType === d.searchImpr) || descriptor.profile !== (ordinary ? "pc-all50-v1" : "pc-filter20-v1") || d.pageSize !== pageSize || d.showTrueCount !== false || d.orderType !== "" || d.expression !== "" || d.rateSrc !== "pc_rate_list" || (ordinary ? Object.hasOwn(d, "foldFlag") || Object.hasOwn(d, "skuVids") : d.foldFlag !== "0" || d.skuVids !== "")) return bad("invalid_response_shape");
      if (!["-8", "2"].includes(d.searchImpr) && !context.filters?.includes(d.searchImpr)) return bad("filter_not_available");
      const data = {
        showTrueCount: false,
        auctionNumId: itemId,
        pageNo: d.pageNo,
        pageSize,
        rateType: d.rateType,
        searchImpr: d.searchImpr,
        orderType: "",
        expression: "",
        rateSrc: "pc_rate_list"
      };
      if (!ordinary) Object.assign(data, { skuVids: "", foldFlag: "0" });
      const obj = (v) => v && typeof v === "object" && !Array.isArray(v);
      const pick = (v, keys) => {
        const out = {};
        if (!obj(v)) return out;
        for (const key of keys) {
          if (typeof v[key] === "string") out[key] = v[key].slice(0, 5001);
          else if (typeof v[key] === "boolean" || Number.isFinite(v[key])) out[key] = v[key];
        }
        return out;
      };
      const media = (row) => ({
        feedPicPathList: [
          ...Array.isArray(row?.feedPicPathList) ? row.feedPicPathList : [],
          ...Array.isArray(row?.appendFeedPicPathList) ? row.appendFeedPicPathList : []
        ].filter((x) => typeof x === "string").slice(0, 20).map((x) => x.slice(0, 3e3)),
        video: pick(row?.video, ["cloudVideoUrl", "sourceVideoUrl"])
      });
      const minimize = (raw) => {
        if (!samePage()) return bad("product_mismatch");
        if (identity() !== account) return bad("account_changed");
        if (typeof raw === "string") {
          if (raw.length > 2e6) return bad("invalid_response_size");
          raw = JSON.parse(raw);
        }
        if (!obj(raw) || raw.api !== descriptor.api || raw.v !== descriptor.version) return bad("invalid_response_shape");
        if (!Array.isArray(raw.ret) || !raw.ret.length || !raw.ret.every((r) => typeof r === "string" && r.split("::")[0] === "SUCCESS")) return failure(raw);
        const source = raw.data;
        if (!obj(source) || !Array.isArray(source.rateList) || source.rateList.length > pageSize) return bad("invalid_response_shape");
        if (source.rateList.some((row) => row?.auctionNumId !== itemId)) return bad("product_mismatch");
        const tabTitles = { "7": "\u56FE/\u89C6\u9891", "1": "\u597D\u8BC4", "0": "\u4E2D\u8BC4", "-1": "\u5DEE\u8BC4" };
        const tabs = (Array.isArray(source.imprNewItemVOS) ? source.imprNewItemVOS : []).slice(0, 100).filter((x) => Object.hasOwn(tabTitles, x?.extraInfo?.rateType) && x.title === tabTitles[x.extraInfo.rateType] && x.extraInfo.labelType === "tab").map((x) => ({ title: x.title, status: String(x.status).slice(0, 5), extraInfo: {
          rateType: x.extraInfo.rateType,
          labelType: "tab",
          gray: x.extraInfo.gray === true || x.extraInfo.gray === "true"
        } }));
        if (d.searchImpr === "-8") context.filters = tabs.filter((x) => x.status === "1" && !x.extraInfo.gray).map((x) => x.extraInfo.rateType);
        const clean = {
          ...pick(source, [
            "hasNext",
            "total",
            "totalPage",
            "timePeriodDesc",
            "feedAllCountFuzzy",
            "feedAllCount",
            "fuzzyRateCount",
            "foldCount",
            "historyCount",
            "feedAppendCount"
          ]),
          imprNewItemVOS: tabs,
          rateList: source.rateList.map((row) => ({
            ...pick(row, ["id", "auctionNumId", "feedback", "feedbackDate", "skuValueStr", "rateType"]),
            ...media(row),
            appendedFeed: obj(row.appendedFeed) ? {
              ...pick(row.appendedFeed, ["appendedFeedback", "createTime", "intervalDay", "reply"]),
              ...media(row.appendedFeed)
            } : null
          }))
        };
        return { ok: true, source: JSON.stringify({ api: raw.api, v: raw.v, ret: ["SUCCESS::OK"], data: clean }) };
      };
      return await new Promise((resolve) => {
        let settled = false, timer;
        const finish = (value) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(value);
          }
        };
        const success = (raw) => {
          if (!settled) {
            try {
              finish(minimize(raw));
            } catch {
              finish(bad("invalid_response_shape"));
            }
          }
        };
        const reject = (raw) => finish(failure(raw));
        timer = setTimeout(() => finish(bad("request_timeout")), 22e3);
        try {
          const returned = sdk.request({
            api: descriptor.api,
            v: descriptor.version,
            data,
            appKey: "12574478",
            type: "GET",
            dataType: "jsonp",
            valueType: "string",
            ecode: 1,
            timeout: 2e4,
            H5Request: true,
            WindVaneRequest: false,
            LoginRequest: false,
            needLogin: false,
            AntiCreep: false,
            AntiFlood: false,
            AntiFlool: false
          }, success, reject);
          if (returned && typeof returned.then === "function") returned.then(success, reject);
        } catch {
          finish(bad("transport_failed"));
        }
      });
    } catch {
      return bad("transport_failed");
    }
  }

  // Taoa-Competitor-Collector-1.0.12/src/review-plan.mjs
  var REVIEW_SCOPES = Object.freeze({
    all: { label: "\u666E\u901A\u5217\u8868", code: "-8" },
    append: { label: "\u8FFD\u8BC4\u5217\u8868", code: "2" },
    media: { label: "\u56FE/\u89C6\u9891\u8865\u91C7", title: "\u56FE/\u89C6\u9891", code: "7" },
    good: { label: "\u597D\u8BC4\u8865\u91C7", title: "\u597D\u8BC4", code: "1" },
    neutral: { label: "\u4E2D\u8BC4\u8865\u91C7", title: "\u4E2D\u8BC4", code: "0" },
    bad: { label: "\u5DEE\u8BC4\u8865\u91C7", title: "\u5DEE\u8BC4", code: "-1" }
  });
  var scopeKeys = Object.keys(REVIEW_SCOPES);
  var supplementalScope = (scope) => scopeKeys.includes(scope) && !["all", "append"].includes(scope);
  function advertisedScopes(data) {
    const tabs = Array.isArray(data?.imprNewItemVOS) ? data.imprNewItemVOS.slice(0, 100) : [];
    return scopeKeys.filter((scope) => supplementalScope(scope) && tabs.some((tab) => String(tab?.status) === "1" && tab?.title === REVIEW_SCOPES[scope].title && tab?.extraInfo?.labelType === "tab" && tab.extraInfo.gray !== true && tab.extraInfo.gray !== "true" && tab.extraInfo.rateType === REVIEW_SCOPES[scope].code));
  }

  // Taoa-Competitor-Collector-1.0.12/src/review-profile.mjs
  var ALL_PROFILE = "pc-all50-v1";
  var FILTER_PROFILE = "pc-filter20-v1";
  var LEGACY_PROFILE = "pc-legacy20-v1";
  var profileFor = (scope) => scope === "all" ? ALL_PROFILE : FILTER_PROFILE;
  var pageSizeFor = (scope) => scope === "all" ? 50 : 20;
  var knownProfile = (value) => [ALL_PROFILE, FILTER_PROFILE, LEGACY_PROFILE].includes(value);

  // Taoa-Competitor-Collector-1.0.12/src/review-model.mjs
  var REVIEW_API = "mtop.taobao.rate.detaillist.get";
  var REVIEW_VERSION = "6.0";
  var REVIEW_LIMITS = Object.freeze({ pagesPerScope: 1e3, records: 1e4, elapsedMs: 2e4, batchPages: 5, bytes: 16e6 });
  var validId = (v) => typeof v === "string" && /^[1-9]\d{0,31}$/.test(v);
  var object = (v) => v && typeof v === "object" && !Array.isArray(v);
  var text = (v, max = 5e3) => typeof v === "string" ? v.trim().slice(0, max) : "";
  var count = (v) => /^(0|[1-9]\d*)$/.test(String(v)) && Number.isSafeInteger(Number(v)) ? Number(v) : null;
  var flag = (v) => v === true || v === "true" ? true : v === false || v === "false" ? false : null;
  var isDefaultReview = (v) => /该用户.{0,8}(?:未|没有).{0,8}(?:评价|评论)|系统默认(?:好评|评价)|此用户没有填写评价|^\d+天内买家未作出评价[。！!]?$/u.test(v);
  var reviewTextKind = (v) => !v ? "empty" : isDefaultReview(v) ? "default" : /^该用户觉得商品非常好[，,]给出好评[。！!]?$/u.test(v) ? "template" : "content";
  function mediaUrl(v) {
    try {
      const u = new URL(typeof v === "string" && v.startsWith("//") ? `https:${v}` : v);
      if (u.protocol !== "https:" || u.username || u.password) return "";
      return ["alicdn.com", "taobao.com", "tmall.com"].some((d) => u.hostname === d || u.hostname.endsWith(`.${d}`)) ? u.href : "";
    } catch {
      return "";
    }
  }
  var pictures = (row) => [...new Set([
    ...Array.isArray(row?.feedPicPathList) ? row.feedPicPathList : [],
    ...Array.isArray(row?.appendFeedPicPathList) ? row.appendFeedPicPathList : []
  ].map(mediaUrl).filter(Boolean))].slice(0, 20);
  var video = (row) => mediaUrl(row?.video?.cloudVideoUrl || row?.video?.sourceVideoUrl);
  function normalizeReview(row, itemId, scope, page) {
    if (!object(row) || row.auctionNumId !== itemId || !validId(row.id)) throw Object.assign(new Error("product_mismatch"), { code: "product_mismatch" });
    const a = object(row.appendedFeed) ? row.appendedFeed : null;
    const feedback = text(row.feedback);
    return {
      id: row.id,
      itemId,
      feedback,
      feedbackDate: text(row.feedbackDate, 100),
      sku: text(row.skuValueStr, 500),
      rateType: text(typeof row.rateType === "number" ? String(row.rateType) : row.rateType, 30),
      isDefault: isDefaultReview(feedback),
      textKind: reviewTextKind(feedback),
      images: pictures(row),
      video: video(row),
      append: a ? {
        feedback: text(a.appendedFeedback),
        date: text(a.createTime, 100),
        intervalDay: text(a.intervalDay, 30),
        reply: text(a.reply),
        images: pictures(a),
        video: video(a)
      } : null,
      textTruncated: [row.feedback, a?.appendedFeedback, a?.reply].some((v) => typeof v === "string" && v.length > 5e3),
      sources: [{ scope, page, profile: profileFor(scope) }]
    };
  }
  function readReviewResponse(source, itemId, scope, page) {
    let raw = source;
    if (typeof raw === "string") {
      if (raw.length > 2e6) throw Object.assign(new Error("invalid_response_size"), { code: "invalid_response_size" });
      const s = raw.trim();
      const wrapper = s.match(/^[A-Za-z_$][\w$]*\s*\(([\s\S]*)\)\s*;?$/);
      raw = JSON.parse(wrapper ? wrapper[1] : s);
    }
    const invalid = () => {
      throw Object.assign(new Error("invalid_response_shape"), { code: "invalid_response_shape" });
    };
    if (!object(raw) || raw.api !== REVIEW_API || raw.v !== REVIEW_VERSION || !Array.isArray(raw.ret) || !raw.ret.length || !raw.ret.every((r) => typeof r === "string" && r.split("::")[0] === "SUCCESS")) invalid();
    const d = raw.data;
    if (!object(d) || !Array.isArray(d.rateList) || d.rateList.length > pageSizeFor(scope)) invalid();
    const items = d.rateList.map((r) => normalizeReview(r, itemId, scope, page));
    return {
      items,
      hasNext: flag(d.hasNext),
      total: count(d.total),
      totalPage: count(d.totalPage),
      timePeriod: text(d.timePeriodDesc, 100),
      platformTotal: text(d.feedAllCountFuzzy || d.fuzzyRateCount || d.feedAllCount, 60),
      folded: count(d.foldCount),
      history: text(d.historyCount, 60),
      appendTotal: count(d.feedAppendCount),
      availableScopes: advertisedScopes(d)
    };
  }
  function mergeReview(previous, incoming) {
    if (!previous) return incoming;
    const append = incoming.append || previous.append;
    const rank = { empty: 0, default: 1, template: 2, content: 3 };
    const feedback = rank[reviewTextKind(incoming.feedback)] >= rank[reviewTextKind(previous.feedback)] ? incoming.feedback || previous.feedback : previous.feedback;
    return {
      ...previous,
      ...incoming,
      feedback,
      feedbackDate: incoming.feedbackDate || previous.feedbackDate,
      sku: incoming.sku || previous.sku,
      rateType: incoming.rateType || previous.rateType,
      images: [.../* @__PURE__ */ new Set([...previous.images, ...incoming.images])],
      video: incoming.video || previous.video,
      isDefault: isDefaultReview(feedback),
      textKind: reviewTextKind(feedback),
      append: append ? {
        ...previous.append || {},
        ...append,
        feedback: append.feedback || previous.append?.feedback || "",
        date: append.date || previous.append?.date || "",
        intervalDay: append.intervalDay || previous.append?.intervalDay || "",
        reply: append.reply || previous.append?.reply || "",
        video: append.video || previous.append?.video || "",
        images: [.../* @__PURE__ */ new Set([...previous.append?.images || [], ...append.images || []])]
      } : null,
      textTruncated: previous.textTruncated || incoming.textTruncated,
      sources: [...previous.sources, ...incoming.sources].filter((s, i, all) => all.findIndex((x) => x.scope === s.scope && x.page === s.page && x.profile === s.profile && x.scanId === s.scanId) === i).slice(-100)
    };
  }
  var REVIEW_MESSAGES = {
    range_exhausted: "\u672C\u6B21\u8BC4\u4EF7\u5165\u53E3\u5DF2\u7ED3\u675F\u6216\u505C\u6B62\uFF0C\u4ECD\u6709\u6570\u91CF\u51B2\u7A81\u6216\u5206\u9875\u7F3A\u53E3\uFF1B\u5DF2\u4FDD\u7559\u5404\u5165\u53E3\u65B0\u589E\u4E0E\u505C\u6B62\u539F\u56E0\uFF0C\u4E0D\u4EE3\u8868\u5168\u91CF\u8865\u9F50\u3002",
    batch_limit: "\u672C\u6279\u5DF2\u4FDD\u5B58\uFF0C\u5C06\u5728\u540E\u53F0\u7EE7\u7EED\u4E0B\u4E00\u6279\u3002",
    manual_paused: "\u5DF2\u6682\u505C\u5E76\u4FDD\u5B58\u9875\u7801\uFF0C\u70B9\u51FB\u7EE7\u7EED\u8BC4\u4EF7\u53EF\u63A5\u7740\u8BFB\u53D6\u3002",
    interrupted: "\u4E0A\u6B21\u91C7\u96C6\u5DF2\u4E2D\u65AD\uFF0C\u5DF2\u4FDD\u7559\u4FDD\u5B58\u7684\u9875\u7801\u4E0E\u5185\u5BB9\uFF1B\u53EF\u4E3B\u52A8\u7EE7\u7EED\u3002",
    storage_unavailable: "\u8FDB\u5EA6\u4FDD\u5B58\u5931\u8D25\uFF0C\u5DF2\u505C\u6B62\u53D1\u9001\u540E\u7EED\u8BF7\u6C42\uFF0C\u8BF7\u68C0\u67E5\u6D4F\u89C8\u5668\u5B58\u50A8\u7A7A\u95F4\u3002",
    invalid_checkpoint: "\u4FDD\u5B58\u7684\u8FDB\u5EA6\u65E0\u6CD5\u6821\u9A8C\uFF0C\u672A\u7EE7\u7EED\u8BF7\u6C42\uFF1B\u8BF7\u91CD\u65B0\u91C7\u96C6\u3002",
    done: "\u672C\u6B21\u5DF2\u63A5\u5165\u7684\u8BC4\u4EF7\u5165\u53E3\u5DF2\u8BFB\u5B8C\uFF1B\u6298\u53E0\u8303\u56F4\u672A\u786E\u8BA4\uFF0C\u4E0D\u4EE3\u8868\u7F3A\u5931\u8BC4\u4EF7\u5DF2\u5168\u90E8\u8865\u9F50\u3002\u672A\u989D\u5916\u8BF7\u6C42\u5386\u53F2\u5165\u53E3\uFF0C\u666E\u901A\u5217\u8868\u65F6\u95F4\u8303\u56F4\u4EE5\u63A5\u53E3\u6807\u6CE8\u4E3A\u51C6\u3002",
    outside_recent_scope: "\u8FD4\u56DE\u8303\u56F4\u6807\u8BB0\u4E3A\u5386\u53F2\u8BC4\u4EF7\uFF0C\u672C\u6B21\u672A\u91C7\u5165\uFF0C\u4E5F\u672A\u7EE7\u7EED\u8BE5\u5165\u53E3\u3002",
    filter_not_available: "\u5F53\u524D\u5546\u54C1\u54CD\u5E94\u672A\u63D0\u4F9B\u8BE5\u7B5B\u9009\u5165\u53E3\uFF0C\u672C\u6B21\u672A\u53D1\u9001\u8BE5\u5165\u53E3\u8BF7\u6C42\u3002",
    capture_stopped: "\u8054\u5408\u91C7\u96C6\u5DF2\u505C\u6B62\uFF0C\u8BC4\u4EF7\u672A\u7EE7\u7EED\u53D1\u9001\u8BF7\u6C42\uFF0C\u5DF2\u4FDD\u7559\u5B9E\u8BFB\u5185\u5BB9\u3002",
    sdk_unavailable: "\u5546\u54C1\u9875\u8BF7\u6C42\u7EC4\u4EF6\u5C1A\u672A\u5C31\u7EEA\uFF0C\u672C\u6B21\u672A\u8BFB\u53D6\u8BC4\u4EF7\u3002",
    sdk_requires_ui: "\u8BF7\u6C42\u7EC4\u4EF6\u53EF\u80FD\u5F39\u51FA\u767B\u5F55\u6216\u9A8C\u8BC1\u754C\u9762\uFF0C\u5DF2\u6309\u540E\u53F0\u8981\u6C42\u505C\u6B62\u3002",
    login_context_missing: "\u5546\u54C1\u9875\u672A\u63D0\u4F9B\u767B\u5F55\u4E0A\u4E0B\u6587\uFF0C\u8BF7\u786E\u8BA4\u767B\u5F55\u540E\u91CD\u8BD5\u3002",
    login_required: "\u767B\u5F55\u5DF2\u5931\u6548\uFF0C\u8BF7\u81EA\u884C\u767B\u5F55\u540E\u91CD\u65B0\u91C7\u96C6\u3002",
    verification_required: "\u63A5\u53E3\u8981\u6C42\u9A8C\u8BC1\u6216\u62D2\u7EDD\u8BBF\u95EE\uFF0C\u5DF2\u505C\u6B62\uFF0C\u672A\u7ED5\u8FC7\u9A8C\u8BC1\u3002",
    rate_limited: "\u63A5\u53E3\u9650\u6D41\uFF0C\u5DF2\u505C\u6B62\u5E76\u4FDD\u7559\u5DF2\u8BFB\u53D6\u7684\u8BC4\u4EF7\u3002",
    account_changed: "\u767B\u5F55\u8D26\u53F7\u5DF2\u53D8\u5316\uFF0C\u672C\u6B21\u91C7\u96C6\u5DF2\u505C\u6B62\u3002",
    request_timeout: "\u8BC4\u4EF7\u8BF7\u6C42\u8D85\u65F6\uFF0C\u5DF2\u4FDD\u7559\u6B64\u524D\u8BFB\u53D6\u7684\u5185\u5BB9\u3002",
    capture_timeout: "\u8BC4\u4EF7\u91C7\u96C6\u8FBE\u5230\u65F6\u95F4\u4E0A\u9650\uFF0C\u5DF2\u4FDD\u7559\u6B64\u524D\u8BFB\u53D6\u7684\u5185\u5BB9\u3002",
    product_mismatch: "\u5546\u54C1\u5DF2\u5207\u6362\u6216\u8FD4\u56DE\u5546\u54C1\u4E0D\u5339\u914D\uFF0C\u5DF2\u505C\u6B62\u4EE5\u907F\u514D\u6DF7\u5165\u5176\u4ED6\u5546\u54C1\u8BC4\u4EF7\u3002",
    document_changed: "\u5546\u54C1\u9875\u5DF2\u5237\u65B0\u6216\u5173\u95ED\uFF0C\u5DF2\u505C\u6B62\u8BC4\u4EF7\u91C7\u96C6\u3002",
    unsupported_browser: "\u6D4F\u89C8\u5668\u7F3A\u5C11\u6587\u6863\u7ED1\u5B9A\u80FD\u529B\uFF0C\u65E0\u6CD5\u5B89\u5168\u8BFB\u53D6\u8BC4\u4EF7\u3002",
    upstream_unsuccessful: "\u8BC4\u4EF7\u63A5\u53E3\u672A\u8FD4\u56DE\u6210\u529F\u7ED3\u679C\uFF0C\u4E0D\u80FD\u636E\u6B64\u5224\u5B9A\u6CA1\u6709\u8BC4\u4EF7\u3002",
    invalid_response_shape: "\u8BC4\u4EF7\u8FD4\u56DE\u683C\u5F0F\u4E0E\u5DF2\u9A8C\u8BC1\u6837\u672C\u4E0D\u540C\uFF0C\u5DF2\u505C\u6B62\u3002",
    invalid_response_size: "\u8BC4\u4EF7\u8FD4\u56DE\u8D85\u8FC7\u5B89\u5168\u5927\u5C0F\u9650\u5236\uFF0C\u5DF2\u505C\u6B62\u3002",
    transport_failed: "\u8BC4\u4EF7\u8BF7\u6C42\u6267\u884C\u5931\u8D25\uFF0C\u5176\u4ED6\u5546\u54C1\u5185\u5BB9\u4E0D\u53D7\u5F71\u54CD\u3002",
    page_limit: "\u8FBE\u5230\u672C\u6B21\u5206\u9875\u4E0A\u9650\uFF0C\u5C1A\u672A\u5168\u90E8\u8BFB\u53D6\u3002",
    record_limit: "\u8FBE\u5230\u672C\u5546\u54C1 10000 \u6761\u5B89\u5168\u4E0A\u9650\uFF0C\u5DF2\u4FDD\u7559\u5185\u5BB9\uFF0C\u672A\u5BA3\u79F0\u5168\u90E8\u8BFB\u5B8C\u3002",
    size_limit: "\u8BC4\u4EF7\u6570\u636E\u8FBE\u5230\u672C\u6B21\u5927\u5C0F\u4E0A\u9650\uFF0C\u5DF2\u4FDD\u7559\u5B9E\u8BFB\u5185\u5BB9\uFF0C\u5C1A\u672A\u5168\u90E8\u8BFB\u53D6\u3002",
    repeated_page: "\u63A5\u53E3\u91CD\u590D\u8FD4\u56DE\u5DF2\u8BFB\u5185\u5BB9\uFF0C\u5DF2\u505C\u6B62\u7FFB\u9875\uFF0C\u4E0D\u80FD\u5224\u5B9A\u8BFB\u5B8C\u3002",
    empty_page: "\u63A5\u53E3\u4ECD\u63D0\u793A\u6709\u4E0B\u4E00\u9875\u4F46\u8FD4\u56DE\u7A7A\u9875\uFF0C\u5DF2\u505C\u6B62\u3002",
    pagination_unknown: "\u63A5\u53E3\u672A\u660E\u786E\u8FD4\u56DE\u5206\u9875\u7ED3\u675F\u72B6\u6001\uFF0C\u5DF2\u4FDD\u7559\u5B9E\u8BFB\u5185\u5BB9\u3002",
    count_mismatch: "\u5DF2\u5230\u5217\u8868\u672B\u9875\uFF0C\u4F46\u5B9E\u8BFB\u6570\u91CF\u4E0E\u8BE5\u8303\u56F4\u603B\u6570\u4E0D\u4E00\u81F4\u3002"
  };
  var safeReason = (code) => Object.hasOwn(REVIEW_MESSAGES, code) ? code : "transport_failed";
  var blockedReason = (code) => ["sdk_requires_ui", "login_required", "verification_required", "rate_limited"].includes(code);
  function unavailableReviews(itemId, reason = "transport_failed") {
    reason = safeReason(reason);
    return {
      schemaVersion: 1,
      itemId,
      status: blockedReason(reason) ? "blocked" : "unavailable",
      items: [],
      scopes: [],
      capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
      message: REVIEW_MESSAGES[reason],
      diagnostics: { transport: "page-native-mtop", backgroundOnly: true, reason, requestCount: 0 }
    };
  }

  // Taoa-Competitor-Collector-1.0.12/src/review-flow.mjs
  function reviewRequest(itemId, scope, page, advertised = []) {
    if (!validId(itemId) || !scopeKeys.includes(scope) || !Number.isInteger(page) || page < 1 || page > 1e3 || supplementalScope(scope) && !advertised.includes(scope)) throw new Error("invalid_request");
    const code = REVIEW_SCOPES[scope].code;
    const data = {
      showTrueCount: false,
      auctionNumId: itemId,
      pageNo: page,
      pageSize: pageSizeFor(scope),
      rateType: scope === "all" ? "" : code,
      searchImpr: code,
      orderType: "",
      expression: "",
      rateSrc: "pc_rate_list"
    };
    if (scope !== "all") Object.assign(data, { skuVids: "", foldFlag: "0" });
    return { api: REVIEW_API, version: REVIEW_VERSION, profile: profileFor(scope), data };
  }
  var newScope = (scope) => ({
    scope,
    profile: profileFor(scope),
    pageSize: pageSizeFor(scope),
    pages: 0,
    readCount: 0,
    uniqueAdded: 0,
    total: null,
    initialTotal: null,
    totalChanged: false,
    platformTotal: "",
    timePeriod: "",
    folded: null,
    history: "",
    complete: false,
    ended: false,
    reason: "pagination_unknown",
    lastPage: null
  });
  var size = (value) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
  function freshCheckpoint(itemId) {
    return {
      version: 3,
      requestProfile: ALL_PROFILE,
      scanId: crypto.randomUUID(),
      retainedCount: 0,
      itemId,
      items: [],
      scopes: [newScope("all"), newScope("append")],
      availableScopes: [],
      discoveryDone: false,
      scopeIndex: 0,
      nextPage: 1,
      reason: "batch_limit",
      pageTrace: [],
      startedAt: (/* @__PURE__ */ new Date()).toISOString(),
      updatedAt: "",
      resumed: false
    };
  }
  function validCheckpoint(s, itemId) {
    return [1, 2, 3].includes(s?.version) && s.itemId === itemId && Array.isArray(s.items) && s.items.length <= REVIEW_LIMITS.records && s.items.every((r) => r.itemId === itemId && validId(r.id) && Array.isArray(r.sources) && r.sources.every((x) => scopeKeys.includes(x?.scope) && Number.isInteger(x.page) && x.page > 0 && x.page <= 1e3 && (s.version < 3 || knownProfile(x.profile) && (x.scanId === "legacy" || /^[a-f0-9-]{36}$/.test(x.scanId || ""))))) && new Set(s.items.map((r) => r.id)).size === s.items.length && Array.isArray(s.scopes) && s.scopes.length >= 2 && s.scopes.length <= 6 && new Set(s.scopes.map((x) => x.scope)).size === s.scopes.length && s.scopes.every((x, i) => (i < 2 ? x.scope === ["all", "append"][i] : supplementalScope(x.scope)) && Number.isInteger(x.pages) && x.pages >= 0 && x.pages <= 1e3) && (s.version === 1 ? s.scopes.length === 2 : Array.isArray(s.availableScopes) && s.availableScopes.every(supplementalScope) && s.scopes.slice(2).every((x) => s.availableScopes.includes(x.scope))) && Number.isInteger(s.scopeIndex) && s.scopeIndex >= 0 && s.scopeIndex <= s.scopes.length && Number.isInteger(s.nextPage) && s.nextPage >= 1 && s.nextPage <= 1001 && (s.version < 3 || s.requestProfile === ALL_PROFILE && /^[a-f0-9-]{36}$/.test(s.scanId || "") && Number.isInteger(s.retainedCount) && s.retainedCount >= 0 && s.retainedCount <= s.items.length && s.scopes.every((x) => x.profile === profileFor(x.scope) && x.pageSize === pageSizeFor(x.scope)));
  }
  function restartPreservingReviews(previous, itemId) {
    if (!validCheckpoint(previous, itemId)) throw Object.assign(new Error("invalid_checkpoint"), { code: "invalid_checkpoint" });
    const next = freshCheckpoint(itemId);
    next.items = structuredClone(previous.items).map((row) => ({
      ...row,
      sources: row.sources.map((source) => ({
        ...source,
        profile: previous.version < 3 ? LEGACY_PROFILE : source.profile,
        scanId: previous.version < 3 ? "legacy" : source.scanId
      }))
    }));
    next.retainedCount = next.items.length;
    next.resumed = true;
    next.previousProgress = {
      version: previous.version,
      requestProfile: previous.requestProfile || LEGACY_PROFILE,
      scopeIndex: previous.scopeIndex,
      nextPage: previous.nextPage,
      scopes: structuredClone(previous.scopes),
      pageTrace: structuredClone(previous.pageTrace || []).slice(-100)
    };
    return next;
  }
  var fromThisScan = (row, scope, s) => row.sources.some((x) => x.scope === scope && x.profile === profileFor(scope) && x.scanId === s.scanId);
  var stamp = (items, s) => items.map((row) => ({ ...row, sources: row.sources.map((x) => ({ ...x, scanId: s.scanId })) }));
  function captureFromCheckpoint(s, reason = s.reason, diagnostics = {}) {
    const complete = reason === "done" && s.scopeIndex === s.scopes.length && s.scopes.every((x) => x.complete);
    return {
      schemaVersion: 1,
      itemId: s.itemId,
      status: blockedReason(reason) ? "blocked" : complete ? s.items.length ? "complete_scope" : "empty_scope" : s.items.length ? "partial" : "unavailable",
      items: s.items,
      scopes: s.scopes,
      capturedAt: s.updatedAt || (/* @__PURE__ */ new Date()).toISOString(),
      coverage: {
        mode: "recent",
        discoveryDone: s.discoveryDone === true,
        availableScopes: s.availableScopes || [],
        requestProfile: s.requestProfile || LEGACY_PROFILE,
        retainedCount: s.retainedCount || 0,
        addedSinceStart: Math.max(0, s.items.length - (s.retainedCount || 0)),
        supplementalAdded: s.items.filter((r) => r.sources.some((x) => supplementalScope(x.scope)) && !r.sources.some((x) => ["all", "append"].includes(x.scope))).length,
        fullCoverageVerified: false
      },
      message: (REVIEW_MESSAGES[reason] || REVIEW_MESSAGES.transport_failed) + (s.resumed ? " \u5DF2\u6CBF\u7528\u672C\u5730\u8FDB\u5EA6\uFF1B\u8DE8\u6279\u5217\u8868\u53EF\u80FD\u53D8\u5316\uFF0C\u6570\u91CF\u4E0D\u4E00\u81F4\u4F1A\u5355\u72EC\u63D0\u793A\u3002" : ""),
      progress: { nextPage: s.nextPage, scope: s.scopeIndex < s.scopes.length && !s.scopes[s.scopeIndex].ended ? s.scopes[s.scopeIndex].scope : "", savedCount: s.items.length },
      pageTrace: (s.pageTrace || []).slice(-100),
      diagnostics: { transport: "page-native-mtop", backgroundOnly: true, reason, ...diagnostics }
    };
  }
  async function runReviewFlow({
    itemId,
    exchange,
    checkpoint,
    onCheckpoint = async () => {
    },
    shouldStop = () => false,
    limits = REVIEW_LIMITS,
    now = Date.now,
    refreshCapabilities = false
  }) {
    if (!validId(itemId)) return unavailableReviews(itemId, "product_mismatch");
    if (checkpoint && !validCheckpoint(checkpoint, itemId)) return unavailableReviews(itemId, "invalid_checkpoint");
    let s = checkpoint ? structuredClone(checkpoint) : freshCheckpoint(itemId);
    if (s.version < 3) s = restartPreservingReviews(s, itemId);
    if (refreshCapabilities) s.discoveryDone = false;
    if (s.reason === "count_mismatch" && s.scopeIndex < s.scopes.length) {
      s.scopes[s.scopeIndex].ended = true;
      s.scopes[s.scopeIndex].reason = "count_mismatch";
      s.scopeIndex++;
      s.nextPage = 1;
    }
    const started = now();
    let reason = "batch_limit", requests = 0;
    let merged = new Map(s.items.map((r) => [r.id, r]));
    try {
      if (!s.discoveryDone && s.scopes.some((x) => x.pages > 0)) {
        if (shouldStop()) throw Object.assign(new Error(), { code: "manual_paused" });
        requests++;
        const result = readReviewResponse(await exchange(reviewRequest(itemId, "all", 1)), itemId, "all", 1);
        if (/历史|更早|history/i.test(result.timePeriod)) throw Object.assign(new Error(), { code: "outside_recent_scope" });
        const next = structuredClone(s), draft = new Map(merged);
        next.availableScopes = [.../* @__PURE__ */ new Set([...next.availableScopes, ...result.availableScopes])];
        next.discoveryDone = true;
        for (const scope of result.availableScopes) if (!next.scopes.some((x) => x.scope === scope)) next.scopes.push(newScope(scope));
        for (const row of stamp(result.items, next)) draft.set(row.id, mergeReview(draft.get(row.id), row));
        if (draft.size > limits.records) throw Object.assign(new Error(), { code: "record_limit" });
        if (size([...draft.values()]) > limits.bytes) throw Object.assign(new Error(), { code: "size_limit" });
        next.items = [...draft.values()];
        const ordinary = next.scopes[0];
        ordinary.readCount = next.items.filter((r) => fromThisScan(r, "all", next)).length;
        ordinary.uniqueAdded = (ordinary.uniqueAdded || 0) + draft.size - merged.size;
        if (result.total !== null) {
          if (ordinary.initialTotal === null) ordinary.initialTotal = result.total;
          else if (ordinary.initialTotal !== result.total) ordinary.totalChanged = true;
          ordinary.total = result.total;
        }
        if (ordinary.ended && (ordinary.totalChanged || ordinary.total !== null && ordinary.readCount !== ordinary.total)) {
          ordinary.complete = false;
          ordinary.reason = "count_mismatch";
        }
        next.metadataRefreshes = (next.metadataRefreshes || 0) + 1;
        next.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
        try {
          await onCheckpoint(next);
        } catch {
          throw Object.assign(new Error(), { code: "storage_unavailable" });
        }
        s = next;
        merged = draft;
      }
      while (s.scopeIndex < s.scopes.length) {
        if (shouldStop()) {
          reason = "manual_paused";
          break;
        }
        if (requests >= (limits.batchPages ?? 5) || now() - started >= limits.elapsedMs) break;
        if (s.nextPage > limits.pagesPerScope) {
          reason = "page_limit";
          break;
        }
        const index = s.scopeIndex, scope = s.scopes[index].scope, page = s.nextPage;
        requests++;
        let result;
        try {
          result = readReviewResponse(await exchange(reviewRequest(itemId, scope, page, s.availableScopes)), itemId, scope, page);
        } catch (e) {
          if (e?.code !== "filter_not_available" || !supplementalScope(scope)) throw e;
          const next2 = structuredClone(s);
          Object.assign(next2.scopes[index], { ended: true, complete: false, reason: "filter_not_available" });
          next2.scopeIndex++;
          next2.nextPage = 1;
          next2.reason = "batch_limit";
          next2.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
          try {
            await onCheckpoint(next2);
          } catch {
            reason = "storage_unavailable";
            break;
          }
          s = next2;
          continue;
        }
        if (/历史|更早|history/i.test(result.timePeriod)) {
          reason = "outside_recent_scope";
          break;
        }
        const draft = new Map(merged);
        const seen = new Set(s.items.filter((r) => fromThisScan(r, scope, s)).map((r) => r.id));
        let added = 0, uniqueAdded = 0;
        for (const row of stamp(result.items, s)) {
          if (!seen.has(row.id)) {
            seen.add(row.id);
            added++;
          }
          if (!draft.has(row.id)) uniqueAdded++;
          draft.set(row.id, mergeReview(draft.get(row.id), row));
        }
        if (draft.size > limits.records) {
          reason = "record_limit";
          break;
        }
        if (size([...draft.values()]) > limits.bytes) {
          reason = "size_limit";
          break;
        }
        const next = structuredClone(s), state = next.scopes[index];
        if (scope === "all") {
          next.discoveryDone = true;
          next.availableScopes = [.../* @__PURE__ */ new Set([...next.availableScopes, ...result.availableScopes])];
          for (const extra of next.availableScopes) if (!next.scopes.some((x) => x.scope === extra)) next.scopes.push(newScope(extra));
        }
        next.items = [...draft.values()];
        state.pages = page;
        state.readCount = seen.size;
        state.uniqueAdded = (state.uniqueAdded || 0) + uniqueAdded;
        if (result.total !== null) {
          if (state.initialTotal === null) state.initialTotal = result.total;
          else if (state.initialTotal !== result.total) state.totalChanged = true;
        }
        Object.assign(state, {
          total: result.total ?? state.total,
          platformTotal: result.platformTotal || state.platformTotal,
          timePeriod: result.timePeriod || state.timePeriod,
          folded: result.folded ?? state.folded,
          history: result.history || state.history
        });
        state.lastPage = {
          page,
          profile: profileFor(scope),
          pageSize: pageSizeFor(scope),
          returned: result.items.length,
          added,
          uniqueAdded,
          hasNext: result.hasNext,
          total: result.total,
          totalPage: result.totalPage
        };
        next.pageTrace = [...next.pageTrace || [], { scope, ...state.lastPage }].slice(-100);
        reason = "batch_limit";
        next.nextPage = page + 1;
        if (page > 1 && result.items.length && !added) reason = "repeated_page";
        else if (result.hasNext === false) {
          state.ended = true;
          state.complete = !state.totalChanged && (state.total === null || seen.size === state.total);
          state.reason = state.complete ? "done" : "count_mismatch";
          next.scopeIndex++;
          next.nextPage = 1;
        } else if (result.hasNext === null) reason = "pagination_unknown";
        else if (!result.items.length) reason = "empty_page";
        if (["repeated_page", "pagination_unknown", "empty_page"].includes(reason)) {
          state.ended = true;
          state.reason = reason;
          next.scopeIndex++;
          next.nextPage = 1;
          reason = "batch_limit";
        }
        if (!state.complete && !state.ended) state.reason = reason;
        if (next.scopeIndex === next.scopes.length) reason = next.scopes.every((x) => x.complete) ? "done" : "range_exhausted";
        next.reason = reason;
        next.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
        try {
          await onCheckpoint(next);
        } catch {
          reason = "storage_unavailable";
          break;
        }
        s = next;
        merged = draft;
        if (reason !== "batch_limit") break;
      }
    } catch (e) {
      reason = safeReason(e?.code || "invalid_response_shape");
    }
    if (s.scopeIndex === s.scopes.length && ["batch_limit", "done", "range_exhausted"].includes(reason)) reason = s.scopes.every((x) => x.complete) ? "done" : "range_exhausted";
    if (shouldStop() && reason === "batch_limit") reason = "manual_paused";
    s.reason = reason;
    s.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    if (reason !== "storage_unavailable") {
      try {
        await onCheckpoint(s);
      } catch {
        reason = s.reason = "storage_unavailable";
      }
    }
    return { ...captureFromCheckpoint(s, reason, { requestCount: requests, elapsedMs: now() - started, limits }), checkpoint: s };
  }

  // Taoa-Competitor-Collector-1.0.12/src/review-executor.mjs
  var inflight = /* @__PURE__ */ new Map();
  var fail = (code) => {
    throw Object.assign(new Error(code), { code });
  };
  var productId = (value) => {
    try {
      const u = new URL(value);
      return u.protocol === "https:" && (u.hostname === "item.taobao.com" || u.hostname === "detail.tmall.com" || u.hostname.endsWith(".tmall.com")) && u.pathname === "/item.htm" ? u.searchParams.get("id") : null;
    } catch {
      return null;
    }
  };
  async function bounded(promise, ms) {
    let timer;
    try {
      return await Promise.race([promise, new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error("request_timeout"), { code: "request_timeout" })), ms);
      })]);
    } finally {
      clearTimeout(timer);
    }
  }
  function collectReviewsInBackground(tab, itemId, browser = chrome, options = {}) {
    const key = `${tab.windowId}:${itemId}`;
    if (inflight.has(key)) return inflight.get(key);
    const job = collect(tab, itemId, browser, options).finally(() => inflight.delete(key));
    inflight.set(key, job);
    return job;
  }
  async function collect(tab, itemId, browser, options) {
    const contextId = options.binding?.contextId || crypto.randomUUID();
    try {
      if (productId(tab.url) !== itemId) fail("product_mismatch");
      let bound = options.binding || null, lastCode = "sdk_unavailable";
      const freshBinding = !bound;
      const query = { url: ["https://*.taobao.com/*", "https://*.tmall.com/*"] };
      if (Number.isInteger(tab.windowId)) query.windowId = tab.windowId;
      const siblings = await browser.tabs.query(query).catch(() => []);
      const candidates = [tab, ...siblings.filter((t) => t.id !== tab.id && !t.discarded && productId(t.url) === itemId).slice(0, 5)];
      for (let round = 0; round < 3 && !bound; round++) {
        for (const candidate of candidates) {
          let live;
          try {
            live = await browser.tabs.get(candidate.id);
          } catch {
            continue;
          }
          if (productId(live.url) !== itemId) continue;
          let entries;
          try {
            entries = await bounded(browser.scripting.executeScript({
              target: { tabId: live.id, frameIds: [0] },
              world: "MAIN",
              func: reviewPageRequest,
              args: [itemId, null, contextId]
            }), 2500);
          } catch (e) {
            if (e?.code === "capture_stopped") fail("capture_stopped");
            lastCode = "document_changed";
            continue;
          }
          const entry = entries.find((x) => x.frameId === 0);
          if (!entry?.documentId) {
            lastCode = "unsupported_browser";
            continue;
          }
          if (!entry.result?.ok) {
            lastCode = safeReason(entry?.result?.code);
            if (lastCode === "sdk_requires_ui") fail(lastCode);
            continue;
          }
          bound = { tabId: live.id, documentId: entry.documentId };
          break;
        }
        if (!bound && round < 2) await new Promise((r) => setTimeout(r, 750));
      }
      if (!bound) fail(lastCode);
      let lastRequest = 0;
      const send = async (descriptor) => {
        const wait = 600 - (Date.now() - lastRequest);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        let live;
        try {
          live = await browser.tabs.get(bound.tabId);
        } catch {
          fail("document_changed");
        }
        if (productId(live.url) !== itemId) fail("product_mismatch");
        lastRequest = Date.now();
        let entries;
        try {
          entries = await bounded(browser.scripting.executeScript({
            target: { tabId: bound.tabId, documentIds: [bound.documentId] },
            world: "MAIN",
            func: reviewPageRequest,
            args: [itemId, descriptor, contextId]
          }), 24e3);
        } catch (e) {
          fail(["request_timeout", "capture_stopped"].includes(e?.code) ? e.code : "document_changed");
        }
        const entry = entries.find((x) => x.documentId === bound.documentId && x.frameId === 0);
        if (!entry) fail("document_changed");
        if (!entry.result?.ok) fail(safeReason(entry?.result?.code));
        return entry.result.source;
      };
      const result = await runReviewFlow({
        itemId,
        ...options,
        refreshCapabilities: freshBinding && options.checkpoint?.scopeIndex > 0,
        exchange: (descriptor) => browser.scheduleRequest ? browser.scheduleRequest(() => send(descriptor)) : send(descriptor)
      });
      result.diagnostics.usedExistingPage = bound.tabId !== tab.id;
      result.binding = { ...bound, contextId };
      return result;
    } catch (e) {
      const reason = safeReason(e?.code);
      return validCheckpoint(options.checkpoint, itemId) ? { ...captureFromCheckpoint(options.checkpoint, reason), checkpoint: { ...options.checkpoint, reason } } : unavailableReviews(itemId, reason);
    }
  }
  return __toCommonJS(review_executor_exports);
})();
