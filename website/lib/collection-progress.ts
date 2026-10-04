import type { QuestionsCapture } from './questions';
import type { ReviewsCapture } from './reviews';
import { reviewScopeLabels } from './reviews';

export type CollectionState = 'idle' | 'waiting' | 'running' | 'queued' | 'paused' | 'complete' | 'partial';
export type CollectionProgress = {
  state: CollectionState; badge: string; detail: string; updatedAt: string; nextRunAt: string;
  metrics: {label: string; value: string}[];
  bars: {label: string; read: number; total: number | null}[];
  control: 'pause' | 'resume' | null;
};
const usableTotal = (read: number, total: number | null | undefined, reliable = true) =>
  reliable && typeof total === 'number' && total >= read && total > 0 ? total : null;
const shortPauseReason = (message: string) => /验证|验证码/.test(message) ? '需要完成商品页验证，进度已保留'
  : /登录|账号/.test(message) ? '请检查商品页登录状态，进度已保留'
  : /频繁|限流/.test(message) ? '平台限制请求，进度已保留'
  : /拒绝|受限/.test(message) ? '商品页访问受限，进度已保留'
  : /手动|用户暂停/.test(message) ? '已暂停，进度已保留'
  : '读取已暂停，进度已保留；原因见采集详情';

export function collectionProgress(kind: 'qa' | 'reviews', data: ReviewsCapture | null, qa: QuestionsCapture | null, checking = false): CollectionProgress {
  const job = data?.job, isQa = kind === 'qa', active = Boolean(job) && (job?.stage || 'reviews') === (isQa ? 'qa' : 'reviews');
  let state: CollectionState = 'idle', detail = '开始采集后显示实时进度';
  if (!isQa && (job?.stage === 'qa' || (checking && !job))) {
    state = 'waiting'; detail = job?.state === 'paused' ? '问大家已暂停，评价尚未开始' : '先采问大家，结束后自动开始评价';
  } else if (active && job?.state === 'paused') {
    state = 'paused'; detail = shortPauseReason(isQa ? qa?.message || data?.message || '' : data?.message || '');
  } else if (active && job?.state === 'running') {
    state = job.nextRunAt ? 'queued' : 'running'; detail = job.nextRunAt ? '本批已保存，等待自动继续' : isQa ? '正在读取问题和回答' : '正在逐页读取评价';
  } else if (isQa && qa) {
    const missingAnswers = qa.items.some(q=>q.answerTotal !== null && q.answers.length < q.answerTotal);
    state = ['complete','empty'].includes(qa.status) && !missingAnswers ? 'complete' : qa.status === 'blocked' ? 'paused' : 'partial';
    detail = state === 'complete' ? '本轮问答已读完' : state === 'paused' ? shortPauseReason(qa.message)
      : job?.stage === 'reviews' ? '本轮问答已结束，部分内容未读取' : '当前为已保存的问答';
  } else if (!isQa && data) {
    const mismatch = data.scopes.some(s=>s.totalChanged || (s.total !== null && s.total !== s.readCount));
    state = (job?.state === 'complete' || ['complete_scope','empty_scope'].includes(data.status)) && !mismatch ? 'complete' : data.status === 'blocked' ? 'paused' : 'partial';
    detail = state === 'complete' ? '本轮评价已读完' : state === 'paused' ? shortPauseReason(data.message) : job?.state === 'complete' ? '本轮已结束，数量仍待核对' : job?.state === 'exhausted' ? '本轮已结束，部分内容未读取' : '当前为已保存的评价';
  } else if (checking) { state = 'running'; detail = '正在读取商品页，准备采集问大家'; }
  const badges = {idle:'等待开始',waiting:'等待问大家',running:'采集中',queued:'等待下一批',paused:'已暂停',complete:'本轮完成',partial:'部分已读'};
  const questions = qa?.items.length || 0, answers = qa?.items.reduce((n,q)=>n+q.answers.length,0) || 0;
  const answerTotal = qa?.items.length && qa.items.every(q=>q.answerTotal !== null && q.answerTotal >= q.answers.length)
    ? qa.items.reduce((n,q)=>n+(q.answerTotal || 0),0) : null;
  const scope = data?.scopes.find(s=>s.scope === data.progress?.scope) || data?.scopes.find(s=>!s.ended) || data?.scopes[0];
  if (!isQa && active && ['running','queued'].includes(state) && data?.progress?.scope && data.progress.nextPage > 0) {
    detail += ` · 待读${reviewScopeLabels[data.progress.scope] || '当前入口'}第 ${data.progress.nextPage} 页`;
  }
  return {state,badge:badges[state],detail,
    updatedAt: isQa ? (active ? job?.updatedAt : '') || qa?.capturedAt || '' : job?.updatedAt || data?.capturedAt || '',
    nextRunAt: active && job?.state === 'running' ? job.nextRunAt : '',
    control: active && job?.state === 'running' ? 'pause' : active && job?.canResume ? 'resume' : null,
    metrics: isQa ? [{label:'已读问题',value:`${questions} 个`},{label:'已存回答',value:`${answers} 条`}]
      : [{label:'去重实读',value:`${data?.items.length || 0} 条`},{label:'累计读取',value:`${data?.scopes.reduce((n,s)=>n+s.pages,0) || 0} 页`}],
    bars: isQa ? [
      {label:'问题列表',read:questions,total:usableTotal(questions,qa?.total,qa?.totalExact)},
      {label:'已读问题的回答',read:answers,total:usableTotal(answers,answerTotal)},
    ] : [{label:scope ? `${reviewScopeLabels[scope.scope] || '当前入口'}（当前入口）` : '评价读取',read:scope?.readCount || 0,
      total:usableTotal(scope?.readCount || 0,scope?.total,!scope?.totalChanged && state !== 'waiting')}],
  };
}
