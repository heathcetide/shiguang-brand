import { AdminButton, AdminInput, AdminPagination, AdminSelect, DialogFrame, EmptyState, FilterBar, PageHeader, StatusBadge as KitStatusBadge, TableContainer, Section } from '@/components/admin';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useQueryState } from '@/hooks/useQueryState';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Eye,
  GitBranch,
  RefreshCw,
  ShieldCheck,
  X,
  Zap,
} from 'lucide-react';
import api from '@/services/api';
import { cn } from '@/utils/cn';

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

function RunStatusBadge({ status }: { status: RunStatus }) {
  const tone =
    status === 'completed' ? 'success' :
    status === 'failed' || status === 'expired' || status === 'cancelled' ? 'danger' :
    status === 'awaiting_input' || status === 'awaiting_approval' ? 'warning' :
    'neutral';
  return <KitStatusBadge tone={tone}>{statusLabels[status]}</KitStatusBadge>;
}

function JsonBlock({ value, empty = '暂无结构化数据' }: { value: unknown; empty?: string }) {
  if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) {
    return <p className="text-xs text-muted-foreground">{empty}</p>;
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
      const data = response.data || {};
      setItems(Array.isArray(data.items) ? data.items : Array.isArray(data.runs) ? data.runs : []);
      setTotal(Number(data.total) || 0);
      setStatusCounts(Array.isArray(data.statusCounts) ? data.statusCounts : []);
      setUsageSummary(data.usageSummary || { modelCalls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUsd: 0 });
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

  const countMap = useMemo(() => Object.fromEntries((statusCounts || []).map((item) => [item.status, Number(item.count) || 0])), [statusCounts]);
  const pageCount = Math.max(1, Math.ceil(total / 25));
  const resetPage = (setter: (value: string) => void, value: string) => { setter(value); setPage(1); };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="任务运行"
        description="查看 Supervisor 分派、公开事件、结构化产物与业务动作；不展示模型思维链或原始媒体。"
        actions={<AdminButton type="button" variant="primary" onClick={() => loadRuns()}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />刷新</AdminButton>}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {[
          { label: '当前范围', value: total, icon: Activity, color: 'text-primary bg-primary/10' },
          { label: '运行 / 排队', value: (countMap.running || 0) + (countMap.queued || 0), icon: Clock3, color: 'text-primary bg-primary/10' },
          { label: '等待用户', value: (countMap.awaiting_input || 0) + (countMap.awaiting_approval || 0), icon: ShieldCheck, color: 'text-warning bg-warning/10' },
          { label: '已完成', value: countMap.completed || 0, icon: CheckCircle2, color: 'text-success bg-success/10' },
          { label: '失败 / 过期', value: (countMap.failed || 0) + (countMap.expired || 0), icon: AlertTriangle, color: 'text-destructive bg-destructive/10' },
          { label: 'Token 消耗', value: formatNumber(usageSummary.totalTokens), note: `${usageSummary.modelCalls} 次模型调用`, icon: Zap, color: 'text-primary bg-primary/10' },
        ].map((card) => (
          <Card key={card.label} className="py-3">
            <CardContent className="px-4">
              <div className={cn('inline-flex rounded-xl p-2', card.color)}>
                <card.icon className="size-4" />
              </div>
              <p className="text-muted-foreground mt-3 text-xs">{card.label}</p>
              <p className="text-foreground mt-1 text-2xl font-bold">{card.value}</p>
              {card.note ? <p className="text-muted-foreground mt-1 text-[10px]">{card.note}</p> : null}
            </CardContent>
          </Card>
        ))}
      </div>

      <FilterBar>
        <AdminInput value={query} onChange={(event) => resetPage(setQuery, event.target.value)} placeholder="搜索 Run ID、会话、用户名或用户 ID" aria-label="搜索任务运行" />
        <AdminSelect value={status} onChange={(event) => resetPage(setStatus, event.target.value)} aria-label="状态"><option value="">全部状态</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</AdminSelect>
        <AdminSelect value={modality} onChange={(event) => resetPage(setModality, event.target.value)} aria-label="模态"><option value="">全部模态</option>{Object.entries(modalityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</AdminSelect>
        <AdminSelect value={agent} onChange={(event) => resetPage(setAgent, event.target.value)} aria-label="专业 Agent">{agentOptions.map((value) => <option key={value || 'all'} value={value}>{value || '全部专业 Agent'}</option>)}</AdminSelect>
        <AdminSelect value={range} onChange={(event) => resetPage(setRange, event.target.value)} aria-label="时间范围"><option value="7d">近 7 天</option><option value="30d">近 30 天</option><option value="90d">近 90 天</option><option value="all">全部时间</option></AdminSelect>
      </FilterBar>

      {error ? (
        <p role="alert" className="border-destructive/20 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-sm">
          {error}
        </p>
      ) : null}

      <Section title="运行列表">
        <TableContainer>
          <Table className="min-w-[1120px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>用户 / Run</TableHead>
                <TableHead>模态</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>公开目标</TableHead>
                <TableHead>专业 Agent</TableHead>
                <TableHead className="whitespace-nowrap">事件 / 动作</TableHead>
                <TableHead className="whitespace-nowrap text-right">Token / 费用</TableHead>
                <TableHead className="whitespace-nowrap text-right">耗时</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow
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
                  className="group cursor-pointer hover:bg-primary/[0.045] focus-visible:bg-primary/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
                >
                  <TableCell>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground">
                          {item.username}{' '}
                          <span className="text-muted-foreground text-xs font-normal">ID {item.userId}</span>
                        </p>
                        <p className="mt-1 max-w-44 truncate font-mono text-[10px] text-muted-foreground" title={item.id}>{item.id}</p>
                        <p className="mt-1 text-[10px] text-muted-foreground">{formatDateTime(item.createdAt)}</p>
                      </div>
                      <span className="bg-primary/10 text-primary group-hover:bg-primary inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold transition-colors group-hover:text-primary-foreground">
                        <Eye className="h-3 w-3" />
                        详情
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="bg-muted text-foreground inline-flex whitespace-nowrap rounded-lg px-2 py-1 text-xs">
                      {modalityLabels[item.modality]}
                    </span>
                    {item.hasMedia ? <p className="mt-1 text-[10px] text-muted-foreground">含受保护媒体</p> : null}
                  </TableCell>
                  <TableCell>
                    <RunStatusBadge status={item.status} />
                    {item.errorMessage ? (
                      <p className="text-destructive mt-2 max-w-44 truncate text-[10px]" title={item.errorMessage}>
                        {item.errorMessage}
                      </p>
                    ) : (
                      <p className="mt-2 max-w-44 truncate text-[10px] text-muted-foreground">{item.lastEventSummary || '等待事件'}</p>
                    )}
                  </TableCell>
                  <TableCell className="max-w-72">
                    <p className="line-clamp-2 text-xs leading-5 text-foreground" title={item.promptPreview}>
                      {item.promptPreview || '媒体或系统触发任务'}
                    </p>
                  </TableCell>
                  <TableCell>
                    <div className="flex max-w-56 flex-wrap gap-1">
                      {(item.specialists || '').split(',').filter(Boolean).map((name) => (
                        <span key={name} className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-[10px]">
                          {name.replace('Agent', '')}
                        </span>
                      ))}
                      {!item.specialists ? (
                        <span className="text-muted-foreground whitespace-nowrap text-xs">尚未分派</span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-foreground whitespace-nowrap text-xs">
                    <p>{item.eventCount} 个事件</p>
                    <p className="text-muted-foreground mt-1">{item.actionCount} 个业务动作</p>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right text-xs">
                    <p className="text-primary font-semibold">{formatNumber(item.totalTokens)}</p>
                    <p className="text-muted-foreground mt-1 text-[10px]">
                      {item.modelCallCount} 次 · {formatCost(item.estimatedCostUsd)}
                    </p>
                  </TableCell>
                  <TableCell className="text-foreground whitespace-nowrap text-right text-xs font-medium">
                    {formatDuration(item.durationMs)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {loading ? <EmptyState>正在加载 Agent Run...</EmptyState> : null}
          {!loading && items.length === 0 ? <EmptyState>当前筛选范围内暂无 Agent Run</EmptyState> : null}
        </TableContainer>
        <AdminPagination page={page} pageSize={25} total={total} disabled={loading} onChange={setPage} />
      </Section>

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
    <DialogFrame onClose={onClose} busy={loading} className="admin-dialog-backdrop admin-dialog-center">
      <section className="bg-card text-card-foreground flex max-h-[92vh] max-h-[92dvh] min-h-0 w-full max-w-6xl flex-col overflow-hidden rounded-[24px] shadow-2xl ring-1 ring-foreground/10 sm:rounded-[28px]" onClick={(event) => event.stopPropagation()}>
        <header className="flex shrink-0 items-start justify-between border-b border-border px-5 py-4 sm:px-6 sm:py-5">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Agent Run 只读审计详情</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-bold text-foreground">{run ? `${run.username} · ${modalityLabels[run.modality]}` : '正在加载...'}</h2>
              {run ? <RunStatusBadge status={run.status} /> : null}
            </div>
            {run ? <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{run.id}</p> : null}
          </div>
          <button type="button" onClick={onClose} disabled={loading} aria-label="关闭详情" className="ml-3 shrink-0 rounded-xl p-2 text-muted-foreground hover:bg-muted"><X className="h-5 w-5" /></button>
        </header>

        {!loading && detail && run ? (
          <nav className="border-border bg-card flex shrink-0 gap-1 overflow-x-auto border-b px-4 pt-2 sm:px-6" aria-label="运行详情分类">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                aria-selected={activeTab === tab.id}
                className={`whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium transition-colors ${activeTab === tab.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
              >
                {tab.label}{tab.count !== undefined ? `（${tab.count}）` : ''}
              </button>
            ))}
          </nav>
        ) : null}

        {loading || !detail || !run ? (
          <div className="flex h-64 shrink-0 items-center justify-center text-sm text-muted-foreground">正在加载运行详情...</div>
        ) : (
          <div ref={contentRef} className={`min-h-0 flex-1 bg-muted p-4 sm:p-6 ${activeTab === 'events' ? 'flex flex-col overflow-y-auto xl:overflow-hidden' : 'overflow-y-auto'}`}>
            {run.error ? (
              <div className="border-destructive/20 bg-destructive/10 text-destructive mb-4 rounded-2xl border p-4 text-sm">
                <p className="font-semibold">{run.error.code || '运行失败'}</p>
                <p className="mt-1">{run.error.message}</p>
              </div>
            ) : null}
            {run.pendingInput?.question ? (
              <div className="border-warning/30 bg-warning/10 text-warning mb-4 rounded-2xl border p-4 text-sm">
                等待用户补充：{run.pendingInput.question}
              </div>
            ) : null}

            {activeTab === 'result' ? (
              <div className="space-y-5">
                <Panel title="最终答复" subtitle="这是本次 Agent Run 最终返回给用户的内容">
                  <p className="whitespace-pre-wrap text-sm leading-7 text-foreground">{run.result.reply || (artifacts.length ? '本次运行生成了结构化产物，请在下方查看。' : '本次运行未保存可展示的最终答复。')}</p>
                  {run.result.transcript ? (
                    <div className="bg-muted text-foreground mt-4 rounded-xl p-3 text-xs leading-5">
                      <span className="font-semibold">语音转录：</span>
                      {run.result.transcript}
                    </div>
                  ) : null}
                </Panel>

                <Panel title={`结构化产物（${artifacts.length}）`} subtitle="展示各专业 Agent 生成并通过安全检查的结果">
                  {artifacts.length ? <div className="space-y-4">{artifacts.map((artifact, index) => <ArtifactCard key={`${artifact.type || 'artifact'}-${index}`} artifact={artifact} index={index} />)}</div> : <p className="text-sm text-muted-foreground">本次 Run 没有结构化产物。</p>}
                </Panel>
              </div>
            ) : null}

            {activeTab === 'overview' ? (
              <div className="space-y-5">
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-6"><Info label="状态"><RunStatusBadge status={run.status} /></Info><Info label="创建时间" value={formatDateTime(run.createdAt)} /><Info label="完成时间" value={formatDateTime(run.completedAt)} /><Info label="媒体" value={run.hasMedia ? '有（内容受保护）' : '无'} /><Info label="Checkpoint" value={`${run.checkpointCount} 个`} /><Info label="Checkpoint 写入" value={`${run.checkpointWriteCount} 次`} /></div>
                <Panel title={inputPresentation?.panelTitle || '运行任务输入'} subtitle={inputPresentation?.description}>
                  <div className="mb-4 flex flex-wrap items-center gap-2">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${inputPresentation?.userInitiated ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}>
                      {inputPresentation?.originLabel || '未知触发来源'}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground">source: {run.source}</span>
                  </div>
                  <div className="border-border bg-muted/55 rounded-2xl border p-4">
                    <p className="text-[11px] font-semibold text-muted-foreground">{inputPresentation?.promptLabel || '运行指令'}</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">{inputPrompt || '本次运行没有保存文字任务指令。'}</p>
                  </div>
                  <details className="border-border bg-card mt-4 rounded-2xl border p-4">
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
                        <div key={item.agentName} className="rounded-2xl border border-primary/20 bg-primary/10/45 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div><p className="text-sm font-semibold text-foreground">{item.agentName}</p><p className="mt-1 text-[10px] text-muted-foreground">{item.modelCalls} 次模型调用</p></div>
                            <span className="text-sm font-bold text-primary">{formatNumber(item.totalTokens)}</span>
                          </div>
                          <div className="mt-3 flex items-center justify-between border-t border-primary/20 pt-3 text-[10px] text-muted-foreground">
                            <span>输入 {formatNumber(item.promptTokens)} · 输出 {formatNumber(item.completionTokens)}</span>
                            <span>{formatCost(item.estimatedCostUsd)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-sm text-muted-foreground">历史 Run 尚无可归因的 Token 记录；新运行会自动写入。</p>}
                </Panel>

                <Panel title={`调用明细（${detail.usage.records.length}）`} subtitle="按实际调用顺序展示模型、阶段、Token、延迟与结果">
                  {detail.usage.records.length ? (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[860px] text-left text-xs">
                        <thead><tr className="border-border text-muted-foreground border-b"><th className="pb-3 font-medium">Agent / 阶段</th><th className="pb-3 font-medium">模型</th><th className="pb-3 text-right font-medium">输入</th><th className="pb-3 text-right font-medium">输出</th><th className="pb-3 text-right font-medium">总量</th><th className="pb-3 text-right font-medium">延迟</th><th className="pb-3 text-right font-medium">费用</th><th className="pb-3 text-right font-medium">状态</th></tr></thead>
                        <tbody>{detail.usage.records.map((record) => <tr key={record.id} className="border-border/60 border-b last:border-0"><td className="py-3"><p className="font-semibold text-foreground">{record.agentName || 'Unknown'}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{record.phase || record.endpoint}</p></td><td className="max-w-48 truncate py-3 font-mono text-[10px] text-muted-foreground" title={record.model}>{record.model}</td><td className="py-3 text-right text-muted-foreground">{formatNumber(record.promptTokens)}</td><td className="py-3 text-right text-muted-foreground">{formatNumber(record.completionTokens)}</td><td className="py-3 text-right font-semibold text-foreground">{formatNumber(record.totalTokens)}</td><td className="py-3 text-right text-muted-foreground">{formatDuration(record.latencyMs)}</td><td className="py-3 text-right text-muted-foreground">{formatCost(record.estimatedCostUsd)}</td><td className="py-3 text-right"><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${record.success ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}`}>{record.success ? '成功' : '失败'}</span></td></tr>)}</tbody>
                      </table>
                    </div>
                  ) : <p className="text-sm text-muted-foreground">暂无模型调用明细。</p>}
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
                          <div className="rounded-2xl bg-muted p-4">
                            <p className="text-[11px] font-medium text-muted-foreground">步骤摘要</p>
                            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">{selectedEvent.summary}</p>
                          </div>
                          <div>
                            <p className="mb-2 text-xs font-semibold text-foreground">步骤数据</p>
                            {selectedEvent.payload !== null && selectedEvent.payload !== undefined ? (
                              <JsonBlock value={selectedEvent.payload} />
                            ) : (
                              <div className="border-border bg-muted/50 rounded-xl border border-dashed p-4">
                                <p className="text-xs leading-5 text-muted-foreground">{selectedEvent.eventType.endsWith('_started') || selectedEvent.eventType === 'routing_started' || selectedEvent.eventType === 'synthesis_started' ? '这是一个开始状态事件，执行结果会记录在对应的完成步骤中。' : '该历史步骤没有单独保存结果数据。新运行会在专业 Agent 完成步骤中保留公开结构化结果。'}</p>
                                <button type="button" onClick={() => setActiveTab('result')} className="mt-3 text-xs font-semibold text-primary hover:underline">查看本次运行的最终汇总结果</button>
                              </div>
                            )}
                          </div>
                        </div>
                      ) : <p className="text-sm text-muted-foreground">请选择右侧步骤查看详情。</p>}
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
                                <div className={`z-10 flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-bold ring-4 ring-card ${isSelected ? 'bg-primary text-primary-foreground' : event.agentName === 'PolicyGate' ? 'bg-warning/15 text-warning' : event.agentName === 'Supervisor' ? 'bg-success/15 text-success' : 'bg-primary/15 text-primary'}`}>{event.sequence}</div>
                                {index < detail.events.length - 1 ? <div className="bg-border absolute left-4 top-8 h-full w-px" /> : null}
                              </div>
                              <button
                                type="button"
                                onClick={() => setSelectedEventSequence(event.sequence)}
                                aria-pressed={isSelected}
                                aria-label={`查看步骤 ${event.sequence}：${event.summary}`}
                                className={`min-w-0 flex-1 rounded-2xl border p-4 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20 ${isSelected ? 'border-primary bg-primary/[0.04] shadow-sm' : 'border-border bg-card hover:border-primary/25 hover:bg-primary/[0.04]'}`}
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                                    <GitBranch className="h-3.5 w-3.5 shrink-0 text-primary" />
                                    <span className="text-xs font-semibold text-foreground">{event.agentName}</span>
                                    <span className="max-w-full truncate rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">{event.eventType}</span>
                                  </div>
                                  <time className="shrink-0 text-[10px] text-muted-foreground">{formatDateTime(event.createdAt)}</time>
                                </div>
                                <p className="mt-2 text-sm leading-6 text-foreground">{event.summary}</p>
                                <p className={`mt-2 text-[11px] font-medium ${isSelected ? 'text-primary' : 'text-muted-foreground'}`}>{isSelected ? '正在查看此步骤' : '点击查看步骤详情'}</p>
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </Panel>
                  </div>
                </div>
              ) : <Panel title="公开事件时间线（0）"><p className="text-sm text-muted-foreground">本次 Run 没有可展示的公开步骤。</p></Panel>
            ) : null}

            {activeTab === 'actions' ? (
              <Panel title={`业务动作（${detail.actions.length}）`} subtitle="只读展示；管理员不能代用户批准">
                {detail.actions.length ? <div className="space-y-3">{detail.actions.map((action) => <div key={action.id} className="border-border rounded-2xl border p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-semibold text-foreground">{action.actionType}</p><p className="mt-1 font-mono text-[10px] text-muted-foreground">{action.id} · v{action.version}</p></div><div className="flex gap-2"><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${action.riskLevel === 'low' ? 'bg-success/10 text-success' : action.riskLevel === 'high' ? 'bg-warning/10 text-warning' : 'bg-destructive/10 text-destructive'}`}>{action.riskLevel}</span><span className="bg-muted text-foreground rounded-full px-2 py-1 text-[10px]">{action.status}</span></div></div><div className="mt-3"><JsonBlock value={{ payload: action.payload, before: action.before, result: action.result, approvalDecision: action.approvalDecision, approvedAt: action.approvedAt, executedAt: action.executedAt, undoneAt: action.undoneAt }} /></div></div>)}</div> : <p className="text-sm text-muted-foreground">本次 Run 未生成业务动作。</p>}
              </Panel>
            ) : null}
          </div>
        )}
      </section>
    </DialogFrame>
  );
}

function ArtifactCard({ artifact, index }: { artifact: { type?: string; title?: string; data?: unknown }; index: number }) {
  return (
    <section className="border-border bg-card overflow-hidden rounded-2xl border">
      <header className="border-border flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <span className="bg-primary/10 text-primary rounded-full px-2 py-1 text-[10px] font-semibold">{artifact.type || 'artifact'}</span>
        <h4 className="text-sm font-semibold text-foreground">{artifact.title || `产物 ${index + 1}`}</h4>
      </header>
      <div className="p-4">
        {typeof artifact.data === 'string' ? (
          <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">{artifact.data}</p>
        ) : (
          <JsonBlock value={artifact.data} empty="该产物没有可展示的数据" />
        )}
      </div>
    </section>
  );
}

function EventDetailField({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="border-border bg-card min-w-0 rounded-xl border p-3">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={`mt-1 break-words text-xs font-semibold text-foreground ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  );
}

function Info({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return (
    <div className="bg-card rounded-2xl p-4 shadow-sm ring-1 ring-foreground/5">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <div className="mt-2 text-xs font-semibold text-foreground">{children || value || '—'}</div>
    </div>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="bg-card rounded-2xl p-5 shadow-sm ring-1 ring-foreground/5">
      <div className="mb-4">
        <h3 className="font-bold text-foreground">{title}</h3>
        {subtitle ? <p className="text-muted-foreground mt-1 text-[11px]">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}
