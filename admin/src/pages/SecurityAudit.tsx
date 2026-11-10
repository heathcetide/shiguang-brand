import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  History,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import api from '../services/api';

interface AuditItem {
  id: number;
  adminUserId: number;
  adminName: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  summary: string;
  ipAddress: string | null;
  createdAt: string;
}

interface AuditResponse {
  items: AuditItem[];
  total: number;
  page: number;
  pageSize: number;
}

interface TrashItem {
  id: number;
  title: string;
  deletedAt: string;
}

interface TrashResponse {
  community: TrashItem[];
  recipes: TrashItem[];
  ingredients: TrashItem[];
  kitchenware: TrashItem[];
}

const resourceLabels: Record<string, string> = {
  community: '社区帖子',
  recipes: '食谱',
  ingredients: '食材',
  kitchenware: '厨具',
};

function formatDateTime(value: string) {
  return new Date(`${value.replace(' ', 'T')}Z`).toLocaleString('zh-CN');
}

export default function SecurityAudit() {
  const [auditData, setAuditData] = useState<AuditResponse | null>(null);
  const [trash, setTrash] = useState<TrashResponse>({ community: [], recipes: [], ingredients: [], kitchenware: [] });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [restoringKey, setRestoringKey] = useState('');
  const [error, setError] = useState('');

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const [auditResponse, trashResponse] = await Promise.all([
        api.get<AuditResponse>('/admin/audit-logs', { params: { page, pageSize: 20 } }),
        api.get<TrashResponse>('/admin/trash'),
      ]);
      setAuditData(auditResponse.data);
      setTrash(trashResponse.data);
    } catch (requestError) {
      console.error('Security data loading failed:', requestError);
      setError('安全审计数据加载失败');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const trashItems = useMemo(
    () => (Object.entries(trash) as Array<[keyof TrashResponse, TrashItem[]]>)
      .flatMap(([resource, items]) => items.map((item) => ({ ...item, resource })))
      .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt)),
    [trash],
  );

  const restore = async (resource: keyof TrashResponse, id: number) => {
    const key = `${resource}:${id}`;
    try {
      setRestoringKey(key);
      await api.post(`/admin/trash/${resource}/${id}/restore`);
      await fetchData();
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || '恢复失败');
    } finally {
      setRestoringKey('');
    }
  };

  const totalPages = Math.max(1, Math.ceil((auditData?.total || 0) / (auditData?.pageSize || 20)));

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-text-main">
            <ShieldCheck className="h-7 w-7 text-primary" />
            安全审计
          </h1>
          <p className="mt-1 text-sm text-text-muted">查看管理员关键操作，并恢复被移入回收站的内容</p>
        </div>
        <button
          type="button"
          onClick={fetchData}
          disabled={loading}
          className="flex items-center justify-center rounded-xl border border-gray-100 bg-white px-4 py-2.5 text-sm font-medium shadow-sm disabled:opacity-50"
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {error ? <div className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-600">{error}</div> : null}

      <section className="rounded-[24px] bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="flex items-center gap-2 font-bold text-text-main">
              <Trash2 className="h-5 w-5 text-amber-600" />
              内容回收站
            </h2>
            <p className="mt-1 text-xs text-text-muted">软删除的帖子、食谱、食材和厨具可在这里恢复</p>
          </div>
          <span className="rounded-full bg-background-alt px-3 py-1 text-xs text-text-muted">
            {trashItems.length} 项
          </span>
        </div>

        {trashItems.length === 0 ? (
          <div className="py-10 text-center text-sm text-text-muted">回收站为空</div>
        ) : (
          <div className="divide-y divide-background-alt">
            {trashItems.map((item) => {
              const key = `${item.resource}:${item.id}`;
              return (
                <div key={key} className="flex items-center gap-4 py-4">
                  <span className="rounded-lg bg-background-alt px-2.5 py-1 text-xs text-text-muted">
                    {resourceLabels[item.resource]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-text-main">{item.title}</p>
                    <p className="mt-1 text-xs text-text-muted">删除于 {formatDateTime(item.deletedAt)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => restore(item.resource, item.id)}
                    disabled={restoringKey === key}
                    className="flex items-center gap-1.5 rounded-xl bg-primary/10 px-3 py-2 text-xs font-medium text-primary disabled:opacity-50"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    {restoringKey === key ? '恢复中' : '恢复'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-[24px] bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="flex items-center gap-2 font-bold text-text-main">
              <History className="h-5 w-5 text-primary" />
              管理员操作记录
            </h2>
            <p className="mt-1 text-xs text-text-muted">记录角色、内容、审核和 AI 配置等关键变更</p>
          </div>
          <span className="text-xs text-text-muted">共 {auditData?.total || 0} 条</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[780px] text-left">
            <thead>
              <tr className="border-b border-background-alt text-xs text-text-muted">
                <th className="pb-3 font-medium">时间</th>
                <th className="pb-3 font-medium">管理员</th>
                <th className="pb-3 font-medium">操作</th>
                <th className="pb-3 font-medium">资源</th>
                <th className="pb-3 font-medium">IP 地址</th>
              </tr>
            </thead>
            <tbody>
              {(auditData?.items || []).map((item) => (
                <tr key={item.id} className="border-b border-background-alt/60 text-sm last:border-0">
                  <td className="py-4 text-xs text-text-muted">{formatDateTime(item.createdAt)}</td>
                  <td className="py-4 font-medium text-text-main">{item.adminName}</td>
                  <td className="py-4">
                    <p className="text-text-main">{item.summary}</p>
                    <p className="mt-1 font-mono text-[10px] text-text-muted">{item.action}</p>
                  </td>
                  <td className="py-4 text-text-muted">
                    {resourceLabels[item.resourceType] || item.resourceType}
                    {item.resourceId ? ` #${item.resourceId}` : ''}
                  </td>
                  <td className="py-4 font-mono text-xs text-text-muted">{item.ipAddress || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !auditData?.items.length ? (
            <div className="py-12 text-center text-sm text-text-muted">暂无审计记录</div>
          ) : null}
        </div>

        <div className="mt-5 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            disabled={page <= 1}
            className="rounded-xl border border-gray-100 p-2 text-text-muted disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-xs text-text-muted">第 {page} / {totalPages} 页</span>
          <button
            type="button"
            onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
            disabled={page >= totalPages}
            className="rounded-xl border border-gray-100 p-2 text-text-muted disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </section>
    </div>
  );
}
