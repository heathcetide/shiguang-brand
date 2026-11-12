import { AdminButton, AdminInput, AdminPagination, AdminSelect, EmptyState, FilterBar, PageHeader, Section, StatusBadge, TableContainer } from '../components/admin';
import { useQueryState } from '../hooks/useQueryState';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock3,
  RefreshCw,
  Search,
  Users,
  Zap,
} from 'lucide-react';
import api from '../services/api';
import { getAvatarUrl } from '../utils/avatar';

type RangeKey = '7d' | '30d' | '90d' | 'all';

interface UsageSummary {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  avgLatencyMs: number;
  successRate: number;
  activeUsers: number;
}

interface UsageTrend {
  date: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

interface UsageBreakdown {
  model?: string;
  endpoint?: string;
  requests: number;
  totalTokens: number;
}

interface UserUsage {
  id: number;
  username: string;
  avatarUrl: string | null;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  avgLatencyMs: number;
  successRate: number;
  lastUsedAt: string | null;
}

interface UsageResponse {
  range: RangeKey;
  selectedUserId: number | null;
  summary: UsageSummary;
  trend: UsageTrend[];
  models: UsageBreakdown[];
  endpoints: UsageBreakdown[];
  users: UserUsage[];
}

const rangeOptions: Array<{ value: RangeKey; label: string }> = [
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' },
  { value: '90d', label: '近 90 天' },
  { value: 'all', label: '全部时间' },
];

const endpointNames: Record<string, string> = {
  chat: 'AI 营养对话',
  'vision-food': '餐食图片识别',
  'scan-receipt': '小票 / 食材扫描',
  'voice-command': '烹饪语音问答',
  'agent:Supervisor': 'Agent · Supervisor',
  'agent:NutritionPlanningAgent': 'Agent · 营养规划',
  'agent:RecipeCookingAgent': 'Agent · 菜谱烹饪',
  'agent:VisionAgent': 'Agent · 视觉识别',
  'agent:VoiceAgent': 'Agent · 语音转录',
  'agent:OperationsAgent': 'Agent · 业务操作',
};

const numberFormatter = new Intl.NumberFormat('zh-CN');

function formatNumber(value: number) {
  return numberFormatter.format(Number(value) || 0);
}

function formatDateTime(value: string | null) {
  if (!value) return '暂无调用';
  return new Date(`${value.replace(' ', 'T')}Z`).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatCompactNumber(value: number) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 10_000) {
    return `${(value / 1_000).toFixed(0)}k`;
  }
  return formatNumber(value);
}

export default function AIUsage() {
  const [range, setRange] = useQueryState<RangeKey>('range', '30d', ["7d", "30d", "90d", "all"]);
  const [selectedUserId, setSelectedUserId] = useQueryState<string>('userId', '', value => !value || /^[1-9]\d*$/.test(value));
  const [searchQuery, setSearchQuery] = useQueryState<string>('q', '');
  const [hoveredTrendDate, setHoveredTrendDate] = useState<string | null>(null);
  const [pinnedTrendDate, setPinnedTrendDate] = useState<string | null>(null);
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [userPage, setUserPage] = useState(1);
  const userPageSize = 20;

  const fetchUsage = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.get<UsageResponse>('/admin/ai-usage', {
        params: {
          range,
          userId: selectedUserId || undefined,
        },
      });
      setData(response.data);
    } catch (requestError) {
      console.error('Error fetching AI usage:', requestError);
      setError('模型用量加载失败，请检查服务器连接后重试');
    } finally {
      setLoading(false);
    }
  }, [range, selectedUserId]);

  useEffect(() => {
    fetchUsage();
  }, [fetchUsage]);

  useEffect(() => {
    setUserPage(1);
  }, [searchQuery, range, selectedUserId, data?.users?.length]);

  const filteredUsers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return data?.users ?? [];
    return (data?.users ?? []).filter((user) =>
      user.username.toLowerCase().includes(query)
      || String(user.id).includes(query)
    );
  }, [data?.users, searchQuery]);

  const pagedUsers = useMemo(() => {
    const start = (userPage - 1) * userPageSize;
    return filteredUsers.slice(start, start + userPageSize);
  }, [filteredUsers, userPage]);
  const userTotalPages = Math.max(1, Math.ceil(filteredUsers.length / userPageSize));

  const displayedTrend = useMemo(() => (data?.trend ?? []).slice(-30), [data?.trend]);
  const maxTrendTokens = Math.max(...displayedTrend.map((item) => item.totalTokens), 1);
  const maxModelTokens = Math.max(...(data?.models ?? []).map((item) => item.totalTokens), 1);
  const maxEndpointTokens = Math.max(...(data?.endpoints ?? []).map((item) => item.totalTokens), 1);

  const activeTrendDate = hoveredTrendDate || pinnedTrendDate;
  const activeTrendItem = useMemo(() => {
    if (!activeTrendDate) return null;
    return displayedTrend.find((item) => item.date === activeTrendDate) || null;
  }, [displayedTrend, activeTrendDate]);

  const trendSummaryStats = useMemo(() => {
    if (!displayedTrend.length) return null;
    const totalTokens = displayedTrend.reduce((sum, item) => sum + item.totalTokens, 0);
    const totalRequests = displayedTrend.reduce((sum, item) => sum + item.requests, 0);
    const totalPrompt = displayedTrend.reduce((sum, item) => sum + item.promptTokens, 0);
    const totalCompletion = displayedTrend.reduce((sum, item) => sum + item.completionTokens, 0);
    const peakItem = displayedTrend.reduce(
      (max, item) => (item.totalTokens > (max?.totalTokens ?? 0) ? item : max),
      displayedTrend[0]
    );
    const avgDailyTokens = Math.round(totalTokens / displayedTrend.length);
    return {
      totalTokens,
      totalRequests,
      totalPrompt,
      totalCompletion,
      peakItem,
      avgDailyTokens,
    };
  }, [displayedTrend]);

  const yAxisTicks = useMemo(() => {
    if (maxTrendTokens <= 0) return [];
    return [1, 0.75, 0.5, 0.25, 0].map((ratio) => ({
      ratio,
      label: formatCompactNumber(Math.round(maxTrendTokens * ratio)),
    }));
  }, [maxTrendTokens]);

  const selectedUser = data?.users.find((user) => String(user.id) === selectedUserId);
  const scopeLabel = selectedUser
    ? `${selectedUser.username} 的用量`
    : '全部用户用量';

  const summaryCards = [
    {
      title: '调用总量',
      value: formatNumber(data?.summary.requests ?? 0),
      note: `${formatNumber(data?.summary.activeUsers ?? 0)} 位活跃用户`,
      icon: Activity,
      color: 'text-primary',
      background: 'bg-primary/10',
    },
    {
      title: 'Token 总量',
      value: formatNumber(data?.summary.totalTokens ?? 0),
      note: `输入 ${formatNumber(data?.summary.promptTokens ?? 0)} · 输出 ${formatNumber(data?.summary.completionTokens ?? 0)}`,
      icon: Zap,
      color: 'text-amber-600',
      background: 'bg-amber-50',
    },
    {
      title: '平均响应',
      value: `${formatNumber(data?.summary.avgLatencyMs ?? 0)} ms`,
      note: '从请求发出到模型返回',
      icon: Clock3,
      color: 'text-blue-600',
      background: 'bg-blue-50',
    },
    {
      title: '成功率',
      value: `${Number(data?.summary.successRate ?? 0).toFixed(1)}%`,
      note: `${formatNumber(data?.summary.requests ?? 0)} 次请求`,
      icon: CheckCircle2,
      color: 'text-emerald-600',
      background: 'bg-emerald-50',
    },
  ];

  return (
    <div className="admin-stack">
      <PageHeader title="模型用量" description="查看模型调用、Token 消耗与费用估算。"/>
      {error ? (
        <div className="flex items-center justify-between admin-error" role="alert">
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5" />
            <span className="text-sm">{error}</span>
          </div>
          <AdminButton type="button" onClick={fetchUsage}>重试</AdminButton>
        </div>
      ) : null}

      <div>
        <p className="mb-3 text-sm font-medium text-text-muted">{scopeLabel}</p>
        <div className="admin-stat-grid grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
          {summaryCards.map((card) => (
            <div key={card.title} className="rounded-[24px] bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-text-muted">{card.title}</p>
                  <p className="mt-2 text-3xl font-bold text-text-main">{loading ? '—' : card.value}</p>
                </div>
                <div className={`rounded-2xl p-3 ${card.background} ${card.color}`}>
                  <card.icon className="h-6 w-6" />
                </div>
              </div>
              <p className="mt-4 truncate text-xs text-text-muted">{card.note}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <section className="rounded-[24px] bg-white p-6 shadow-sm xl:col-span-2">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-bold text-text-main">每日 Token 趋势</h2>
              <p className="mt-1 text-xs text-text-muted">
                输入与输出 Token 统计
                {(data?.trend.length ?? 0) > 30 ? ' · 展示最近 30 个有调用的日期' : ''}
              </p>
            </div>
            <div className="flex items-center gap-4 text-xs text-text-muted">
              <span className="flex items-center gap-1.5"><i aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-viz-input" />输入 (Prompt)</span>
              <span className="flex items-center gap-1.5"><i aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-viz-output" />输出 (Completion)</span>
            </div>
          </div>

          {/* Interactive Info Banner - utilizes top blank space */}
          {activeTrendItem ? (
            <div role="status" aria-live="polite" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-3.5 transition-all">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-white text-xs font-bold shadow-sm">
                  {new Date(`${activeTrendItem.date}T00:00:00`).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-text-main text-sm">
                      {activeTrendItem.date}
                    </span>
                    {pinnedTrendDate === activeTrendItem.date && (
                      <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                        已锁定
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-text-muted">
                    悬停、聚焦或点击柱状图查看每日明细
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-5 text-xs">
                <div>
                  <span className="text-text-muted block text-[10px]">Token 总量</span>
                  <span className="font-bold text-text-main text-sm">{formatNumber(activeTrendItem.totalTokens)}</span>
                </div>
                <div>
                  <span className="text-text-muted block text-[10px]">输入 (Prompt)</span>
                  <span className="font-semibold text-text-main">
                    {formatNumber(activeTrendItem.promptTokens)}
                    <span className="ml-1 text-[10px] text-text-muted font-normal">
                      ({activeTrendItem.totalTokens ? ((activeTrendItem.promptTokens / activeTrendItem.totalTokens) * 100).toFixed(1) : 0}%)
                    </span>
                  </span>
                </div>
                <div>
                  <span className="text-text-muted block text-[10px]">输出 (Completion)</span>
                  <span className="font-semibold text-text-main">
                    {formatNumber(activeTrendItem.completionTokens)}
                    <span className="ml-1 text-[10px] text-text-muted font-normal">
                      ({activeTrendItem.totalTokens ? ((activeTrendItem.completionTokens / activeTrendItem.totalTokens) * 100).toFixed(1) : 0}%)
                    </span>
                  </span>
                </div>
                <div>
                  <span className="text-text-muted block text-[10px]">调用次数 / 均值</span>
                  <span className="font-bold text-text-main">
                    {formatNumber(activeTrendItem.requests)} 次
                    <span className="ml-1 text-text-muted font-normal">
                      (均 {activeTrendItem.requests ? formatNumber(Math.round(activeTrendItem.totalTokens / activeTrendItem.requests)) : 0}/次)
                    </span>
                  </span>
                </div>

                {pinnedTrendDate && (
                  <button
                    type="button"
                    onClick={() => setPinnedTrendDate(null)}
                    className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-text-muted hover:bg-gray-100 hover:text-text-main"
                  >
                    解锁
                  </button>
                )}
              </div>
            </div>
          ) : trendSummaryStats ? (
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-100 bg-background-alt/50 p-3.5 transition-all">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 text-xs font-bold">
                  30D
                </div>
                <div>
                  <span className="font-bold text-text-main text-xs">趋势数据概览</span>
                  <p className="text-[11px] text-text-muted">点击或悬停下方柱状图可固定并显示单日具体明细</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-5 text-xs">
                <div>
                  <span className="text-text-muted block text-[10px]">最高单日 Token</span>
                  <span className="font-bold text-text-main">
                    {formatNumber(trendSummaryStats.peakItem.totalTokens)}
                    <span className="ml-1 text-[10px] font-normal text-text-muted">
                      ({new Date(`${trendSummaryStats.peakItem.date}T00:00:00`).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })})
                    </span>
                  </span>
                </div>
                <div>
                  <span className="text-text-muted block text-[10px]">日均 Token</span>
                  <span className="font-bold text-text-main">
                    {formatNumber(trendSummaryStats.avgDailyTokens)} / 天
                  </span>
                </div>
                <div>
                  <span className="text-text-muted block text-[10px]">输入 : 输出 比例</span>
                  <span className="font-medium text-text-main">
                    <span className="text-text-main font-semibold">
                      {(trendSummaryStats.totalTokens ? (trendSummaryStats.totalPrompt / trendSummaryStats.totalTokens) * 100 : 0).toFixed(1)}%
                    </span>
                    {' : '}
                    <span className="text-text-main font-semibold">
                      {(trendSummaryStats.totalTokens ? (trendSummaryStats.totalCompletion / trendSummaryStats.totalTokens) * 100 : 0).toFixed(1)}%
                    </span>
                  </span>
                </div>
              </div>
            </div>
          ) : null}

          {loading ? (
            <div className="flex h-64 items-center justify-center text-sm text-text-muted">正在加载趋势...</div>
          ) : displayedTrend.length === 0 ? (
            <div className="flex h-64 flex-col items-center justify-center text-center">
              <Activity className="mb-3 h-9 w-9 text-text-muted/40" />
              <p className="text-sm font-medium text-text-main">当前范围内暂无模型调用</p>
              <p className="mt-1 text-xs text-text-muted">产生真实模型请求后，用量会自动记录在这里</p>
            </div>
          ) : (
            <div className="relative pt-6">
              {/* Background grid lines */}
              <div className="absolute inset-x-0 bottom-9 h-[180px] flex flex-col justify-between pl-11 pointer-events-none">
                {yAxisTicks.map((tick) => (
                  <div key={tick.ratio} className="relative flex items-center border-b border-gray-100 w-full h-0">
                    <span className="absolute -left-11 w-9 -translate-y-1/2 text-right text-[10px] text-text-muted select-none font-mono">
                      {tick.label}
                    </span>
                  </div>
                ))}
              </div>

              <div className="relative ml-11 flex h-64 items-end gap-2 overflow-x-auto border-b border-gray-100 px-1 pb-9 pt-6">
                {displayedTrend.map((item) => {
                  const isSelected = pinnedTrendDate === item.date;
                  const isHovered = hoveredTrendDate === item.date;
                  const isActive = isSelected || isHovered;
                  const isPeak = trendSummaryStats?.peakItem.date === item.date;

                  const inputHeight = Math.max((item.promptTokens / maxTrendTokens) * 180, item.promptTokens ? 3 : 0);
                  const outputHeight = Math.max((item.completionTokens / maxTrendTokens) * 180, item.completionTokens ? 3 : 0);

                  return (
                    <button
                      type="button"
                      key={item.date}
                      aria-label={`${item.date}，输入 ${formatNumber(item.promptTokens)}，输出 ${formatNumber(item.completionTokens)} Token`}
                      aria-pressed={isSelected}
                      onFocus={() => setHoveredTrendDate(item.date)}
                      onBlur={() => setHoveredTrendDate(null)}
                      onMouseEnter={() => setHoveredTrendDate(item.date)}
                      onMouseLeave={() => setHoveredTrendDate(null)}
                      onClick={() => setPinnedTrendDate(pinnedTrendDate === item.date ? null : item.date)}
                      className={`group relative flex min-w-7 flex-1 cursor-pointer flex-col items-center justify-end self-stretch rounded-t-lg transition-all ${
                        isActive ? 'bg-primary/5 ring-2 ring-primary/30' : 'hover:bg-gray-50/80'
                      }`}
                    >
                      {/* Hover and keyboard focus share the detailed banner above the plot. */}

                      {/* Peak Tag */}
                      {!isActive && isPeak && (
                        <span className="absolute -top-5 text-[9px] font-bold text-amber-600 bg-amber-50 border border-amber-200/80 rounded px-1">
                          峰值
                        </span>
                      )}

                      <div className="flex flex-1 items-end gap-0.5 px-0.5">
                        <div
                          className="w-2 rounded-t-[4px] bg-viz-input"
                          style={{ height: `${inputHeight}px` }}
                        />
                        <div
                          className="w-2 rounded-t-[4px] bg-viz-output"
                          style={{ height: `${outputHeight}px` }}
                        />
                      </div>

                      <span className={`absolute -bottom-7 whitespace-nowrap text-[10px] font-medium transition-colors ${
                        isActive ? 'font-bold text-primary' : 'text-text-muted group-hover:text-text-main'
                      }`}>
                        {new Date(`${item.date}T00:00:00`).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {displayedTrend.length > 0 && <details className="mt-5">
            <summary className="text-xs text-text-muted">查看每日数值</summary>
            <div className="admin-table-container mt-3" role="region" aria-label="每日 Token 数值" tabIndex={0}>
              <table>
                <thead><tr><th scope="col">日期</th><th scope="col">输入 Token</th><th scope="col">输出 Token</th><th scope="col">Token 总量</th><th scope="col">调用次数</th></tr></thead>
                <tbody>{displayedTrend.map(item => <tr key={item.date}><td>{item.date}</td><td>{formatNumber(item.promptTokens)}</td><td>{formatNumber(item.completionTokens)}</td><td>{formatNumber(item.totalTokens)}</td><td>{formatNumber(item.requests)}</td></tr>)}</tbody>
              </table>
            </div>
          </details>}
        </section>

        <div className="space-y-6">
          <BreakdownCard
            title="模型分布"
            items={data?.models ?? []}
            labelKey="model"
            maxTokens={maxModelTokens}
            emptyText="暂无模型调用"
          />
          <BreakdownCard
            title="功能分布"
            items={data?.endpoints ?? []}
            labelKey="endpoint"
            maxTokens={maxEndpointTokens}
            emptyText="暂无功能调用"
          />
        </div>
      </div>

      <section className="rounded-[24px] bg-white p-6 shadow-sm">
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="flex items-center gap-2 font-bold text-text-main">
              <Users className="h-5 w-5 text-primary" />
              单用户使用量
            </h2>
            <p className="mt-1 text-xs text-text-muted">按用户及时间筛选统计模型调用与 Token 消耗</p>
          </div>

          <FilterBar>
            <AdminInput
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="搜索用户名或 ID"
              aria-label="搜索用户"
            />
            <AdminSelect
              value={selectedUserId}
              onChange={(event) => setSelectedUserId(event.target.value)}
              aria-label="用户筛选"
            >
              <option value="">全部用户</option>
              {(data?.users ?? []).map((user) => (
                <option key={user.id} value={user.id}>
                  {user.username}
                </option>
              ))}
            </AdminSelect>
            <AdminSelect
              value={range}
              onChange={(event) => setRange(event.target.value as RangeKey)}
              aria-label="时间范围"
            >
              {rangeOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </AdminSelect>
            <AdminButton type="button" onClick={fetchUsage} disabled={loading}>
              <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              刷新
            </AdminButton>
          </FilterBar>
        </div>

        <TableContainer>
          <table className="admin-table w-full min-w-[900px] text-left">
            <thead>
              <tr className="border-b border-background-alt text-xs text-text-muted">
                <th className="pb-3 font-medium">用户</th>
                <th className="pb-3 text-right font-medium">调用次数</th>
                <th className="pb-3 text-right font-medium">输入 Token</th>
                <th className="pb-3 text-right font-medium">输出 Token</th>
                <th className="pb-3 text-right font-medium">Token 总量</th>
                <th className="pb-3 text-right font-medium">平均响应</th>
                <th className="pb-3 text-right font-medium">成功率</th>
                <th className="pb-3 text-right font-medium">最后调用</th>
              </tr>
            </thead>
            <tbody>
              {pagedUsers.map((user) => (
                <tr
                  key={user.id}
                  className={`border-b border-background-alt/60 text-sm last:border-0 ${
                    String(user.id) === selectedUserId ? 'bg-primary/5' : ''
                  }`}
                >
                  <td className="py-4">
                    <button
                      type="button"
                      onClick={() => setSelectedUserId(String(user.id) === selectedUserId ? '' : String(user.id))}
                      className="flex items-center gap-3 text-left"
                    >
                      <img
                        src={getAvatarUrl(user.avatarUrl, user.id)}
                        alt={user.username}
                        className="h-9 w-9 rounded-full object-cover"
                      />
                      <span>
                        <span className="block font-medium text-text-main">{user.username}</span>
                        <span className="block text-xs text-text-muted">@{user.username} · ID {user.id}</span>
                      </span>
                    </button>
                  </td>
                  <td className="py-4 text-right text-text-main">{formatNumber(user.requests)}</td>
                  <td className="py-4 text-right text-text-muted">{formatNumber(user.promptTokens)}</td>
                  <td className="py-4 text-right text-text-muted">{formatNumber(user.completionTokens)}</td>
                  <td className="py-4 text-right font-semibold text-text-main">{formatNumber(user.totalTokens)}</td>
                  <td className="py-4 text-right text-text-muted">{formatNumber(user.avgLatencyMs)} ms</td>
                  <td className="py-4 text-right">
                    <span className={user.successRate >= 95 ? 'text-emerald-600' : user.requests ? 'text-amber-600' : 'text-text-muted'}>
                      {user.requests ? `${Number(user.successRate).toFixed(1)}%` : '—'}
                    </span>
                  </td>
                  <td className="py-4 text-right text-xs text-text-muted">{formatDateTime(user.lastUsedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && filteredUsers.length === 0 ? (
            <EmptyState>没有匹配的用户</EmptyState>
          ) : null}
        </TableContainer>
        {filteredUsers.length > userPageSize ? (
          <AdminPagination
            page={userPage}
            pageSize={userPageSize}
            total={filteredUsers.length}
            disabled={loading}
            onChange={setUserPage}
          />
        ) : null}
      </section>
    </div>
  );
}

function BreakdownCard({
  title,
  items,
  labelKey,
  maxTokens,
  emptyText,
}: {
  title: string;
  items: UsageBreakdown[];
  labelKey: 'model' | 'endpoint';
  maxTokens: number;
  emptyText: string;
}) {
  return (
    <section className="rounded-[24px] bg-white p-5 shadow-sm">
      <h2 className="mb-4 font-bold text-text-main">{title}</h2>
      {items.length === 0 ? (
        <div className="py-5 text-center text-xs text-text-muted">{emptyText}</div>
      ) : (
        <div className="space-y-4">
          {items.slice(0, 5).map((item) => {
            const rawLabel = item[labelKey] || '未知';
            const label = labelKey === 'endpoint' ? endpointNames[rawLabel] || rawLabel : rawLabel;
            return (
              <div key={rawLabel}>
                <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
                  <span className="truncate font-medium text-text-main" title={label}>{label}</span>
                  <span className="shrink-0 text-text-muted">{formatNumber(item.totalTokens)} Token</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-background-alt">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.max((item.totalTokens / maxTokens) * 100, 2)}%` }}
                  />
                </div>
                <p className="mt-1 text-[10px] text-text-muted">{formatNumber(item.requests)} 次调用</p>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
