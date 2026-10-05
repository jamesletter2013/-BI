'use client';

import { useEffect, useState } from 'react';
import { Check, CircleAlert, LoaderCircle } from 'lucide-react';
import type { AIStage } from '@/lib/ai/types';

export type AnalysisRun = {
  requestId: string;
  stage: AIStage | 'connecting' | 'confirming';
  status: 'pending' | 'success' | 'failed';
  startedAt: number;
  finishedAt?: number;
  error?: string;
  count?: number;
  question: string;
};
const labels = {
  confirming: '请在当前对话框确认接收域名和费用',
  connecting: '正在提交到分析服务',
  validating: '服务器已接收，正在检查资料和额度',
  requesting: '正在连接所选 AI，等待分析回复',
  organizing: '已收到 AI 回复，正在整理建议',
};

export function AnalysisRunCard({
  run,
  onEdit,
  disabled = false,
}: {
  run: AnalysisRun;
  onEdit: () => void;
  disabled?: boolean;
}) {
  const [now, setNow] = useState(run.startedAt);
  useEffect(() => {
    if (run.status !== 'pending') return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [run.status, run.startedAt]);
  const elapsed = Math.max(
    0,
    Math.floor(((run.finishedAt ?? now) - run.startedAt) / 1000),
  );
  const failed = run.status === 'failed',
    success = run.status === 'success';
  const stageIndex = [
    'connecting',
    'validating',
    'requesting',
    'organizing',
  ].indexOf(run.stage);
  return (
    <article
      className={`mr-3 rounded-2xl border p-3 ${failed ? 'border-red-200 bg-red-50/70' : 'border-input bg-white'}`}
      aria-label="本次分析进度"
    >
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>AI 分析进度</span>
        <span aria-label="已用时间">已用 {elapsed} 秒</span>
      </div>
      <div
        className={`mt-2 flex items-start gap-2 text-sm font-medium ${failed ? 'text-red-700' : 'text-primary'}`}
        role="status"
        aria-live="polite"
      >
        {failed ? (
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
        ) : success ? (
          <Check className="mt-0.5 size-4 shrink-0" />
        ) : (
          <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin" />
        )}
        <span>
          {failed
            ? '本次分析未完成'
            : success
              ? `已生成 ${run.count} 条建议，已自动填入左侧`
              : labels[run.stage]}
        </span>
      </div>
      {failed ? (
        <>
          <p
            className="mt-2 break-words text-sm leading-6 text-red-700"
            role="alert"
          >
            {run.error}
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            问题、资料和原有建议保留。不会自动重试。
          </p>
          <button
            type="button"
            disabled={disabled}
            onClick={onEdit}
            className="mt-3 rounded-lg border border-input bg-white px-3 py-1.5 text-xs font-medium text-primary disabled:opacity-40"
          >
            重新编辑问题
          </button>
        </>
      ) : !success ? (
        <>
          <ol className="mt-3 grid grid-cols-3 gap-2 text-xs leading-5">
            {['检查资料', '等待 AI', '生成建议'].map((label, index) => (
              <li
                key={label}
                className={`rounded-lg px-2 py-1.5 text-center ${stageIndex > index + 1 ? 'bg-primary/10 text-primary' : stageIndex === index + 1 ? 'bg-secondary font-medium text-primary' : 'bg-secondary/40 text-muted-foreground'}`}
              >
                {stageIndex > index + 1 ? '✓ ' : ''}
                {label}
              </li>
            ))}
          </ol>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            {run.stage === 'requesting'
              ? '正在等待完整回复，通常需要一些时间；无需重复发送。'
              : '按实际处理阶段更新，不代表百分比。'}
          </p>
        </>
      ) : (
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          可在左侧查看建议，或继续提问。AI 结论仍需人工核实。
        </p>
      )}
      <p className="mt-2 text-[10px] text-muted-foreground/75">
        请求编号：{run.requestId.slice(0, 8)}
      </p>
    </article>
  );
}
