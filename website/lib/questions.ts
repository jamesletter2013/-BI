export type Question = { id?: string; question: string; answers: string[]; answerIds?: string[]; answerTotal: number | null };
export type QuestionsCapture = {
  items: Question[];
  total: number | null;
  totalExact: boolean;
  totalLabel: string;
  status: 'complete' | 'partial' | 'empty' | 'not_found' | 'blocked' | 'unavailable';
  capturedAt: string;
  message: string;
  reason?: string;
};

export const collectionReasons = new Set(['batch_limit','done','partial_answers','list_limit','list_no_progress',
  'unknown_list_pagination','size_limit','manual_paused','interrupted','verification_required','access_denied',
  'verification_cancelled','verification_timeout','rate_limited','login_required','login_context_missing',
  'sdk_requires_ui','sdk_unavailable','request_timeout','capture_timeout','document_changed','account_changed',
  'product_mismatch','storage_unavailable','transport_failed','upstream_unsuccessful','invalid_checkpoint']);

const clean = (v: unknown, limit = 2000) => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
const nonNegative = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;

// Keep Q&A separate from reviews, SKU labels, and generated analysis text.
export function validateQuestions(value: unknown): QuestionsCapture | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const byQuestion = new Map<string, Question>();
  let limited = Array.isArray(input.items) && input.items.length > 5000;
  const validId = (v: unknown): v is string => typeof v === 'string' && /^\d{1,32}$/.test(v);
  for (const raw of (Array.isArray(input.items) ? input.items.slice(0, 5000) : [])) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const question = clean(item.question, 1000);
    if (!question) continue;
    const id = validId(item.id) ? item.id : undefined;
    const key = id ? `id:${id}` : `legacy:${question.replace(/\s/g, '')}`;
    const previous = byQuestion.get(key);
    const merged = new Map<string, { id: string; text: string }>();
    const add = (texts: unknown[], ids: unknown[]) => texts.slice(0, 100).forEach((value, i) => {
      const text = clean(value), answerId = validId(ids[i]) ? String(ids[i]) : '';
      if (text) merged.set(answerId ? `id:${answerId}` : `text:${text}`, { id: answerId, text });
    });
    add(previous?.answers || [], previous?.answerIds || []);
    add(Array.isArray(item.answers) ? item.answers : [], Array.isArray(item.answerIds) ? item.answerIds : []);
    limited ||= merged.size > 30;
    const entries = [...merged.values()].slice(0, 30), answers = entries.map(a => a.text);
    const totals = [previous?.answerTotal, nonNegative(item.answerTotal)].filter((n): n is number => typeof n === 'number');
    byQuestion.set(key, { id, question, answers, answerIds: entries.map(a => a.id), answerTotal: totals.length ? Math.max(...totals) : null });
  }
  const items = [...byQuestion.values()];
  const total = nonNegative(input.total);
  const totalExact = input.totalExact === true && total !== null;
  const allowed = ['complete', 'partial', 'empty', 'not_found', 'blocked', 'unavailable'];
  let status = (allowed.includes(String(input.status)) ? input.status : 'unavailable') as QuestionsCapture['status'];
  if (items.length && !['blocked', 'unavailable'].includes(status)) {
    status = status === 'complete' && totalExact && total === items.length && !limited ? 'complete' : 'partial';
  } else if (status === 'complete' || status === 'partial') {
    status = totalExact && total === 0 ? 'empty' : 'unavailable';
  }
  if (status === 'empty' && total !== null && total > 0) status = 'unavailable';
  const label = clean(input.totalLabel, 30);
  const diagnostics = input.diagnostics && typeof input.diagnostics === 'object' ? input.diagnostics as Record<string,unknown> : {};
  const reason = collectionReasons.has(String(input.reason || diagnostics.reason)) ? String(input.reason || diagnostics.reason) : undefined;
  return { items, total, totalExact, reason, totalLabel: /^[\d,.]+万?\+?$/.test(label) ? label : total === null ? '' : String(total), status, capturedAt: clean(input.capturedAt, 80), message: clean(input.message, 700) + (limited ? '已达到展示安全限额，不能视为全部内容。' : '') };
}

export function questionsSummary(qa: QuestionsCapture | null, checking = false) {
  if (checking) return { badge: '采集中', message: '正在读取本次商品的问大家…' };
  if (!qa) return { badge: '待采集', message: '使用支持问答采集的插件重新采集商品后显示。' };
  const badge = qa.items.length ? `已读取 ${qa.items.length} 条` : ({ empty: '暂无问答', not_found: '未发现入口', blocked: '访问受限', unavailable: '未读取到' } as Record<string, string>)[qa.status] || '未读取到';
  const total = qa.total !== null && qa.total > 0 ? `来源标注 ${qa.totalLabel || qa.total} 条（不是实读数量）；` : '';
  const state = qa.status === 'partial' ? '部分采集。' : qa.status === 'complete' ? '问题数量已核对。' : '';
  return { badge, message: `${total}${state}${qa.message}` };
}
