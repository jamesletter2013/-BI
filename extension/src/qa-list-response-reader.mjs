// Pure response parsing and coverage accounting; no browser state or requests.
import { decodeResponse, readPostDetailResponse } from './qa-post-detail-reader.mjs';

const API = 'mtop.taobao.wdj.list.merge.search';
const MAX_QUESTIONS = 5000;
const MAX_PAGE_QUESTIONS = 200;
const MAX_ANSWERS = 30;
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = v => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
const id = v => typeof v === 'string' && /^\d{1,32}$/.test(v) ? v : null;
const flag = v => v === true || v === 'true' ? true : v === false || v === 'false' ? false : null;
const count = v => {
  if (typeof v !== 'number' && !(typeof v === 'string' && /^\d+$/.test(v))) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
};
function fail(code) { throw Object.assign(new Error(code), { code }); }

export function readQuestionListResponse(source, expectedItemId) {
  if (!id(expectedItemId)) fail('expected_product_id_required');
  const p = decodeResponse(source);
  if (p.api !== API) fail('unsupported_api');
  if (!Array.isArray(p.ret) || !p.ret.length
    || !p.ret.every(v => typeof v === 'string' && v.split('::')[0] === 'SUCCESS')) fail('upstream_unsuccessful');
  const d = p.data;
  if (!record(d) || !record(d.item) || d.item.itemId !== expectedItemId) fail('product_mismatch');
  if (!Array.isArray(d.questionList)) fail('invalid_question_list');
  const diagnostics = { skippedQuestions: 0, skippedAnswers: 0, textTruncated: false,
    questionLimitReached: d.questionList.length > MAX_PAGE_QUESTIONS, answerLimitReached: false };
  const questions = [];
  for (const q of d.questionList.slice(0, MAX_PAGE_QUESTIONS)) {
    if (!record(q)) { diagnostics.skippedQuestions++; continue; }
    if (q.itemId !== expectedItemId) fail('question_product_mismatch');
    if (!id(q.questionId) || !text(q.questionTitle)) { diagnostics.skippedQuestions++; continue; }
    const title = text(q.questionTitle).slice(0, 1000);
    diagnostics.textTruncated ||= title !== text(q.questionTitle);
    const preview = Array.isArray(q.topAnswerList) ? q.topAnswerList : [];
    if (!Array.isArray(q.topAnswerList)) diagnostics.skippedAnswers++;
    diagnostics.answerLimitReached ||= preview.length > MAX_ANSWERS;
    const answers = [];
    for (const a of preview.slice(0, MAX_ANSWERS)) {
      if (!record(a)) { diagnostics.skippedAnswers++; continue; }
      if (a.questionId !== q.questionId) fail('answer_question_mismatch');
      if (!id(a.answerId) || !text(a.answerTitle)) { diagnostics.skippedAnswers++; continue; }
      const body = text(a.answerTitle).slice(0, 2000);
      diagnostics.textTruncated ||= body !== text(a.answerTitle);
      answers.push({ id: a.answerId, text: body, isAiAnswer: flag(a.isAiAnswer),
        mergedAnswerHasMore: flag(a.mergedAnswerHasMore), comments: [], sources: ['list_preview'] });
    }
    // Numeric question text such as "15555" is real source content, not noise.
    questions.push({ id: q.questionId, title, reportedAnswerTotal: count(q.answerCount), answers });
  }
  return { sourceApi: API, itemId: expectedItemId, questions, diagnostics,
    totals: { questionTotal: count(d.questionTotal), total: count(d.total) },
    pagination: { hasNext: flag(d.hasNext), foldingHasNext: flag(d.foldingHasNext), foldingCount: count(d.foldingCount) } };
}

// Sources must belong to one caller-managed capture attempt. This is a response
// merger, NOT a request/pagination implementation; it never invents page params.
export function combineQuestionResponses(listSources, detailSources, expectedItemId) {
  if (!Array.isArray(listSources) || !listSources.length || listSources.length > 500
    || !Array.isArray(detailSources) || detailSources.length > MAX_QUESTIONS * 3) fail('invalid_source_count');
  const pages = listSources.map(s => readQuestionListResponse(s, expectedItemId));
  const details = detailSources.map(s => readPostDetailResponse(s, expectedItemId));
  return combineParsedQuestionResponses(pages, details, expectedItemId);
}

// Only allowlisted parser results are checkpointed; never raw account data.
export function combineParsedQuestionResponses(pages, details, expectedItemId) {
  if (!pages.length || pages.some(p => p.itemId !== expectedItemId)
    || details.some(p => p.itemId !== expectedItemId)) fail('product_mismatch');
  const byQuestion = new Map();
  const detailCoverage = new Map();
  const diagnostics = { conflicts: 0, skippedQuestions: 0, skippedAnswers: 0, textTruncated: false,
    questionLimitReached: false, answerLimitReached: false, duplicateQuestionIds: 0,
    duplicateAnswerIds: 0, legacyTitleCollisions: 0, legacyAnswerLoss: 0 };
  const totals = new Set();
  const addTotal = n => { if (n !== null) totals.add(n); };
  const upsertAnswers = (q, incoming) => {
    for (const answer of incoming) {
      if (!answer.id) { diagnostics.skippedAnswers++; continue; }
      const previous = q.answers.find(a => a.id === answer.id);
      if (previous) {
        diagnostics.duplicateAnswerIds++;
        if (previous.text !== answer.text || (previous.isAiAnswer !== null && answer.isAiAnswer !== null
          && previous.isAiAnswer !== answer.isAiAnswer)) diagnostics.conflicts++;
        if (previous.isAiAnswer === null) previous.isAiAnswer = answer.isAiAnswer;
        if (previous.mergedAnswerHasMore === null) previous.mergedAnswerHasMore = answer.mergedAnswerHasMore;
        else if (answer.mergedAnswerHasMore !== null && previous.mergedAnswerHasMore !== answer.mergedAnswerHasMore) diagnostics.conflicts++;
        previous.sources = [...new Set([...previous.sources, ...answer.sources])];
        for (const c of answer.comments) if (!previous.comments.some(x => x.text === c.text)) previous.comments.push(c);
      } else if (q.answers.length < MAX_ANSWERS) q.answers.push(structuredClone(answer));
      else diagnostics.answerLimitReached = true;
    }
  };
  const upsertQuestion = (incoming, fromDetail = false) => {
    let q = byQuestion.get(incoming.id);
    if (!q) {
      if (byQuestion.size >= MAX_QUESTIONS) { diagnostics.questionLimitReached = true; return null; }
      q = { id: incoming.id, title: incoming.title, reportedAnswerTotal: incoming.reportedAnswerTotal,
        answers: [], detailListComplete: false };
      byQuestion.set(q.id, q);
    } else {
      if (!fromDetail) diagnostics.duplicateQuestionIds++;
      if (q.title !== incoming.title) diagnostics.conflicts++;
      if (q.reportedAnswerTotal !== null && incoming.reportedAnswerTotal !== null
        && q.reportedAnswerTotal !== incoming.reportedAnswerTotal) diagnostics.conflicts++;
      if (q.reportedAnswerTotal === null) q.reportedAnswerTotal = incoming.reportedAnswerTotal;
    }
    upsertAnswers(q, incoming.answers);
    return q;
  };
  for (const p of pages) {
    addTotal(p.totals.questionTotal); addTotal(p.totals.total);
    diagnostics.skippedQuestions += p.diagnostics.skippedQuestions;
    diagnostics.skippedAnswers += p.diagnostics.skippedAnswers;
    for (const name of ['textTruncated', 'questionLimitReached', 'answerLimitReached']) diagnostics[name] ||= p.diagnostics[name];
    for (const q of p.questions) upsertQuestion(q);
  }
  for (const detail of details) {
    // Details cannot introduce unseen questions and silently substitute for a
    // missing product-list page. The caller first discovers IDs from the list.
    if (!byQuestion.has(detail.question.id)) fail('detail_question_not_in_list');
    addTotal(detail.question.reportedProductQuestionTotal);
    const q = upsertQuestion({ ...detail.question,
      answers: detail.question.answers.map(a => ({ ...a, sources: ['question_detail'] })) }, true);
    diagnostics.conflicts += detail.diagnostics.conflictingAnswerIds;
    diagnostics.skippedAnswers += detail.diagnostics.skippedAnswerRows;
    diagnostics.textTruncated ||= detail.diagnostics.textTruncated;
    diagnostics.answerLimitReached ||= detail.diagnostics.answerLimitReached;
    if (q) {
      let coverage = detailCoverage.get(q.id);
      if (!coverage) {
        coverage = { ids: new Set(), ended: false, valid: true };
        detailCoverage.set(q.id, coverage);
      }
      for (const a of detail.question.answers) if (a.id) coverage.ids.add(a.id);
      coverage.ended = detail.answerPagination.ended === true;
      coverage.valid &&= !detail.diagnostics.skippedAnswerRows && !detail.diagnostics.answerLimitReached
        && !detail.diagnostics.conflictingAnswerIds && !detail.diagnostics.textTruncated
        && detail.question.answers.every(a => a.id && a.mergedAnswerHasMore === false)
        && detail.mergedAnswerHasMore === false;
      // A final detail page alone may contain fewer answers than totalCount.
      // Check the union of detail-page IDs; previews cannot fill missing pages.
      q.detailListComplete = coverage.ended && coverage.valid && q.reportedAnswerTotal !== null
        && coverage.ids.size === q.reportedAnswerTotal;
    }
  }
  const questions = [...byQuestion.values()];
  const totalConflict = totals.size > 1;
  const total = totals.size === 1 ? [...totals][0] : null;
  const countConflict = total !== null && questions.length > total;
  const totalExact = total !== null && !totalConflict && !countConflict;
  const last = pages.at(-1).pagination;
  // Folded-list semantics have no nonzero real fixture yet. Do not claim that
  // branch is complete just because the normal list says hasNext=false.
  const noMoreQuestions = last.hasNext === false && last.foldingHasNext === false && last.foldingCount === 0;
  const questionListComplete = totalExact && total === questions.length && noMoreQuestions
    && !diagnostics.skippedQuestions && !diagnostics.questionLimitReached && !diagnostics.textTruncated && !diagnostics.conflicts;
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
  const answerCountsMatched = questionListComplete && !diagnostics.conflicts && !diagnostics.skippedAnswers
    && !diagnostics.answerLimitReached && questions.every(q => q.reportedAnswerTotal !== null && q.answers.length === q.reportedAnswerTotal);
  const detailListsComplete = answerCountsMatched && questions.every(q => q.detailListComplete);
  const titleSet = new Set(questions.map(q => q.title.replace(/\s/g, '')));
  diagnostics.legacyTitleCollisions = questions.length - titleSet.size;
  const captureItems = questions.map(q => ({ id: q.id, question: q.title,
    answers: q.answers.filter(a => a.isAiAnswer !== true).map(a => a.text),
    answerIds: q.answers.filter(a => a.isAiAnswer !== true).map(a => a.id), answerTotal: q.reportedAnswerTotal }));
  diagnostics.legacyAnswerLoss = questions.reduce((n, q, i) => n + q.answers.length - captureItems[i].answers.length, 0);
  const message = `问题已读取 ${questions.length}/${totalExact ? total : '未知'}；已读问题的回答已读取 ${loadedAnswerCount}/${allAnswerTotalsKnown ? knownAnswerTotal : '未知'}。列表回答含预览，跟帖单独保留，未读到的内容不补写。`
    + (totalConflict ? `接口总数口径不一致（${[...totals].join(' / ')}），未据此提前停止分页。` : '');
  return { itemId: expectedItemId, questions, diagnostics: { ...diagnostics, totalConflict, countConflict },
    coverage: { questionListComplete, loadedQuestionCount: questions.length, reportedQuestionTotal: total,
      loadedAnswerCount, reportedAnswerTotalForLoadedQuestions: allAnswerTotalsKnown ? knownAnswerTotal : null,
      answerCountsMatched, detailListsComplete, nestedRepliesComplete: false },
    pendingDetailQuestionIds: questions.filter(q => !q.detailListComplete).map(q => q.id),
    capture: { items: captureItems,
    total, totalExact, totalLabel: total === null ? '' : String(total),
    status: questionListComplete && !questions.length ? 'empty'
      : detailListsComplete && !diagnostics.legacyAnswerLoss ? 'complete' : questions.length ? 'partial' : 'unavailable',
    capturedAt: '', message } };
}
