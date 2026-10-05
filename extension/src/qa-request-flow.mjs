// Durable, transport-independent Q&A pagination. Only parsed, allowlisted
// response fields are checkpointed. No credentials, hidden endpoints or history.
import { readQuestionListResponse, combineParsedQuestionResponses } from './qa-list-response-reader.mjs';
import { readPostDetailResponse } from './qa-post-detail-reader.mjs';

const validId = v => typeof v === 'string' && /^\d{1,32}$/.test(v);
const pageNumber = v => Number.isSafeInteger(v) && v >= 1 && v <= 1000;
const fail = code => { throw Object.assign(new Error(code), { code }); };
export function listRequest(itemId, page = 1) {
  if (!validId(itemId) || !pageNumber(page)) fail('invalid_list_request');
  return { api: 'mtop.taobao.wdj.list.merge.search', version: '1.0', requiresRuntimeFields: ['userId'],
    data: { itemId, pageSize: 10, page, type: 'mix_group', tagId: '',
      extraInfo: JSON.stringify({ searchText: '' }), ecode: 0, biz: 'pc' } };
}
export function detailRequest(questionId, firstAnswerId, pageNum = 1) {
  if (!validId(questionId) || !validId(firstAnswerId) || !pageNumber(pageNum)) fail('invalid_detail_request');
  return { api: 'mtop.taobao.social.ugc.post.detail', version: '2.0', requiresRuntimeFields: ['userId'],
    data: { id: questionId, params: JSON.stringify({ pageNum, pageSize: 10, firstAnswerId,
      from: 'answer', searchFoldingList: false, pageVersion: 'v2', channel: 0 }), ecode: 0, biz: 'pc' } };
}
export const freshQaCheckpoint = itemId => ({ version: 1, itemId, stage: 'list', nextListPage: 1,
  detailIndex: 0, nextDetailPage: 1, detailAttempts: 0, lists: [], details: [], trace: [],
  listEndReason: '', incompleteAnswers: false, reason: 'batch_limit' });
export function validQaCheckpoint(c, itemId) {
  try {
    return c?.version === 1 && c.itemId === itemId && validId(itemId)
      && ['list', 'details', 'done'].includes(c.stage) && pageNumber(c.nextListPage)
      && Number.isInteger(c.detailIndex) && c.detailIndex >= 0 && c.detailIndex <= 5000
      && pageNumber(c.nextDetailPage) && Number.isInteger(c.detailAttempts) && c.detailAttempts >= 0 && c.detailAttempts <= 3
      && Array.isArray(c.lists) && c.lists.length <= 500 && Array.isArray(c.details) && c.details.length <= 15000
      && Array.isArray(c.trace) && c.trace.length <= 100
      && c.lists.every(p => p.itemId === itemId && Array.isArray(p.questions) && p.totals && p.pagination && p.diagnostics
        && p.questions.every(q => validId(q.id) && typeof q.title === 'string' && Array.isArray(q.answers)))
      && c.details.every(p => p.itemId === itemId && validId(p.question?.id) && Array.isArray(p.question?.answers)
        && p.answerPagination && p.diagnostics)
      && new TextEncoder().encode(JSON.stringify(c)).length <= 16_000_000;
  } catch { return false; }
}
export function qaResultFromCheckpoint(c) {
  return c.lists.length ? combineParsedQuestionResponses(c.lists, c.details, c.itemId) : null;
}
const safeCodes = new Set(['capture_stopped', 'aborted', 'manual_paused', 'storage_unavailable', 'product_mismatch',
  'question_product_mismatch', 'answer_question_mismatch', 'detail_question_mismatch', 'upstream_unsuccessful',
  'invalid_response_size', 'invalid_json_or_jsonp', 'invalid_response_shape', 'unsupported_api',
  'missing_question_identity', 'invalid_answer_list', 'invalid_question_list', 'sdk_unavailable', 'sdk_requires_ui',
  'login_context_missing', 'login_required', 'verification_required', 'verification_cancelled', 'verification_timeout', 'access_denied', 'rate_limited', 'account_changed',
  'request_timeout', 'capture_timeout', 'document_changed', 'unsupported_browser']);

export async function runQaResponseFlow({ itemId, exchange, checkpoint, onCheckpoint = async () => {},
  shouldStop = () => false, signal, maxListPages = 500, maxDetailPages = 3, batchRequests = 5, batchMs = 20000 }) {
  if (!validId(itemId) || typeof exchange !== 'function') fail('invalid_flow_input');
  if (!Number.isInteger(maxListPages) || maxListPages < 1 || maxListPages > 500
    || !Number.isInteger(maxDetailPages) || maxDetailPages < 1 || maxDetailPages > 3
    || !Number.isInteger(batchRequests) || batchRequests < 1 || batchRequests > 100) fail('invalid_flow_limits');
  if (checkpoint && !validQaCheckpoint(checkpoint, itemId)) fail('invalid_checkpoint');
  let c = checkpoint ? structuredClone(checkpoint) : freshQaCheckpoint(itemId);
  const steps = [], started = Date.now();
  const finish = reason => {
    c.reason = reason;
    const result = qaResultFromCheckpoint(c);
    if (result && reason !== 'done' && ['complete', 'empty'].includes(result.capture.status)) result.capture.status = 'partial';
    return { reason, result, steps, checkpoint: c };
  };
  const persist = async next => {
    if (new TextEncoder().encode(JSON.stringify(next)).length > 16_000_000) return false;
    try { await onCheckpoint(structuredClone(next)); } catch { fail('storage_unavailable'); }
    c = next;
    return true;
  };
  try {
    while (c.stage !== 'done') {
      if (signal?.aborted || shouldStop()) return finish('manual_paused');
      if (steps.length >= batchRequests || Date.now() - started >= batchMs) return finish('batch_limit');
      let request, question;
      if (c.stage === 'list') request = listRequest(itemId, c.nextListPage);
      else {
        question = qaResultFromCheckpoint(c)?.questions[c.detailIndex];
        if (!question) { c.stage = 'done'; break; }
        if ((question.reportedAnswerTotal === 0 && !question.answers.length) || !question.answers[0]?.id) {
          c.incompleteAnswers ||= question.reportedAnswerTotal !== 0;
          c.detailIndex++; c.nextDetailPage = 1; c.detailAttempts = 0; continue;
        }
        request = detailRequest(question.id, question.answers[0].id, c.nextDetailPage);
      }
      const page = request.data.page ?? JSON.parse(request.data.params).pageNum;
      steps.push({ api: request.api, page });
      const source = await exchange(structuredClone(request), { signal });
      // A pause during the request still commits its known response.
      const next = structuredClone(c);
      if (c.stage === 'list') {
        const parsed = readQuestionListResponse(source, itemId);
        const ids = new Set(c.lists.flatMap(p => p.questions.map(q => q.id)));
        const added = parsed.questions.filter(q => !ids.has(q.id)).length;
        next.lists.push(parsed); next.nextListPage++;
        next.trace.push({ kind: 'list', page, returned: parsed.questions.length, added,
          hasNext: parsed.pagination.hasNext, totals: parsed.totals, warnings: parsed.diagnostics });
        // Count disagreements and partial previews are warnings, not stop conditions.
        if (parsed.pagination.hasNext === false) next.listEndReason = 'end';
        else if (parsed.pagination.hasNext !== true) next.listEndReason = 'unknown_list_pagination';
        else if (!added) next.listEndReason = 'list_no_progress';
        else if (next.lists.length >= maxListPages) next.listEndReason = 'list_limit';
        if (next.listEndReason) next.stage = 'details';
      } else {
        const parsed = readPostDetailResponse(source, itemId);
        if (parsed.question.id !== question.id) fail('detail_question_mismatch');
        delete parsed.capture;
        const ids = new Set(c.details.filter(p => p.question.id === question.id).flatMap(p => p.question.answers.map(a => a.id)));
        const added = parsed.question.answers.filter(a => a.id && !ids.has(a.id)).length;
        next.details.push(parsed); next.detailAttempts++;
        next.trace.push({ kind: 'answers', questionId: question.id, page, returned: parsed.question.answers.length,
          added, ended: parsed.answerPagination.ended, nextPage: parsed.answerPagination.nextPage });
        const more = parsed.answerPagination.nextPage, ended = parsed.answerPagination.ended === true;
        if (ended || !added || !pageNumber(more) || more <= page || next.detailAttempts >= maxDetailPages) {
          next.incompleteAnswers ||= !ended;
          next.detailIndex++; next.nextDetailPage = 1; next.detailAttempts = 0;
        } else next.nextDetailPage = more;
      }
      next.trace = next.trace.slice(-100);
      if (!await persist(next)) return finish('size_limit');
    }
    const result = qaResultFromCheckpoint(c);
    return finish(c.listEndReason !== 'end' ? c.listEndReason || 'partial_answers'
      : result?.coverage.detailListsComplete ? 'done' : 'partial_answers');
  } catch (error) {
    return finish(safeCodes.has(error?.code) ? error.code : 'transport_failed');
  }
}
