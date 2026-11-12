import { useQueryState } from '../hooks/useQueryState';
import { useEffect, useState } from 'react';
import api from '../services/api';
import {
  AdminButton,
  AdminSelect,
  EmptyState,
  FilterBar,
  PageHeader,
  StatusBadge,
  TableContainer,
} from '../components/admin';

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
    <div className="admin-stack">
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
      </FilterBar>
      {message && (
        <p role="alert" className="admin-error">
          {message}
        </p>
      )}
      {loading ? (
        <p role="status" className="admin-muted">
          正在读取…
        </p>
      ) : (
        <TableContainer>
          <table className="admin-table">
            <thead>
              <tr>
                <th>原始名称</th>
                <th>来源</th>
                <th>匹配置信度</th>
                <th>处理</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.raw_name}</td>
                  <td>
                    {row.source_type === 'recipe'
                      ? '菜谱'
                      : row.source_type === 'user_kitchenware'
                        ? '用户厨具'
                        : '导入词条'}{' '}
                    / {row.source_id || '—'}
                  </td>
                  <td>{row.confidence}</td>
                  <td>
                    {status === 'pending' ? (
                      <div className="admin-actions flex-wrap">
                        <AdminSelect
                          aria-label={`标准厨具 ${row.id}`}
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
                        <AdminButton
                          variant="primary"
                          disabled={busy || !selected[row.id]}
                          onClick={() => void decide(row, 'approved')}
                        >
                          {confirming === row.id ? '确认全局别名' : '批准为别名'}
                        </AdminButton>
                        <AdminButton disabled={busy} onClick={() => void decide(row, 'rejected')}>
                          拒绝映射
                        </AdminButton>
                        {confirming === row.id && (
                          <p role="alert" className="w-full text-sm text-amber-800">
                            确认将“{row.raw_name}”作为“
                            {catalog.find((item) => item.id === Number(selected[row.id]))?.name}
                            ”的全局别名，并修复来源菜谱要求。
                            <AdminButton className="ml-2" onClick={() => setConfirming(null)}>
                              取消
                            </AdminButton>
                          </p>
                        )}
                      </div>
                    ) : row.status === 'approved' ? (
                      <StatusBadge tone="success">已批准</StatusBadge>
                    ) : (
                      <StatusBadge tone="danger">已拒绝</StatusBadge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <EmptyState>暂无该状态的词条。</EmptyState>}
        </TableContainer>
      )}
      {more && <p className="admin-muted text-sm">当前显示前 200 条；处理待审词条后刷新继续。</p>}
    </div>
  );
}
