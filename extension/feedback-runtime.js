"use strict";
var TAOAFEEDBACK = (() => {
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

  // Taoa-Competitor-Collector-1.3.7/src/combined-executor.mjs
  var combined_executor_exports = {};
  __export(combined_executor_exports, {
    collectFeedbackInBackground: () => collectFeedbackInBackground
  });

  // Taoa-Competitor-Collector-1.3.7/src/qa-page-request.mjs
  async function qaPageRequest(itemId, descriptor = null, contextId = "", allowVerification = false) {
    const bad = (code) => ({ ok: false, code });
    const validId3 = (v) => typeof v === "string" && /^[1-9]\d{0,31}$/.test(v) || Number.isSafeInteger(v) && v > 0;
    const samePage = () => {
      const u = new URL(location.href);
      return u.protocol === "https:" && (u.hostname === "item.taobao.com" || u.hostname === "detail.tmall.com" || u.hostname.endsWith(".tmall.com")) && u.pathname === "/item.htm" && u.searchParams.get("id") === itemId;
    };
    const readIdentity = () => {
      const info = window.__itempage_userinfo;
      if (!validId3(info?.userId)) return null;
      if (validId3(info.userNumId) && String(info.userId) !== String(info.userNumId)) return null;
      return info.userId;
    };
    const configSafe = (sdk) => {
      const c = sdk.config || {};
      if (["LoginRequest", "AntiCreep", "AntiFlood", "AntiFlool"].some((k) => c[k])) return false;
      return (!c.mainDomain || ["taobao.com", "tmall.com"].includes(c.mainDomain)) && (!c.subDomain || c.subDomain === "m") && (!c.prefix || c.prefix === "h5api");
    };
    const failure = (value) => {
      const codes = Array.isArray(value?.ret) ? value.ret.filter((x) => typeof x === "string").map((x) => x.split("::")[0]).join(",") : "";
      if (/USER_INPUT_CANCEL/.test(codes)) return bad("verification_cancelled");
      if (/USER_INPUT_FAILURE/.test(codes)) return bad("verification_required");
      if (/SESSION_EXPIRED|SID_INVALID|AUTH_REJECT|NEED_LOGIN|NOT_LOGIN|TOKEN_EMPTY|TOKEN_EXPIRED/.test(codes)) return bad("login_required");
      if (/VALIDATE|RGV587|ASSIST_FLAG|USER_VALIDATE/.test(codes)) {
        let canOpenVerification = false;
        try {
          const url = new URL(value?.data?.url);
          canOpenVerification = /RGV587|ASSIST_FLAG/.test(codes) && url.protocol === "https:" && !url.username && !url.password && ["taobao.com", "tmall.com"].some((d) => url.hostname === d || url.hostname.endsWith("." + d)) && typeof window.lib?.mtop?.antiCreepRequest === "function";
        } catch {
        }
        return { ...bad("verification_required"), canOpenVerification };
      }
      if (/LIMIT|FREQUENT|TRAFFIC/.test(codes)) return bad("rate_limited");
      if (/ANTI|ILLEGAL_ACCESS|ACCESS_DENIED/.test(codes)) return bad("access_denied");
      return bad("upstream_unsuccessful");
    };
    try {
      if (typeof itemId !== "string" || !validId3(itemId) || !samePage()) return bad("product_mismatch");
      const userId = readIdentity();
      if (userId === null) return bad("login_context_missing");
      if (!/^[a-f0-9-]{36}$/.test(contextId)) return bad("invalid_response_shape");
      const contexts = window.__TAOA_QA_CONTEXTS__ ||= /* @__PURE__ */ new Map();
      for (const [key, value] of contexts) if (Date.now() - value.started > 864e5) contexts.delete(key);
      if (descriptor === null && !contexts.has(contextId)) contexts.set(contextId, { itemId, account: String(userId), started: Date.now() });
      const context = contexts.get(contextId);
      if (!context || context.itemId !== itemId) return bad("document_changed");
      if (context.account !== String(userId)) return bad("account_changed");
      context.started = Date.now();
      const sdk = window.lib?.mtop;
      if (!sdk || typeof sdk.request !== "function") return bad("sdk_unavailable");
      if (!configSafe(sdk)) return bad("sdk_requires_ui");
      if (descriptor === null) return { ok: true };
      const d = descriptor.data;
      const page = (n) => Number.isSafeInteger(n) && n >= 1 && n <= 1e3;
      let data;
      if (descriptor.api === "mtop.taobao.wdj.list.merge.search" && descriptor.version === "1.0") {
        if (d?.itemId !== itemId || !page(d.page)) return bad("invalid_request");
        data = {
          itemId,
          userId,
          pageSize: 10,
          page: d.page,
          type: "mix_group",
          tagId: "",
          extraInfo: JSON.stringify({ searchText: "" }),
          ecode: 0,
          biz: "pc"
        };
      } else if (descriptor.api === "mtop.taobao.social.ugc.post.detail" && descriptor.version === "2.0") {
        if (!validId3(d?.id) || typeof d.params !== "string") return bad("invalid_request");
        const p = JSON.parse(d.params);
        if (!page(p.pageNum) || !validId3(p.firstAnswerId)) return bad("invalid_request");
        data = { id: String(d.id), userId, params: JSON.stringify({
          pageNum: p.pageNum,
          pageSize: 10,
          firstAnswerId: String(p.firstAnswerId),
          from: "answer",
          searchFoldingList: false,
          pageVersion: "v2",
          channel: 0
        }), ecode: 0, biz: "pc" };
      } else return bad("unsupported_api");
      const record3 = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
      const pick = (v, keys) => {
        if (!record3(v)) return null;
        const o = {};
        for (const k of keys) if (typeof v[k] === "string") o[k] = v[k].slice(0, 2001);
        else if (typeof v[k] === "boolean" || Number.isFinite(v[k])) o[k] = v[k];
        return o;
      };
      const rows = (v, n, transform) => Array.isArray(v) ? v.slice(0, n).map(transform) : null;
      const minimize = (raw) => {
        if (!samePage()) return bad("product_mismatch");
        if (String(readIdentity()) !== String(userId)) return bad("account_changed");
        if (typeof raw === "string") {
          if (raw.length > 2e6) return bad("invalid_response_size");
          raw = JSON.parse(raw);
        }
        if (!record3(raw) || raw.api !== descriptor.api || raw.v !== descriptor.version) return bad("invalid_response_shape");
        if (!Array.isArray(raw.ret) || !raw.ret.length || !raw.ret.every((r) => typeof r === "string" && r.split("::")[0] === "SUCCESS")) return failure(raw);
        const s = raw.data;
        if (!record3(s)) return bad("invalid_response_shape");
        let clean;
        if (descriptor.version === "1.0") {
          if (s.item?.itemId !== itemId) return bad("product_mismatch");
          clean = {
            ...pick(s, ["questionTotal", "total", "hasNext", "foldingHasNext", "foldingCount"]),
            item: pick(s.item, ["itemId"]),
            questionList: rows(s.questionList, 201, (q) => ({
              ...pick(q, ["itemId", "questionId", "questionTitle", "answerCount"]),
              topAnswerList: rows(q?.topAnswerList, 31, (a) => pick(
                a,
                ["questionId", "answerId", "answerTitle", "isAiAnswer", "mergedAnswerHasMore"]
              ))
            }))
          };
        } else {
          if (s.refId !== itemId) return bad("product_mismatch");
          if (s.id !== data.id) return bad("detail_question_mismatch");
          clean = {
            ...pick(s, ["refId", "id", "title", "questionCount", "mergedAnswerHasMore"]),
            list: {
              ...pick(s.list, ["success", "isEnd", "nextPage", "totalCount"]),
              list: rows(s.list?.list, 31, (a) => ({
                ...pick(a, ["id", "title", "isAiAnswer", "mergedAnswerHasMore"]),
                firstCommentVO: pick(a?.firstCommentVO, ["content"])
              }))
            }
          };
        }
        return { ok: true, source: JSON.stringify({ api: raw.api, v: raw.v, ret: ["SUCCESS::OK"], data: clean }) };
      };
      return await new Promise((resolve) => {
        let settled = false;
        let timer;
        const finish = (value) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(value);
          }
        };
        const success = (raw) => {
          if (settled) return;
          try {
            finish(minimize(raw));
          } catch {
            finish(bad("invalid_response_shape"));
          }
        };
        const reject = (raw) => finish(failure(raw));
        timer = setTimeout(() => finish(bad(allowVerification ? "verification_timeout" : "request_timeout")), allowVerification ? 12e4 : 12e3);
        try {
          const returned = sdk.request({
            api: descriptor.api,
            v: descriptor.version,
            data,
            appKey: "12574478",
            type: "GET",
            dataType: "jsonp",
            ecode: 0,
            timeout: 1e4,
            H5Request: true,
            WindVaneRequest: false,
            LoginRequest: false,
            needLogin: false,
            // The platform's own inline verification dialog handles user input.
            // Never click, solve, forge a completion event, or enable redirects.
            AntiCreep: allowVerification === true,
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

  // Taoa-Competitor-Collector-1.3.7/src/qa-post-detail-reader.mjs
  var API = "mtop.taobao.social.ugc.post.detail";
  var MAX_INPUT = 2e6;
  var MAX_ANSWERS = 30;
  var record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  var text = (value) => typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  var id = (value) => typeof value === "string" && /^\d{1,32}$/.test(value) ? value : null;
  var flag = (value) => value === true || value === "true" ? true : value === false || value === "false" ? false : null;
  var count = (value) => {
    if (typeof value !== "number" && !(typeof value === "string" && /^\d+$/.test(value))) return null;
    const n = Number(value);
    return Number.isSafeInteger(n) && n >= 0 ? n : null;
  };
  function fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }
  function decodeResponse(source) {
    if (typeof source !== "string" || !source.trim() || source.length > MAX_INPUT) fail("invalid_response_size");
    const input = source.replace(/^\uFEFF/, "").trim();
    const wrapped = /^[A-Za-z_$][\w$]*\s*\(\s*([\s\S]*)\s*\)\s*;?\s*$/.exec(input);
    let payload;
    try {
      payload = JSON.parse(wrapped ? wrapped[1] : input);
    } catch {
      fail("invalid_json_or_jsonp");
    }
    if (!record(payload)) fail("invalid_response_shape");
    return payload;
  }
  function readPostDetailResponse(source, expectedItemId, { capturedAt = "" } = {}) {
    if (!id(expectedItemId)) fail("expected_product_id_required");
    const payload = decodeResponse(source);
    if (payload.api !== API) fail("unsupported_api");
    if (!Array.isArray(payload.ret) || !payload.ret.length || !payload.ret.every((value) => typeof value === "string" && value.split("::")[0] === "SUCCESS")) {
      fail("upstream_unsuccessful");
    }
    const data = payload.data;
    if (!record(data) || !id(data.refId) || data.refId !== expectedItemId) fail("product_mismatch");
    if (!id(data.id) || !text(data.title)) fail("missing_question_identity");
    const list = data.list;
    if (!record(list) || !Array.isArray(list.list) || flag(list.success) !== true) fail("invalid_answer_list");
    const questionTitle = text(data.title).slice(0, 1e3);
    const questionTotal = count(data.questionCount);
    const answerTotal = count(list.totalCount);
    const diagnostics = {
      inputAnswerRows: list.list.length,
      duplicateAnswerIds: 0,
      conflictingAnswerIds: 0,
      skippedAnswerRows: 0,
      answerLimitReached: list.list.length > MAX_ANSWERS,
      textTruncated: questionTitle !== text(data.title),
      totalConflict: questionTotal === 0,
      replyPreviewCount: 0
    };
    const answers = [];
    const byId = /* @__PURE__ */ new Map();
    for (const row of list.list.slice(0, MAX_ANSWERS)) {
      if (!record(row) || !text(row.title)) {
        diagnostics.skippedAnswerRows++;
        continue;
      }
      const body = text(row.title);
      const answer = {
        id: id(row.id),
        text: body.slice(0, 2e3),
        isAiAnswer: flag(row.isAiAnswer),
        mergedAnswerHasMore: flag(row.mergedAnswerHasMore),
        // A comment under an answer is NOT another answer to the question.
        // Keep its parent relationship and do not retain names, avatars or tracking.
        comments: record(row.firstCommentVO) && text(row.firstCommentVO.content) ? [{ text: text(row.firstCommentVO.content).slice(0, 2e3), previewOnly: true }] : []
      };
      diagnostics.textTruncated ||= answer.text !== body || text(row.firstCommentVO?.content).length > 2e3;
      if (answer.id && byId.has(answer.id)) {
        const previous = byId.get(answer.id);
        diagnostics.duplicateAnswerIds++;
        if (previous.text !== answer.text || previous.isAiAnswer !== answer.isAiAnswer) diagnostics.conflictingAnswerIds++;
        for (const comment of answer.comments) {
          if (!previous.comments.some((c) => c.text === comment.text)) previous.comments.push(comment);
        }
        continue;
      }
      answers.push(answer);
      if (answer.id) byId.set(answer.id, answer);
    }
    diagnostics.replyPreviewCount = answers.reduce((n, answer) => n + answer.comments.length, 0);
    const ended = list.isEnd === "y" ? true : list.isEnd === "n" ? false : null;
    const answerListComplete = ended === true && answerTotal !== null && answers.length === answerTotal && answers.every((answer) => answer.id) && !diagnostics.answerLimitReached && !diagnostics.skippedAnswerRows && !diagnostics.conflictingAnswerIds && !diagnostics.textTruncated;
    const answerPagination = {
      ended,
      nextPage: ended === false ? count(list.nextPage) : null,
      reportedNextPage: count(list.nextPage),
      reportedTotal: answerTotal,
      listComplete: answerListComplete
    };
    const totalExact = questionTotal !== null && !diagnostics.totalConflict;
    const nonAiAnswers = answers.filter((answer) => answer.isAiAnswer === false);
    return {
      sourceApi: API,
      itemId: data.refId,
      question: {
        id: data.id,
        title: questionTitle,
        reportedProductQuestionTotal: questionTotal,
        reportedAnswerTotal: answerTotal,
        answers
      },
      answerPagination,
      mergedAnswerHasMore: flag(data.mergedAnswerHasMore),
      diagnostics,
      // Compatibility sample for the current workbench. No file is injected or
      // delivered to a browser. AI/unknown-origin answers remain labelled above,
      // rather than being silently presented as non-AI answers in this view.
      capture: {
        items: [{ question: questionTitle, answers: [...new Set(nonAiAnswers.map((answer) => answer.text))], answerTotal }],
        total: questionTotal,
        totalExact,
        totalLabel: questionTotal === null ? "" : String(questionTotal),
        status: totalExact && questionTotal === 1 && !diagnostics.textTruncated ? "complete" : "partial",
        capturedAt: typeof capturedAt === "string" ? capturedAt : "",
        message: "\u5DF2\u89E3\u67901\u4E2A\u95EE\u9898\u7684\u8BE6\u60C5\u54CD\u5E94\uFF1B\u5546\u54C1\u7684\u5176\u4ED6\u95EE\u9898\u4E0D\u5305\u542B\u5728\u672C\u6B21\u54CD\u5E94\u4E2D\u3002\u56DE\u7B54\u4E0B\u7684\u8DDF\u5E16\u53E6\u884C\u4FDD\u7559\uFF0C\u672A\u6DF7\u4F5C\u72EC\u7ACB\u56DE\u7B54\u3002"
      }
    };
  }

  // Taoa-Competitor-Collector-1.3.7/src/qa-list-response-reader.mjs
  var API2 = "mtop.taobao.wdj.list.merge.search";
  var MAX_QUESTIONS = 5e3;
  var MAX_PAGE_QUESTIONS = 200;
  var MAX_ANSWERS2 = 30;
  var record2 = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  var text2 = (v) => typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  var id2 = (v) => typeof v === "string" && /^\d{1,32}$/.test(v) ? v : null;
  var flag2 = (v) => v === true || v === "true" ? true : v === false || v === "false" ? false : null;
  var count2 = (v) => {
    if (typeof v !== "number" && !(typeof v === "string" && /^\d+$/.test(v))) return null;
    const n = Number(v);
    return Number.isSafeInteger(n) && n >= 0 ? n : null;
  };
  function fail2(code) {
    throw Object.assign(new Error(code), { code });
  }
  function readQuestionListResponse(source, expectedItemId) {
    if (!id2(expectedItemId)) fail2("expected_product_id_required");
    const p = decodeResponse(source);
    if (p.api !== API2) fail2("unsupported_api");
    if (!Array.isArray(p.ret) || !p.ret.length || !p.ret.every((v) => typeof v === "string" && v.split("::")[0] === "SUCCESS")) fail2("upstream_unsuccessful");
    const d = p.data;
    if (!record2(d) || !record2(d.item) || d.item.itemId !== expectedItemId) fail2("product_mismatch");
    if (!Array.isArray(d.questionList)) fail2("invalid_question_list");
    const diagnostics = {
      skippedQuestions: 0,
      skippedAnswers: 0,
      textTruncated: false,
      questionLimitReached: d.questionList.length > MAX_PAGE_QUESTIONS,
      answerLimitReached: false
    };
    const questions = [];
    for (const q of d.questionList.slice(0, MAX_PAGE_QUESTIONS)) {
      if (!record2(q)) {
        diagnostics.skippedQuestions++;
        continue;
      }
      if (q.itemId !== expectedItemId) fail2("question_product_mismatch");
      if (!id2(q.questionId) || !text2(q.questionTitle)) {
        diagnostics.skippedQuestions++;
        continue;
      }
      const title = text2(q.questionTitle).slice(0, 1e3);
      diagnostics.textTruncated ||= title !== text2(q.questionTitle);
      const preview = Array.isArray(q.topAnswerList) ? q.topAnswerList : [];
      if (!Array.isArray(q.topAnswerList)) diagnostics.skippedAnswers++;
      diagnostics.answerLimitReached ||= preview.length > MAX_ANSWERS2;
      const answers = [];
      for (const a of preview.slice(0, MAX_ANSWERS2)) {
        if (!record2(a)) {
          diagnostics.skippedAnswers++;
          continue;
        }
        if (a.questionId !== q.questionId) fail2("answer_question_mismatch");
        if (!id2(a.answerId) || !text2(a.answerTitle)) {
          diagnostics.skippedAnswers++;
          continue;
        }
        const body = text2(a.answerTitle).slice(0, 2e3);
        diagnostics.textTruncated ||= body !== text2(a.answerTitle);
        answers.push({
          id: a.answerId,
          text: body,
          isAiAnswer: flag2(a.isAiAnswer),
          mergedAnswerHasMore: flag2(a.mergedAnswerHasMore),
          comments: [],
          sources: ["list_preview"]
        });
      }
      questions.push({ id: q.questionId, title, reportedAnswerTotal: count2(q.answerCount), answers });
    }
    return {
      sourceApi: API2,
      itemId: expectedItemId,
      questions,
      diagnostics,
      totals: { questionTotal: count2(d.questionTotal), total: count2(d.total) },
      pagination: { hasNext: flag2(d.hasNext), foldingHasNext: flag2(d.foldingHasNext), foldingCount: count2(d.foldingCount) }
    };
  }
  function combineParsedQuestionResponses(pages, details, expectedItemId) {
    if (!pages.length || pages.some((p) => p.itemId !== expectedItemId) || details.some((p) => p.itemId !== expectedItemId)) fail2("product_mismatch");
    const byQuestion = /* @__PURE__ */ new Map();
    const detailCoverage = /* @__PURE__ */ new Map();
    const diagnostics = {
      conflicts: 0,
      skippedQuestions: 0,
      skippedAnswers: 0,
      textTruncated: false,
      questionLimitReached: false,
      answerLimitReached: false,
      duplicateQuestionIds: 0,
      duplicateAnswerIds: 0,
      legacyTitleCollisions: 0,
      legacyAnswerLoss: 0
    };
    const totals = /* @__PURE__ */ new Set();
    const addTotal = (n) => {
      if (n !== null) totals.add(n);
    };
    const upsertAnswers = (q, incoming) => {
      for (const answer of incoming) {
        if (!answer.id) {
          diagnostics.skippedAnswers++;
          continue;
        }
        const previous = q.answers.find((a) => a.id === answer.id);
        if (previous) {
          diagnostics.duplicateAnswerIds++;
          if (previous.text !== answer.text || previous.isAiAnswer !== null && answer.isAiAnswer !== null && previous.isAiAnswer !== answer.isAiAnswer) diagnostics.conflicts++;
          if (previous.isAiAnswer === null) previous.isAiAnswer = answer.isAiAnswer;
          if (previous.mergedAnswerHasMore === null) previous.mergedAnswerHasMore = answer.mergedAnswerHasMore;
          else if (answer.mergedAnswerHasMore !== null && previous.mergedAnswerHasMore !== answer.mergedAnswerHasMore) diagnostics.conflicts++;
          previous.sources = [.../* @__PURE__ */ new Set([...previous.sources, ...answer.sources])];
          for (const c of answer.comments) if (!previous.comments.some((x) => x.text === c.text)) previous.comments.push(c);
        } else if (q.answers.length < MAX_ANSWERS2) q.answers.push(structuredClone(answer));
        else diagnostics.answerLimitReached = true;
      }
    };
    const upsertQuestion = (incoming, fromDetail = false) => {
      let q = byQuestion.get(incoming.id);
      if (!q) {
        if (byQuestion.size >= MAX_QUESTIONS) {
          diagnostics.questionLimitReached = true;
          return null;
        }
        q = {
          id: incoming.id,
          title: incoming.title,
          reportedAnswerTotal: incoming.reportedAnswerTotal,
          answers: [],
          detailListComplete: false
        };
        byQuestion.set(q.id, q);
      } else {
        if (!fromDetail) diagnostics.duplicateQuestionIds++;
        if (q.title !== incoming.title) diagnostics.conflicts++;
        if (q.reportedAnswerTotal !== null && incoming.reportedAnswerTotal !== null && q.reportedAnswerTotal !== incoming.reportedAnswerTotal) diagnostics.conflicts++;
        if (q.reportedAnswerTotal === null) q.reportedAnswerTotal = incoming.reportedAnswerTotal;
      }
      upsertAnswers(q, incoming.answers);
      return q;
    };
    for (const p of pages) {
      addTotal(p.totals.questionTotal);
      addTotal(p.totals.total);
      diagnostics.skippedQuestions += p.diagnostics.skippedQuestions;
      diagnostics.skippedAnswers += p.diagnostics.skippedAnswers;
      for (const name of ["textTruncated", "questionLimitReached", "answerLimitReached"]) diagnostics[name] ||= p.diagnostics[name];
      for (const q of p.questions) upsertQuestion(q);
    }
    for (const detail of details) {
      if (!byQuestion.has(detail.question.id)) fail2("detail_question_not_in_list");
      addTotal(detail.question.reportedProductQuestionTotal);
      const q = upsertQuestion({
        ...detail.question,
        answers: detail.question.answers.map((a) => ({ ...a, sources: ["question_detail"] }))
      }, true);
      diagnostics.conflicts += detail.diagnostics.conflictingAnswerIds;
      diagnostics.skippedAnswers += detail.diagnostics.skippedAnswerRows;
      diagnostics.textTruncated ||= detail.diagnostics.textTruncated;
      diagnostics.answerLimitReached ||= detail.diagnostics.answerLimitReached;
      if (q) {
        let coverage = detailCoverage.get(q.id);
        if (!coverage) {
          coverage = { ids: /* @__PURE__ */ new Set(), ended: false, valid: true };
          detailCoverage.set(q.id, coverage);
        }
        for (const a of detail.question.answers) if (a.id) coverage.ids.add(a.id);
        coverage.ended = detail.answerPagination.ended === true;
        coverage.valid &&= !detail.diagnostics.skippedAnswerRows && !detail.diagnostics.answerLimitReached && !detail.diagnostics.conflictingAnswerIds && !detail.diagnostics.textTruncated && detail.question.answers.every((a) => a.id && a.mergedAnswerHasMore === false) && detail.mergedAnswerHasMore === false;
        q.detailListComplete = coverage.ended && coverage.valid && q.reportedAnswerTotal !== null && coverage.ids.size === q.reportedAnswerTotal;
      }
    }
    const questions = [...byQuestion.values()];
    const totalConflict = totals.size > 1;
    const total = totals.size === 1 ? [...totals][0] : null;
    const countConflict = total !== null && questions.length > total;
    const totalExact = total !== null && !totalConflict && !countConflict;
    const last = pages.at(-1).pagination;
    const noMoreQuestions = last.hasNext === false && last.foldingHasNext === false && last.foldingCount === 0;
    const questionListComplete = totalExact && total === questions.length && noMoreQuestions && !diagnostics.skippedQuestions && !diagnostics.questionLimitReached && !diagnostics.textTruncated && !diagnostics.conflicts;
    let knownAnswerTotal = 0;
    let allAnswerTotalsKnown = true;
    let loadedAnswerCount = 0;
    for (const q of questions) {
      if (questionListComplete && q.reportedAnswerTotal === 0 && q.answers.length === 0) q.detailListComplete = true;
      loadedAnswerCount += q.answers.length;
      if (q.reportedAnswerTotal === null) allAnswerTotalsKnown = false;
      else knownAnswerTotal += q.reportedAnswerTotal;
      if (q.reportedAnswerTotal !== null && q.answers.length > q.reportedAnswerTotal) diagnostics.conflicts++;
    }
    const answerCountsMatched = questionListComplete && !diagnostics.conflicts && !diagnostics.skippedAnswers && !diagnostics.answerLimitReached && questions.every((q) => q.reportedAnswerTotal !== null && q.answers.length === q.reportedAnswerTotal);
    const detailListsComplete = answerCountsMatched && questions.every((q) => q.detailListComplete);
    const titleSet = new Set(questions.map((q) => q.title.replace(/\s/g, "")));
    diagnostics.legacyTitleCollisions = questions.length - titleSet.size;
    const captureItems = questions.map((q) => ({
      id: q.id,
      question: q.title,
      answers: q.answers.filter((a) => a.isAiAnswer !== true).map((a) => a.text),
      answerIds: q.answers.filter((a) => a.isAiAnswer !== true).map((a) => a.id),
      answerTotal: q.reportedAnswerTotal
    }));
    diagnostics.legacyAnswerLoss = questions.reduce((n, q, i) => n + q.answers.length - captureItems[i].answers.length, 0);
    const message = `\u95EE\u9898\u5DF2\u8BFB\u53D6 ${questions.length}/${totalExact ? total : "\u672A\u77E5"}\uFF1B\u5DF2\u8BFB\u95EE\u9898\u7684\u56DE\u7B54\u5DF2\u8BFB\u53D6 ${loadedAnswerCount}/${allAnswerTotalsKnown ? knownAnswerTotal : "\u672A\u77E5"}\u3002\u5217\u8868\u56DE\u7B54\u542B\u9884\u89C8\uFF0C\u8DDF\u5E16\u5355\u72EC\u4FDD\u7559\uFF0C\u672A\u8BFB\u5230\u7684\u5185\u5BB9\u4E0D\u8865\u5199\u3002` + (totalConflict ? `\u63A5\u53E3\u603B\u6570\u53E3\u5F84\u4E0D\u4E00\u81F4\uFF08${[...totals].join(" / ")}\uFF09\uFF0C\u672A\u636E\u6B64\u63D0\u524D\u505C\u6B62\u5206\u9875\u3002` : "");
    return {
      itemId: expectedItemId,
      questions,
      diagnostics: { ...diagnostics, totalConflict, countConflict },
      coverage: {
        questionListComplete,
        loadedQuestionCount: questions.length,
        reportedQuestionTotal: total,
        loadedAnswerCount,
        reportedAnswerTotalForLoadedQuestions: allAnswerTotalsKnown ? knownAnswerTotal : null,
        answerCountsMatched,
        detailListsComplete,
        nestedRepliesComplete: false
      },
      pendingDetailQuestionIds: questions.filter((q) => !q.detailListComplete).map((q) => q.id),
      capture: {
        items: captureItems,
        total,
        totalExact,
        totalLabel: total === null ? "" : String(total),
        status: questionListComplete && !questions.length ? "empty" : detailListsComplete && !diagnostics.legacyAnswerLoss ? "complete" : questions.length ? "partial" : "unavailable",
        capturedAt: "",
        message
      }
    };
  }

  // Taoa-Competitor-Collector-1.3.7/src/qa-request-flow.mjs
  var validId = (v) => typeof v === "string" && /^\d{1,32}$/.test(v);
  var pageNumber = (v) => Number.isSafeInteger(v) && v >= 1 && v <= 1e3;
  var fail3 = (code) => {
    throw Object.assign(new Error(code), { code });
  };
  function listRequest(itemId, page = 1) {
    if (!validId(itemId) || !pageNumber(page)) fail3("invalid_list_request");
    return {
      api: "mtop.taobao.wdj.list.merge.search",
      version: "1.0",
      requiresRuntimeFields: ["userId"],
      data: {
        itemId,
        pageSize: 10,
        page,
        type: "mix_group",
        tagId: "",
        extraInfo: JSON.stringify({ searchText: "" }),
        ecode: 0,
        biz: "pc"
      }
    };
  }
  function detailRequest(questionId, firstAnswerId, pageNum = 1) {
    if (!validId(questionId) || !validId(firstAnswerId) || !pageNumber(pageNum)) fail3("invalid_detail_request");
    return {
      api: "mtop.taobao.social.ugc.post.detail",
      version: "2.0",
      requiresRuntimeFields: ["userId"],
      data: { id: questionId, params: JSON.stringify({
        pageNum,
        pageSize: 10,
        firstAnswerId,
        from: "answer",
        searchFoldingList: false,
        pageVersion: "v2",
        channel: 0
      }), ecode: 0, biz: "pc" }
    };
  }
  var freshQaCheckpoint = (itemId) => ({
    version: 1,
    itemId,
    stage: "list",
    nextListPage: 1,
    detailIndex: 0,
    nextDetailPage: 1,
    detailAttempts: 0,
    lists: [],
    details: [],
    trace: [],
    listEndReason: "",
    incompleteAnswers: false,
    reason: "batch_limit"
  });
  function validQaCheckpoint(c, itemId) {
    try {
      return c?.version === 1 && c.itemId === itemId && validId(itemId) && ["list", "details", "done"].includes(c.stage) && pageNumber(c.nextListPage) && Number.isInteger(c.detailIndex) && c.detailIndex >= 0 && c.detailIndex <= 5e3 && pageNumber(c.nextDetailPage) && Number.isInteger(c.detailAttempts) && c.detailAttempts >= 0 && c.detailAttempts <= 3 && Array.isArray(c.lists) && c.lists.length <= 500 && Array.isArray(c.details) && c.details.length <= 15e3 && Array.isArray(c.trace) && c.trace.length <= 100 && c.lists.every((p) => p.itemId === itemId && Array.isArray(p.questions) && p.totals && p.pagination && p.diagnostics && p.questions.every((q) => validId(q.id) && typeof q.title === "string" && Array.isArray(q.answers))) && c.details.every((p) => p.itemId === itemId && validId(p.question?.id) && Array.isArray(p.question?.answers) && p.answerPagination && p.diagnostics) && new TextEncoder().encode(JSON.stringify(c)).length <= 16e6;
    } catch {
      return false;
    }
  }
  function qaResultFromCheckpoint(c) {
    return c.lists.length ? combineParsedQuestionResponses(c.lists, c.details, c.itemId) : null;
  }
  var safeCodes = /* @__PURE__ */ new Set([
    "capture_stopped",
    "aborted",
    "manual_paused",
    "storage_unavailable",
    "product_mismatch",
    "question_product_mismatch",
    "answer_question_mismatch",
    "detail_question_mismatch",
    "upstream_unsuccessful",
    "invalid_response_size",
    "invalid_json_or_jsonp",
    "invalid_response_shape",
    "unsupported_api",
    "missing_question_identity",
    "invalid_answer_list",
    "invalid_question_list",
    "sdk_unavailable",
    "sdk_requires_ui",
    "login_context_missing",
    "login_required",
    "verification_required",
    "verification_cancelled",
    "verification_timeout",
    "access_denied",
    "rate_limited",
    "account_changed",
    "request_timeout",
    "capture_timeout",
    "document_changed",
    "unsupported_browser"
  ]);
  async function runQaResponseFlow({
    itemId,
    exchange,
    checkpoint,
    onCheckpoint = async () => {
    },
    shouldStop = () => false,
    signal,
    maxListPages = 500,
    maxDetailPages = 3,
    batchRequests = 5,
    batchMs = 2e4
  }) {
    if (!validId(itemId) || typeof exchange !== "function") fail3("invalid_flow_input");
    if (!Number.isInteger(maxListPages) || maxListPages < 1 || maxListPages > 500 || !Number.isInteger(maxDetailPages) || maxDetailPages < 1 || maxDetailPages > 3 || !Number.isInteger(batchRequests) || batchRequests < 1 || batchRequests > 100) fail3("invalid_flow_limits");
    if (checkpoint && !validQaCheckpoint(checkpoint, itemId)) fail3("invalid_checkpoint");
    let c = checkpoint ? structuredClone(checkpoint) : freshQaCheckpoint(itemId);
    const steps = [], started = Date.now();
    const finish = (reason) => {
      c.reason = reason;
      const result = qaResultFromCheckpoint(c);
      if (result && reason !== "done" && ["complete", "empty"].includes(result.capture.status)) result.capture.status = "partial";
      return { reason, result, steps, checkpoint: c };
    };
    const persist = async (next) => {
      if (new TextEncoder().encode(JSON.stringify(next)).length > 16e6) return false;
      try {
        await onCheckpoint(structuredClone(next));
      } catch {
        fail3("storage_unavailable");
      }
      c = next;
      return true;
    };
    try {
      while (c.stage !== "done") {
        if (signal?.aborted || shouldStop()) return finish("manual_paused");
        if (steps.length >= batchRequests || Date.now() - started >= batchMs) return finish("batch_limit");
        let request, question;
        if (c.stage === "list") request = listRequest(itemId, c.nextListPage);
        else {
          question = qaResultFromCheckpoint(c)?.questions[c.detailIndex];
          if (!question) {
            c.stage = "done";
            break;
          }
          if (question.reportedAnswerTotal === 0 && !question.answers.length || !question.answers[0]?.id) {
            c.incompleteAnswers ||= question.reportedAnswerTotal !== 0;
            c.detailIndex++;
            c.nextDetailPage = 1;
            c.detailAttempts = 0;
            continue;
          }
          request = detailRequest(question.id, question.answers[0].id, c.nextDetailPage);
        }
        const page = request.data.page ?? JSON.parse(request.data.params).pageNum;
        steps.push({ api: request.api, page });
        const source = await exchange(structuredClone(request), { signal });
        const next = structuredClone(c);
        if (c.stage === "list") {
          const parsed = readQuestionListResponse(source, itemId);
          const ids = new Set(c.lists.flatMap((p) => p.questions.map((q) => q.id)));
          const added = parsed.questions.filter((q) => !ids.has(q.id)).length;
          next.lists.push(parsed);
          next.nextListPage++;
          next.trace.push({
            kind: "list",
            page,
            returned: parsed.questions.length,
            added,
            hasNext: parsed.pagination.hasNext,
            totals: parsed.totals,
            warnings: parsed.diagnostics
          });
          if (parsed.pagination.hasNext === false) next.listEndReason = "end";
          else if (parsed.pagination.hasNext !== true) next.listEndReason = "unknown_list_pagination";
          else if (!added) next.listEndReason = "list_no_progress";
          else if (next.lists.length >= maxListPages) next.listEndReason = "list_limit";
          if (next.listEndReason) next.stage = "details";
        } else {
          const parsed = readPostDetailResponse(source, itemId);
          if (parsed.question.id !== question.id) fail3("detail_question_mismatch");
          delete parsed.capture;
          const ids = new Set(c.details.filter((p) => p.question.id === question.id).flatMap((p) => p.question.answers.map((a) => a.id)));
          const added = parsed.question.answers.filter((a) => a.id && !ids.has(a.id)).length;
          next.details.push(parsed);
          next.detailAttempts++;
          next.trace.push({
            kind: "answers",
            questionId: question.id,
            page,
            returned: parsed.question.answers.length,
            added,
            ended: parsed.answerPagination.ended,
            nextPage: parsed.answerPagination.nextPage
          });
          const more = parsed.answerPagination.nextPage, ended = parsed.answerPagination.ended === true;
          if (ended || !added || !pageNumber(more) || more <= page || next.detailAttempts >= maxDetailPages) {
            next.incompleteAnswers ||= !ended;
            next.detailIndex++;
            next.nextDetailPage = 1;
            next.detailAttempts = 0;
          } else next.nextDetailPage = more;
        }
        next.trace = next.trace.slice(-100);
        if (!await persist(next)) return finish("size_limit");
      }
      const result = qaResultFromCheckpoint(c);
      return finish(c.listEndReason !== "end" ? c.listEndReason || "partial_answers" : result?.coverage.detailListsComplete ? "done" : "partial_answers");
    } catch (error) {
      return finish(safeCodes.has(error?.code) ? error.code : "transport_failed");
    }
  }

  // Taoa-Competitor-Collector-1.3.7/src/qa-executor.mjs
  var messages = {
    batch_limit: "\u672C\u6279\u95EE\u5927\u5BB6\u5DF2\u4FDD\u5B58\uFF0C\u5C06\u81EA\u52A8\u7EE7\u7EED\u4E0B\u4E00\u6279\uFF1B\u95EE\u5927\u5BB6\u7ED3\u675F\u540E\u518D\u8BFB\u53D6\u8BC4\u4EF7\u3002",
    manual_paused: "\u5DF2\u6682\u505C\u91C7\u96C6\uFF0C\u5DF2\u4FDD\u5B58\u95EE\u5927\u5BB6\u8FDB\u5EA6\u3002",
    invalid_checkpoint: "\u95EE\u5927\u5BB6\u8FDB\u5EA6\u65E0\u6CD5\u6821\u9A8C\uFF0C\u5DF2\u4FDD\u7559\u539F\u8BB0\u5F55\uFF0C\u672A\u53D1\u9001\u8BF7\u6C42\u3002",
    storage_unavailable: "\u8FDB\u5EA6\u4FDD\u5B58\u5931\u8D25\uFF0C\u5DF2\u505C\u6B62\u81EA\u52A8\u7EE7\u7EED\uFF0C\u8BF7\u68C0\u67E5\u6D4F\u89C8\u5668\u5B58\u50A8\u3002",
    size_limit: "\u95EE\u5927\u5BB6\u8FBE\u5230\u672C\u573016MB\u5B89\u5168\u9650\u989D\uFF0C\u672A\u58F0\u660E\u5B8C\u6574\u3002",
    list_limit: "\u95EE\u5927\u5BB6\u8FBE\u5230500\u9875\u5B89\u5168\u9650\u989D\uFF0C\u672A\u58F0\u660E\u5B8C\u6574\u3002",
    capture_stopped: "\u8054\u5408\u91C7\u96C6\u5DF2\u505C\u6B62\uFF0C\u95EE\u7B54\u672A\u7EE7\u7EED\u53D1\u9001\u8BF7\u6C42\uFF0C\u5DF2\u4FDD\u7559\u5B9E\u8BFB\u5185\u5BB9\u3002",
    sdk_unavailable: "\u5546\u54C1\u9875\u5C1A\u672A\u63D0\u4F9B\u8BF7\u6C42 SDK\uFF0C\u672C\u6B21\u672A\u53D1\u9001\u95EE\u7B54\u8BF7\u6C42\u3002",
    sdk_requires_ui: "\u5546\u54C1\u9875 SDK \u914D\u7F6E\u53EF\u80FD\u5F39\u51FA\u767B\u5F55\u6216\u9A8C\u8BC1\u754C\u9762\uFF1B\u5DF2\u6309\u5168\u540E\u53F0\u8981\u6C42\u505C\u6B62\u3002",
    login_context_missing: "\u5546\u54C1\u9875\u672A\u63D0\u4F9B\u6709\u6548\u767B\u5F55\u4E0A\u4E0B\u6587\uFF0C\u8BF7\u786E\u8BA4\u5DF2\u767B\u5F55\u540E\u91CD\u65B0\u91C7\u96C6\u3002",
    login_required: "\u767B\u5F55\u5DF2\u5931\u6548\uFF0C\u8BF7\u81EA\u884C\u767B\u5F55\u540E\u91CD\u65B0\u91C7\u96C6\uFF1B\u672A\u5F39\u51FA\u767B\u5F55\u7A97\u53E3\u3002",
    verification_required: "\u63A5\u53E3\u8981\u6C42\u9A8C\u8BC1\u6216\u62D2\u7EDD\u8BBF\u95EE\uFF0C\u672C\u6B21\u5DF2\u505C\u6B62\uFF0C\u672A\u81EA\u52A8\u6253\u5F00\u9A8C\u8BC1\u754C\u9762\u3002",
    verification_cancelled: "\u4F60\u5DF2\u53D6\u6D88\u5E73\u53F0\u9A8C\u8BC1\uFF0C\u95EE\u5927\u5BB6\u8FDB\u5EA6\u5DF2\u4FDD\u7559\u3002",
    verification_timeout: "\u7B49\u5F85\u5E73\u53F0\u9A8C\u8BC1\u8D85\u8FC72\u5206\u949F\uFF0C\u5DF2\u505C\u6B62\u5E76\u4FDD\u7559\u8FDB\u5EA6\u3002",
    access_denied: "\u63A5\u53E3\u62D2\u7EDD\u8BBF\u95EE\uFF0C\u95EE\u5927\u5BB6\u8FDB\u5EA6\u5DF2\u4FDD\u7559\uFF1B\u4E0D\u81EA\u52A8\u91CD\u8BD5\u3002",
    rate_limited: "\u63A5\u53E3\u9650\u6D41\uFF0C\u672C\u6B21\u5DF2\u505C\u6B62\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002",
    account_changed: "\u91C7\u96C6\u671F\u95F4\u767B\u5F55\u8D26\u53F7\u53D1\u751F\u53D8\u5316\uFF0C\u5DF2\u505C\u6B62\u672C\u6B21\u95EE\u7B54\u91C7\u96C6\u3002",
    request_timeout: "\u95EE\u7B54\u8BF7\u6C42\u8D85\u65F6\uFF0C\u5DF2\u4FDD\u7559\u6B64\u524D\u5B9E\u8BFB\u6570\u636E\u3002",
    capture_timeout: "\u672C\u6B21\u95EE\u7B54\u91C7\u96C6\u8FBE\u5230\u65F6\u95F4\u4E0A\u9650\uFF0C\u5DF2\u4FDD\u7559\u6B64\u524D\u5B9E\u8BFB\u6570\u636E\u3002",
    product_mismatch: "\u5546\u54C1\u9875\u5DF2\u5207\u6362\uFF0C\u5DF2\u505C\u6B62\uFF0C\u672A\u6DF7\u5165\u5176\u4ED6\u5546\u54C1\u95EE\u7B54\u3002",
    document_changed: "\u5546\u54C1\u9875\u5DF2\u5237\u65B0\u3001\u5173\u95ED\u6216\u5207\u6362\uFF0C\u5DF2\u505C\u6B62\u672C\u6B21\u95EE\u7B54\u91C7\u96C6\u3002",
    unsupported_browser: "\u6D4F\u89C8\u5668\u672A\u63D0\u4F9B\u6587\u6863\u7ED1\u5B9A\u80FD\u529B\uFF0C\u65E0\u6CD5\u5B89\u5168\u6267\u884C\u95EE\u7B54\u8BF7\u6C42\u3002",
    transport_failed: "\u95EE\u7B54\u8BF7\u6C42\u6267\u884C\u5931\u8D25\uFF0C\u5176\u4ED6\u5546\u54C1\u5185\u5BB9\u4E0D\u53D7\u5F71\u54CD\u3002",
    upstream_unsuccessful: "\u95EE\u7B54\u63A5\u53E3\u672A\u8FD4\u56DE\u6210\u529F\u7ED3\u679C\uFF1B\u672A\u628A\u5931\u8D25\u5F53\u4F5C\u6CA1\u6709\u95EE\u7B54\u3002",
    invalid_response_shape: "\u95EE\u7B54\u63A5\u53E3\u8FD4\u56DE\u7ED3\u6784\u4E0D\u7B26\u5408\u5DF2\u9A8C\u8BC1\u683C\u5F0F\uFF0C\u5DF2\u505C\u6B62\u3002",
    invalid_response_size: "\u95EE\u7B54\u63A5\u53E3\u8FD4\u56DE\u6570\u636E\u8D85\u51FA\u5B89\u5168\u5927\u5C0F\uFF0C\u5DF2\u505C\u6B62\u3002",
    detail_question_mismatch: "\u56DE\u7B54\u8BE6\u60C5\u7684\u95EE\u9898 ID \u4E0D\u5339\u914D\uFF0C\u5DF2\u505C\u6B62\uFF0C\u672A\u6DF7\u5165\u5176\u4ED6\u95EE\u9898\u3002"
  };
  var safeCode = (value) => Object.hasOwn(messages, value) ? value : "transport_failed";
  var productId = (value) => {
    try {
      const u = new URL(value);
      return u.protocol === "https:" && (u.hostname === "item.taobao.com" || u.hostname.endsWith(".tmall.com")) && u.pathname === "/item.htm" ? u.searchParams.get("id") || "" : "";
    } catch {
      return "";
    }
  };
  var fail4 = (code) => {
    throw Object.assign(new Error(code), { code });
  };
  var inflight = /* @__PURE__ */ new Map();
  function bounded(promise, ms = 14e3) {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error("request_timeout"), { code: "request_timeout" })), ms);
    })]).finally(() => clearTimeout(timer));
  }
  function collectQuestionsInBackground(tab, itemId, browser = chrome, options = {}) {
    const key = `${tab.windowId}:${itemId}`;
    if (inflight.has(key)) return inflight.get(key);
    const operation = collect(tab, itemId, browser, options).finally(() => inflight.delete(key));
    inflight.set(key, operation);
    return operation;
  }
  async function collect(tab, itemId, browser, options) {
    const started = Date.now();
    let lastCode = "sdk_unavailable", usedExistingPage = false;
    let flow = null;
    let bound = options.binding || null;
    const contextId = bound?.contextId || crypto.randomUUID();
    const attempts = [];
    const unavailable = () => ({ items: [], total: null, totalExact: false, totalLabel: "", status: "unavailable", message: "" });
    try {
      if (typeof itemId !== "string" || !/^[1-9]\d{0,31}$/.test(itemId) || productId(tab.url) !== itemId) fail4("product_mismatch");
      if (options.checkpoint && !validQaCheckpoint(options.checkpoint, itemId)) fail4("invalid_checkpoint");
      const query = { url: ["https://*.taobao.com/*", "https://*.tmall.com/*"] };
      if (Number.isInteger(tab.windowId)) query.windowId = tab.windowId;
      const siblings = await browser.tabs.query(query).catch(() => []);
      const candidates = [tab, ...siblings.filter((t) => t.id !== tab.id && !t.discarded && productId(t.url) === itemId).slice(0, 5)];
      for (let round = 0; round < 3 && !bound; round++) {
        for (const candidate of candidates) {
          try {
            const live = await browser.tabs.get(candidate.id);
            if (productId(live.url) !== itemId) continue;
            const entries = await bounded(browser.scripting.executeScript({
              target: { tabId: live.id, frameIds: [0] },
              world: "MAIN",
              func: qaPageRequest,
              args: [itemId, null, contextId]
            }), 2500);
            const result = entries.find((x) => x.frameId === 0);
            if (!result?.documentId) {
              lastCode = "unsupported_browser";
              continue;
            }
            if (!result.result?.ok) {
              lastCode = safeCode(result?.result?.code);
              continue;
            }
            bound = { tabId: live.id, documentId: result.documentId, contextId };
            usedExistingPage = live.id !== tab.id;
            break;
          } catch (error) {
            if (error?.code === "capture_stopped") fail4("capture_stopped");
            lastCode = "document_changed";
          }
        }
        if (!bound && round < 2) await new Promise((r) => setTimeout(r, 1e3));
      }
      if (!bound) fail4(lastCode);
      let lastRequest = 0;
      const send = async (request) => {
        if (Date.now() - started > 12e4) fail4("capture_timeout");
        const delay = 400 - (Date.now() - lastRequest);
        if (delay > 0) await new Promise((r) => setTimeout(r, delay));
        let live;
        try {
          live = await browser.tabs.get(bound.tabId);
        } catch {
          fail4("document_changed");
        }
        if (productId(live.url) !== itemId) fail4("product_mismatch");
        let entries;
        lastRequest = Date.now();
        try {
          entries = await bounded(browser.scripting.executeScript({
            target: { tabId: bound.tabId, documentIds: [bound.documentId] },
            world: "MAIN",
            func: qaPageRequest,
            args: [itemId, request, contextId]
          }));
        } catch (error) {
          fail4(["request_timeout", "capture_stopped"].includes(error?.code) ? error.code : "document_changed");
        }
        let entry = entries.find((x) => x.documentId === bound.documentId && x.frameId === 0);
        if (!entry) fail4("document_changed");
        if (entry.result?.code === "verification_required" && entry.result.canOpenVerification === true && options.allowInteractiveVerification === true && !options.shouldStop?.()) {
          let watch, pulses = 0;
          try {
            await options.onVerification?.(true);
            if (options.shouldStop?.()) fail4("manual_paused");
            await browser.tabs.update(bound.tabId, { active: true });
            if (browser.windows?.update && Number.isInteger(live.windowId)) await browser.windows.update(live.windowId, { focused: true });
            if (options.shouldStop?.()) fail4("manual_paused");
            const stopped2 = new Promise((_, reject) => {
              watch = setInterval(() => {
                if (options.shouldStop?.()) reject(Object.assign(new Error("manual_paused"), { code: "manual_paused" }));
                if (++pulses % 10 === 0) browser.tabs.get(bound.tabId).catch(() => reject(Object.assign(new Error("document_changed"), { code: "document_changed" })));
              }, 1e3);
            });
            entries = await Promise.race([bounded(browser.scripting.executeScript({
              target: { tabId: bound.tabId, documentIds: [bound.documentId] },
              world: "MAIN",
              func: qaPageRequest,
              args: [itemId, request, contextId, true]
            }), 13e4), stopped2]);
            entry = entries.find((x) => x.documentId === bound.documentId && x.frameId === 0);
            if (!entry) fail4("document_changed");
          } catch (error) {
            fail4(safeCode(error?.code));
          } finally {
            clearInterval(watch);
            await options.onVerification?.(false);
          }
        }
        if (!entry.result?.ok) fail4(safeCode(entry.result?.code));
        return entry.result.source;
      };
      const exchange = (request) => browser.scheduleRequest ? browser.scheduleRequest(() => send(request)) : send(request);
      flow = await runQaResponseFlow({ ...options, itemId, exchange });
      lastCode = flow.reason;
      attempts.push(...flow.steps);
    } catch (error) {
      lastCode = safeCode(error?.code);
    }
    const saved = flow?.result || (validQaCheckpoint(options.checkpoint, itemId) ? qaResultFromCheckpoint(options.checkpoint) : null);
    const qa = saved?.capture || unavailable();
    qa.capturedAt = (/* @__PURE__ */ new Date()).toISOString();
    if (["login_required", "verification_required", "verification_cancelled", "verification_timeout", "access_denied", "rate_limited", "sdk_requires_ui"].includes(lastCode)) qa.status = "blocked";
    const suffix = lastCode === "done" ? qa.status === "empty" ? "\u63A5\u53E3\u5DF2\u786E\u8BA4\u6682\u65E0\u95EE\u7B54\u3002" : "\u95EE\u9898\u53CA\u4E3B\u56DE\u7B54\u5DF2\u6838\u5BF9\uFF1B\u8DDF\u5E16\u672A\u505A\u5B8C\u6574\u91C7\u96C6\u3002" : messages[lastCode] || `\u91C7\u96C6\u672A\u5168\u90E8\u5B8C\u6210\uFF08${lastCode}\uFF09\uFF0C\u53EA\u4FDD\u7559\u5DF2\u8BFB\u53D6\u5185\u5BB9\u3002`;
    qa.message = `${qa.message || ""}${suffix}`;
    qa.diagnostics = {
      transport: "page-native-mtop",
      transportImplemented: true,
      backgroundOnly: true,
      usedExistingPage,
      reason: lastCode,
      requestCount: attempts.length,
      elapsedMs: Date.now() - started,
      coverage: saved?.coverage || null,
      warnings: saved?.diagnostics || null,
      pageTrace: flow?.checkpoint?.trace || options.checkpoint?.trace || [],
      progress: flow?.checkpoint ? {
        stage: flow.checkpoint.stage,
        nextListPage: flow.checkpoint.nextListPage,
        detailIndex: flow.checkpoint.detailIndex,
        nextDetailPage: flow.checkpoint.nextDetailPage
      } : null
    };
    if (saved) qa.records = saved.questions;
    return { qa, error: "", qaCheckpoint: flow?.checkpoint || options.checkpoint, qaBinding: bound };
  }

  // Taoa-Competitor-Collector-1.3.7/src/review-page-request.mjs
  async function reviewPageRequest(itemId, descriptor = null, contextId = "", allowVerification = false) {
    const bad = (code) => ({ ok: false, code });
    const id3 = (v) => typeof v === "string" && /^[1-9]\d{0,31}$/.test(v) || Number.isSafeInteger(v) && v > 0;
    const samePage = () => {
      const u = new URL(location.href);
      return u.protocol === "https:" && (u.hostname === "item.taobao.com" || u.hostname === "detail.tmall.com" || u.hostname.endsWith(".tmall.com")) && u.pathname === "/item.htm" && u.searchParams.get("id") === itemId;
    };
    const identity = () => {
      const info = window.__itempage_userinfo;
      if (!id3(info?.userId) || id3(info.userNumId) && String(info.userId) !== String(info.userNumId)) return null;
      return String(info.userId);
    };
    const failure = (raw) => {
      const code = Array.isArray(raw?.ret) ? raw.ret.filter((v) => typeof v === "string").map((v) => v.split("::")[0]).join(",") : "";
      if (/USER_INPUT_CANCEL/.test(code)) return bad("verification_cancelled");
      if (/USER_INPUT_FAILURE/.test(code)) return bad("verification_required");
      if (/SESSION_EXPIRED|SID_INVALID|AUTH_REJECT|NEED_LOGIN|NOT_LOGIN|TOKEN_EMPTY|TOKEN_EXPIRED/.test(code)) return bad("login_required");
      if (/LIMIT|FREQUENT|TRAFFIC/.test(code)) return bad("rate_limited");
      if (/ILLEGAL_ACCESS|ACCESS_DENIED/.test(code)) return bad("access_denied");
      if (/VALIDATE|RGV587|ASSIST_FLAG|USER_VALIDATE/.test(code)) {
        let canOpenVerification = false;
        try {
          const url = new URL(raw?.data?.url);
          canOpenVerification = /RGV587|ASSIST_FLAG/.test(code) && url.protocol === "https:" && !url.username && !url.password && ["taobao.com", "tmall.com"].some((d) => url.hostname === d || url.hostname.endsWith("." + d)) && typeof window.lib?.mtop?.antiCreepRequest === "function";
        } catch {
        }
        return { ...bad("verification_required"), canOpenVerification };
      }
      if (/ANTI/.test(code)) return bad("access_denied");
      return bad("upstream_unsuccessful");
    };
    try {
      if (typeof itemId !== "string" || !id3(itemId) || !samePage()) return bad("product_mismatch");
      const account = identity();
      if (account === null) return bad("login_context_missing");
      if (!/^[a-f0-9-]{36}$/.test(contextId)) return bad("invalid_response_shape");
      const contexts = window.__TAOA_REVIEW_CONTEXTS__ ||= /* @__PURE__ */ new Map();
      for (const [key, value] of contexts) if (Date.now() - value.started > 864e5) contexts.delete(key);
      if (descriptor === null && !contexts.has(contextId)) contexts.set(contextId, { account, itemId, started: Date.now(), filters: [] });
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
        timer = setTimeout(() => finish(bad(allowVerification ? "verification_timeout" : "request_timeout")), allowVerification ? 12e4 : 22e3);
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
            // The platform's dialog receives human input; success is still parsed
            // and bound to this product/account before the cursor can advance.
            AntiCreep: allowVerification === true,
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

  // Taoa-Competitor-Collector-1.3.7/src/review-plan.mjs
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

  // Taoa-Competitor-Collector-1.3.7/src/review-profile.mjs
  var ALL_PROFILE = "pc-all50-v1";
  var FILTER_PROFILE = "pc-filter20-v1";
  var LEGACY_PROFILE = "pc-legacy20-v1";
  var profileFor = (scope) => scope === "all" ? ALL_PROFILE : FILTER_PROFILE;
  var pageSizeFor = (scope) => scope === "all" ? 50 : 20;
  var knownProfile = (value) => [ALL_PROFILE, FILTER_PROFILE, LEGACY_PROFILE].includes(value);

  // Taoa-Competitor-Collector-1.3.7/src/review-model.mjs
  var REVIEW_API = "mtop.taobao.rate.detaillist.get";
  var REVIEW_VERSION = "6.0";
  var REVIEW_LIMITS = Object.freeze({ pagesPerScope: 1e3, records: 1e4, elapsedMs: 6e4, batchPages: 20, bytes: 16e6 });
  var validId2 = (v) => typeof v === "string" && /^[1-9]\d{0,31}$/.test(v);
  var object = (v) => v && typeof v === "object" && !Array.isArray(v);
  var text3 = (v, max = 5e3) => typeof v === "string" ? v.trim().slice(0, max) : "";
  var count3 = (v) => /^(0|[1-9]\d*)$/.test(String(v)) && Number.isSafeInteger(Number(v)) ? Number(v) : null;
  var flag3 = (v) => v === true || v === "true" ? true : v === false || v === "false" ? false : null;
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
    if (!object(row) || row.auctionNumId !== itemId || !validId2(row.id)) throw Object.assign(new Error("product_mismatch"), { code: "product_mismatch" });
    const a = object(row.appendedFeed) ? row.appendedFeed : null;
    const feedback = text3(row.feedback);
    return {
      id: row.id,
      itemId,
      feedback,
      feedbackDate: text3(row.feedbackDate, 100),
      sku: text3(row.skuValueStr, 500),
      rateType: text3(typeof row.rateType === "number" ? String(row.rateType) : row.rateType, 30),
      isDefault: isDefaultReview(feedback),
      textKind: reviewTextKind(feedback),
      images: pictures(row),
      video: video(row),
      append: a ? {
        feedback: text3(a.appendedFeedback),
        date: text3(a.createTime, 100),
        intervalDay: text3(a.intervalDay, 30),
        reply: text3(a.reply),
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
      hasNext: flag3(d.hasNext),
      total: count3(d.total),
      totalPage: count3(d.totalPage),
      timePeriod: text3(d.timePeriodDesc, 100),
      platformTotal: text3(d.feedAllCountFuzzy || d.fuzzyRateCount || d.feedAllCount, 60),
      folded: count3(d.foldCount),
      history: text3(d.historyCount, 60),
      appendTotal: count3(d.feedAppendCount),
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
    verification_cancelled: "\u4F60\u5DF2\u53D6\u6D88\u5E73\u53F0\u9A8C\u8BC1\uFF0C\u8BC4\u4EF7\u8FDB\u5EA6\u5DF2\u4FDD\u7559\u3002",
    verification_timeout: "\u7B49\u5F85\u5E73\u53F0\u9A8C\u8BC1\u8D85\u8FC72\u5206\u949F\uFF0C\u5DF2\u505C\u6B62\u5E76\u4FDD\u7559\u8BC4\u4EF7\u8FDB\u5EA6\u3002",
    access_denied: "\u63A5\u53E3\u62D2\u7EDD\u8BBF\u95EE\uFF0C\u8BC4\u4EF7\u8FDB\u5EA6\u5DF2\u4FDD\u7559\uFF1B\u4E0D\u81EA\u52A8\u91CD\u8BD5\u3002",
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
  var blockedReason = (code) => ["sdk_requires_ui", "login_required", "verification_required", "verification_cancelled", "verification_timeout", "access_denied", "rate_limited"].includes(code);
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

  // Taoa-Competitor-Collector-1.3.7/src/review-flow.mjs
  function reviewRequest(itemId, scope, page, advertised = []) {
    if (!validId2(itemId) || !scopeKeys.includes(scope) || !Number.isInteger(page) || page < 1 || page > 1e3 || supplementalScope(scope) && !advertised.includes(scope)) throw new Error("invalid_request");
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
    return [1, 2, 3].includes(s?.version) && s.itemId === itemId && Array.isArray(s.items) && s.items.length <= REVIEW_LIMITS.records && s.items.every((r) => r.itemId === itemId && validId2(r.id) && Array.isArray(r.sources) && r.sources.every((x) => scopeKeys.includes(x?.scope) && Number.isInteger(x.page) && x.page > 0 && x.page <= 1e3 && (s.version < 3 || knownProfile(x.profile) && (x.scanId === "legacy" || /^[a-f0-9-]{36}$/.test(x.scanId || ""))))) && new Set(s.items.map((r) => r.id)).size === s.items.length && Array.isArray(s.scopes) && s.scopes.length >= 2 && s.scopes.length <= 6 && new Set(s.scopes.map((x) => x.scope)).size === s.scopes.length && s.scopes.every((x, i) => (i < 2 ? x.scope === ["all", "append"][i] : supplementalScope(x.scope)) && Number.isInteger(x.pages) && x.pages >= 0 && x.pages <= 1e3) && (s.version === 1 ? s.scopes.length === 2 : Array.isArray(s.availableScopes) && s.availableScopes.every(supplementalScope) && s.scopes.slice(2).every((x) => s.availableScopes.includes(x.scope))) && Number.isInteger(s.scopeIndex) && s.scopeIndex >= 0 && s.scopeIndex <= s.scopes.length && Number.isInteger(s.nextPage) && s.nextPage >= 1 && s.nextPage <= 1001 && (s.version < 3 || s.requestProfile === ALL_PROFILE && /^[a-f0-9-]{36}$/.test(s.scanId || "") && Number.isInteger(s.retainedCount) && s.retainedCount >= 0 && s.retainedCount <= s.items.length && s.scopes.every((x) => x.profile === profileFor(x.scope) && x.pageSize === pageSizeFor(x.scope)));
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
    if (!validId2(itemId)) return unavailableReviews(itemId, "product_mismatch");
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
        if (requests >= (limits.batchPages ?? REVIEW_LIMITS.batchPages) || now() - started >= limits.elapsedMs) break;
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

  // Taoa-Competitor-Collector-1.3.7/src/review-executor.mjs
  var inflight2 = /* @__PURE__ */ new Map();
  var fail5 = (code) => {
    throw Object.assign(new Error(code), { code });
  };
  var productId2 = (value) => {
    try {
      const u = new URL(value);
      return u.protocol === "https:" && (u.hostname === "item.taobao.com" || u.hostname === "detail.tmall.com" || u.hostname.endsWith(".tmall.com")) && u.pathname === "/item.htm" ? u.searchParams.get("id") : null;
    } catch {
      return null;
    }
  };
  async function bounded2(promise, ms) {
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
    if (inflight2.has(key)) return inflight2.get(key);
    const job = collect2(tab, itemId, browser, options).finally(() => inflight2.delete(key));
    inflight2.set(key, job);
    return job;
  }
  async function collect2(tab, itemId, browser, options) {
    const contextId = options.binding?.contextId || crypto.randomUUID();
    try {
      if (productId2(tab.url) !== itemId) fail5("product_mismatch");
      let bound = options.binding || null, lastCode = "sdk_unavailable";
      const freshBinding = !bound;
      const query = { url: ["https://*.taobao.com/*", "https://*.tmall.com/*"] };
      if (Number.isInteger(tab.windowId)) query.windowId = tab.windowId;
      const siblings = await browser.tabs.query(query).catch(() => []);
      const candidates = [tab, ...siblings.filter((t) => t.id !== tab.id && !t.discarded && productId2(t.url) === itemId).slice(0, 5)];
      for (let round = 0; round < 3 && !bound; round++) {
        for (const candidate of candidates) {
          let live;
          try {
            live = await browser.tabs.get(candidate.id);
          } catch {
            continue;
          }
          if (productId2(live.url) !== itemId) continue;
          let entries;
          try {
            entries = await bounded2(browser.scripting.executeScript({
              target: { tabId: live.id, frameIds: [0] },
              world: "MAIN",
              func: reviewPageRequest,
              args: [itemId, null, contextId]
            }), 2500);
          } catch (e) {
            if (e?.code === "capture_stopped") fail5("capture_stopped");
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
            if (lastCode === "sdk_requires_ui") fail5(lastCode);
            continue;
          }
          bound = { tabId: live.id, documentId: entry.documentId };
          break;
        }
        if (!bound && round < 2) await new Promise((r) => setTimeout(r, 750));
      }
      if (!bound) fail5(lastCode);
      const started = Date.now();
      let lastFinished = null;
      const send = async (descriptor) => {
        const wait = lastFinished === null ? 0 : 3e3 - (Date.now() - lastFinished);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        if (options.shouldStop?.()) fail5("manual_paused");
        if (Date.now() - started >= (options.limits?.elapsedMs ?? REVIEW_LIMITS.elapsedMs)) fail5("batch_limit");
        let live;
        try {
          live = await browser.tabs.get(bound.tabId);
        } catch {
          fail5("document_changed");
        }
        if (productId2(live.url) !== itemId) fail5("product_mismatch");
        let entries;
        try {
          entries = await bounded2(browser.scripting.executeScript({
            target: { tabId: bound.tabId, documentIds: [bound.documentId] },
            world: "MAIN",
            func: reviewPageRequest,
            args: [itemId, descriptor, contextId]
          }), 24e3);
        } catch (e) {
          fail5(["request_timeout", "capture_stopped"].includes(e?.code) ? e.code : "document_changed");
        }
        let entry = entries.find((x) => x.documentId === bound.documentId && x.frameId === 0);
        if (!entry) fail5("document_changed");
        if (entry.result?.code === "verification_required" && entry.result.canOpenVerification === true && options.allowInteractiveVerification === true && !options.shouldStop?.()) {
          let watch, pulses = 0;
          try {
            await options.onVerification?.(true);
            if (options.shouldStop?.()) fail5("manual_paused");
            await browser.tabs.update(bound.tabId, { active: true });
            if (browser.windows?.update && Number.isInteger(live.windowId)) await browser.windows.update(live.windowId, { focused: true });
            if (options.shouldStop?.()) fail5("manual_paused");
            const stopped2 = new Promise((_, reject) => {
              watch = setInterval(() => {
                if (options.shouldStop?.()) reject(Object.assign(new Error("manual_paused"), { code: "manual_paused" }));
                if (++pulses % 10 === 0) browser.tabs.get(bound.tabId).catch(() => reject(Object.assign(new Error("document_changed"), { code: "document_changed" })));
              }, 1e3);
            });
            entries = await Promise.race([bounded2(browser.scripting.executeScript({
              target: { tabId: bound.tabId, documentIds: [bound.documentId] },
              world: "MAIN",
              func: reviewPageRequest,
              args: [itemId, descriptor, contextId, true]
            }), 13e4), stopped2]);
            entry = entries.find((x) => x.documentId === bound.documentId && x.frameId === 0);
            if (!entry) fail5("document_changed");
          } catch (error) {
            fail5(safeReason(error?.code));
          } finally {
            clearInterval(watch);
            await options.onVerification?.(false);
          }
        }
        if (!entry.result?.ok) fail5(safeReason(entry?.result?.code));
        if (options.shouldStop?.()) fail5("manual_paused");
        lastFinished = Date.now();
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

  // Taoa-Competitor-Collector-1.3.7/src/capture-scheduler.mjs
  var STOP_CODES = /* @__PURE__ */ new Set([
    "login_required",
    "verification_required",
    "rate_limited",
    "access_denied",
    "verification_cancelled",
    "verification_timeout",
    "sdk_requires_ui",
    "account_changed",
    "document_changed",
    "product_mismatch",
    "request_timeout"
  ]);
  var stopped = () => Object.assign(new Error("capture_stopped"), { code: "capture_stopped" });
  function createCaptureScheduler({
    now = Date.now,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    intervalMs = 600,
    budgetMs = 12e4
  } = {}) {
    const started = now(), queue = [], counts = { qa: 0, reviews: 0 };
    let running = false, lastFinished = null, stop = null;
    const halt = (source, reason) => {
      stop ||= { source, reason };
    };
    async function drain() {
      if (running) return;
      running = true;
      try {
        while (queue.length) {
          const job = queue.shift();
          if (!stop && lastFinished !== null) {
            const delay = intervalMs - (now() - lastFinished);
            if (delay > 0) await sleep(delay);
          }
          if (!stop && now() - started >= budgetMs) halt("capture", "capture_timeout");
          if (stop) {
            job.reject(stopped());
            continue;
          }
          counts[job.source]++;
          try {
            job.resolve(await job.operation());
          } catch (error) {
            if (STOP_CODES.has(error?.code)) halt(job.source, error.code);
            job.reject(error);
          } finally {
            lastFinished = now();
          }
        }
      } finally {
        running = false;
      }
    }
    return {
      halt,
      check() {
        if (stop) throw stopped();
      },
      run(source, operation) {
        if (!Object.hasOwn(counts, source)) throw new Error("invalid_capture_source");
        return new Promise((resolve, reject) => {
          queue.push({ source, operation, resolve, reject });
          void drain();
        });
      },
      snapshot() {
        return {
          mode: "interleaved",
          intervalMs,
          budgetMs,
          requestCounts: { ...counts },
          stop: stop ? { ...stop } : null
        };
      }
    };
  }

  // Taoa-Competitor-Collector-1.3.7/src/combined-executor.mjs
  var inflight3 = /* @__PURE__ */ new Map();
  var stopLabels = {
    login_required: "\u767B\u5F55\u5931\u6548",
    verification_required: "\u8981\u6C42\u9A8C\u8BC1\u6216\u62D2\u7EDD\u8BBF\u95EE",
    rate_limited: "\u9650\u6D41",
    sdk_requires_ui: "\u8BF7\u6C42\u7EC4\u4EF6\u9700\u8981\u524D\u53F0\u754C\u9762",
    account_changed: "\u8D26\u53F7\u53D8\u5316",
    document_changed: "\u5546\u54C1\u9875\u5237\u65B0\u6216\u5173\u95ED",
    product_mismatch: "\u5546\u54C1\u53D8\u5316",
    request_timeout: "\u8BF7\u6C42\u8D85\u65F6",
    capture_timeout: "\u8FBE\u5230\u672C\u8F6E\u65F6\u95F4\u4E0A\u9650"
  };
  var names = { qa: "\u95EE\u5927\u5BB6", reviews: "\u8BC4\u4EF7", capture: "\u8054\u5408\u91C7\u96C6" };
  function collectFeedbackInBackground(tab, itemId, browser = chrome, options = {}) {
    const key = `${tab.windowId}:${itemId}`;
    if (inflight3.has(key)) return inflight3.get(key);
    const job = collect3(tab, itemId, browser, options).finally(() => inflight3.delete(key));
    inflight3.set(key, job);
    return job;
  }
  async function collect3(tab, itemId, browser, options) {
    const scheduler = createCaptureScheduler(options);
    const adapter = (source) => ({
      tabs: browser.tabs,
      windows: browser.windows,
      scheduleRequest: (operation) => scheduler.run(source, operation),
      scripting: {
        executeScript: async (spec) => {
          const operation = async () => {
            scheduler.check();
            const entries = await browser.scripting.executeScript(spec);
            const entry = entries.find((x) => x.frameId === 0 && (!spec.target.documentIds || spec.target.documentIds.includes(x.documentId)));
            const inlineVerification = options[source]?.allowInteractiveVerification === true && entry?.result?.code === "verification_required" && entry.result.canOpenVerification === true && spec.args?.[3] !== true;
            if (STOP_CODES.has(entry?.result?.code) && !inlineVerification) scheduler.halt(source, entry.result.code);
            return entries;
          };
          return operation();
        }
      }
    });
    const questionResult = await collectQuestionsInBackground(tab, itemId, adapter("qa"), options.qa || {});
    const qaReason = questionResult.qa.diagnostics?.reason;
    const qaPending = qaReason === "batch_limit";
    const qaFinished = [
      "done",
      "partial_answers",
      "list_limit",
      "list_no_progress",
      "unknown_list_pagination",
      "size_limit"
    ].includes(qaReason);
    if (STOP_CODES.has(qaReason)) scheduler.halt("qa", qaReason);
    let reviewData;
    if (!qaFinished) {
      const checkpoint = options.reviews?.checkpoint || freshCheckpoint(itemId);
      reviewData = {
        ...captureFromCheckpoint(checkpoint, "capture_stopped"),
        checkpoint,
        diagnostics: { reason: qaPending ? "waiting_qa" : "capture_stopped" },
        message: qaPending ? "\u5148\u91C7\u96C6\u95EE\u5927\u5BB6\uFF0C\u8BC4\u4EF7\u5C1A\u672A\u542F\u52A8\uFF1B\u4E0B\u4E00\u6279\u81EA\u52A8\u7EE7\u7EED\u3002" : "\u95EE\u5927\u5BB6\u9636\u6BB5\u5DF2\u505C\u6B62\uFF0C\u8BC4\u4EF7\u672A\u53D1\u8D77\u65B0\u8BF7\u6C42\u3002"
      };
    } else {
      await options.onQaFinished?.(questionResult);
      reviewData = await collectReviewsInBackground(tab, itemId, adapter("reviews"), options.reviews || {});
      if (STOP_CODES.has(reviewData.diagnostics?.reason)) scheduler.halt("reviews", reviewData.diagnostics.reason);
    }
    const schedule = scheduler.snapshot();
    const decorate = (data, source) => {
      data.diagnostics = { ...data.diagnostics, requestCount: schedule.requestCounts[source], schedule };
      if (data.diagnostics.reason !== "capture_stopped") return;
      const why = schedule.stop;
      const count4 = schedule.requestCounts[source];
      data.status = data.items.length ? "partial" : "unavailable";
      data.message = `${names[source]}${count4 ? `\u5DF2\u5C1D\u8BD5 ${count4} \u6B21\u8BF7\u6C42\uFF0C\u540E\u7EED\u5206\u9875\u672A\u5B8C\u6210` : "\u8BF7\u6C42\u5C1A\u672A\u53D1\u8D77"}\uFF1B\u672C\u8F6E\u56E0${names[why?.source] || "\u8054\u5408\u91C7\u96C6"}${stopLabels[why?.reason] || "\u505C\u6B62"}\u505C\u6B62\u3002\u5DF2\u4FDD\u7559\u5B9E\u8BFB\u5185\u5BB9\uFF0C\u672A\u81EA\u52A8\u91CD\u8BD5\u6216\u6253\u5F00\u9A8C\u8BC1\u754C\u9762\u3002`;
    };
    decorate(questionResult.qa, "qa");
    decorate(reviewData, "reviews");
    if (schedule.stop && reviewData.diagnostics.reason === "batch_limit") {
      reviewData.diagnostics.reason = "capture_stopped";
      if (reviewData.checkpoint) reviewData.checkpoint.reason = "capture_stopped";
      decorate(reviewData, "reviews");
    }
    return { ...questionResult, qaPending, qaFinished, reviewData };
  }
  return __toCommonJS(combined_executor_exports);
})();
