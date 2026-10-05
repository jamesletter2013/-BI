'use client';

import {
  forwardRef,
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
  Settings2,
  ChevronDown,
  FileText,
  Square,
  Maximize2,
} from 'lucide-react';
import type { AIStatus } from '@/lib/ai/types';
import { analysisSystemPrompt } from '@/lib/analysis-prompt';
import { personalBridge, runPersonalAnalysis, watchPersonalAnalysis, type PersonalAPIStatus, type PersonalJob } from '@/lib/ai/personal';
import { readAnalysisResponse } from '@/lib/ai/stream';
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
  DropdownMenuSeparator,
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
  { input: AnalysisInput; reviewScope?: ReviewPushScope }
>(function OpportunityPanel({ input, reviewScope = 'bad' }, ref) {
  const [packet, setPacket] = useState<AnalysisPacket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState(''),
    [reply, setReply] = useState('');
  const [suggestions, setSuggestions] = useState<AnalysisSuggestion[]>([]);
  const [notice, setNotice] = useState('');
  const [dialog, setDialog] = useState<
    'settings' | 'reply' | 'consent' | 'packet' | 'compose' | 'jobs' | null
  >(null);
  const [replyError, setReplyError] = useState(''),
    [confirmConsent, setConfirmConsent] = useState(false);
  const [ai, setAi] = useState<AIStatus | null>(null),
    [aiStatusMessage, setAiStatusMessage] = useState('正在检查 AI 配置…');
  const [providerId, setProviderId] = useState('deepseek'),
    [modelId, setModelId] = useState('deepseek-flash');
  const [mode,setMode]=useState<'personal'|'company'|'manual'>('personal');
  const [personal,setPersonal]=useState<PersonalAPIStatus>({installed:false,profiles:[]});
  const [profileId,setProfileId]=useState<string|null>(null);
  const [personalNotice,setPersonalNotice]=useState('正在检查个人 API 插件…');
  const [approvalStamp,setApprovalStamp]=useState('');
  const activePersonalRequest=useRef<string|null>(null);
  async function refreshPersonal(){
    try{const response=await personalBridge('TAOA_PERSONAL_STATUS');
      if(!alive.current)return;
      if(![3,4].includes(response.status?.version) || !Array.isArray(response.status.profiles))throw new Error('请更新 V1.3.1 插件后刷新工作台。');
      setPersonal(response.status);
      // Initialize once; deleting a selected profile must not silently choose another account.
      setProfileId(current=>current??response.status.profiles[0]?.id??null);
      setPersonalNotice(response.status.profiles.length?'可从输入框下方选择本次使用的 API；设置按钮可新增或管理多套配置。':'插件已连接，请添加你的第一套 API。');
    }catch(error){if(alive.current){setPersonal({installed:false,profiles:[]});setPersonalNotice(error instanceof Error?error.message:'未连接新版插件。');}}
  }
  async function openPersonalSettings(){
    try{await personalBridge('TAOA_PERSONAL_SETTINGS');setNotice('已打开插件设置页。保存后返回此页面会自动刷新配置。');}
    catch(error){setPersonalNotice(error instanceof Error?error.message:'请更新插件。');setDialog('settings');}
  }
  const [consent, setConsent] = useState(false),
    [sending, setSending] = useState(false),
    [suggestionOrigin, setSuggestionOrigin] = useState('');
  const pending = useRef<AbortController | null>(null),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    void refreshPersonal();
    window.addEventListener('focus',refreshPersonal);
    fetch('/api/ai/status', { signal: controller.signal, cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        return (await r.json()) as AIStatus;
      })
      .then((data) => {
        if (!Array.isArray(data.providers) || !data.limits) throw new Error();
        setAi(data);
        setAiStatusMessage(data.message);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setAiStatusMessage('暂时无法读取 AI 配置；手动草稿仍可使用。');
      });
    return () => {
      alive.current = false;
      controller.abort();
      window.removeEventListener('focus',refreshPersonal);
      pending.current?.abort();
    };
  }, []);
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
  const selectedProvider = ai?.providers.find((p) => p.id === providerId);
  const selectedProfile=personal.profiles.find(p=>p.id===profileId);
  const canSendAI = mode==='personal'?Boolean(selectedProfile?.configured):mode==='company'&&Boolean(ai?.companyAllowed && ai?.ready && selectedProvider?.configured);
  const providers = ai?.providers.length
    ? ai.providers
    : [
        {
          id: 'deepseek',
          label: 'DeepSeek 官方',
          models: [{ id: 'deepseek-flash', label: 'DeepSeek Flash' }],
        },
      ];
  async function sendAnalysis(approved = false) {
    if (!packet || !canSendAI || pending.current) return;
    if (!approved && ((mode==='personal' && !selectedProfile?.consentGranted) || (mode==='company' && !consent))) {
      setConfirmConsent(false);
      setApprovalStamp(`${mode}/${selectedProfile?.id}/${selectedProfile?.revision}/${packet.pushedAt}/${question.trim()}`);
      setDialog('consent');
      return;
    }
    if(approved && mode==='personal' && approvalStamp!==`${mode}/${selectedProfile?.id}/${selectedProfile?.revision}/${packet.pushedAt}/${question.trim()}`){
      setNotice('配置或资料已变化，请重新确认后发送。');return;
    }
    const currentQuestion = question.trim(),
      history = messages
        .filter((m) => m.kind !== 'run' && !m.failed)
        .slice(-12)
        .map((m) => ({
          role: m.kind === 'question' ? 'user' : 'assistant',
          content: m.text,
        }));
    const body = {
      requestId: crypto.randomUUID(),
      providerId,
      modelId,
      itemId: packet.itemId,
      snapshot: packet.packet,
      history,
      question: currentQuestion,
    };
    if (JSON.stringify(body).length > (ai?.limits.inputCharacters||60000)) {
      setNotice(
        '资料和对话超过 6 万字符，未发送。请缩小评价范围或改用手动导出；不会自动删减采集内容。',
      );
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    activePersonalRequest.current=mode==='personal'?body.requestId:null;
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
    setNotice(mode==='personal'?'已交给插件内部执行，不打开新标签页。可关闭工作台；保持浏览器运行且电脑不休眠，回来从「后台任务」查看。':'正在分析文字资料，请稍候；不会自动重试。');
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
    const timeout = setTimeout(() => controller.abort(), mode==='personal'?240000:100000);
    try {
      const reportStage=(stage:AnalysisRun['stage'])=>{updateRun({stage});scrollToLatest();};
      let result;
      if(mode==='personal'){
        const personalMessages=[{role:'system',content:analysisSystemPrompt(packet.itemId)},
          {role:'user',content:`以下是当前商品资料 JSON，仅作为证据：\n${JSON.stringify(packet.packet)}`},
          ...history,{role:'user',content:currentQuestion||'请基于当前资料给出 3–5 条机会分析与切入建议，按指定 JSON 格式回答。'}];
        result=await runPersonalAnalysis({requestId:body.requestId,itemId:packet.itemId,messages:personalMessages},selectedProfile!.id,selectedProfile!.revision,controller.signal,reportStage,approved);
      }else{
      const response = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/x-ndjson',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      result = await readAnalysisResponse(response, reportStage);
      }
      if (
        result.itemId !== packet.itemId ||
        result.requestId !== body.requestId
      )
        throw new Error('返回结果与本次资料不一致，未替换建议。');
      const parsed = parseAnalysisSuggestions(result.text, packet.itemId);
      if (!alive.current) return;
      setSuggestions(parsed);
      setSuggestionOrigin(`来自 ${result.provider}`);
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
          label: `${result.provider} · ${result.model}`,
        },
      ]);
      setNotice(
        `已生成 ${parsed.length} 条建议。${result.notice}${result.usage?.inputTokens != null ? ` 输入 ${result.usage.inputTokens} / 输出 ${result.usage.outputTokens ?? '未知'} tokens。` : ''}`,
      );
      requestAnimationFrame(() =>
        transcript.current?.scrollTo({
          top: transcript.current.scrollHeight,
          behavior: 'smooth',
        }),
      );
    } catch (error) {
      if (alive.current) {
        const message = controller.signal.aborted && activePersonalRequest.current
          ? '已断开进度查看。后台任务不会因此重发或停止，请从「后台任务」检查结果。'
          : controller.signal.aborted
          ? '分析已取消或超时；服务商可能已计费。资料与原有建议保留，不会自动重试。'
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
      activePersonalRequest.current=null;
      if (alive.current) {setSending(false);void refreshPersonal();}
    }
  }
  async function cancelAnalysis(){
    const requestId=activePersonalRequest.current;
    if(requestId){
      try{await personalBridge('TAOA_PERSONAL_CANCEL',{requestId});}
      catch(error){setNotice(error instanceof Error?error.message:'停止失败，请查看后台任务。');}
      return;
    }
    pending.current?.abort();
  }
  async function restorePersonalJob(requestId:string){
    if(pending.current)return;
    const controller=new AbortController();pending.current=controller;activePersonalRequest.current=requestId;setSending(true);
    let runId=0;
    try{
      const {job}:{job:PersonalJob}=await personalBridge('TAOA_PERSONAL_JOB',{requestId});
      if(!alive.current)return;
      // Recover the exact submitted snapshot, never rebuild it from another product.
      const raw=job.input.messages[1]?.content||'';
      const snapshot=JSON.parse(raw.slice(raw.indexOf('\n')+1)) as AnalysisPacket['packet'];
      if(snapshot?.snapshot?.itemId!==job.itemId || !snapshot.reviews || !snapshot.questions || !Array.isArray(snapshot.parameters))throw new Error('后台快照不完整，未替换当前资料。');
      const recovered:AnalysisPacket={itemId:job.itemId,pushedAt:snapshot.snapshot.pushedAt,packet:snapshot,
        text:job.input.messages.slice(0,2).map(m=>m.content).join('\n\n'),summary:`已恢复商品 ${job.itemId} 的提交快照 · ${job.profileName} · ${job.model}`};
      setPacket(recovered);setMode('personal');setSuggestions([]);setSuggestionOrigin('');setDialog(null);setQuestion('');
      runId=++seq.current;
      setMessages([...job.input.messages.slice(2).map(m=>({id:++seq.current,text:m.content,kind:m.role==='user'?'question' as const:'reply' as const,sent:true})),
        {id:runId,kind:'run',text:'',run:{requestId,stage:job.stage,status:'pending',startedAt:job.createdAt,question:job.input.messages.at(-1)?.content||''}}]);
      setNotice('已恢复后台任务，仅查看结果，不会重新调用 API。');
      const result=await watchPersonalAnalysis(requestId,controller.signal,stage=>{
        if(alive.current)setMessages(m=>m.map(x=>x.id===runId&&x.run?{...x,run:{...x.run,stage}}:x));
      });
      if(!alive.current)return;
      if(result.itemId!==job.itemId||result.requestId!==requestId)throw new Error('结果与后台任务不一致。');
      const parsed=parseAnalysisSuggestions(result.text,job.itemId);
      setSuggestions(parsed);setSuggestionOrigin(`来自 ${result.provider}`);
      setMessages(m=>[...m.map(x=>x.id===runId&&x.run?{...x,run:{...x.run,status:'success' as const,finishedAt:Date.now(),count:parsed.length}}:x),
        {id:++seq.current,kind:'api',text:result.text,label:`${result.provider} · ${result.model}`}]);
      setNotice(`已取回商品 ${job.itemId} 的 ${parsed.length} 条建议，没有再次调用 API。`);
    }catch(error){
      if(alive.current){const message=error instanceof Error?error.message:'后台任务读取失败。';setNotice(message);
        setMessages(m=>m.map(x=>x.id===runId&&x.run?{...x,run:{...x.run,status:'failed',finishedAt:Date.now(),error:message}}:x));}
    }finally{pending.current=null;activePersonalRequest.current=null;if(alive.current){setSending(false);void refreshPersonal();}}
  }
  function submitComposer() {
    if (pending.current || !packet) return;
    if (canSendAI) void sendAnalysis();
    else if(mode==='manual' && packet) addQuestion();
    else setDialog('settings');
  }
  function submitExpandedComposer() {
    if(pending.current || !packet || (mode==='manual'&&!question.trim()))return;
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
        推送已采资料 · 选择 AI 分析或手动草稿 · 建议回填左侧。评价范围：
        {pushScopeLabels[reviewScope]}。推送本身不调用 API。
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
            <button type="button" disabled={sending} onClick={()=>{setDialog('jobs');void refreshPersonal();}} className="ml-auto rounded-full bg-white/15 px-2 py-1 text-xs hover:bg-white/25 disabled:opacity-40">后台任务{personal.jobs?.length?` · ${personal.jobs.length}`:''}</button>
            <span className="rounded-full bg-white/15 px-2 py-1 text-xs">
              {sending ? '分析中' : mode==='personal' ? (selectedProfile?.configured?'个人 API':'待配置个人 API') : canSendAI ? '公司 API' : '手动模式'}
            </span>
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
                <div className="relative min-w-0 max-w-56 flex-1 sm:flex-none">
                  <select
                    aria-label="选择个人 API、公司 API 或手动草稿"
                    value={mode==='company'?JSON.stringify([providerId,modelId]):mode==='personal'&&selectedProfile?`personal:${selectedProfile.id}`:mode}
                    disabled={sending}
                    onChange={(e) => {
                      setNotice('');
                      if(e.target.value.startsWith('personal:')){
                        setProfileId(e.target.value.slice(9));setMode('personal');setConsent(false);return;
                      }
                      if(['personal','manual'].includes(e.target.value)){
                        setMode(e.target.value as 'personal'|'manual');setConsent(false);return;
                      }
                      const [provider, model] = JSON.parse(e.target.value);
                      setMode('company');
                      setProviderId(provider);
                      setModelId(model);
                      setConsent(false);
                    }}
                    className="w-full cursor-pointer appearance-none truncate rounded-lg bg-secondary/60 py-2 pl-2.5 pr-7 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  >
                    {!selectedProfile && <option value="personal">{profileId&&personal.profiles.length?'原配置已删除 · 请选择':'个人 API · 待配置'}</option>}
                    {personal.profiles.length>0 && <optgroup label="我的 API">{personal.profiles.map(p=><option key={p.id} value={`personal:${p.id}`}>{p.name} · {p.model}{p.configured?'':'（待填密钥）'}</option>)}</optgroup>}
                    <option value="manual">手动草稿（不调用 API）</option>
                    {ai?.companyAllowed && providers.map((p) => (
                      <optgroup key={p.id} label={p.label}>
                        {p.models.map((m) => (
                          <option
                            key={m.id}
                            value={JSON.stringify([p.id, m.id])}
                          >
                            {m.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-2.5 size-3.5 text-muted-foreground" />
                </div>
                <button type="button" disabled={sending} onClick={()=>void openPersonalSettings()} aria-label="设置自己的 API" title="设置自己的 API" className="grid size-9 shrink-0 place-items-center rounded-lg text-primary hover:bg-secondary disabled:opacity-40"><Settings2 className="size-4"/></button>
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
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setDialog('settings')}>
                      <Settings2 />
                      配置与使用说明
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
                      aria-label={canSendAI ? '发送并生成建议' : mode==='manual'?'加入草稿':'配置 API'}
                      title={
                        canSendAI
                          ? '发送并生成建议（Enter 发送，Shift+Enter 换行）'
                          : mode==='manual'?'加入草稿（Enter 发送，不调用 AI）':'配置你自己的 API'
                      }
                      disabled={!packet || (mode==='manual' && !question.trim())}
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
              {notice ||
                (mode==='personal'?(selectedProfile?`${selectedProfile.name} · ${selectedProfile.host}${selectedProfile.configured?' · 仅使用本套 API':' · 请补填本次会话密钥'}`:personalNotice):canSendAI
                  ? '仅分析文字 · 首次发送需确认 · 更多操作见 ···'
                  : '手动草稿不调用 AI · 复制 / 粘贴回复见 ···')}
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
              {dialog === 'jobs' ? '后台 AI 任务' : dialog === 'compose' ? '展开编辑' : dialog === 'reply'
                ? '粘贴 AI 回复'
                : dialog === 'consent'
                  ? '确认发送分析'
                  : dialog === 'packet'
                    ? '已推送的分析资料'
                    : '配置与使用说明'}
            </DialogTitle>
            <DialogDescription>
              {dialog === 'jobs' ? '个人 API 最近 10 次任务；仅查看进度和取回结果，不会重新调用。' : dialog === 'compose' ? '长内容在这里编辑；收起或按 Esc 会保留文字。Enter 发送，Shift+Enter 换行。' : dialog === 'reply'
                ? '把现有 AI 的回复整理为左侧建议，不调用 API。'
                : dialog === 'consent'
                  ? '确认后将调用所选 AI，可能产生 API 费用。'
                  : dialog === 'packet'
                    ? '只包含当前已采集快照，未读取的内容不会补写。'
                    : '个人密钥在插件内填写，只发往你选择的接口；手动草稿始终可用。'}
            </DialogDescription>
          </DialogHeader>
          {dialog==='jobs' && <div className="space-y-3 text-sm">
            <p className="rounded-xl bg-secondary p-3 leading-6">关闭工作台不影响已提交的个人 API 任务。请保持 Chrome 运行、电脑不休眠。任务和密钥仅保留在本次浏览器会话；退出浏览器或重载插件会清除，请及时复制结果。</p>
            <p className="text-xs text-muted-foreground">取回会替换当前对话草稿，使用当时提交的商品快照；不会改变上方已采集资料。</p>
            <button type="button" onClick={()=>void refreshPersonal()} className="rounded-lg border border-input px-3 py-2">刷新任务状态</button>
            {!personal.installed && <output className="block">{personalNotice}</output>}
            {personal.installed && !personal.jobs?.length && <p className="py-5 text-center text-muted-foreground">本次浏览器会话还没有后台任务</p>}
            {personal.jobs?.map(job=><div key={job.requestId} className="rounded-xl border border-input p-3">
              <p className="font-medium">商品 {job.itemId} · {job.status==='running'?'分析中':job.status==='success'?'已完成':'已停止'}</p>
              <p className="mt-1 text-xs text-muted-foreground">{job.profileName} · {job.model} · {new Date(job.createdAt).toLocaleString()}</p>
              <button type="button" disabled={sending} onClick={()=>void restorePersonalJob(job.requestId)} className="mt-3 rounded-lg bg-primary px-3 py-2 text-white disabled:opacity-40">{job.status==='running'?'查看实时进度':job.status==='success'?'取回建议':'查看停止原因'}</button>
            </div>)}
          </div>}
          {dialog==='compose' && <div className="space-y-3">
            <label className="sr-only" htmlFor="expanded-question">完整问题或要求</label>
            <textarea id="expanded-question" autoFocus disabled={sending} value={question} onChange={e=>setQuestion(e.target.value)}
              onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}} onKeyDown={handleComposerKeyDown}
              maxLength={6000} placeholder="输入完整的分析问题或要求…" className="h-[48dvh] min-h-40 w-full resize-none rounded-xl border border-input bg-[#fffaf6] p-4 text-base leading-7 outline-none focus:ring-2 focus:ring-primary/20" />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">{question.length} / 6000 字符 · {mode==='personal'?(selectedProfile?.name||'个人 API 待配置'):mode==='manual'?'手动草稿':selectedProvider?.label}</span>
              <div className="flex gap-2">
                <button type="button" onClick={()=>setDialog(null)} className="rounded-lg border border-input px-4 py-2 text-sm">收起编辑</button>
                <button type="button" disabled={sending||!packet||(mode==='manual'&&!question.trim())} onClick={submitExpandedComposer} className="rounded-lg bg-primary px-4 py-2 text-sm text-white disabled:opacity-40">{canSendAI?'发送分析':mode==='manual'?'加入草稿':'配置 API'}</button>
              </div>
            </div>
            {!packet && <p className="text-xs text-muted-foreground">可以先编辑问题，推送商品资料后即可发送。</p>}
          </div>}
          {dialog === 'settings' && (
            <div className="space-y-3 text-sm leading-6">
              <p className="rounded-xl bg-secondary p-3">{personalNotice}</p>
              <button type="button" disabled={sending} onClick={()=>void openPersonalSettings()} className="rounded-lg bg-primary px-4 py-2 text-white disabled:opacity-40">打开个人 API 设置</button>
              <button type="button" onClick={()=>void refreshPersonal()} className="ml-2 rounded-lg border border-input px-3 py-2">刷新连接</button>
              <p>
                可新增多套具名 API，分别填写 HTTPS 接口地址、模型 ID 和 API Key，在输入框下方选择本次使用哪套。支持 Chat Completions（OpenAI 兼容）、Claude Messages、Gemini generateContent；不支持任意厂商的所有专有协议。
              </p>
              <p>费用从所选 API 账户扣除。新版每套 API 首次确认一次，后续主动发送直接调用；修改地址、模型、分析模式或输出上限需重新确认，可在插件设置撤销。DeepSeek 默认普通分析，也可选深度思考；4000 tokens 是单次输出预算，不是模型容量。由插件内部执行，不打开新标签页。关闭工作台后可从「后台任务」取回结果；保持浏览器运行、电脑不休眠。失败不重试、不改用其他密钥。仅分析文字与图片链接，不识别图像。公司模式仍由当前网页等待回复。</p>
              <p>密钥仅保存在当前浏览器会话中，重启浏览器或重载插件后需重填。不要把密钥粘贴到对话框或商品资料里。</p>
              <div className="rounded-xl border border-input p-3"><a href="/downloads/taoa-collector-1.3.6.zip" download className="font-medium text-primary underline">下载 V1.3.6 插件 · 评价批次等待 10 秒</a><p className="mt-1 text-xs text-muted-foreground">先等当前任务结束并保存结果，再备份原加载目录、将新版文件覆盖进去，在扩展管理页点击重新加载。保留原目录和扩展 ID，不要删除扩展或清空存储，以免丢失采集记录。重载后个人密钥需重填，再刷新工作台。首次安装可选择「加载已解压的扩展程序」。正式商店分发尚未开启。</p></div>
              {ai?.companyAllowed && (
                <details><summary>公司模式说明（仅授权员工）</summary><p>{aiStatusMessage}</p>
                <p>
                  每人每日{' '}
                  {ai.limits.userDaily === null
                    ? '不限次数'
                    : `最多 ${ai.limits.userDaily} 次`}{' '}
                  / 团队每日{' '}
                  {ai.limits.teamDaily === null
                    ? '不限次数'
                    : `最多 ${ai.limits.teamDaily} 次`}
                  ；最多 6 万字符输入、
                  {ai.limits.outputTokens} tokens
                  输出。仍保留调用记录；费用按服务商实际用量计算，不是金额上限。
                </p></details>
              )}
              <p>
                发送本次快照、最近 12
                条对话及当前问题；超长不会自动删减。更新资料会清空这一轮对话。
              </p>
              <p className="text-muted-foreground">
                未发送草稿仅本页暂存；已提交的个人 API 任务可在本次浏览器会话中从「后台任务」取回。退出浏览器前请从「更多」复制或下载结果。Enter
                发送，Shift+Enter 换行。中文输入法选字时不会发送。
              </p>
            </div>
          )}
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
              <p className="rounded-xl bg-secondary p-3">
                {mode==='personal'?selectedProfile?.name:selectedProvider?.label} ·{' '}
                {mode==='personal'?selectedProfile?.model:selectedProvider?.models.find((m) => m.id === modelId)?.label}
                {mode==='personal' && <><br/>接收域名：{selectedProfile?.host}<br/>输出上限：{selectedProfile?.maxTokens} tokens</>}
                {mode==='personal' && selectedProfile?.thinking && <><br/>分析模式：{selectedProfile.thinking==='enabled'?'深度思考（思考内容可能占用输出预算）':'普通分析'}</>}
                <br />
                发送商品资料快照、最近 12
                条对话及当前问题。图片仅以链接收录，不进行图片识别。
              </p>
              {mode==='personal' && <p className="text-muted-foreground">使用这套个人 API 账户付费，不自动切换其他账户。第三方接口会收到密钥和资料，请确认你信任上述域名。发送后在插件内部执行，不打开分析页；关闭工作台不会取消，退出浏览器或休眠可能中断。</p>}
              {mode==='personal' && <p className="text-muted-foreground">{personal.version===4?'本机记住这套 API 的授权，后续点击发送将直接调用并计费，不再弹窗。修改接收地址、接口格式、模型、分析模式或输出上限后重新确认。可在插件设置的「更多设置」撤销授权。':'当前插件为旧版，仍需每次确认。更新 V1.3.1 后即可记住本套授权。'}</p>}
              {mode==='company' && ai && (
                <p className="text-muted-foreground">
                  使用公司额度：每人每日{' '}
                  {ai.limits.userDaily === null
                    ? '不限次数'
                    : `${ai.limits.userDaily} 次`}
                  ，团队每日{' '}
                  {ai.limits.teamDaily === null
                    ? '不限次数'
                    : `${ai.limits.teamDaily} 次`}
                  。 费用按实际用量计算；取消后服务商可能已计费。
                </p>
              )}
              <label className="flex items-start gap-2">
                <Checkbox
                  checked={confirmConsent}
                  onCheckedChange={(value) => setConfirmConsent(Boolean(value))}
                  className="mt-1"
                />
                {mode==='personal'?(personal.version===4?'同意使用这套 API 发送分析资料并承担费用，在本机记住授权':'同意本次将资料发送到上述接口，并由所选个人 API 账户承担费用'):'同意本轮对话将资料发送至所选 AI，并使用公司 API 额度'}
              </label>
              <button
                type="button"
                disabled={!confirmConsent || sending}
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
