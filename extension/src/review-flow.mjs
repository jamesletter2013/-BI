import { REVIEW_API, REVIEW_VERSION, REVIEW_LIMITS, REVIEW_MESSAGES, validId, readReviewResponse, mergeReview, safeReason, blockedReason, unavailableReviews } from './review-model.mjs';
import { REVIEW_SCOPES, scopeKeys, supplementalScope } from './review-plan.mjs';
import { ALL_PROFILE, LEGACY_PROFILE, profileFor, pageSizeFor, knownProfile } from './review-profile.mjs';

export function reviewRequest(itemId, scope, page, advertised = []) {
  if (!validId(itemId) || !scopeKeys.includes(scope) || !Number.isInteger(page) || page < 1 || page > 1000
    || (supplementalScope(scope) && !advertised.includes(scope))) throw new Error('invalid_request');
  const code = REVIEW_SCOPES[scope].code;
  const data = { showTrueCount: false, auctionNumId: itemId, pageNo: page, pageSize: pageSizeFor(scope),
    rateType: scope === 'all' ? '' : code, searchImpr: code, orderType: '', expression: '', rateSrc: 'pc_rate_list' };
  if (scope !== 'all') Object.assign(data, { skuVids: '', foldFlag: '0' });
  return { api: REVIEW_API, version: REVIEW_VERSION, profile: profileFor(scope), data };
}
const newScope = scope => ({ scope, profile: profileFor(scope), pageSize: pageSizeFor(scope), pages: 0, readCount: 0, uniqueAdded: 0, total: null, initialTotal: null, totalChanged: false, platformTotal: '', timePeriod: '',
  folded: null, history: '', complete: false, ended: false, reason: 'pagination_unknown', lastPage: null });
const size = value => new TextEncoder().encode(JSON.stringify(value)).byteLength;
export function freshCheckpoint(itemId) {
  return { version: 3, requestProfile: ALL_PROFILE, scanId: crypto.randomUUID(), retainedCount: 0,
    itemId, items: [], scopes: [newScope('all'), newScope('append')], availableScopes: [], discoveryDone: false,
    scopeIndex: 0, nextPage: 1, reason: 'batch_limit', pageTrace: [], startedAt: new Date().toISOString(), updatedAt: '', resumed: false };
}
export function validCheckpoint(s, itemId) {
  return [1, 2, 3].includes(s?.version) && s.itemId === itemId && Array.isArray(s.items) && s.items.length <= REVIEW_LIMITS.records
    && s.items.every(r => r.itemId === itemId && validId(r.id) && Array.isArray(r.sources)
      && r.sources.every(x => scopeKeys.includes(x?.scope) && Number.isInteger(x.page) && x.page > 0 && x.page <= 1000
        && (s.version < 3 || knownProfile(x.profile) && (x.scanId === 'legacy' || /^[a-f0-9-]{36}$/.test(x.scanId || '')))))
    && new Set(s.items.map(r => r.id)).size === s.items.length && Array.isArray(s.scopes) && s.scopes.length >= 2 && s.scopes.length <= 6
    && new Set(s.scopes.map(x => x.scope)).size === s.scopes.length
    && s.scopes.every((x, i) => (i < 2 ? x.scope === ['all', 'append'][i] : supplementalScope(x.scope)) && Number.isInteger(x.pages) && x.pages >= 0 && x.pages <= 1000)
    && (s.version === 1 ? s.scopes.length === 2 : Array.isArray(s.availableScopes)
      && s.availableScopes.every(supplementalScope) && s.scopes.slice(2).every(x => s.availableScopes.includes(x.scope)))
    && Number.isInteger(s.scopeIndex) && s.scopeIndex >= 0 && s.scopeIndex <= s.scopes.length
    && Number.isInteger(s.nextPage) && s.nextPage >= 1 && s.nextPage <= 1001
    && (s.version < 3 || s.requestProfile === ALL_PROFILE && /^[a-f0-9-]{36}$/.test(s.scanId || '')
      && Number.isInteger(s.retainedCount) && s.retainedCount >= 0 && s.retainedCount <= s.items.length
      && s.scopes.every(x => x.profile === profileFor(x.scope) && x.pageSize === pageSizeFor(x.scope)));
}
// Protocol changes and explicit rescans reset cursors, never the saved records.
export function restartPreservingReviews(previous, itemId) {
  if (!validCheckpoint(previous, itemId)) throw Object.assign(new Error('invalid_checkpoint'), { code: 'invalid_checkpoint' });
  const next = freshCheckpoint(itemId);
  next.items = structuredClone(previous.items).map(row => ({ ...row,
    sources: row.sources.map(source => ({ ...source, profile: previous.version < 3 ? LEGACY_PROFILE : source.profile,
      scanId: previous.version < 3 ? 'legacy' : source.scanId })) }));
  next.retainedCount = next.items.length;
  next.resumed = true;
  next.previousProgress = { version: previous.version, requestProfile: previous.requestProfile || LEGACY_PROFILE,
    scopeIndex: previous.scopeIndex, nextPage: previous.nextPage, scopes: structuredClone(previous.scopes),
    pageTrace: structuredClone(previous.pageTrace || []).slice(-100) };
  return next;
}
const fromThisScan = (row, scope, s) => row.sources.some(x => x.scope === scope && x.profile === profileFor(scope) && x.scanId === s.scanId);
const stamp = (items, s) => items.map(row => ({ ...row, sources: row.sources.map(x => ({ ...x, scanId: s.scanId })) }));
export function captureFromCheckpoint(s, reason = s.reason, diagnostics = {}) {
  const complete = reason === 'done' && s.scopeIndex === s.scopes.length && s.scopes.every(x => x.complete);
  return { schemaVersion: 1, itemId: s.itemId,
    status: blockedReason(reason) ? 'blocked' : complete ? (s.items.length ? 'complete_scope' : 'empty_scope') : s.items.length ? 'partial' : 'unavailable',
    items: s.items, scopes: s.scopes, capturedAt: s.updatedAt || new Date().toISOString(),
    coverage: { mode: 'recent', discoveryDone: s.discoveryDone === true, availableScopes: s.availableScopes || [],
      requestProfile: s.requestProfile || LEGACY_PROFILE, retainedCount: s.retainedCount || 0,
      addedSinceStart: Math.max(0, s.items.length - (s.retainedCount || 0)),
      supplementalAdded: s.items.filter(r => r.sources.some(x => supplementalScope(x.scope)) && !r.sources.some(x => ['all', 'append'].includes(x.scope))).length,
      fullCoverageVerified: false },
    message: (REVIEW_MESSAGES[reason] || REVIEW_MESSAGES.transport_failed) + (s.resumed ? ' 已沿用本地进度；跨批列表可能变化，数量不一致会单独提示。' : ''),
    progress: { nextPage: s.nextPage, scope: s.scopeIndex < s.scopes.length && !s.scopes[s.scopeIndex].ended ? s.scopes[s.scopeIndex].scope : '', savedCount: s.items.length },
    pageTrace: (s.pageTrace || []).slice(-100),
    diagnostics: { transport: 'page-native-mtop', backgroundOnly: true, reason, ...diagnostics } };
}
// A bounded batch. Only a normal batch_limit may schedule another batch.
export async function runReviewFlow({ itemId, exchange, checkpoint, onCheckpoint = async () => {},
  shouldStop = () => false, limits = REVIEW_LIMITS, now = Date.now, refreshCapabilities = false }) {
  if (!validId(itemId)) return unavailableReviews(itemId, 'product_mismatch');
  if (checkpoint && !validCheckpoint(checkpoint, itemId)) return unavailableReviews(itemId, 'invalid_checkpoint');
  let s = checkpoint ? structuredClone(checkpoint) : freshCheckpoint(itemId);
  if (s.version < 3) s = restartPreservingReviews(s, itemId);
  if (refreshCapabilities) s.discoveryDone = false;
  // Upgrade the old stopped cursor: the ordinary endpoint already reported an
  // end. Do not invent page 4; retain the gap and proceed to the verified append
  // scope. This is not a retry after an access challenge.
  if (s.reason === 'count_mismatch' && s.scopeIndex < s.scopes.length) {
    s.scopes[s.scopeIndex].ended = true;
    s.scopes[s.scopeIndex].reason = 'count_mismatch';
    s.scopeIndex++; s.nextPage = 1;
  }
  const started = now(); let reason = 'batch_limit', requests = 0;
  let merged = new Map(s.items.map(r => [r.id, r]));
  try {
    // An old checkpoint has no filter metadata. Read one known ordinary page
    // to discover capabilities, without discarding old rows or moving its cursor.
    // This runs only in a user-started/resumed job, never after a challenge in
    // the same run. Its request participates in the same queue and budget.
    if (!s.discoveryDone && s.scopes.some(x => x.pages > 0)) {
      if (shouldStop()) throw Object.assign(new Error(), { code: 'manual_paused' });
      requests++;
      const result = readReviewResponse(await exchange(reviewRequest(itemId, 'all', 1)), itemId, 'all', 1);
      if (/历史|更早|history/i.test(result.timePeriod)) throw Object.assign(new Error(), { code: 'outside_recent_scope' });
      const next = structuredClone(s), draft = new Map(merged);
      next.availableScopes = [...new Set([...next.availableScopes, ...result.availableScopes])]; next.discoveryDone = true;
      for (const scope of result.availableScopes) if (!next.scopes.some(x => x.scope === scope)) next.scopes.push(newScope(scope));
      // A metadata refresh is still a real successful read. Retain new rows as
      // well, but do not advance or reset the saved ordinary pagination cursor.
      for (const row of stamp(result.items, next)) draft.set(row.id, mergeReview(draft.get(row.id), row));
      if (draft.size > limits.records) throw Object.assign(new Error(), { code: 'record_limit' });
      if (size([...draft.values()]) > limits.bytes) throw Object.assign(new Error(), { code: 'size_limit' });
      next.items = [...draft.values()];
      const ordinary = next.scopes[0];
      ordinary.readCount = next.items.filter(r => fromThisScan(r, 'all', next)).length;
      ordinary.uniqueAdded = (ordinary.uniqueAdded || 0) + draft.size - merged.size;
      if (result.total !== null) {
        if (ordinary.initialTotal === null) ordinary.initialTotal = result.total;
        else if (ordinary.initialTotal !== result.total) ordinary.totalChanged = true;
        ordinary.total = result.total;
      }
      if (ordinary.ended && (ordinary.totalChanged || ordinary.total !== null && ordinary.readCount !== ordinary.total)) {
        ordinary.complete = false; ordinary.reason = 'count_mismatch';
      }
      next.metadataRefreshes = (next.metadataRefreshes || 0) + 1;
      next.updatedAt = new Date().toISOString();
      try { await onCheckpoint(next); } catch { throw Object.assign(new Error(), { code: 'storage_unavailable' }); }
      s = next; merged = draft;
    }
    while (s.scopeIndex < s.scopes.length) {
      if (shouldStop()) { reason = 'manual_paused'; break; }
      if (requests >= (limits.batchPages ?? 5) || now() - started >= limits.elapsedMs) break;
      if (s.nextPage > limits.pagesPerScope) { reason = 'page_limit'; break; }
      const index = s.scopeIndex, scope = s.scopes[index].scope, page = s.nextPage;
      requests++;
      let result;
      try { result = readReviewResponse(await exchange(reviewRequest(itemId, scope, page, s.availableScopes)), itemId, scope, page); }
      catch (e) {
        if (e?.code !== 'filter_not_available' || !supplementalScope(scope)) throw e;
        const next = structuredClone(s);
        Object.assign(next.scopes[index], { ended: true, complete: false, reason: 'filter_not_available' });
        next.scopeIndex++; next.nextPage = 1; next.reason = 'batch_limit'; next.updatedAt = new Date().toISOString();
        try { await onCheckpoint(next); } catch { reason = 'storage_unavailable'; break; }
        s = next; continue;
      }
      if (/历史|更早|history/i.test(result.timePeriod)) {
        reason = 'outside_recent_scope'; break;
      }
      // The cursor never moves past a page that could not be fully retained.
      const draft = new Map(merged);
      const seen = new Set(s.items.filter(r => fromThisScan(r, scope, s)).map(r => r.id));
      let added = 0, uniqueAdded = 0;
      for (const row of stamp(result.items, s)) {
        if (!seen.has(row.id)) { seen.add(row.id); added++; }
        if (!draft.has(row.id)) uniqueAdded++;
        draft.set(row.id, mergeReview(draft.get(row.id), row));
      }
      if (draft.size > limits.records) { reason = 'record_limit'; break; }
      if (size([...draft.values()]) > limits.bytes) { reason = 'size_limit'; break; }
      const next = structuredClone(s), state = next.scopes[index];
      if (scope === 'all') {
        next.discoveryDone = true;
        next.availableScopes = [...new Set([...next.availableScopes, ...result.availableScopes])];
        for (const extra of next.availableScopes) if (!next.scopes.some(x => x.scope === extra)) next.scopes.push(newScope(extra));
      }
      next.items = [...draft.values()]; state.pages = page; state.readCount = seen.size;
      state.uniqueAdded = (state.uniqueAdded || 0) + uniqueAdded;
      if (result.total !== null) {
        if (state.initialTotal === null) state.initialTotal = result.total;
        else if (state.initialTotal !== result.total) state.totalChanged = true;
      }
      Object.assign(state, { total: result.total ?? state.total, platformTotal: result.platformTotal || state.platformTotal,
        timePeriod: result.timePeriod || state.timePeriod, folded: result.folded ?? state.folded, history: result.history || state.history });
      state.lastPage = { page, profile: profileFor(scope), pageSize: pageSizeFor(scope), returned: result.items.length, added, uniqueAdded, hasNext: result.hasNext,
        total: result.total, totalPage: result.totalPage };
      next.pageTrace = [...(next.pageTrace || []), { scope, ...state.lastPage }].slice(-100);
      reason = 'batch_limit'; next.nextPage = page + 1;
      if (page > 1 && result.items.length && !added) reason = 'repeated_page';
      else if (result.hasNext === false) {
        state.ended = true;
        state.complete = !state.totalChanged && (state.total === null || seen.size === state.total);
        state.reason = state.complete ? 'done' : 'count_mismatch';
        // A count discrepancy is a coverage warning, not an authentication or
        // transport failure. Keep it visible without suppressing append reads.
        next.scopeIndex++; next.nextPage = 1;
      } else if (result.hasNext === null) reason = 'pagination_unknown';
      else if (!result.items.length) reason = 'empty_page';
      // A successful but unusable pagination result ends just this view. It
      // must not suppress independent advertised views. Transport/auth errors
      // still leave the entire run through the catch below, without fallback.
      if (['repeated_page', 'pagination_unknown', 'empty_page'].includes(reason)) {
        state.ended = true; state.reason = reason;
        next.scopeIndex++; next.nextPage = 1; reason = 'batch_limit';
      }
      if (!state.complete && !state.ended) state.reason = reason;
      if (next.scopeIndex === next.scopes.length) reason = next.scopes.every(x => x.complete) ? 'done' : 'range_exhausted';
      next.reason = reason; next.updatedAt = new Date().toISOString();
      try { await onCheckpoint(next); } catch { reason = 'storage_unavailable'; break; }
      s = next; merged = draft;
      if (reason !== 'batch_limit') break;
    }
  } catch (e) { reason = safeReason(e?.code || 'invalid_response_shape'); }
  if (s.scopeIndex === s.scopes.length && ['batch_limit', 'done', 'range_exhausted'].includes(reason)) reason = s.scopes.every(x => x.complete) ? 'done' : 'range_exhausted';
  if (shouldStop() && reason === 'batch_limit') reason = 'manual_paused';
  s.reason = reason; s.updatedAt = new Date().toISOString();
  if (reason !== 'storage_unavailable') {
    try { await onCheckpoint(s); } catch { reason = s.reason = 'storage_unavailable'; }
  }
  return { ...captureFromCheckpoint(s, reason, { requestCount: requests, elapsedMs: now() - started, limits }), checkpoint: s };
}
