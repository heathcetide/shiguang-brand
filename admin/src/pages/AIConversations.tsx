import { DialogFrame } from '../components/admin/DialogFrame';
import { useQueryState } from '../hooks/useQueryState';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Eye, MessageCircle, RefreshCw, Search, X } from 'lucide-react';
import api from '../services/api';
import { createLatestRequest } from '../utils/latestRequest';

interface Conversation {
  userId: number;
  sessionId: string;
  username: string;
  turnCount: number;
  messageCount: number;
  avgResponseTimeMs: number | null;
  failedCount: number;
  sources: string | null;
  updatedAt: string;
  lastUserMessage: string | null;
}

interface ConversationDetail {
  user: { id: number; username: string };
  sessionId: string;
  messages: Array<{
    id: number;
    role: 'system' | 'user' | 'assistant';
    content: string;
    responseTimeMs: number | null;
    source: 'assistant' | 'voice' | 'cooking' | 'cooking_voice' | 'legacy';
    status: 'completed' | 'failed';
    payload: ConversationPayload | null;
    confirmationStatus: string | null;
    createdAt: string;
  }>;
}

interface ConversationPayload {
  actionCard?: { mealType?: string; foodName?: string; amount?: string; calories?: number | null; protein?: number | null; carbs?: number | null; fat?: number | null };
  missingCard?: { dishName?: string; missingIngredients?: Array<{ name?: string; amount?: string }> };
  optionsCard?: { title?: string; options?: Array<{ label?: string; actionText?: string }> };
  solutionCards?: Array<{ id?: string; schemeTag?: string; title?: string; ingredients?: string; cookingTip?: string; macros?: string; source?: string }>;
  writeConfirmation?: { action?: string };
  legacyCardSummaries?: string[];
  errorCode?: string;
  errorType?: string;
  errorMessage?: string;
  failureStage?: string;
  requestId?: string;
  occurredAt?: string;
  source?: string;
  modelIdentifier?: string | null;
}

interface ScanJob {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  errorMessage: string | null;
  updatedAt: string;
  userId: number;
  username: string;
  itemCount: number;
}

interface ScanJobDetail extends ScanJob {
  items: Array<{ foodName: string; quantity: string; suggestedStorageLocation: string; estimatedExpireDays: number }>;
}

function formatDateTime(value: string) {
  return new Date(`${value.replace(' ', 'T')}Z`).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function formatResponseTime(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '暂无耗时数据';
  if (value < 1_000) return `${Math.round(value)} ms`;
  if (value < 60_000) return `${(value / 1_000).toFixed(value < 10_000 ? 2 : 1)} 秒`;
  const minutes = Math.floor(value / 60_000);
  return `${minutes} 分 ${((value % 60_000) / 1_000).toFixed(1)} 秒`;
}

const sourceLabels: Record<string, string> = {
  assistant: 'AI 助手',
  voice: '语音助手',
  cooking: '做饭文字',
  cooking_voice: '做饭语音',
  legacy: '历史记录',
};

export default function AIConversations() {
  const [query, setQuery] = useQueryState<string>('q', '');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ConversationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [scanJobs, setScanJobs] = useState<ScanJob[]>([]);
  const [scanJobsLoading, setScanJobsLoading] = useState(true);
  const [selectedScanJob, setSelectedScanJob] = useState<ScanJobDetail | null>(null);
  const [scanDetailLoading, setScanDetailLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [scanJobsError, setScanJobsError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [scanDetailError, setScanDetailError] = useState('');
  const [detailTarget, setDetailTarget] = useState<Conversation | null>(null);
  const [scanDetailTarget, setScanDetailTarget] = useState<string | null>(null);
  const listRequests = useRef(createLatestRequest());
  const scanRequests = useRef(createLatestRequest());
  const detailRequests = useRef(createLatestRequest());
  const scanDetailRequests = useRef(createLatestRequest());
  useEffect(() => () => {
    detailRequests.current.cancel();
    scanDetailRequests.current.cancel();
  }, []);
  const totalTurns = conversations.reduce((sum, item) => sum + Number(item.turnCount || 0), 0);
  const activeUsers = new Set(conversations.map((item) => item.userId)).size;
  const selectedResponseTimes = selected?.messages
    .filter((message) => message.role === 'assistant' && message.status === 'completed' && message.responseTimeMs !== null)
    .map((message) => Number(message.responseTimeMs)) ?? [];
  const selectedAverageResponseTime = selectedResponseTimes.length
    ? selectedResponseTimes.reduce((sum, value) => sum + value, 0) / selectedResponseTimes.length
    : null;

  const loadConversations = useCallback(async () => {
    const request = listRequests.current.begin();
    setLoading(true);
    setLoadError('');
    setConversations([]);
    try {
      const response = await api.get<{ items: Conversation[] }>('/admin/chat-conversations', { params: { query: query || undefined }, signal: request.signal });
      if (request.isLatest()) setConversations(response.data.items);
    } catch {
      if (request.isLatest()) setLoadError('会话记录加载失败，请重试。');
    } finally {
      if (request.isLatest()) setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    const requests = listRequests.current;
    void loadConversations();
    return () => requests.cancel();
  }, [loadConversations]);

  const loadScanJobs = useCallback(async () => {
    const request = scanRequests.current.begin();
    setScanJobsLoading(true);
    setScanJobsError('');
    setScanJobs([]);
    try {
      const response = await api.get<{ items: ScanJob[] }>('/admin/inventory-scan-jobs', { signal: request.signal });
      if (request.isLatest()) setScanJobs(response.data.items);
    } catch {
      if (request.isLatest()) setScanJobsError('图片识别记录加载失败，请重试。');
    } finally {
      if (request.isLatest()) setScanJobsLoading(false);
    }
  }, []);

  useEffect(() => {
    const requests = scanRequests.current;
    void loadScanJobs();
    return () => requests.cancel();
  }, [loadScanJobs]);

  const closeDetail = () => {
    detailRequests.current.cancel();
    setDetailTarget(null);
    setSelected(null);
    setDetailError('');
    setDetailLoading(false);
  };

  const closeScanDetail = () => {
    scanDetailRequests.current.cancel();
    setScanDetailTarget(null);
    setSelectedScanJob(null);
    setScanDetailError('');
    setScanDetailLoading(false);
  };

  const openDetail = async (conversation: Conversation) => {
    const request = detailRequests.current.begin();
    setDetailTarget(conversation);
    setSelected(null);
    setDetailError('');
    setDetailLoading(true);
    try {
      const response = await api.get<ConversationDetail>(`/admin/chat-conversations/${conversation.userId}/${encodeURIComponent(conversation.sessionId)}`, { signal: request.signal });
      if (!request.isLatest()) return;
      if (response.data.user.id !== conversation.userId || response.data.sessionId !== conversation.sessionId) throw new Error('Conversation identity mismatch');
      setSelected(response.data);
    } catch {
      if (request.isLatest()) setDetailError('对话详情加载失败，请重试。');
    } finally {
      if (request.isLatest()) setDetailLoading(false);
    }
  };

  const openScanDetail = async (jobId: string) => {
    const request = scanDetailRequests.current.begin();
    setScanDetailTarget(jobId);
    setSelectedScanJob(null);
    setScanDetailError('');
    setScanDetailLoading(true);
    try {
      const response = await api.get<ScanJobDetail>(`/admin/inventory-scan-jobs/${jobId}`, { signal: request.signal });
      if (!request.isLatest()) return;
      if (response.data.id !== jobId) throw new Error('Scan identity mismatch');
      setSelectedScanJob(response.data);
    } catch {
      if (request.isLatest()) setScanDetailError('图片识别详情加载失败，请重试。');
    } finally {
      if (request.isLatest()) setScanDetailLoading(false);
    }
  };

  return (
    <div className="space-y-7">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-primary/10 p-2.5 text-primary"><MessageCircle className="h-6 w-6" /></div>
          <div>
            <h1 className="text-2xl font-bold text-text-main">AI 对话记录</h1>
            <p className="mt-1 text-sm text-text-muted">查看用户与 AI 的完整会话，用于客服跟进与模型质量排查。</p>
          </div>
        </div>
        <div className="flex gap-3">
          <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索用户名或 ID" className="w-64 rounded-xl bg-white py-2.5 pl-10 pr-4 text-sm shadow-sm outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
          <button type="button" onClick={() => { loadConversations(); loadScanJobs(); }} className="inline-flex items-center rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white"><RefreshCw className={`mr-2 h-4 w-4 ${loading || scanJobsLoading ? 'animate-spin' : ''}`} />刷新</button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl bg-white p-5 shadow-sm"><p className="text-xs text-text-muted">会话数</p><p className="mt-2 text-2xl font-bold text-text-main">{conversations.length}</p></div>
        <div className="rounded-2xl bg-white p-5 shadow-sm"><p className="text-xs text-text-muted">对话轮次</p><p className="mt-2 text-2xl font-bold text-text-main">{totalTurns}</p></div>
        <div className="rounded-2xl bg-white p-5 shadow-sm"><p className="text-xs text-text-muted">参与用户</p><p className="mt-2 text-2xl font-bold text-text-main">{activeUsers}</p></div>
      </div>

      <section className="rounded-[24px] bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center justify-between"><div><h2 className="font-bold text-text-main">会话列表</h2><p className="mt-1 text-xs text-text-muted">最近 100 段会话，每段会话可展开查看逐轮消息。</p></div><span className="rounded-full bg-background-alt px-3 py-1 text-xs text-text-muted">{conversations.length} 段</span></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[1000px] text-left"><thead><tr className="border-b border-background-alt text-xs text-text-muted"><th className="w-[19%] pb-3 font-medium">用户</th><th className="w-[13%] pb-3 font-medium">对话轮次</th><th className="w-[30%] pb-3 font-medium">最后提问</th><th className="w-[14%] pb-3 text-right font-medium">平均回复耗时</th><th className="w-[14%] pb-3 text-right font-medium">最后更新</th><th className="w-[10%] pb-3 text-right font-medium">操作</th></tr></thead>
          <tbody>{conversations.map((item) => <tr key={`${item.userId}-${item.sessionId}`} className="border-b border-background-alt/60 text-sm last:border-0"><td className="py-4"><p className="font-medium text-text-main">{item.username}</p><p className="mt-0.5 text-xs text-text-muted">ID {item.userId}</p></td><td className="py-4 text-text-main"><p>{item.turnCount} 轮 <span className="text-xs text-text-muted">/ {item.messageCount} 条可见消息</span>{item.failedCount > 0 ? <span className="ml-1 text-xs text-red-600">· {item.failedCount} 次失败</span> : null}</p><div className="mt-1 flex flex-wrap gap-1">{(item.sources || 'legacy').split(',').map((source) => <span key={source} className="rounded-full bg-background-alt px-1.5 py-0.5 text-[9px] text-text-muted">{sourceLabels[source] || source}</span>)}</div></td><td className="max-w-96 truncate py-4 text-text-muted" title={item.lastUserMessage || ''}>{item.lastUserMessage || '—'}</td><td className="py-4 text-right text-xs font-medium text-text-main">{formatResponseTime(item.avgResponseTimeMs)}</td><td className="py-4 text-right text-xs text-text-muted">{formatDateTime(item.updatedAt)}</td><td className="py-4 text-right"><button type="button" onClick={() => openDetail(item)} className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/15"><Eye className="h-3.5 w-3.5" />查看对话</button></td></tr>)}</tbody></table>
          {!loading && !loadError && conversations.length === 0 ? <div className="py-14 text-center text-sm text-text-muted">暂未记录 AI 对话；新产生的对话会出现在这里。</div> : null}
          {loadError ? <LoadFailure message={loadError} onRetry={loadConversations} /> : null}
          {loading ? <div className="py-14 text-center text-sm text-text-muted">正在加载会话记录...</div> : null}
        </div>
      </section>

      <section className="rounded-[24px] bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center justify-between"><div><h2 className="font-bold text-text-main">图片识别记录</h2><p className="mt-1 text-xs text-text-muted">食材、小票和订单图片识别任务，与聊天记录统一归档在此。</p></div><span className="rounded-full bg-background-alt px-3 py-1 text-xs text-text-muted">{scanJobs.length} 条</span></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[880px] text-left"><thead><tr className="border-b border-background-alt text-xs text-text-muted"><th className="w-[25%] pb-3 font-medium">用户</th><th className="w-[14%] pb-3 font-medium">状态</th><th className="w-[16%] pb-3 font-medium">结果</th><th className="w-[22%] pb-3 font-medium">异常摘要</th><th className="w-[14%] pb-3 text-right font-medium">最后更新</th><th className="w-[14%] pb-3 text-right font-medium">操作</th></tr></thead><tbody>{scanJobs.map((job) => <tr key={job.id} className="border-b border-background-alt/60 text-sm last:border-0"><td className="py-4"><p className="font-medium text-text-main">{job.username}</p><p className="mt-0.5 text-xs text-text-muted">ID {job.userId}</p></td><td className="py-4"><ScanStatus status={job.status} /></td><td className="py-4 text-text-main">{job.status === 'completed' ? `${job.itemCount} 项食材` : '—'}</td><td className="max-w-52 truncate py-4 text-xs text-red-600" title={job.errorMessage || ''}>{job.errorMessage || '—'}</td><td className="py-4 text-right text-xs text-text-muted">{formatDateTime(job.updatedAt)}</td><td className="py-4 text-right"><button type="button" onClick={() => openScanDetail(job.id)} className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/15"><Eye className="h-3.5 w-3.5" />查看详情</button></td></tr>)}</tbody></table>{scanJobsLoading ? <div className="py-10 text-center text-sm text-text-muted">正在加载识别记录...</div> : null}{scanJobsError ? <LoadFailure message={scanJobsError} onRetry={loadScanJobs} /> : null}{!scanJobsLoading && !scanJobsError && scanJobs.length === 0 ? <div className="py-10 text-center text-sm text-text-muted">暂无图片识别记录</div> : null}</div>
      </section>

      {detailTarget ? <DialogFrame onClose={closeDetail} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 p-5" ><section className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-[28px] bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}><div className="flex items-start justify-between border-b border-background-alt px-6 py-5"><div><p className="text-xs text-text-muted">AI 对话详情</p><h2 className="mt-1 text-lg font-bold text-text-main">{`${detailTarget.username} 的会话`}</h2></div><button aria-label="关闭" type="button" onClick={closeDetail} className="rounded-xl p-2 text-text-muted hover:bg-background-alt"><X className="h-5 w-5" /></button></div>{detailError ? <LoadFailure message={detailError} onRetry={() => openDetail(detailTarget)} /> : detailLoading || !selected ? <div className="flex h-52 items-center justify-center text-sm text-text-muted">正在加载对话...</div> : <><div className="grid grid-cols-2 gap-2 border-b border-background-alt bg-white px-6 py-4 sm:grid-cols-4"><div><p className="text-[10px] text-text-muted">用户消息</p><p className="mt-1 text-sm font-bold text-text-main">{selected.messages.filter((message) => message.role === 'user').length} 条</p></div><div><p className="text-[10px] text-text-muted">AI 回复</p><p className="mt-1 text-sm font-bold text-text-main">{selected.messages.filter((message) => message.role === 'assistant').length} 条{selected.messages.some((message) => message.role === 'assistant' && message.status === 'failed') ? <span className="ml-1 text-xs text-red-600">含失败</span> : null}</p></div><div><p className="text-[10px] text-text-muted">系统指令</p><p className="mt-1 text-sm font-bold text-amber-700">{selected.messages.filter((message) => message.role === 'system').length} 条</p></div><div><p className="text-[10px] text-text-muted">平均回复耗时</p><p className="mt-1 text-sm font-bold text-primary">{formatResponseTime(selectedAverageResponseTime)}</p></div></div><div className="space-y-4 overflow-y-auto bg-background-alt p-6">{selected.messages.map((message) => <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : message.role === 'assistant' ? 'justify-start' : 'justify-center'}`}><div className={`rounded-2xl px-4 py-3 text-sm leading-6 ${message.role === 'user' ? 'max-w-[82%] bg-primary text-white' : message.role === 'assistant' ? `max-w-[82%] border bg-white text-text-main shadow-sm ${message.status === 'failed' ? 'border-red-200' : 'border-transparent'}` : 'max-w-[90%] border border-dashed border-amber-300 bg-amber-50 text-amber-950'}`}><div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] opacity-70"><span>{message.role === 'user' ? '用户' : message.role === 'assistant' ? 'AI 助手' : '系统指令'} · {sourceLabels[message.source] || message.source} · {formatDateTime(message.createdAt)}</span>{message.role === 'assistant' ? <span className={`rounded-full px-2 py-0.5 font-semibold opacity-100 ${message.status === 'failed' ? 'bg-red-50 text-red-600' : 'bg-primary/10 text-primary'}`}>{message.status === 'failed' ? '回复失败' : `回复耗时 ${formatResponseTime(message.responseTimeMs)}`}</span> : null}</div><p className="whitespace-pre-wrap">{message.content}</p>{message.payload ? <ConversationPayloadView payload={message.payload} confirmationStatus={message.confirmationStatus} /> : null}</div></div>)}</div></>}</section></DialogFrame> : null}

      {scanDetailTarget ? <DialogFrame onClose={closeScanDetail} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 p-5" ><section className="max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-[28px] bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}><div className="flex items-start justify-between border-b border-background-alt px-6 py-5"><div><p className="text-xs text-text-muted">图片识别详情</p><h2 className="mt-1 text-lg font-bold text-text-main">{selectedScanJob ? `${selectedScanJob.username} 的识别结果` : '正在加载...'}</h2></div><button aria-label="关闭" type="button" onClick={closeScanDetail} className="rounded-xl p-2 text-text-muted hover:bg-background-alt"><X className="h-5 w-5" /></button></div>{scanDetailError ? <LoadFailure message={scanDetailError} onRetry={() => openScanDetail(scanDetailTarget)} /> : scanDetailLoading || !selectedScanJob ? <div className="flex h-52 items-center justify-center text-sm text-text-muted">正在加载识别详情...</div> : <div className="max-h-[65vh] overflow-y-auto p-6"><div className="grid grid-cols-3 gap-3 rounded-2xl bg-background-alt p-4 text-sm"><div><p className="text-xs text-text-muted">状态</p><div className="mt-1"><ScanStatus status={selectedScanJob.status} /></div></div><div><p className="text-xs text-text-muted">识别条目</p><p className="mt-1 font-semibold text-text-main">{selectedScanJob.items.length} 项</p></div><div><p className="text-xs text-text-muted">最后更新</p><p className="mt-1 text-xs text-text-main">{formatDateTime(selectedScanJob.updatedAt)}</p></div></div>{selectedScanJob.errorMessage ? <div className="mt-4 rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{selectedScanJob.errorMessage}</div> : null}{selectedScanJob.items.length > 0 ? <div className="mt-5 overflow-hidden rounded-2xl border border-background-alt">{selectedScanJob.items.map((item, index) => <div key={`${item.foodName}-${index}`} className="grid grid-cols-[1fr_auto_auto] gap-3 border-b border-background-alt px-4 py-3 text-sm last:border-0"><span className="font-medium text-text-main">{item.foodName}</span><span className="text-text-muted">{item.quantity}</span><span className="text-text-muted">{item.suggestedStorageLocation} · {item.estimatedExpireDays} 天</span></div>)}</div> : !selectedScanJob.errorMessage ? <div className="py-10 text-center text-sm text-text-muted">未识别到可入库食材。</div> : null}</div>}</section></DialogFrame> : null}
    </div>
  );
}

function ConversationPayloadView({ payload, confirmationStatus }: { payload: ConversationPayload; confirmationStatus: string | null }) {
  return (
    <div className="mt-3 space-y-2 border-t border-background-alt pt-3 text-xs leading-5">
      {payload.actionCard ? <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3"><p className="font-bold text-emerald-800">饮食打卡卡片 · {payload.actionCard.mealType || '未分类'}</p><p className="mt-1 text-text-main">{payload.actionCard.foodName || '未命名食物'} · {payload.actionCard.amount || '未填写分量'}</p><p className="text-text-muted">{payload.actionCard.calories ?? '—'} kcal · 蛋白质 {payload.actionCard.protein ?? '—'}g · 碳水 {payload.actionCard.carbs ?? '—'}g · 脂肪 {payload.actionCard.fat ?? '—'}g</p></div> : null}
      {payload.missingCard ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3"><p className="font-bold text-amber-800">缺料采购卡片 · {payload.missingCard.dishName || '目标料理'}</p><div className="mt-1 flex flex-wrap gap-1">{(payload.missingCard.missingIngredients || []).map((item, index) => <span key={`${item.name}-${index}`} className="rounded-full bg-white px-2 py-0.5 text-amber-800">{item.name} {item.amount}</span>)}</div></div> : null}
      {payload.optionsCard ? <div className="rounded-xl border border-blue-100 bg-blue-50 p-3"><p className="font-bold text-blue-800">选项卡片 · {payload.optionsCard.title}</p><div className="mt-1 space-y-1">{(payload.optionsCard.options || []).map((item, index) => <p key={`${item.label}-${index}`}><span className="font-semibold">{item.label}</span>：{item.actionText}</p>)}</div></div> : null}
      {payload.solutionCards?.map((card, index) => <div key={card.id || `${card.title}-${index}`} className="rounded-xl border border-primary/15 bg-primary/5 p-3"><div className="flex items-center justify-between gap-2"><p className="font-bold text-primary">{card.schemeTag || `方案 ${index + 1}`} · {card.title}</p><span className="rounded-full bg-white px-2 py-0.5 text-[9px] text-text-muted">{card.source === 'local' ? '本地菜谱' : 'AI 方案'}</span></div><p className="mt-1 text-text-main">{card.ingredients}</p>{card.cookingTip ? <p className="text-text-muted">做法：{card.cookingTip}</p> : null}{card.macros ? <p className="font-medium text-primary">{card.macros}</p> : null}</div>)}
      {payload.legacyCardSummaries?.map((summary, index) => <div key={index} className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="mb-1 font-bold text-slate-600">历史卡片摘要</p><p className="whitespace-pre-wrap text-slate-700">{summary}</p></div>)}
      {payload.writeConfirmation || confirmationStatus ? <div className="rounded-xl bg-background-alt p-2.5 text-text-muted">操作确认：{confirmationStatus === 'committed' ? '已确认执行' : confirmationStatus === 'expired' ? '已过期' : confirmationStatus === 'cancelled' ? '已取消' : '待用户确认'}</div> : null}
      {payload.errorCode ? <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-800"><p className="font-bold">AI 调用失败详情</p><dl className="mt-1 grid grid-cols-[72px_1fr] gap-x-2 gap-y-1"><dt>错误代码</dt><dd className="break-all font-mono">{payload.errorCode}</dd>{payload.errorType ? <><dt>错误类型</dt><dd>{payload.errorType}</dd></> : null}{payload.failureStage ? <><dt>失败阶段</dt><dd>{payload.failureStage}</dd></> : null}{payload.modelIdentifier ? <><dt>模型标识</dt><dd className="break-all font-mono">{payload.modelIdentifier}</dd></> : null}{payload.errorMessage ? <><dt>错误信息</dt><dd className="break-words">{payload.errorMessage}</dd></> : null}{payload.requestId ? <><dt>追踪 ID</dt><dd className="break-all font-mono">{payload.requestId}</dd></> : null}{payload.occurredAt ? <><dt>发生时间</dt><dd>{new Date(payload.occurredAt).toLocaleString('zh-CN')}</dd></> : null}</dl></div> : null}
    </div>
  );
}

function ScanStatus({ status }: { status: ScanJob['status'] }) {
  const styles: Record<ScanJob['status'], string> = { queued: 'bg-amber-50 text-amber-700', processing: 'bg-blue-50 text-blue-700', completed: 'bg-emerald-50 text-emerald-700', failed: 'bg-red-50 text-red-700' };
  const labels: Record<ScanJob['status'], string> = { queued: '排队中', processing: '识别中', completed: '已完成', failed: '失败' };
  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${styles[status]}`}>{labels[status]}</span>;
}

function LoadFailure({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div role="alert" className="p-6 text-sm text-red-600"><p>{message}</p><button type="button" onClick={onRetry} className="mt-2 font-semibold text-primary">重新加载</button></div>;
}
