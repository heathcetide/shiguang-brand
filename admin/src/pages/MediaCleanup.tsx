import { useQueryState, useQueryNumber } from '../hooks/useQueryState';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  DatabaseZap,
  Loader2,
  RefreshCw,
  RotateCcw,
} from 'lucide-react';
import api from '../services/api';
import { createLatestRequest } from '../utils/latestRequest';
import {
  mediaCleanupErrorMessage,
  mediaCleanupRetryConfirmation,
  mediaCleanupRetryFeedback,
  mediaCleanupStatusPresentation,
  mediaCleanupViewState,
  type MediaCleanupJob,
} from './mediaCleanupModel';

type CleanupFilter = 'all' | 'attention' | 'pending' | 'processing' | 'completed' | 'failing' | 'stale';
type Overview = {
  items: MediaCleanupJob[];
  total: number;
  page: number;
  pageSize: number;
  status: CleanupFilter;
  olderThanHours: number;
  staleAfterMinutes: number;
  summary: { pending: number; processing: number; completed: number; failing: number; stale: number };
};

const emptySummary = { pending: 0, processing: 0, completed: 0, failing: 0, stale: 0 };

export default function MediaCleanup() {
  const [data, setData] = useState<Overview | null>(null);
  const [status, setStatus] = useQueryState<CleanupFilter>('status', 'attention', ["all", "attention", "pending", "processing", "completed", "failing", "stale"]);
  const [olderThanHours, setOlderThanHours] = useQueryNumber('olderThanHours', 0, [0,1,6,24,168]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const requestGuardRef = useRef(createLatestRequest());
  const queryRef = useRef({ page, status, olderThanHours });
  queryRef.current = { page, status, olderThanHours };

  const load = useCallback(async (quiet = false) => {
    const request = requestGuardRef.current.begin();
    const query = queryRef.current;
    if (!quiet) setLoading(true);
    setError('');
    try {
      const response = await api.get<Overview>('/admin/media-cleanup-jobs', {
        params: { page: query.page, pageSize: 25, status: query.status, olderThanHours: query.olderThanHours },
        signal: request.signal,
      });
      if (request.isLatest()) setData(response.data);
    } catch (requestError) {
      if (request.isLatest() && !axios.isCancel(requestError)) {
        setError(mediaCleanupErrorMessage(requestError, '加载媒体清理任务失败'));
      }
    } finally {
      if (!quiet && request.isLatest()) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load, olderThanHours, page, status]);
  useEffect(() => () => requestGuardRef.current.cancel(), []);

  const retry = async (job: MediaCleanupJob) => {
    if (!job.eligibleForRetry || retryingId !== null) return;
    if (!window.confirm(mediaCleanupRetryConfirmation(job))) return;
    setRetryingId(job.id);
    setError('');
    setNotice('');
    try {
      await api.post(`/admin/media-cleanup-jobs/${job.id}/retry`);
      setNotice(mediaCleanupRetryFeedback(job.id, true));
      await load(true);
    } catch (requestError) {
      await load(true);
      setError(mediaCleanupErrorMessage(requestError, mediaCleanupRetryFeedback(job.id, false)));
    } finally {
      setRetryingId(null);
    }
  };

  const summary = data?.summary ?? emptySummary;
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 25)));
  const viewState = mediaCleanupViewState(loading, error, data?.items.length ?? 0);
  const showingAttention = status === 'attention';
  const caption = useMemo(() => {
    if (!data) return '正在读取清理队列状态';
    return `共 ${data.total} 个匹配任务 · 执行超过 ${data.staleAfterMinutes} 分钟视为超时`;
  }, [data]);

  return (
    <div className="space-y-6 p-1 sm:p-2">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-text-main"><DatabaseZap className="text-primary" />媒体清理运维</h1>
          <p className="mt-1 text-sm text-text-muted">监控账号注销后的媒体清理队列，并安全重试失败或超时任务。</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-text-main hover:bg-gray-50 disabled:opacity-50">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />刷新
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <SummaryCard label="等待重试" value={summary.pending} icon={Clock3} tone="amber" />
        <SummaryCard label="处理中" value={summary.processing} icon={Loader2} tone="blue" />
        <SummaryCard label="反复失败" value={summary.failing} icon={AlertTriangle} tone="red" />
        <SummaryCard label="执行超时" value={summary.stale} icon={AlertTriangle} tone="red" />
        <SummaryCard label="已完成" value={summary.completed} icon={CheckCircle2} tone="green" />
      </div>

      {notice ? <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-700">{notice}</div> : null}
      {error ? <div className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div> : null}

      <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-gray-100 p-5 lg:flex-row lg:items-center lg:justify-between">
          <div><h2 className="font-bold text-text-main">清理任务</h2><p className="mt-1 text-xs text-text-muted">{caption}</p></div>
          <div className="flex flex-wrap gap-2">
            <select value={status} onChange={(event) => { setStatus(event.target.value as CleanupFilter); setPage(1); }} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-text-main">
              <option value="attention">需要关注</option><option value="all">全部状态</option><option value="pending">等待重试</option><option value="processing">处理中</option><option value="failing">反复失败</option><option value="stale">执行超时</option><option value="completed">已完成</option>
            </select>
            <select value={olderThanHours} onChange={(event) => { setOlderThanHours(Number(event.target.value)); setPage(1); }} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-text-main">
              <option value={0}>不限任务年龄</option><option value={1}>超过 1 小时</option><option value={6}>超过 6 小时</option><option value={24}>超过 24 小时</option><option value={168}>超过 7 天</option>
            </select>
          </div>
        </div>

        {viewState === 'loading' ? <StatePanel icon={Loader2} label="正在加载媒体清理任务…" spin /> : null}
        {viewState === 'empty' ? <StatePanel icon={CheckCircle2} label={showingAttention ? '当前没有需要关注的媒体清理任务' : '当前筛选条件下没有任务'} /> : null}
        {viewState === 'error' && !data ? <StatePanel icon={AlertTriangle} label="任务列表暂时不可用，请重试" /> : null}
        {data?.items.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1050px] text-left text-sm">
              <thead className="bg-gray-50 text-xs text-text-muted"><tr><th className="px-5 py-3 font-medium">任务</th><th className="px-4 py-3 font-medium">状态</th><th className="px-4 py-3 font-medium">媒体</th><th className="px-4 py-3 font-medium">尝试</th><th className="px-4 py-3 font-medium">最后错误</th><th className="px-4 py-3 font-medium">更新时间</th><th className="px-5 py-3 text-right font-medium">操作</th></tr></thead>
              <tbody className="divide-y divide-gray-100">{data.items.map((job) => <JobRow key={job.id} job={job} retrying={retryingId === job.id} onRetry={retry} />)}</tbody>
            </table>
          </div>
        ) : null}

        {data && data.total > data.pageSize ? (
          <div className="flex items-center justify-between border-t border-gray-100 px-5 py-4 text-sm text-text-muted"><span>第 {page} / {totalPages} 页</span><div className="flex gap-2"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-lg border border-gray-200 px-3 py-1.5 disabled:opacity-40">上一页</button><button type="button" disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))} className="rounded-lg border border-gray-200 px-3 py-1.5 disabled:opacity-40">下一页</button></div></div>
        ) : null}
      </section>
    </div>
  );
}

function JobRow({ job, retrying, onRetry }: { job: MediaCleanupJob; retrying: boolean; onRetry: (job: MediaCleanupJob) => Promise<void> }) {
  const status = mediaCleanupStatusPresentation(job);
  const statusClass = { danger: 'bg-red-50 text-red-700', warning: 'bg-amber-50 text-amber-700', info: 'bg-blue-50 text-blue-700', success: 'bg-emerald-50 text-emerald-700' }[status.tone];
  return <tr className="align-top"><td className="px-5 py-4"><p className="font-semibold text-text-main">#{job.id}</p><p className="mt-1 text-xs text-text-muted">原用户 ID {job.ownerUserId}</p><p className="mt-1 text-[11px] text-text-muted">已存在 {formatAge(job.ageSeconds)}</p></td><td className="px-4 py-4"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass}`}>{status.label}</span></td><td className="px-4 py-4 text-text-main">{job.urlCount} 个对象</td><td className="px-4 py-4 text-text-main">{job.attempts} 次</td><td className="max-w-80 px-4 py-4"><p className="line-clamp-3 text-xs leading-5 text-red-600" title={job.lastError || ''}>{job.lastError || '—'}</p></td><td className="px-4 py-4 text-xs text-text-muted">{formatDate(job.updatedAt)}</td><td className="px-5 py-4 text-right"><button type="button" disabled={!job.eligibleForRetry || retrying} onClick={() => void onRetry(job)} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white disabled:bg-gray-200 disabled:text-gray-500">{retrying ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}{retrying ? '重试中' : '立即重试'}</button></td></tr>;
}

function SummaryCard({ label, value, icon: Icon, tone }: { label: string; value: number; icon: typeof Clock3; tone: 'amber' | 'blue' | 'red' | 'green' }) {
  const toneClass = { amber: 'bg-amber-50 text-amber-700', blue: 'bg-blue-50 text-blue-700', red: 'bg-red-50 text-red-700', green: 'bg-emerald-50 text-emerald-700' }[tone];
  return <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm"><div className={`inline-flex rounded-xl p-2.5 ${toneClass}`}><Icon size={19} /></div><p className="mt-3 text-sm text-text-muted">{label}</p><p className="mt-1 text-2xl font-bold text-text-main">{value}</p></div>;
}

function StatePanel({ icon: Icon, label, spin = false }: { icon: typeof Clock3; label: string; spin?: boolean }) {
  return <div className="flex min-h-52 flex-col items-center justify-center gap-3 p-8 text-sm text-text-muted"><Icon size={28} className={spin ? 'animate-spin text-primary' : 'text-gray-300'} /><span>{label}</span></div>;
}

function formatDate(value: string) { return new Date(value).toLocaleString('zh-CN'); }
function formatAge(seconds: number) { if (seconds < 3600) return `${Math.max(1, Math.floor(seconds / 60))} 分钟`; if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时`; return `${Math.floor(seconds / 86400)} 天`; }
