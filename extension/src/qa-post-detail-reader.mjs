// Pure response adapter used by the packaged executor and offline tests.
// Reads user-supplied JSON/JSONP as data: no eval, requests, cookies or DOM.
const API = 'mtop.taobao.social.ugc.post.detail';
const MAX_INPUT = 2_000_000;
const MAX_ANSWERS = 30;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
const id = value => typeof value === 'string' && /^\d{1,32}$/.test(value) ? value : null;
const flag = value => value === true || value === 'true' ? true : value === false || value === 'false' ? false : null;
const count = value => {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value))) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
};
function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

export function decodeResponse(source) {
  if (typeof source !== 'string' || !source.trim() || source.length > MAX_INPUT) fail('invalid_response_size');
  const input = source.replace(/^\uFEFF/, '').trim();
  // Only an identifier wrapping ONE JSON value is accepted. Executable
  // arguments, callback property access and trailing statements are rejected.
  const wrapped = /^[A-Za-z_$][\w$]*\s*\(\s*([\s\S]*)\s*\)\s*;?\s*$/.exec(input);
  let payload;
  try { payload = JSON.parse(wrapped ? wrapped[1] : input); }
  catch { fail('invalid_json_or_jsonp'); }
  if (!record(payload)) fail('invalid_response_shape');
  return payload;
}

export function readPostDetailResponse(source, expectedItemId, { capturedAt = '' } = {}) {
  if (!id(expectedItemId)) fail('expected_product_id_required');
  const payload = decodeResponse(source);
  if (payload.api !== API) fail('unsupported_api');
  if (!Array.isArray(payload.ret) || !payload.ret.length
    || !payload.ret.every(value => typeof value === 'string' && value.split('::')[0] === 'SUCCESS')) {
    // Failure is NOT an empty question list. The caller must retain that distinction.
    fail('upstream_unsuccessful');
  }
  const data = payload.data;
  if (!record(data) || !id(data.refId) || data.refId !== expectedItemId) fail('product_mismatch');
  if (!id(data.id) || !text(data.title)) fail('missing_question_identity');
  const list = data.list;
  if (!record(list) || !Array.isArray(list.list) || flag(list.success) !== true) fail('invalid_answer_list');

  const questionTitle = text(data.title).slice(0, 1000);
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
    replyPreviewCount: 0,
  };
  const answers = [];
  const byId = new Map();
  for (const row of list.list.slice(0, MAX_ANSWERS)) {
    if (!record(row) || !text(row.title)) { diagnostics.skippedAnswerRows++; continue; }
    const body = text(row.title);
    const answer = {
      id: id(row.id), text: body.slice(0, 2000), isAiAnswer: flag(row.isAiAnswer),
      mergedAnswerHasMore: flag(row.mergedAnswerHasMore),
      // A comment under an answer is NOT another answer to the question.
      // Keep its parent relationship and do not retain names, avatars or tracking.
      comments: record(row.firstCommentVO) && text(row.firstCommentVO.content)
        ? [{ text: text(row.firstCommentVO.content).slice(0, 2000), previewOnly: true }] : [],
    };
    diagnostics.textTruncated ||= answer.text !== body
      || text(row.firstCommentVO?.content).length > 2000;
    if (answer.id && byId.has(answer.id)) {
      const previous = byId.get(answer.id);
      diagnostics.duplicateAnswerIds++;
      if (previous.text !== answer.text || previous.isAiAnswer !== answer.isAiAnswer) diagnostics.conflictingAnswerIds++;
      for (const comment of answer.comments) {
        if (!previous.comments.some(c => c.text === comment.text)) previous.comments.push(comment);
      }
      continue;
    }
    answers.push(answer);
    if (answer.id) byId.set(answer.id, answer);
  }
  diagnostics.replyPreviewCount = answers.reduce((n, answer) => n + answer.comments.length, 0);
  const ended = list.isEnd === 'y' ? true : list.isEnd === 'n' ? false : null;
  const answerListComplete = ended === true && answerTotal !== null && answers.length === answerTotal
    && answers.every(answer => answer.id) && !diagnostics.answerLimitReached
    && !diagnostics.skippedAnswerRows && !diagnostics.conflictingAnswerIds && !diagnostics.textTruncated;
  // This state describes only data.list.list, not nested replies, merged answers,
  // or the OTHER questions for the product. isEnd=y wins over nextPage="1".
  const answerPagination = {
    ended, nextPage: ended === false ? count(list.nextPage) : null,
    reportedNextPage: count(list.nextPage), reportedTotal: answerTotal, listComplete: answerListComplete,
  };
  const totalExact = questionTotal !== null && !diagnostics.totalConflict;
  const nonAiAnswers = answers.filter(answer => answer.isAiAnswer === false);
  return {
    sourceApi: API, itemId: data.refId,
    question: { id: data.id, title: questionTitle, reportedProductQuestionTotal: questionTotal,
      reportedAnswerTotal: answerTotal, answers },
    answerPagination, mergedAnswerHasMore: flag(data.mergedAnswerHasMore), diagnostics,
    // Compatibility sample for the current workbench. No file is injected or
    // delivered to a browser. AI/unknown-origin answers remain labelled above,
    // rather than being silently presented as non-AI answers in this view.
    capture: {
      items: [{ question: questionTitle, answers: [...new Set(nonAiAnswers.map(answer => answer.text))], answerTotal }],
      total: questionTotal, totalExact, totalLabel: questionTotal === null ? '' : String(questionTotal),
      status: totalExact && questionTotal === 1 && !diagnostics.textTruncated ? 'complete' : 'partial',
      capturedAt: typeof capturedAt === 'string' ? capturedAt : '',
      message: '已解析1个问题的详情响应；商品的其他问题不包含在本次响应中。回答下的跟帖另行保留，未混作独立回答。',
    },
  };
}
