'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import {
  Copy,
  MessageSquarePlus,
  Plus,
  ClipboardPaste,
  ListChecks,
  Download,
  ArrowUp,
  LoaderCircle,
  MoreHorizontal,
  ChevronDown,
  FileText,
  Square,
  Maximize2,
} from 'lucide-react';
import { analyzeWithHost, readHostAIStatus, type HostAIAdapter, type HostAIStatus, type HostAIInput } from '@/lib/ai/host';
import {
  AnalysisRunCard,
  type AnalysisRun,
} from '@/components/analysis-run-card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import {
  buildAnalysisPacket,
  hasAnalysisData,
  parseAnalysisSuggestions,
  pushScopeLabels,
  type AnalysisInput,
  type AnalysisPacket,
  type AnalysisSuggestion,
  type ReviewPushScope,
} from '@/lib/analysis-packet';

type Message = {
  id: number;
  text: string;
  kind: 'question' | 'reply' | 'api' | 'run';
  sent?: boolean;
  failed?: boolean;
  requestId?: string;
  run?: AnalysisRun;
  label?: string;
};
export type OpportunityPanelHandle = { pushData: () => void };
export const OpportunityPanel = forwardRef<
  OpportunityPanelHandle,
  { input: AnalysisInput; reviewScope?: ReviewPushScope; hostAI?: HostAIAdapter | null }
>(function OpportunityPanel({ input, reviewScope = 'bad', hostAI }, ref) {
  const [packet, setPacket] = useState<AnalysisPacket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState(''),
    [reply, setReply] = useState('');
  const [suggestions, setSuggestions] = useState<AnalysisSuggestion[]>([]);
  const [notice, setNotice] = useState('');
  const [dialog, setDialog] = useState<
    'reply' | 'consent' | 'packet' | 'compose' | null
  >(null);
  const [replyError, setReplyError] = useState(''),
    [confirmConsent, setConfirmConsent] = useState(false);
  const [ai, setAi] = useState<HostAIStatus | null>(null),
    [aiStatusMessage, setAiStatusMessage] = useState('正在读取主站 AI 状态…');
  const statusGeneration = useRef(0);
  const [consent, setConsent] = useState(false),
    [sending, setSending] = useState(false),
    [suggestionOrigin, setSuggestionOrigin] = useState('');
  const pending = useRef<AbortController | null>(null),
    alive = useRef(true);
  const refreshAI = useCallback(async () => {
    const generation = ++statusGeneration.current;
    try { const data = await readHostAIStatus(hostAI); if (alive.current && generation === statusGeneration.current) { setAi(data); setAiStatusMessage(data.message); } }
    catch (error) { if (alive.current && generation === statusGeneration.current) { setAi(null); setAiStatusMessage(error instanceof Error ? error.message : '暂时无法读取主站状态。'); } }
  }, [hostAI]);
  useEffect(() => {
    alive.current = true;
    setAi(null);
    void refreshAI();
    window.addEventListener('focus', refreshAI);
    return () => { alive.current = false; ++statusGeneration.current; window.removeEventListener('focus', refreshAI); pending.current?.abort(); };
  }, [refreshAI]);
  useEffect(() => { setConsent(false); }, [hostAI, ai?.termsVersion, ai?.usageNotice]);
  const seq = useRef(0),
    transcript = useRef<HTMLDivElement>(null),
    composer = useRef<HTMLTextAreaElement>(null),
    composing = useRef(false);
  function pushData() {
    if (pending.current) {
      setNotice('分析进行中，请完成或取消后再更新资料。');
      return;
    }
    if (!hasAnalysisData(input)) {
      setNotice('请先采集商品资料。');
      return;
    }
    const next = buildAnalysisPacket(input, reviewScope);
    setPacket(next);
    setSuggestions([]);
    setMessages([]);
    setReply('');
    setSuggestionOrigin('');
    setConsent(false);
    setDialog(null);
    setNotice(
      '资料已推送，已开始新一轮草稿，尚未发送给 AI。可点击发送分析，或继续手动复制。',
    );
    document
      .getElementById('opportunity')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    requestAnimationFrame(() => {
      transcript.current?.scrollTo({ top: 0 });
      composer.current?.focus({ preventScroll: true });
    });
  }
  useImperativeHandle(ref, () => ({ pushData }));
  function draft() {
    return [
      packet?.text,
      ...messages
        .filter((m) => m.kind === 'question')
        .map((m) => `补充要求：${m.text}`),
      question.trim() ? `补充要求：${question.trim()}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
  }
  async function copyDraft() {
    try {
      await navigator.clipboard.writeText(draft());
      setNotice('已复制。粘贴给现有 AI 分析，再把回复粘贴回来。');
    } catch {
      setNotice('复制未成功，可下载资料 TXT，或展开资料后手动复制。');
    }
  }
  function downloadDraft() {
    const url = URL.createObjectURL(
      new Blob([draft()], { type: 'text/plain;charset=utf-8' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `竞品分析资料-${input.itemId || '待识别'}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice('已发起 TXT 下载，图片以链接收录；原始采集数据未改动。');
  }
  function addQuestion() {
    if (!question.trim()) return;
    setMessages((m) => [
      ...m,
      { id: ++seq.current, text: question.trim(), kind: 'question' },
    ]);
    setQuestion('');
    setNotice('问题已加入分析资料，尚未发送给 AI。');
    requestAnimationFrame(() =>
      transcript.current?.scrollTo({
        top: transcript.current.scrollHeight,
        behavior: 'smooth',
      }),
    );
  }
  function importReply() {
    if (!packet || pending.current) return;
    try {
      const result = parseAnalysisSuggestions(reply, packet.itemId);
      setSuggestions(result);
      setSuggestionOrigin('来自粘贴回复');
      setMessages((m) => [
        ...m,
        { id: ++seq.current, text: reply.trim(), kind: 'reply' },
      ]);
      setReply('');
      setReplyError('');
      setDialog(null);
      setNotice(
        `已从粘贴回复整理出 ${result.length} 条建议，显示在左侧；未经本站 AI 核验。`,
      );
      requestAnimationFrame(() =>
        transcript.current?.scrollTo({
          top: transcript.current.scrollHeight,
          behavior: 'smooth',
        }),
      );
    } catch (error) {
      setReplyError(
        error instanceof Error
          ? error.message
          : '回复读取失败；现有建议保持不变。',
      );
    }
  }
  const canSendAI = Boolean(hostAI && ai?.ready);
  async function sendAnalysis(approved = false) {
    if (!packet || !canSendAI || pending.current) return;
    if (!approved && !consent) { setConfirmConsent(false); setDialog('consent'); return; }
    const currentQuestion = question.trim(),
      history = messages
        .filter((m) => m.kind !== 'run' && !m.failed)
        .slice(-12)
        .map((m) => ({
          role: m.kind === 'question' ? 'user' : 'assistant',
          content: m.text,
        }));
    const body: HostAIInput = {
      requestId: crypto.randomUUID(),
      expectedTermsVersion: ai?.termsVersion || '',
      itemId: packet.itemId,
      snapshot: packet.packet,
      history: history as HostAIInput['history'],
      question: currentQuestion,
    };
    if (JSON.stringify(body).length > 60000) {
      setNotice(
        '资料和对话超过 6 万字符，未发送。请缩小评价范围或改用手动导出；不会自动删减采集内容。',
      );
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    const runId = ++seq.current,
      questionId = ++seq.current;
    const run: AnalysisRun = {
      requestId: body.requestId,
      stage: 'connecting',
      status: 'pending',
      startedAt: Date.now(),
      question: currentQuestion,
    };
    setMessages((m) => [
      ...m,
      {
        id: questionId,
        kind: 'question',
        text: currentQuestion || '请分析本次商品资料，生成可执行的建议。',
        sent: true,
        requestId: body.requestId,
      },
      { id: runId, kind: 'run', text: '', run },
    ]);
    setQuestion('');
    setSending(true);
    setNotice('正在提交给主站统一 AI 服务；请保持页面打开，不会自动重试。');
    function updateRun(patch: Partial<AnalysisRun>) {
      if (!alive.current) return;
      setMessages((m) =>
        m.map((item) =>
          item.id === runId && item.run
            ? { ...item, run: { ...item.run, ...patch } }
            : item,
        ),
      );
    }
    function scrollToLatest() {
      requestAnimationFrame(() =>
        transcript.current?.scrollTo({
          top: transcript.current.scrollHeight,
          behavior: 'smooth',
        }),
      );
    }
    scrollToLatest();
    const timeout = setTimeout(() => controller.abort(), 110000);
    try {
      const reportStage=(stage:AnalysisRun['stage'])=>{updateRun({stage});scrollToLatest();};
      const result = await analyzeWithHost(hostAI, body, {
        signal: controller.signal,
        onProgress: reportStage,
      });
      if (
        result.itemId !== packet.itemId ||
        result.requestId !== body.requestId
      )
        throw new Error('返回结果与本次资料不一致，未替换建议。');
      const parsed = parseAnalysisSuggestions(result.text, packet.itemId);
      if (!alive.current) return;
      setSuggestions(parsed);
      setSuggestionOrigin('来自主站 AI');
      updateRun({
        status: 'success',
        finishedAt: Date.now(),
        count: parsed.length,
      });
      const replyId = ++seq.current;
      setMessages((m) => [
        ...m.map((item) => (item.failed ? item : { ...item, sent: true })),
        {
          id: replyId,
          text: result.text,
          kind: 'api',
          label: '主站 AI',
        },
      ]);
      setNotice(
        `已生成 ${parsed.length} 条建议。${typeof result.notice === 'string' ? result.notice : '用量记录以主站为准。'}`,
      );
      requestAnimationFrame(() =>
        transcript.current?.scrollTo({
          top: transcript.current.scrollHeight,
          behavior: 'smooth',
        }),
      );
    } catch (error) {
      if (alive.current) {
        const message = controller.signal.aborted
          ? '已停止等待。请到主站确认实际结果和用量后再决定是否重试；取消等待不等于服务端已取消。'
          : error instanceof Error
            ? error.message
            : '发送失败，资料已保留。';
        updateRun({ status: 'failed', finishedAt: Date.now(), error: message });
        setMessages((m) =>
          m.map((item) =>
            item.id === questionId ? { ...item, failed: true } : item,
          ),
        );
        setNotice(message);
        scrollToLatest();
      }
    } finally {
      clearTimeout(timeout);
      pending.current = null;
      if (alive.current) {setSending(false);void refreshAI();}
    }
  }
  function cancelAnalysis(){ pending.current?.abort(); }
  function submitComposer() {
    if (pending.current || !packet) return;
    if (canSendAI) void sendAnalysis();
    else setNotice(aiStatusMessage);
  }
  function submitExpandedComposer() {
    if(pending.current || !packet || !canSendAI)return;
    setDialog(null);
    submitComposer();
  }
  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if(event.key==='Enter' && !event.shiftKey && !composing.current && !event.nativeEvent.isComposing && event.nativeEvent.keyCode!==229){
      event.preventDefault();
      if(!event.repeat){if(dialog==='compose')submitExpandedComposer();else submitComposer();}
    }
  }
  return (
    <section id="opportunity" className="workbench-card xl:col-span-3 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.14em] text-muted-foreground">
            Opportunity
          </p>
          <h2 className="mt-1 text-lg font-bold">机会分析与切入建议</h2>
        </div>
        <button
          type="button"
          onClick={pushData}
          disabled={!hasAnalysisData(input) || sending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          <MessageSquarePlus className="size-4" />
          {packet ? '更新资料，开始新一轮' : '一键推送资料'}
        </button>
      </div>
      <p className="my-3 text-sm leading-6 text-muted-foreground">
        推送已采资料 · 使用 ai.taoa.cc 统一 AI 服务 · 建议回填左侧。评价范围：
        {pushScopeLabels[reviewScope]}。
      </p>
      <div className="grid items-start gap-4 lg:grid-cols-[1.2fr_1fr]">
        <section
          className="flex h-[700px] min-w-0 flex-col rounded-2xl border border-border bg-secondary/25"
          aria-label="机会建议列表"
        >
          <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
            <h3 className="font-semibold">最终建议</h3>
            <span className="text-sm text-primary">
              {sending
                ? '正在分析 · 完成后自动更新'
                : suggestions.length
                  ? `${suggestions.length} 条 · ${suggestionOrigin}`
                  : '等待分析回复'}
            </span>
          </header>
          <div
            className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4"
            tabIndex={0}
          >
            {!suggestions.length ? (
              <div className="rounded-xl border border-dashed border-input bg-white p-6 text-center">
                {sending ? (
                  <LoaderCircle className="mx-auto size-8 animate-spin text-primary" />
                ) : (
                  <ListChecks className="mx-auto size-8 text-primary" />
                )}
                <h4 className="mt-3 font-semibold">
                  {sending
                    ? '正在分析你的资料'
                    : '分析完成后，建议会显示在这里'}
                </h4>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {sending
                    ? '右侧可查看实时处理阶段。收到有效回复后，建议会自动显示在这里。'
                    : packet
                      ? '资料已准备好。右侧发送分析，或粘贴现有 AI 回复，即可整理为建议卡片。'
                      : '先推送上方商品资料。这里保留给基于实际资料的分析建议。'}
                </p>
              </div>
            ) : (
              suggestions.map((s, i) => (
                <article
                  key={i}
                  className="rounded-xl border border-border bg-white p-4"
                >
                  <div className="flex items-start gap-3">
                    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold text-white">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h4 className="break-words text-base font-semibold">
                        {s.title}
                      </h4>
                    </div>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap break-words text-base leading-7">
                    {s.action}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setQuestion(
                        `针对建议 ${i + 1}「${s.title}」，请进一步细化：\n${s.action}`,
                      );
                      requestAnimationFrame(() =>
                        composer.current?.focus({ preventScroll: true }),
                      );
                    }}
                    className="mt-3 rounded-lg border border-input px-3 py-1.5 text-sm font-medium text-primary"
                  >
                    继续讨论这条建议
                  </button>
                </article>
              ))
            )}
          </div>
        </section>
        <section
          className="flex h-[700px] min-w-0 flex-col overflow-hidden rounded-2xl border border-input bg-[#fffcf9]"
          aria-label="最终建议对话草稿"
        >
          <header className="flex shrink-0 items-center justify-between gap-2 bg-[#773014] px-4 py-3 text-white">
            <h3 className="text-base font-semibold">分析对话</h3>
            <span className="rounded-full bg-white/15 px-2 py-1 text-xs">{sending ? '分析中' : '主站 AI'}</span>
          </header>
          <div
            ref={transcript}
            role="log"
            aria-label="对话草稿记录"
            className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4"
            tabIndex={0}
          >
            {!packet && (
              <div className="flex h-full min-h-48 flex-col items-center justify-center px-5 text-center">
                <MessageSquarePlus className="size-8 text-primary/70" />
                <p className="mt-4 font-medium">从商品资料开始聊</p>
                <p className="mt-2 max-w-64 text-sm leading-6 text-muted-foreground">
                  点击上方「一键推送资料」，再输入你想分析的问题。
                </p>
              </div>
            )}
            {packet && (
              <button
                type="button"
                onClick={() => setDialog('packet')}
                className="flex w-full items-start gap-3 rounded-2xl border border-input bg-white p-3 text-left transition-colors hover:bg-secondary/50"
              >
                <FileText className="mt-1 size-5 shrink-0 text-primary" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    商品分析资料{' '}
                    <span className="font-normal text-muted-foreground">
                      ·{' '}
                      {sending
                        ? '发送中'
                        : messages.some((m) => m.kind === 'api')
                          ? '已用于分析'
                          : messages.some((m) => m.kind === 'run')
                            ? '上次分析未完成'
                            : '待发送'}
                    </span>
                  </span>
                  <span className="mt-1 line-clamp-2 block text-xs leading-5 text-muted-foreground">
                    {packet.summary}
                  </span>
                </span>
                <ChevronDown className="mt-1 size-4 shrink-0 text-muted-foreground" />
              </button>
            )}
            {messages.map((m) =>
              m.kind === 'run' && m.run ? (
                <AnalysisRunCard
                  key={m.id}
                  run={m.run}
                  disabled={sending}
                  onEdit={() => {
                    setQuestion(
                      m.run?.question ||
                        '请分析本次商品资料，生成可执行的建议。',
                    );
                    composer.current?.focus({ preventScroll: true });
                  }}
                />
              ) : (
                <article
                  key={m.id}
                  className={`rounded-2xl p-3 ${m.kind !== 'question' ? 'mr-3 border border-border bg-white' : 'ml-3 bg-secondary'}`}
                >
                  <p className="mb-2 text-xs font-medium text-primary">
                    {m.kind === 'api'
                      ? `${m.label} · 需人工核实`
                      : m.kind === 'reply'
                        ? 'AI 回复 · 手动粘贴，未核验'
                        : `我的问题 · ${m.failed ? '本次未完成' : m.sent ? '已提交' : '待发送'}`}
                  </p>
                  {m.kind !== 'question' ? (
                    <details>
                      <summary className="cursor-pointer text-sm">
                        查看回复原文
                      </summary>
                      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 [overflow-wrap:anywhere]">
                        {m.text}
                      </p>
                    </details>
                  ) : (
                    <p className="whitespace-pre-wrap break-words text-sm leading-6">
                      {m.text}
                    </p>
                  )}
                </article>
              ),
            )}
          </div>
          <div className="shrink-0 p-3 pt-1" data-testid="analysis-composer">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                submitComposer();
              }}
              className="rounded-2xl border border-input bg-white p-3 shadow-sm focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/10"
            >
              <label className="sr-only" htmlFor="opportunity-question">
                补充问题或要求
              </label>
              <div className="relative">
                <button type="button" disabled={sending} onClick={()=>setDialog('compose')} className="absolute right-0 top-0 grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-primary focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40" aria-label="展开编辑输入内容" title="展开编辑">
                  <Maximize2 className="size-4" />
                </button>
              <textarea
                ref={composer}
                id="opportunity-question"
                disabled={sending}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onCompositionStart={() => {
                  composing.current = true;
                }}
                onCompositionEnd={() => {
                  composing.current = false;
                }}
                onKeyDown={handleComposerKeyDown}
                maxLength={6000}
                placeholder="聊聊你的想法，例如：从差评中找出 3 个切入机会…"
                className="block h-24 w-full resize-none border-0 bg-transparent pr-12 pt-1.5 text-sm leading-6 outline-none placeholder:text-muted-foreground/70"
              />
              </div>
              <div className="mt-2 flex min-w-0 items-center gap-1.5">
                <div className="min-w-0 flex-1">
                  <span className="text-sm text-muted-foreground">AI 由 ai.taoa.cc 统一提供</span>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    type="button"
                    aria-label="更多对话操作"
                    title="更多对话操作"
                    className="grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <MoreHorizontal className="size-5" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    side="top"
                    className="w-48"
                  >
                    <DropdownMenuItem
                      disabled={!packet}
                      onClick={() => void copyDraft()}
                    >
                      <Copy />
                      复制分析资料
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={!packet}
                      onClick={downloadDraft}
                    >
                      <Download />
                      下载资料 TXT
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={!packet || sending}
                      onClick={() => {
                        setReplyError('');
                        setDialog('reply');
                      }}
                    >
                      <ClipboardPaste />
                      粘贴 AI 回复
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={!packet || !question.trim() || sending}
                      onClick={addQuestion}
                    >
                      <Plus />
                      仅加入草稿
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <div className="ml-auto flex shrink-0 items-center gap-2">
                  {sending ? (
                    <button
                      type="button"
                      aria-label="取消等待"
                      title="取消等待"
                      onClick={() => void cancelAnalysis()}
                      className="grid size-9 place-items-center rounded-full bg-primary text-white"
                    >
                      <Square className="size-3.5 fill-current" />
                    </button>
                  ) : (
                    <button
                      type="submit"
                      aria-label={canSendAI ? '发送并生成建议' : '主站 AI 暂不可用'}
                      title={
                        canSendAI
                          ? '发送并生成建议（Enter 发送，Shift+Enter 换行）'
                          : aiStatusMessage
                      }
                      disabled={!packet || !canSendAI}
                      className="grid size-9 place-items-center rounded-full bg-primary text-white transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-35"
                    >
                      <ArrowUp className="size-5" />
                    </button>
                  )}
                </div>
              </div>
            </form>
            <p
              role="status"
              className="mt-2 max-h-10 overflow-y-auto break-words px-1 text-xs leading-5 text-muted-foreground"
            >
              {notice || aiStatusMessage}
            </p>
          </div>
        </section>
      </div>
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        <DialogContent className={`max-h-[85dvh] overflow-y-auto ${dialog==='compose'?'sm:max-w-4xl':'sm:max-w-lg'}`}>
          <DialogHeader>
            <DialogTitle>
              {dialog === 'compose' ? '展开编辑' : dialog === 'reply'
                ? '粘贴 AI 回复'
                : dialog === 'consent'
                  ? '确认发送分析'
                  : dialog === 'packet'
                    ? '已推送的分析资料'
                    : '分析对话'}
            </DialogTitle>
            <DialogDescription>
              {dialog === 'compose' ? '长内容在这里编辑；收起或按 Esc 会保留文字。Enter 发送，Shift+Enter 换行。' : dialog === 'reply'
                ? '把现有 AI 的回复整理为左侧建议，不调用 API。'
                : dialog === 'consent'
                  ? '本次调用使用主站的统一服务和使用规则。'
                  : dialog === 'packet'
                    ? '只包含当前已采集快照，未读取的内容不会补写。'
                    : 'AI 由平台统一提供，无需配置接口或密钥。'}
            </DialogDescription>
          </DialogHeader>
          {dialog==='compose' && <div className="space-y-3">
            <label className="sr-only" htmlFor="expanded-question">完整问题或要求</label>
            <textarea id="expanded-question" autoFocus disabled={sending} value={question} onChange={e=>setQuestion(e.target.value)}
              onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}} onKeyDown={handleComposerKeyDown}
              maxLength={6000} placeholder="输入完整的分析问题或要求…" className="h-[48dvh] min-h-40 w-full resize-none rounded-xl border border-input bg-[#fffaf6] p-4 text-base leading-7 outline-none focus:ring-2 focus:ring-primary/20" />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">{question.length} / 6000 字符 · 主站 AI</span>
              <div className="flex gap-2">
                <button type="button" onClick={()=>setDialog(null)} className="rounded-lg border border-input px-4 py-2 text-sm">收起编辑</button>
                <button type="button" disabled={sending||!packet||!canSendAI} onClick={submitExpandedComposer} className="rounded-lg bg-primary px-4 py-2 text-sm text-white disabled:opacity-40">发送分析</button>
              </div>
            </div>
            {!packet && <p className="text-xs text-muted-foreground">可以先编辑问题，推送商品资料后即可发送。</p>}
          </div>}
          {dialog === 'reply' && (
            <div className="space-y-3">
              <label className="sr-only" htmlFor="analysis-reply">
                AI 分析回复
              </label>
              <textarea
                id="analysis-reply"
                disabled={sending}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                maxLength={50000}
                placeholder="粘贴完整回复（JSON 或按 1.、2.、3. 分条），最多 5 万字。"
                className="h-64 w-full resize-none rounded-xl border border-input bg-[#fffaf6] p-3 text-sm leading-6"
              />
              {replyError && (
                <p role="alert" className="text-sm text-destructive">
                  {replyError}
                </p>
              )}
              <button
                type="button"
                disabled={!packet || !reply.trim() || sending}
                onClick={importReply}
                className="w-full rounded-lg bg-primary px-3 py-2.5 text-sm font-medium text-white disabled:opacity-40"
              >
                整理为左侧建议
              </button>
            </div>
          )}
          {dialog === 'consent' && (
            <div className="space-y-4 text-sm leading-6">
              <p className="rounded-xl bg-secondary p-3">{ai?.usageNotice}<br/>将发送商品资料快照、最近 12 条对话和当前问题给主站 AI。图片仅以链接收录，不做图片识别。</p>
              <p>账号权限、模型和用量由 ai.taoa.cc 统一管理。本模块不设置独立接口或计费规则。</p>
              <label className="flex items-start gap-2">
                <Checkbox
                  checked={confirmConsent}
                  onCheckedChange={(value) => setConfirmConsent(Boolean(value))}
                  className="mt-1"
                />
                同意本轮将资料发送给主站 AI，并按上述主站规则使用
              </label>
              <button
                type="button"
                disabled={!confirmConsent || sending || !canSendAI}
                onClick={() => {
                  setConsent(true);
                  setDialog(null);
                  void sendAnalysis(true);
                }}
                className="w-full rounded-lg bg-primary px-3 py-2.5 font-medium text-white disabled:opacity-40"
              >
                确认并发送
              </button>
            </div>
          )}
          {dialog === 'packet' && packet && (
            <div className="space-y-3 text-sm leading-6">
              <p>{packet.summary}</p>
              <p className="text-muted-foreground">
                {packet.packet.snapshot.collecting
                  ? '采集中快照，后续新增需再次更新。'
                  : '仅当前已采集快照。'}{' '}
                图片仅为链接，本版在线分析不读取图片。
              </p>
              {!packet.packet.reviews.included && (
                <p className="text-[#9a5b0c]">
                  当前范围未采到评价，不代表商品没有差评。
                </p>
              )}
              <textarea
                aria-label="已推送分析资料"
                readOnly
                value={packet.text}
                className="h-64 w-full resize-none rounded-xl border border-input bg-[#fffaf6] p-3 text-sm leading-6"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
});
