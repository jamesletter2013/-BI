'use client';
import { useEffect, useState } from 'react';

import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { questionsSummary, type Question, type QuestionsCapture } from '@/lib/questions';
import { ModuleCard } from '@/components/module-card';
import type { ReviewsCapture } from '@/lib/reviews';
import { collectionProgress } from '@/lib/collection-progress';
import { CollectionProgress } from '@/components/collection-progress';
import { downloadFeedbackExcel, questionsExcel } from '@/lib/feedback-excel';

function QuestionRow({ item, index, full = false }: { item: Question; index: number; full?: boolean }) {
  const answers = full ? item.answers : item.answers.slice(0, 1);
  return <article className="rounded-lg bg-muted px-3 py-2">
    <p className="break-words text-sm font-medium leading-5">{String(index + 1).padStart(2, '0')}　{item.question}</p>
    {answers.map((answer, i) => <p key={i} className="mt-1 break-words text-sm leading-5 text-muted-foreground">答：{answer}</p>)}
    {!answers.length && <p className="mt-1 text-sm text-muted-foreground">{item.answerTotal === 0 ? '暂无回答' : '尚未读取到回答'}</p>}
    {full && item.answerTotal !== null && item.answerTotal > item.answers.length && <p className="mt-1 text-sm text-muted-foreground">页面标注 {item.answerTotal} 条回答，已读取 {item.answers.length} 条</p>}
  </article>;
}

export function QuestionsPanel({ qa, checking, itemId='', reviewData=null, onControl }: { qa: QuestionsCapture | null; checking: boolean; itemId?:string; reviewData?:ReviewsCapture|null; onControl?:(action:'pause'|'resume')=>void }) {
  const [visible, setVisible] = useState(50);
  const [exporting,setExporting]=useState(false);
  const [exportNotice,setExportNotice]=useState('');
  useEffect(() => setVisible(50), [checking]);
  const summary = questionsSummary(qa, checking&&!qa);
  // The parent gates stale captures; fresh checkpoints remain visible while collecting.
  const items = qa?.items || [];
  const progress = collectionProgress('qa',reviewData,qa,checking);
  async function downloadQuestions(){if(!qa||exporting)return;setExporting(true);setExportNotice('正在生成 Excel…');try{
    const snapshot=questionsExcel(qa,itemId||reviewData?.itemId||'');await downloadFeedbackExcel(snapshot);
    setExportNotice(`已发起 ${snapshot.count} 个问题及已存回答的 Excel 下载；请查看浏览器下载记录。`);
  }catch(error){setExportNotice(error instanceof Error?error.message:'问答导出失败，原数据未改动。')}finally{setExporting(false)}}
  return <ModuleCard label="问大家关注问题" eyebrow="Buyer questions" actions={
    <span className="shrink-0 rounded bg-secondary px-2 py-1 text-xs text-primary">进度 · {progress.badge}</span>
  } pinned={<CollectionProgress progress={progress} onControl={onControl}/>}>
    <p className="text-sm text-muted-foreground">商品页真实问题与已读取回答</p>
    {!!items.length&&<button type="button" onClick={downloadQuestions} disabled={exporting} className="mt-2 rounded-md border border-input bg-secondary px-3 py-2 text-sm font-medium text-primary disabled:opacity-50">{exporting?'正在生成…':'下载问大家 Excel'}</button>}
    {exportNotice&&<p role="status" className="mt-1 text-sm text-primary">{exportNotice}</p>}
    {!items.length&&<p role="status" className="mt-3 rounded-lg bg-muted p-3 text-sm text-muted-foreground">{checking?'正在读取商品页问答…':'采集后在这里查看已读取的问题和回答。'}</p>}
    {!!items.length && <>
      <Dialog>
        <DialogTrigger className="mt-2 inline-block text-sm font-medium text-primary">放大查看已采集的 {items.length} 个问题</DialogTrigger>
        <DialogContent className="max-h-[85dvh] overflow-y-auto bg-white text-[#32251f] sm:max-w-2xl">
          <DialogTitle className="pr-8">问大家 · 已读取 {items.length} 个问题</DialogTitle>
          <DialogDescription>{summary.message} 回答仅展示实际读取内容，不代表全部回答。</DialogDescription>
          <div className="space-y-2">{items.slice(0, visible).map((item, i) => <QuestionRow key={item.id || item.question} item={item} index={i} full />)}</div>
          {visible < items.length && <button onClick={() => setVisible(n => n + 50)} className="rounded border border-input p-2 text-sm text-primary">显示后50个已保存问题（{visible}/{items.length}）</button>}
        </DialogContent>
      </Dialog>
      <details open className="mt-3"><summary className="cursor-pointer text-sm font-medium text-primary">问题与回答（{items.length}）</summary>
        <div className="mt-2 space-y-2">{items.slice(0, visible).map((item, i) => <QuestionRow key={item.id || item.question} item={item} index={i} full />)}</div>
        {visible < items.length && <button onClick={() => setVisible(n => n + 50)} className="mt-2 w-full rounded border border-input p-2 text-sm text-primary">显示后50个已保存问题（{visible}/{items.length}）</button>}
      </details>
    </>}
    <details className="mt-3 text-sm text-muted-foreground"><summary className="cursor-pointer">采集详情</summary><p className="mt-2 leading-6">{summary.message}</p>{reviewData?.job?.stage==='qa'&&<p className="mt-2 leading-6">{reviewData.message}</p>}</details>
  </ModuleCard>;
}
