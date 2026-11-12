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
import {
  AdminButton,
  AdminField,
  AdminPagination,
  AdminSelect,
  EmptyState,
  FilterBar,
  PageHeader,
  Section,
  StatusBadge,
  TableContainer,
} from '../components/admin';
import { createLatestRequest } from '../utils/latestRequest';
import { asAdminArray } from '../utils/adminResponses';
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
  const [status, setStatus] = useQueryState<CleanupFilter>('status', 'attention', [
    'all',
    'attention',
    'pending',
    'processing',
    'completed',
    'failing',
    'stale',
  ]);
  const [olderThanHours, setOlderThanHours] = useQueryNumber('olderThanHours', 0, [0, 1, 6, 24, 168]);
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
      const response = await api.get('/admin/media-cleanup-jobs', {
        params: { page: query.page, pageSize: 25, status: query.status, olderThanHours: query.olderThanHours },
        signal: request.signal,
      });
      if (request.isLatest()) {
        const payload = response.data && typeof response.data === 'object' ? (response.data as Partial<Overview>) : {};
        setData({
          items: asAdminArray<MediaCleanupJob>(response.data, ['items', 'jobs']),
          total: typeof payload.total === 'number' ? payload.total : 0,
          page: typeof payload.page === 'number' ? payload.page : query.page,
          pageSize: typeof payload.pageSize === 'number' ? payload.pageSize : 25,
          status: (payload.status as CleanupFilter) || query.status,
          olderThanHours: typeof payload.olderThanHours === 'number' ? payload.olderThanHours : query.olderThanHours,
          staleAfterMinutes: typeof payload.staleAfterMinutes === 'number' ? payload.staleAfterMinutes : 30,
          summary: payload.summary || emptySummary,
        });
      }
    } catch (requestError) {
      if (request.isLatest() && !axios.isCancel(requestError)) {
        setError(mediaCleanupErrorMessage(requestError, '加载媒体清理任务失败'));
      }
    } finally {
      if (!quiet && request.isLatest()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, olderThanHours, page, status]);
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
  const viewState = mediaCleanupViewState(loading, error, data?.items.length ?? 0);
  const showingAttention = status === 'attention';
  const caption = useMemo(() => {
    if (!data) return '正在读取清理队列状态';
    return `共 ${data.total} 个匹配任务 · 执行超过 ${data.staleAfterMinutes} 分钟视为超时`;
  }, [data]);

  return (
    <div className="admin-stack">
      <PageHeader
        title="媒体清理运维"
        description="监控账号注销后的媒体清理队列，并安全重试失败或超时任务。"
        actions={
          <AdminButton type="button" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            刷新
          </AdminButton>
        }
      />

      <div className="admin-stat-grid">
        <SummaryCard label="等待重试" value={summary.pending} icon={Clock3} />
        <SummaryCard label="处理中" value={summary.processing} icon={Loader2} />
        <SummaryCard label="反复失败" value={summary.failing} icon={AlertTriangle} tone="danger" />
        <SummaryCard label="执行超时" value={summary.stale} icon={AlertTriangle} tone="warning" />
        <SummaryCard label="已完成" value={summary.completed} icon={CheckCircle2} tone="success" />
      </div>

      {notice ? (
        <p role="status" className="admin-muted">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="admin-error">
          {error}
        </p>
      ) : null}

      <Section title="清理任务" icon={<DatabaseZap size={18} />}>
        <p className="admin-muted mb-3 text-xs">{caption}</p>
        <FilterBar>
          <AdminField label="状态">
            <AdminSelect
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as CleanupFilter);
                setPage(1);
              }}
            >
              <option value="attention">需要关注</option>
              <option value="all">全部状态</option>
              <option value="pending">等待重试</option>
              <option value="processing">处理中</option>
              <option value="failing">反复失败</option>
              <option value="stale">执行超时</option>
              <option value="completed">已完成</option>
            </AdminSelect>
          </AdminField>
          <AdminField label="任务年龄">
            <AdminSelect
              value={String(olderThanHours)}
              onChange={(event) => {
                setOlderThanHours(Number(event.target.value));
                setPage(1);
              }}
            >
              <option value={0}>不限任务年龄</option>
              <option value={1}>超过 1 小时</option>
              <option value={6}>超过 6 小时</option>
              <option value={24}>超过 24 小时</option>
              <option value={168}>超过 7 天</option>
            </AdminSelect>
          </AdminField>
        </FilterBar>

        {viewState === 'loading' ? (
          <p role="status" className="admin-muted">
            正在加载媒体清理任务…
          </p>
        ) : null}
        {viewState === 'empty' ? (
          <EmptyState>{showingAttention ? '当前没有需要关注的媒体清理任务' : '当前筛选条件下没有任务'}</EmptyState>
        ) : null}
        {viewState === 'error' && !data ? <EmptyState>任务列表暂时不可用，请重试</EmptyState> : null}
        {data?.items.length ? (
          <TableContainer>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>任务</th>
                  <th>状态</th>
                  <th>媒体</th>
                  <th>尝试</th>
                  <th>最后错误</th>
                  <th>更新时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((job) => (
                  <JobRow key={job.id} job={job} retrying={retryingId === job.id} onRetry={retry} />
                ))}
              </tbody>
            </table>
          </TableContainer>
        ) : null}

        {data ? (
          <AdminPagination
            page={page}
            pageSize={data.pageSize || 25}
            total={data.total}
            disabled={viewState === 'loading'}
            onChange={setPage}
          />
        ) : null}
      </Section>
    </div>
  );
}

function JobRow({
  job,
  retrying,
  onRetry,
}: {
  job: MediaCleanupJob;
  retrying: boolean;
  onRetry: (job: MediaCleanupJob) => Promise<void>;
}) {
  const status = mediaCleanupStatusPresentation(job);
  const tone = status.tone === 'danger' ? 'danger' : status.tone === 'warning' ? 'warning' : status.tone === 'success' ? 'success' : 'neutral';
  return (
    <tr>
      <td>
        <p className="font-semibold">#{job.id}</p>
        <p className="admin-muted text-xs">原用户 ID {job.ownerUserId}</p>
        <p className="admin-muted text-xs">已存在 {formatAge(job.ageSeconds)}</p>
      </td>
      <td>
        <StatusBadge tone={tone}>{status.label}</StatusBadge>
      </td>
      <td>{job.urlCount} 个对象</td>
      <td>{job.attempts} 次</td>
      <td>
        <p className="line-clamp-3 text-xs text-destructive" title={job.lastError || ''}>
          {job.lastError || '—'}
        </p>
      </td>
      <td className="admin-muted text-xs">{formatDate(job.updatedAt)}</td>
      <td>
        <AdminButton
          type="button"
          variant="primary"
          disabled={!job.eligibleForRetry || retrying}
          onClick={() => void onRetry(job)}
        >
          {retrying ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
          {retrying ? '重试中' : '立即重试'}
        </AdminButton>
      </td>
    </tr>
  );
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  icon: typeof Clock3;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}) {
  return (
    <div className="admin-metric-card">
      <div className="admin-muted mb-2 flex items-center gap-2 text-xs">
        <Icon size={16} />
        {label}
      </div>
      <div className="admin-metric-value">{value}</div>
      <StatusBadge tone={tone}>{label}</StatusBadge>
    </div>
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('zh-CN');
}
function formatAge(seconds: number) {
  if (seconds < 3600) return `${Math.max(1, Math.floor(seconds / 60))} 分钟`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时`;
  return `${Math.floor(seconds / 86400)} 天`;
}
