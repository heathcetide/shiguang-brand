import { DialogFrame } from '../components/admin/DialogFrame';
import { useQueryState } from '../hooks/useQueryState';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Eye,
  Filter,
  GitBranch,
  RefreshCw,
  Search,
  ShieldCheck,
  Workflow,
  X,
  Zap,
} from 'lucide-react';
import api from '../services/api';

type RunStatus = 'queued' | 'running' | 'awaiting_input' | 'awaiting_approval' | 'completed' | 'failed' | 'cancelled' | 'expired';
type Modality = 'text' | 'home' | 'cooking' | 'image' | 'audio' | 'inventory_scan' | 'receipt';

interface AgentRunItem {
  id: string;
  userId: number;
  username: string;
  sessionId: string;
  modality: Modality;
  source: string;
  status: RunStatus;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  durationMs: number | null;
  eventCount: number;
  actionCount: number;
  modelCallCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  hasMedia: number;
  specialists: string | null;
  lastEventSummary: string | null;
  promptPreview: string;
}

interface AgentRunDetail {
  run: {
    id: string;
    userId: number;
    username: string;
    sessionId: string;
    modality: Modality;
    source: string;
    status: RunStatus;
    input: Record<string, unknown>;
    result: { reply?: string; transcript?: string; artifacts?: Array<{ type?: string; title?: string; data?: unknown }> };
    pendingApproval: unknown;
    pendingInput: { question?: string } | null;
    error: { code?: string; message?: string } | null;
    hasMedia: boolean;
    checkpointCount: number;
    checkpointWriteCount: number;
    startedAt: string | null;
    completedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  events: Array<{ sequence: number; agentName: string; eventType: string; summary: string; payload: unknown; createdAt: string }>;
  actions: Array<{
    id: string;
    actionType: string;
    riskLevel: 'low' | 'high' | 'forbidden';
    status: string;
    payload: unknown;
    before: unknown;
    result: unknown;
    version: number;
    approvalDecision: string | null;
    approvedAt: string | null;
    executedAt: string | null;
    undoneAt: string | null;
  }>;
  usage: {
    summary: AgentUsageSummary;
    byAgent: Array<AgentUsageSummary & { agentName: string }>;
    records: Array<{
      id: number;
      agentName: string | null;
      phase: string | null;
      endpoint: string;
      model: string;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      estimatedCostUsd: number;
      latencyMs: number;
      success: number;
      failureReason: string | null;
      createdAt: string;
    }>;
  };
}

interface AgentUsageSummary {
  modelCalls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  avgLatencyMs?: number;
}

const agentOptions = ['', 'NutritionPlanningAgent', 'RecipeCookingAgent', 'VisionAgent', 'VoiceAgent', 'OperationsAgent'];

const statusStyles: Record<RunStatus, string> = {
  queued: 'bg-slate-100 text-slate-600',
  running: 'bg-blue-50 text-blue-700',
  awaiting_input: 'bg-amber-50 text-amber-700',
  awaiting_approval: 'bg-orange-50 text-orange-700',
  completed: 'bg-emerald-50 text-emerald-700',
  failed: 'bg-red-50 text-red-700',
  cancelled: 'bg-slate-100 text-slate-500',
  expired: 'bg-zinc-100 text-zinc-600',
};

const statusLabels: Record<RunStatus, string> = {
  running: '运行中', queued: '排队中', awaiting_input: '等待用户输入', awaiting_approval: '等待用户确认',
  completed: '已完成', failed: '失败', cancelled: '已取消', expired: '已过期',
};

const modalityLabels: Record<Modality, string> = {
  text: '文字', home: '首页推荐', cooking: '烹饪', image: '食物图片', audio: '语音',
  inventory_scan: '库存扫描', receipt: '小票扫描',
};

type RunInputPresentation = {
  originLabel: string;
  panelTitle: string;
  promptLabel: string;
  description: string;
  userInitiated: boolean;
};

function getRunInputPresentation(run: AgentRunDetail['run']): RunInputPresentation {
  if (['assistant', 'voice', 'cooking'].includes(run.source)) {
    return {
      originLabel: '用户直接发起',
      panelTitle: '用户原始输入',
      promptLabel: '用户发送的内容',
      description: '下方内容来自本次会话的用户请求；媒体正文和内部 mediaRef 不展示。',
      userInitiated: true,
    };
  }
  if (run.source === 'home') {
    return {
      originLabel: '系统自动触发',
      panelTitle: '首页推荐任务',
      promptLabel: '发送给 Agent 的系统任务指令',
      description: '该 Run 由首页推荐自动触发，不存在用户直接输入。下方是服务端生成的内部任务指令。',
      userInitiated: false,
    };
  }
  if (run.source === 'cooking_voice' || run.source === 'cooking_voice_control') {
    return {
      originLabel: '用户操作 + 系统上下文',
      panelTitle: '烹饪语音任务',
      promptLabel: '运行请求与烹饪上下文',
      description: '该字段组合了用户语音请求和当前烹饪步骤上下文，不等同于用户的逐字原始输入。',
      userInitiated: false,
    };
  }
  return {
    originLabel: '系统或媒体触发',
    panelTitle: '运行任务输入',
    promptLabel: '发送给 Agent 的任务指令',
    description: '该 Run 由业务流程或媒体处理触发；这里展示的是运行任务指令，不标记为用户原始输入。',
    userInitiated: false,
  };
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(`${value.replace(' ', 'T')}Z`).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function formatDuration(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (value < 1_000) return `${Math.max(0, Math.round(value))} ms`;
  if (value < 60_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)} 秒`;
  return `${Math.floor(value / 60_000)} 分 ${Math.round((value % 60_000) / 1_000)} 秒`;
}

const numberFormatter = new Intl.NumberFormat('zh-CN');
function formatNumber(value: number | null | undefined) {
  return numberFormatter.format(Number(value) || 0);
}

function formatCost(value: number | null | undefined) {
  const cost = Number(value) || 0;
  return cost ? `$${cost.toFixed(cost < 0.01 ? 4 : 2)}` : '$0.00';
}

function StatusBadge({ status }: { status: RunStatus }) {
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusStyles[status]}`}>{statusLabels[status]}</span>;
}

function JsonBlock({ value, empty = '暂无结构化数据' }: { value: unknown; empty?: string }) {
  if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) {
    return <p className="text-xs text-text-muted">{empty}</p>;
  }
  return <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-950 p-4 text-[11px] leading-5 text-slate-100">{JSON.stringify(value, null, 2)}</pre>;
}

export default function AgentRuns() {
  const [items, setItems] = useState<AgentRunItem[]>([]);
  const [total, setTotal] = useState(0);
  const [statusCounts, setStatusCounts] = useState<Array<{ status: RunStatus; count: number }>>([]);
  const [usageSummary, setUsageSummary] = useState<AgentUsageSummary>({ modelCalls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUsd: 0 });
  const [query, setQuery] = useQueryState<string>('q', '');
  const [status, setStatus] = useQueryState<string>('status', '', ['', ...Object.keys(statusLabels)]);
  const [modality, setModality] = useQueryState<string>('modality', '', ['', ...Object.keys(modalityLabels)]);
  const [agent, setAgent] = useQueryState<string>('agent', '', agentOptions);
  const [range, setRange] = useQueryState<string>('range', '30d', ["7d", "30d", "90d", "all"]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<AgentRunDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadRuns = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError('');
    try {
      const response = await api.get('/admin/agent-runs', { params: { query: query || undefined, status: status || undefined, modality: modality || undefined, agent: agent || undefined, range, page, pageSize: 25 } });
      setItems(response.data.items);
      setTotal(response.data.total);
      setStatusCounts(response.data.statusCounts);
      setUsageSummary(response.data.usageSummary);
    } catch {
      setError('任务记录加载失败，请检查服务器连接后重试');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [agent, modality, page, query, range, status]);

  useEffect(() => { loadRuns(); }, [loadRuns]);
  useEffect(() => {
    if (!items.some((item) => item.status === 'running' || item.status === 'queued')) return undefined;
    const timer = window.setInterval(() => loadRuns(true), 10_000);
    return () => window.clearInterval(timer);
  }, [items, loadRuns]);

  const openDetail = async (runId: string) => {
    setDetailLoading(true);
    setSelected(null);
    try {
      const response = await api.get<AgentRunDetail>(`/admin/agent-runs/${runId}`);
      setSelected(response.data);
    } finally {
      setDetailLoading(false);
    }
  };

  const countMap = useMemo(() => Object.fromEntries(statusCounts.map((item) => [item.status, Number(item.count) || 0])), [statusCounts]);
  const pageCount = Math.max(1, Math.ceil(total / 25));
  const resetPage = (setter: (value: string) => void, value: string) => { setter(value); setPage(1); };

  return (
    <div className="space-y-7">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="rounded-2xl bg-primary/10 p-2.5 text-primary shrink-0"><Workflow className="h-6 w-6" /></div>
          <div className="min-w-0"><h1 className="text-2xl font-bold text-text-main truncate">任务运行</h1><p className="mt-1 text-sm text-text-muted">查看 Supervisor 分派、公开事件、结构化产物与业务动作；不展示模型思维链或原始媒体。</p></div>
        </div>
        <button type="button" onClick={() => loadRuns()} className="inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-hover transition-colors shrink-0 self-start sm:self-auto"><RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />刷新</button>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {[
          { label: '当前范围', value: total, icon: Activity, color: 'text-primary bg-primary/10' },
          { label: '运行 / 排队', value: (countMap.running || 0) + (countMap.queued || 0), icon: Clock3, color: 'text-blue-700 bg-blue-50' },
          { label: '等待用户', value: (countMap.awaiting_input || 0) + (countMap.awaiting_approval || 0), icon: ShieldCheck, color: 'text-amber-700 bg-amber-50' },
          { label: '已完成', value: countMap.completed || 0, icon: CheckCircle2, color: 'text-emerald-700 bg-emerald-50' },
          { label: '失败 / 过期', value: (countMap.failed || 0) + (countMap.expired || 0), icon: AlertTriangle, color: 'text-red-700 bg-red-50' },
          { label: 'Token 消耗', value: formatNumber(usageSummary.totalTokens), note: `${usageSummary.modelCalls} 次模型调用`, icon: Zap, color: 'text-violet-700 bg-violet-50' },
        ].map((card) => <div key={card.label} className="rounded-2xl bg-white p-4 shadow-sm"><div className={`inline-flex rounded-xl p-2 ${card.color}`}><card.icon className="h-4 w-4" /></div><p className="mt-3 text-xs text-text-muted">{card.label}</p><p className="mt-1 text-2xl font-bold text-text-main">{card.value}</p>{card.note ? <p className="mt-1 text-[10px] text-text-muted">{card.note}</p> : null}</div>)}
      </div>

      <section className="rounded-[24px] bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[200px] sm:min-w-64 flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" /><input value={query} onChange={(event) => resetPage(setQuery, event.target.value)} placeholder="搜索 Run ID、会话、用户名或用户 ID" className="w-full rounded-xl border border-gray-200 py-2.5 pl-10 pr-4 text-sm outline-none focus:border-primary" /></div>
          <Filter className="h-4 w-4 text-text-muted hidden sm:block" />
          <select value={status} onChange={(event) => resetPage(setStatus, event.target.value)} className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-text-main max-w-full"><option value="">全部状态</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <select value={modality} onChange={(event) => resetPage(setModality, event.target.value)} className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-text-main max-w-full"><option value="">全部模态</option>{Object.entries(modalityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <select value={agent} onChange={(event) => resetPage(setAgent, event.target.value)} className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-text-main max-w-full">{agentOptions.map((value) => <option key={value || 'all'} value={value}>{value || '全部专业 Agent'}</option>)}</select>
          <select value={range} onChange={(event) => resetPage(setRange, event.target.value)} className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-text-main max-w-full"><option value="7d">近 7 天</option><option value="30d">近 30 天</option><option value="90d">近 90 天</option><option value="all">全部时间</option></select>
        </div>
      </section>

      {error ? <div className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div> : null}

      <section className="overflow-hidden rounded-[24px] bg-white shadow-sm">
        <div className="overflow-x-auto"><table className="w-full min-w-[1120px] text-left"><thead><tr className="border-b border-background-alt bg-background-alt/40 text-xs text-text-muted"><th className="px-5 py-4 font-medium">用户 / Run</th><th className="px-4 py-4 font-medium">模态</th><th className="px-4 py-4 font-medium">状态</th><th className="px-4 py-4 font-medium">公开目标</th><th className="px-4 py-4 font-medium">专业 Agent</th><th className="whitespace-nowrap px-4 py-4 font-medium">事件 / 动作</th><th className="whitespace-nowrap px-4 py-4 text-right font-medium">Token / 费用</th><th className="whitespace-nowrap px-5 py-4 text-right font-medium">耗时</th></tr></thead>
          <tbody>{items.map((item) => (
            <tr
              key={item.id}
              role="button"
              tabIndex={0}
              aria-label={`查看 ${item.username} 的 Agent Run 详情`}
              onClick={() => void openDetail(item.id)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                void openDetail(item.id);
              }}
              className="group cursor-pointer border-b border-background-alt/70 text-sm transition-colors last:border-0 hover:bg-primary/[0.045] focus-visible:bg-primary/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
            >
              <td className="px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-text-main">{item.username} <span className="text-xs font-normal text-text-muted">ID {item.userId}</span></p>
                    <p className="mt-1 max-w-44 truncate font-mono text-[10px] text-text-muted" title={item.id}>{item.id}</p>
                    <p className="mt-1 text-[10px] text-text-muted">{formatDateTime(item.createdAt)}</p>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-primary/10 px-2 py-1 text-[10px] font-semibold text-primary transition-colors group-hover:bg-primary group-hover:text-white">
                    <Eye className="h-3 w-3" />详情
                  </span>
                </div>
              </td>
              <td className="px-4 py-4"><span className="inline-flex whitespace-nowrap rounded-lg bg-background-alt px-2 py-1 text-xs text-text-main">{modalityLabels[item.modality]}</span>{item.hasMedia ? <p className="mt-1 text-[10px] text-text-muted">含受保护媒体</p> : null}</td>
              <td className="px-4 py-4"><StatusBadge status={item.status} />{item.errorMessage ? <p className="mt-2 max-w-44 truncate text-[10px] text-red-600" title={item.errorMessage}>{item.errorMessage}</p> : <p className="mt-2 max-w-44 truncate text-[10px] text-text-muted">{item.lastEventSummary || '等待事件'}</p>}</td>
              <td className="max-w-72 px-4 py-4"><p className="line-clamp-2 text-xs leading-5 text-text-main" title={item.promptPreview}>{item.promptPreview || '媒体或系统触发任务'}</p></td>
              <td className="px-4 py-4"><div className="flex max-w-56 flex-wrap gap-1">{(item.specialists || '').split(',').filter(Boolean).map((name) => <span key={name} className="rounded-full bg-primary/8 px-2 py-0.5 text-[10px] text-primary">{name.replace('Agent', '')}</span>)}{!item.specialists ? <span className="whitespace-nowrap text-xs text-text-muted">尚未分派</span> : null}</div></td>
              <td className="whitespace-nowrap px-4 py-4 text-xs text-text-main"><p>{item.eventCount} 个事件</p><p className="mt-1 text-text-muted">{item.actionCount} 个业务动作</p></td>
              <td className="whitespace-nowrap px-4 py-4 text-right text-xs"><p className="font-semibold text-violet-700">{formatNumber(item.totalTokens)}</p><p className="mt-1 text-[10px] text-text-muted">{item.modelCallCount} 次 · {formatCost(item.estimatedCostUsd)}</p></td>
              <td className="whitespace-nowrap px-5 py-4 text-right text-xs font-medium text-text-main">{formatDuration(item.durationMs)}</td>
            </tr>
          ))}</tbody></table>
          {loading ? <div className="py-16 text-center text-sm text-text-muted">正在加载 Agent Run...</div> : null}{!loading && items.length === 0 ? <div className="py-16 text-center text-sm text-text-muted">当前筛选范围内暂无 Agent Run</div> : null}</div>
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-background-alt px-5 py-4 text-xs text-text-muted"><span>共 {total} 条 · 第 {page}/{pageCount} 页</span><div className="flex gap-2"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-lg border border-gray-200 px-3 py-1.5 disabled:opacity-40">上一页</button><button type="button" disabled={page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} className="rounded-lg border border-gray-200 px-3 py-1.5 disabled:opacity-40">下一页</button></div></div>
      </section>

      {selected || detailLoading ? <RunDetailModal detail={selected} loading={detailLoading} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}

function RunDetailModal({ detail, loading, onClose }: { detail: AgentRunDetail | null; loading: boolean; onClose: () => void }) {
  const run = detail?.run;
  const inputPrompt = typeof run?.input.prompt === 'string' ? run.input.prompt : '';
  const inputPresentation = run ? getRunInputPresentation(run) : null;
  const [activeTab, setActiveTab] = useState<'result' | 'overview' | 'usage' | 'events' | 'actions'>('result');
  const [selectedEventSequence, setSelectedEventSequence] = useState<number | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const artifacts = run?.result.artifacts || [];
  const firstEventSequence = detail?.events[0]?.sequence ?? null;
  const selectedEvent = detail?.events.find((event) => event.sequence === selectedEventSequence) || detail?.events[0];

  useEffect(() => {
    setActiveTab('result');
    setSelectedEventSequence(firstEventSequence);
  }, [firstEventSequence, run?.id]);

  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [activeTab, run?.id]);

  const tabs = [
    { id: 'result' as const, label: '运行结果', count: artifacts.length || undefined },
    { id: 'overview' as const, label: '触发与概览' },
    { id: 'usage' as const, label: 'Token 用量', count: detail?.usage.summary.modelCalls || undefined },
    { id: 'events' as const, label: '公开事件', count: detail?.events.length },
    { id: 'actions' as const, label: '业务动作', count: detail?.actions.length },
  ];

  return (
    <DialogFrame onClose={onClose} busy={loading} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-3 sm:p-4" >
      <section className="flex max-h-[92vh] max-h-[92dvh] min-h-0 w-full max-w-6xl flex-col overflow-hidden rounded-[24px] bg-white shadow-2xl sm:rounded-[28px]" onClick={(event) => event.stopPropagation()}>
        <header className="flex shrink-0 items-start justify-between border-b border-background-alt px-5 py-4 sm:px-6 sm:py-5">
          <div className="min-w-0">
            <p className="text-xs text-text-muted">Agent Run 只读审计详情</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-bold text-text-main">{run ? `${run.username} · ${modalityLabels[run.modality]}` : '正在加载...'}</h2>
              {run ? <StatusBadge status={run.status} /> : null}
            </div>
            {run ? <p className="mt-1 truncate font-mono text-[10px] text-text-muted">{run.id}</p> : null}
          </div>
          <button type="button" onClick={onClose} disabled={loading} aria-label="关闭详情" className="ml-3 shrink-0 rounded-xl p-2 text-text-muted hover:bg-background-alt"><X className="h-5 w-5" /></button>
        </header>

        {!loading && detail && run ? (
          <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-background-alt bg-white px-4 pt-2 sm:px-6" aria-label="运行详情分类">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                aria-selected={activeTab === tab.id}
                className={`whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium transition-colors ${activeTab === tab.id ? 'border-primary text-primary' : 'border-transparent text-text-muted hover:text-text-main'}`}
              >
                {tab.label}{tab.count !== undefined ? `（${tab.count}）` : ''}
              </button>
            ))}
          </nav>
        ) : null}

        {loading || !detail || !run ? (
          <div className="flex h-64 shrink-0 items-center justify-center text-sm text-text-muted">正在加载运行详情...</div>
        ) : (
          <div ref={contentRef} className={`min-h-0 flex-1 bg-background-alt p-4 sm:p-6 ${activeTab === 'events' ? 'flex flex-col overflow-y-auto xl:overflow-hidden' : 'overflow-y-auto'}`}>
            {run.error ? <div className="mb-4 rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-700"><p className="font-semibold">{run.error.code || '运行失败'}</p><p className="mt-1">{run.error.message}</p></div> : null}
            {run.pendingInput?.question ? <div className="mb-4 rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm text-amber-800">等待用户补充：{run.pendingInput.question}</div> : null}

            {activeTab === 'result' ? (
              <div className="space-y-5">
                <Panel title="最终答复" subtitle="这是本次 Agent Run 最终返回给用户的内容">
                  <p className="whitespace-pre-wrap text-sm leading-7 text-text-main">{run.result.reply || (artifacts.length ? '本次运行生成了结构化产物，请在下方查看。' : '本次运行未保存可展示的最终答复。')}</p>
                  {run.result.transcript ? <div className="mt-4 rounded-xl bg-blue-50 p-3 text-xs leading-5 text-blue-800"><span className="font-semibold">语音转录：</span>{run.result.transcript}</div> : null}
                </Panel>

                <Panel title={`结构化产物（${artifacts.length}）`} subtitle="展示各专业 Agent 生成并通过安全检查的结果">
                  {artifacts.length ? <div className="space-y-4">{artifacts.map((artifact, index) => <ArtifactCard key={`${artifact.type || 'artifact'}-${index}`} artifact={artifact} index={index} />)}</div> : <p className="text-sm text-text-muted">本次 Run 没有结构化产物。</p>}
                </Panel>
              </div>
            ) : null}

            {activeTab === 'overview' ? (
              <div className="space-y-5">
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-6"><Info label="状态"><StatusBadge status={run.status} /></Info><Info label="创建时间" value={formatDateTime(run.createdAt)} /><Info label="完成时间" value={formatDateTime(run.completedAt)} /><Info label="媒体" value={run.hasMedia ? '有（内容受保护）' : '无'} /><Info label="Checkpoint" value={`${run.checkpointCount} 个`} /><Info label="Checkpoint 写入" value={`${run.checkpointWriteCount} 次`} /></div>
                <Panel title={inputPresentation?.panelTitle || '运行任务输入'} subtitle={inputPresentation?.description}>
                  <div className="mb-4 flex flex-wrap items-center gap-2">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${inputPresentation?.userInitiated ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                      {inputPresentation?.originLabel || '未知触发来源'}
                    </span>
                    <span className="font-mono text-[10px] text-text-muted">source: {run.source}</span>
                  </div>
                  <div className="rounded-2xl border border-gray-100 bg-background-alt/55 p-4">
                    <p className="text-[11px] font-semibold text-text-muted">{inputPresentation?.promptLabel || '运行指令'}</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-text-main">{inputPrompt || '本次运行没有保存文字任务指令。'}</p>
                  </div>
                  <details className="mt-4 rounded-2xl border border-gray-100 bg-white p-4">
                    <summary className="cursor-pointer text-xs font-semibold text-primary">查看完整运行参数（审计）</summary>
                    <div className="mt-3"><JsonBlock value={run.input} /></div>
                  </details>
                </Panel>
              </div>
            ) : null}

            {activeTab === 'usage' ? (
              <div className="space-y-5">
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
                  <Info label="模型调用" value={`${detail.usage.summary.modelCalls} 次`} />
                  <Info label="输入 Token" value={formatNumber(detail.usage.summary.promptTokens)} />
                  <Info label="输出 Token" value={formatNumber(detail.usage.summary.completionTokens)} />
                  <Info label="Token 总量" value={formatNumber(detail.usage.summary.totalTokens)} />
                  <Info label="平均响应" value={formatDuration(detail.usage.summary.avgLatencyMs)} />
                  <Info label="估算费用" value={formatCost(detail.usage.summary.estimatedCostUsd)} />
                </div>

                <Panel title="按 Agent 汇总" subtitle="同一次 Run 内各 Agent 和 Supervisor 的模型消耗">
                  {detail.usage.byAgent.length ? (
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {detail.usage.byAgent.map((item) => (
                        <div key={item.agentName} className="rounded-2xl border border-violet-100 bg-violet-50/45 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div><p className="text-sm font-semibold text-text-main">{item.agentName}</p><p className="mt-1 text-[10px] text-text-muted">{item.modelCalls} 次模型调用</p></div>
                            <span className="text-sm font-bold text-violet-700">{formatNumber(item.totalTokens)}</span>
                          </div>
                          <div className="mt-3 flex items-center justify-between border-t border-violet-100 pt-3 text-[10px] text-text-muted">
                            <span>输入 {formatNumber(item.promptTokens)} · 输出 {formatNumber(item.completionTokens)}</span>
                            <span>{formatCost(item.estimatedCostUsd)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-sm text-text-muted">历史 Run 尚无可归因的 Token 记录；新运行会自动写入。</p>}
                </Panel>

                <Panel title={`调用明细（${detail.usage.records.length}）`} subtitle="按实际调用顺序展示模型、阶段、Token、延迟与结果">
                  {detail.usage.records.length ? (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[860px] text-left text-xs">
                        <thead><tr className="border-b border-gray-100 text-text-muted"><th className="pb-3 font-medium">Agent / 阶段</th><th className="pb-3 font-medium">模型</th><th className="pb-3 text-right font-medium">输入</th><th className="pb-3 text-right font-medium">输出</th><th className="pb-3 text-right font-medium">总量</th><th className="pb-3 text-right font-medium">延迟</th><th className="pb-3 text-right font-medium">费用</th><th className="pb-3 text-right font-medium">状态</th></tr></thead>
                        <tbody>{detail.usage.records.map((record) => <tr key={record.id} className="border-b border-gray-50 last:border-0"><td className="py-3"><p className="font-semibold text-text-main">{record.agentName || 'Unknown'}</p><p className="mt-0.5 text-[10px] text-text-muted">{record.phase || record.endpoint}</p></td><td className="max-w-48 truncate py-3 font-mono text-[10px] text-text-muted" title={record.model}>{record.model}</td><td className="py-3 text-right text-text-muted">{formatNumber(record.promptTokens)}</td><td className="py-3 text-right text-text-muted">{formatNumber(record.completionTokens)}</td><td className="py-3 text-right font-semibold text-text-main">{formatNumber(record.totalTokens)}</td><td className="py-3 text-right text-text-muted">{formatDuration(record.latencyMs)}</td><td className="py-3 text-right text-text-muted">{formatCost(record.estimatedCostUsd)}</td><td className="py-3 text-right"><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${record.success ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{record.success ? '成功' : '失败'}</span></td></tr>)}</tbody>
                      </table>
                    </div>
                  ) : <p className="text-sm text-text-muted">暂无模型调用明细。</p>}
                </Panel>
              </div>
            ) : null}

            {activeTab === 'events' ? (
              detail.events.length ? (
                <div className="grid min-h-0 flex-1 items-start gap-5 xl:h-full xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.35fr)] xl:items-stretch">
                  <div className="min-h-0 pb-[max(1.5rem,env(safe-area-inset-bottom))] xl:overflow-y-auto xl:overscroll-contain xl:pr-2">
                    <Panel title={selectedEvent ? `步骤 ${selectedEvent.sequence} 详情` : '步骤详情'} subtitle="显示该公开步骤保存的摘要与结构化载荷">
                      {selectedEvent ? (
                        <div className="space-y-4">
                          <div className="grid grid-cols-2 gap-3">
                            <EventDetailField label="执行 Agent" value={selectedEvent.agentName} />
                            <EventDetailField label="事件类型" value={selectedEvent.eventType} mono />
                            <EventDetailField label="步骤序号" value={`#${selectedEvent.sequence}`} />
                            <EventDetailField label="发生时间" value={formatDateTime(selectedEvent.createdAt)} />
                          </div>
                          <div className="rounded-2xl bg-background-alt p-4">
                            <p className="text-[11px] font-medium text-text-muted">步骤摘要</p>
                            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-text-main">{selectedEvent.summary}</p>
                          </div>
                          <div>
                            <p className="mb-2 text-xs font-semibold text-text-main">步骤数据</p>
                            {selectedEvent.payload !== null && selectedEvent.payload !== undefined ? (
                              <JsonBlock value={selectedEvent.payload} />
                            ) : (
                              <div className="rounded-xl border border-dashed border-gray-200 bg-background-alt/50 p-4">
                                <p className="text-xs leading-5 text-text-muted">{selectedEvent.eventType.endsWith('_started') || selectedEvent.eventType === 'routing_started' || selectedEvent.eventType === 'synthesis_started' ? '这是一个开始状态事件，执行结果会记录在对应的完成步骤中。' : '该历史步骤没有单独保存结果数据。新运行会在专业 Agent 完成步骤中保留公开结构化结果。'}</p>
                                <button type="button" onClick={() => setActiveTab('result')} className="mt-3 text-xs font-semibold text-primary hover:underline">查看本次运行的最终汇总结果</button>
                              </div>
                            )}
                          </div>
                        </div>
                      ) : <p className="text-sm text-text-muted">请选择右侧步骤查看详情。</p>}
                    </Panel>
                  </div>

                  <div className="min-h-0 pb-[max(1.5rem,env(safe-area-inset-bottom))] xl:overflow-y-auto xl:overscroll-contain xl:pl-1">
                    <Panel title={`公开事件时间线（${detail.events.length}）`} subtitle="点击任一步骤，在左侧查看该步骤的具体数据；不包含思维链">
                      <div className="relative space-y-0">
                        {detail.events.map((event, index) => {
                          const isSelected = selectedEvent?.sequence === event.sequence;
                          return (
                            <div key={event.sequence} className="relative flex gap-4 pb-5 last:pb-0">
                              <div className="flex w-8 shrink-0 flex-col items-center">
                                <div className={`z-10 flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-bold ring-4 ring-white ${isSelected ? 'bg-primary text-white' : event.agentName === 'PolicyGate' ? 'bg-amber-100 text-amber-700' : event.agentName === 'Supervisor' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>{event.sequence}</div>
                                {index < detail.events.length - 1 ? <div className="absolute left-4 top-8 h-full w-px bg-gray-200" /> : null}
                              </div>
                              <button
                                type="button"
                                onClick={() => setSelectedEventSequence(event.sequence)}
                                aria-pressed={isSelected}
                                aria-label={`查看步骤 ${event.sequence}：${event.summary}`}
                                className={`min-w-0 flex-1 rounded-2xl border p-4 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20 ${isSelected ? 'border-primary bg-primary/[0.04] shadow-sm' : 'border-gray-100 bg-white hover:border-primary/25 hover:bg-primary/[0.04]'}`}
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                                    <GitBranch className="h-3.5 w-3.5 shrink-0 text-primary" />
                                    <span className="text-xs font-semibold text-text-main">{event.agentName}</span>
                                    <span className="max-w-full truncate rounded-full bg-background-alt px-2 py-0.5 font-mono text-[10px] text-text-muted">{event.eventType}</span>
                                  </div>
                                  <time className="shrink-0 text-[10px] text-text-muted">{formatDateTime(event.createdAt)}</time>
                                </div>
                                <p className="mt-2 text-sm leading-6 text-text-main">{event.summary}</p>
                                <p className={`mt-2 text-[11px] font-medium ${isSelected ? 'text-primary' : 'text-text-muted'}`}>{isSelected ? '正在查看此步骤' : '点击查看步骤详情'}</p>
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </Panel>
                  </div>
                </div>
              ) : <Panel title="公开事件时间线（0）"><p className="text-sm text-text-muted">本次 Run 没有可展示的公开步骤。</p></Panel>
            ) : null}

            {activeTab === 'actions' ? (
              <Panel title={`业务动作（${detail.actions.length}）`} subtitle="只读展示；管理员不能代用户批准">
                {detail.actions.length ? <div className="space-y-3">{detail.actions.map((action) => <div key={action.id} className="rounded-2xl border border-gray-100 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-semibold text-text-main">{action.actionType}</p><p className="mt-1 font-mono text-[10px] text-text-muted">{action.id} · v{action.version}</p></div><div className="flex gap-2"><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${action.riskLevel === 'low' ? 'bg-emerald-50 text-emerald-700' : action.riskLevel === 'high' ? 'bg-orange-50 text-orange-700' : 'bg-red-50 text-red-700'}`}>{action.riskLevel}</span><span className="rounded-full bg-background-alt px-2 py-1 text-[10px] text-text-main">{action.status}</span></div></div><div className="mt-3"><JsonBlock value={{ payload: action.payload, before: action.before, result: action.result, approvalDecision: action.approvalDecision, approvedAt: action.approvedAt, executedAt: action.executedAt, undoneAt: action.undoneAt }} /></div></div>)}</div> : <p className="text-sm text-text-muted">本次 Run 未生成业务动作。</p>}
              </Panel>
            ) : null}
          </div>
        )}
      </section>
    </DialogFrame>
  );
}

function ArtifactCard({ artifact, index }: { artifact: { type?: string; title?: string; data?: unknown }; index: number }) {
  return <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white"><header className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-3"><span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] font-semibold text-primary">{artifact.type || 'artifact'}</span><h4 className="text-sm font-semibold text-text-main">{artifact.title || `产物 ${index + 1}`}</h4></header><div className="p-4">{typeof artifact.data === 'string' ? <p className="whitespace-pre-wrap text-sm leading-6 text-text-main">{artifact.data}</p> : <JsonBlock value={artifact.data} empty="该产物没有可展示的数据" />}</div></section>;
}

function EventDetailField({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="min-w-0 rounded-xl border border-gray-100 bg-white p-3"><p className="text-[10px] text-text-muted">{label}</p><p className={`mt-1 break-words text-xs font-semibold text-text-main ${mono ? 'font-mono' : ''}`}>{value}</p></div>;
}

function Info({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return <div className="rounded-2xl bg-white p-4 shadow-sm"><p className="text-[10px] text-text-muted">{label}</p><div className="mt-2 text-xs font-semibold text-text-main">{children || value || '—'}</div></div>;
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return <section className="rounded-2xl bg-white p-5 shadow-sm"><div className="mb-4"><h3 className="font-bold text-text-main">{title}</h3>{subtitle ? <p className="mt-1 text-[11px] text-text-muted">{subtitle}</p> : null}</div>{children}</section>;
}
