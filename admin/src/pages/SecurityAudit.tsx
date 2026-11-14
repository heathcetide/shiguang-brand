import { useCallback, useEffect, useMemo, useState } from 'react';
import { History, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import api from '@/services/api';
import {
  AdminButton,
  AdminPagination,
  EmptyState,
  PageHeader,
  Section,
  StatusBadge,
  TableContainer,
} from '@/components/admin';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/utils/cn';

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
    void fetchData();
  }, [fetchData]);

  const trashItems = useMemo(
    () =>
      (Object.entries(trash) as Array<[keyof TrashResponse, TrashItem[]]>)
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
    } catch (requestError: unknown) {
      const err = requestError as { response?: { data?: { error?: string } } };
      setError(err.response?.data?.error || '恢复失败');
    } finally {
      setRestoringKey('');
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="安全审计"
        description="查看管理员关键操作，并恢复被移入回收站的内容"
        actions={
          <AdminButton type="button" onClick={() => void fetchData()} disabled={loading}>
            <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
            刷新
          </AdminButton>
        }
      />

      {error ? (
        <p role="alert" className="border-destructive/20 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-sm">
          {error}
        </p>
      ) : null}

      <Section
        title="内容回收站"
        icon={<Trash2 size={18} />}
        action={<StatusBadge>{trashItems.length} 项</StatusBadge>}
      >
        <p className="text-muted-foreground mb-3 text-xs">软删除的帖子、食谱、食材和厨具可在这里恢复</p>
        {trashItems.length === 0 ? (
          <EmptyState>回收站为空</EmptyState>
        ) : (
          <ul className="divide-border divide-y">
            {trashItems.map((item) => {
              const key = `${item.resource}:${item.id}`;
              return (
                <li key={key} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0">
                  <div className="min-w-0 flex-1">
                    <StatusBadge>{resourceLabels[item.resource]}</StatusBadge>
                    <strong className="text-foreground mt-1 block truncate text-sm">{item.title}</strong>
                    <small className="text-muted-foreground text-xs">删除于 {formatDateTime(item.deletedAt)}</small>
                  </div>
                  <AdminButton
                    type="button"
                    onClick={() => void restore(item.resource, item.id)}
                    disabled={restoringKey === key}
                  >
                    <RotateCcw size={14} />
                    {restoringKey === key ? '恢复中' : '恢复'}
                  </AdminButton>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="管理员操作记录" icon={<History size={18} />}>
        <p className="text-muted-foreground mb-3 text-xs">
          记录角色、内容、审核和 AI 配置等关键变更 · 共 {auditData?.total || 0} 条
        </p>
        <TableContainer>
          <Table className="min-w-[720px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>时间</TableHead>
                <TableHead>管理员</TableHead>
                <TableHead>操作</TableHead>
                <TableHead>资源</TableHead>
                <TableHead>IP 地址</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(auditData?.items || []).map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="text-muted-foreground text-xs">{formatDateTime(item.createdAt)}</TableCell>
                  <TableCell className="text-foreground font-medium">{item.adminName}</TableCell>
                  <TableCell className="whitespace-normal">
                    <p className="text-foreground">{item.summary}</p>
                    <p className="text-muted-foreground font-mono text-[10px]">{item.action}</p>
                  </TableCell>
                  <TableCell className="text-muted-foreground whitespace-normal">
                    {resourceLabels[item.resourceType] || item.resourceType}
                    {item.resourceId ? ` #${item.resourceId}` : ''}
                  </TableCell>
                  <TableCell className="text-muted-foreground font-mono text-xs">{item.ipAddress || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!loading && !auditData?.items.length ? <EmptyState>暂无审计记录</EmptyState> : null}
        </TableContainer>

        <AdminPagination
          page={page}
          pageSize={auditData?.pageSize || 20}
          total={auditData?.total || 0}
          disabled={loading}
          onChange={setPage}
        />
      </Section>
    </div>
  );
}