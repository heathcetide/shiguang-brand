import { useQueryState } from '@/hooks/useQueryState';
import { useEffect, useState } from 'react';
import api from '@/services/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  AdminButton,
  AdminField,
  AdminSelect,
  EmptyState,
  FilterBar,
  PageHeader,
  StatusBadge,
} from '@/components/admin';
import { cn } from '@/utils/cn';

type Review = {
  id: number;
  raw_name: string;
  source_type: string;
  source_id: string | null;
  confidence: number;
  status: string;
  token: string;
};
type Catalog = { id: number; name: string; quality_status: string };

const sourceLabel = (type: string) =>
  type === 'recipe' ? '菜谱' : type === 'user_kitchenware' ? '用户厨具' : '导入词条';

export default function KitchenwareMappingReviews() {
  const [rows, setRows] = useState<Review[]>([]);
  const [catalog, setCatalog] = useState<Catalog[]>([]);
  const [confirming, setConfirming] = useState<number | null>(null);
  const [status, setStatus] = useQueryState<string>('status', 'pending', ['pending', 'approved', 'rejected']);
  const [reload, setReload] = useState(0);
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setRows([]);
    setSelected({});
    setConfirming(null);
    setMessage('');
    void Promise.all([
      api.get<{ items?: Review[]; reviews?: Review[]; hasMore?: boolean }>('/admin/kitchenware/mapping-reviews', { params: { status } }),
      api.get<{ items?: Catalog[] } | Catalog[]>('/admin/kitchenware/catalog', { params: { pageSize: 200 } }),
    ])
      .then(([reviews, tools]) => {
        if (!active) return;
        const reviewItems = reviews.data.items ?? reviews.data.reviews ?? [];
        setRows(Array.isArray(reviewItems) ? reviewItems : []);
        setMore(Boolean(reviews.data.hasMore));
        const catalogPayload = tools.data;
        const catalogItems = Array.isArray(catalogPayload)
          ? catalogPayload
          : Array.isArray(catalogPayload?.items)
            ? catalogPayload.items
            : [];
        setCatalog(catalogItems.filter((item) => !item.quality_status || item.quality_status === 'trusted'));
      })
      .catch(() => {
        if (active) setMessage('读取失败，请刷新重试。');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [status, reload]);

  async function decide(row: Review, decision: 'approved' | 'rejected') {
    const catalogId = Number(selected[row.id]);
    if (busy || (decision === 'approved' && !catalogId)) return;
    if (decision === 'approved' && confirming !== row.id) {
      setConfirming(row.id);
      return;
    }
    setBusy(true);
    try {
      await api.post(`/admin/kitchenware/mapping-reviews/${row.id}`, {
        token: row.token,
        decision,
        ...(decision === 'approved' ? { catalogId } : {}),
      });
      setReload((value) => value + 1);
    } catch (error) {
      setMessage((error as { response?: { data?: { error?: string } } }).response?.data?.error || '审核未完成，请刷新核对后重试。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="厨具映射审核"
        description="核对原始名称与标准设备。批准会建立全局别名，并修复仍匹配的来源菜谱要求；拒绝不会赋予设备能力。不要仅因名称相似就批准。"
        actions={
          <AdminButton disabled={busy} onClick={() => setReload((value) => value + 1)}>
            刷新
          </AdminButton>
        }
      />

      <FilterBar>
        <AdminField label="审核状态" className="min-w-[10rem]">
          <AdminSelect
            aria-label="审核状态"
            disabled={busy}
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="pending">待审核</option>
            <option value="approved">已批准</option>
            <option value="rejected">已拒绝</option>
          </AdminSelect>
        </AdminField>
      </FilterBar>

      {message ? (
        <div role="alert" className="border-destructive/20 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-sm">
          {message}
        </div>
      ) : null}

      <Card className="gap-0 py-0">
        <CardHeader className="border-b py-4">
          <CardTitle>映射词条</CardTitle>
          <CardDescription>
            {status === 'pending' ? '为每条原始名称选择已核实的标准厨具后再批准。' : `当前筛选：${status === 'approved' ? '已批准' : '已拒绝'}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <EmptyState>正在读取…</EmptyState>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>原始名称</TableHead>
                    <TableHead>来源</TableHead>
                    <TableHead>匹配置信度</TableHead>
                    <TableHead className="min-w-[320px]">处理</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.raw_name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        <span className="text-foreground">{sourceLabel(row.source_type)}</span>
                        <span className="text-muted-foreground"> / {row.source_id || '—'}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{row.confidence}</Badge>
                      </TableCell>
                      <TableCell>
                        {status === 'pending' ? (
                          <div className="flex flex-col gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <AdminSelect
                                aria-label={`标准厨具 ${row.id}`}
                                className="min-w-[12rem] flex-1"
                                disabled={busy}
                                value={selected[row.id] || ''}
                                onChange={(event) => {
                                  setConfirming(null);
                                  setSelected((value) => ({ ...value, [row.id]: event.target.value }));
                                }}
                              >
                                <option value="">选择已核实的标准厨具</option>
                                {catalog.map((item) => (
                                  <option key={item.id} value={item.id}>
                                    {item.name}
                                  </option>
                                ))}
                              </AdminSelect>
                              <Button
                                type="button"
                                size="sm"
                                disabled={busy || !selected[row.id]}
                                onClick={() => void decide(row, 'approved')}
                              >
                                {confirming === row.id ? '确认全局别名' : '批准为别名'}
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={busy}
                                onClick={() => void decide(row, 'rejected')}
                              >
                                拒绝映射
                              </Button>
                            </div>
                            {confirming === row.id ? (
                              <p
                                role="alert"
                                className="border-amber-200/80 bg-amber-50 text-amber-900 rounded-lg border px-3 py-2 text-xs leading-relaxed"
                              >
                                确认将「{row.raw_name}」作为「
                                {catalog.find((item) => item.id === Number(selected[row.id]))?.name}
                                」的全局别名，并修复来源菜谱要求。
                                <Button
                                  type="button"
                                  variant="link"
                                  size="sm"
                                  className="ml-1 h-auto px-1 py-0"
                                  onClick={() => setConfirming(null)}
                                >
                                  取消
                                </Button>
                              </p>
                            ) : null}
                          </div>
                        ) : row.status === 'approved' ? (
                          <StatusBadge tone="success">已批准</StatusBadge>
                        ) : (
                          <StatusBadge tone="danger">已拒绝</StatusBadge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {!rows.length ? <EmptyState>暂无该状态的词条。</EmptyState> : null}
            </>
          )}
        </CardContent>
      </Card>

      {more ? (
        <p className={cn('text-muted-foreground text-sm')}>当前显示前 200 条；处理待审词条后刷新继续。</p>
      ) : null}
    </div>
  );
}