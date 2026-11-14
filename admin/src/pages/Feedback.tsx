import {
  AdminButton,
  AdminField,
  AdminPagination,
  AdminSelect,
  AdminTextarea,
  EmptyState,
  FilterBar,
  PageHeader,
  StatusBadge,
} from '@/components/admin';
import { useQueryState } from '@/hooks/useQueryState';
import { useCallback, useEffect, useRef, useState } from 'react';
import api from '@/services/api';
import { asAdminPage } from '@/utils/adminResponses';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/utils/cn';

type Status = 'received' | 'processing' | 'waiting_user' | 'resolved' | 'closed';
const labels: Record<Status, string> = {
  received: '已收到',
  processing: '处理中',
  waiting_user: '待用户补充',
  resolved: '已解决',
  closed: '已关闭',
};
type Item = {
  id: number;
  userId: number;
  category: string;
  content: string;
  status: Status;
  version: number;
  createdAt: string;
  context: { page?: string; appVersion?: string; platform?: string } | null;
};
type Detail = Item & {
  messages: Array<{ id: number; authorRole: string; visibility: string; content: string; status: Status; createdAt: string }>;
};

function feedbackTone(status: Status): 'neutral' | 'success' | 'warning' {
  if (status === 'resolved') return 'success';
  if (status === 'received' || status === 'waiting_user') return 'warning';
  return 'neutral';
}

const categoryLabels: Record<string, string> = {
  issue: '问题',
  suggestion: '建议',
  support: '客服',
};

export default function Feedback() {
  const [items, setItems] = useState<Item[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [filter, setFilter] = useQueryState<string>('status', '', ['', 'received', 'processing', 'waiting_user', 'resolved', 'closed']);
  const [category, setCategory] = useQueryState<string>('category', '', ['', 'issue', 'suggestion', 'support']);
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [total, setTotal] = useState(0);
  const [text, setText] = useState('');
  const [status, setStatus] = useState<Status>('processing');
  const [internal, setInternal] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const generation = useRef(0);
  const selection = useRef(0);
  const busy = useRef(false);
  const pending = useRef<{ fingerprint: string; key: string } | null>(null);

  const load = useCallback(async () => {
    const sequence = ++generation.current;
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/feedback/admin', {
        params: {
          status: filter || undefined,
          category: category || undefined,
          page,
          pageSize,
        },
      });
      if (sequence !== generation.current) return;
      const pageData = asAdminPage<Item>(data, ['items']);
      setItems(pageData.items);
      setTotal(pageData.total);
    } catch (err: any) {
      if (sequence === generation.current) setError(err.response?.data?.error || '读取反馈失败');
    } finally {
      if (sequence === generation.current) setLoading(false);
    }
  }, [filter, category, page]);

  useEffect(() => {
    void load();
    return () => { generation.current++; };
  }, [load]);
  useEffect(() => () => { selection.current++; }, []);

  const open = async (id: number) => {
    if (saving || (text.trim() && !window.confirm('有未发送的内容，确定放弃吗？'))) return;
    const sequence = ++selection.current;
    setDetail(null);
    setText('');
    setInternal(false);
    setError('');
    try {
      const { data } = await api.get(`/feedback/admin/${id}`);
      if (sequence !== selection.current) return;
      setDetail(data);
      setStatus(data.status);
    } catch (err: any) {
      if (sequence === selection.current) setError(err.response?.data?.error || '读取详情失败');
    }
  };

  const submit = async () => {
    if (!detail || !text.trim() || busy.current) return;
    const sequence = selection.current;
    busy.current = true;
    setSaving(true);
    setError('');
    const payload = {
      content: text.trim(),
      version: detail.version,
      visibility: internal ? 'internal' : 'public',
      status: internal ? detail.status : status,
    };
    const fingerprint = JSON.stringify([detail.id, payload]);
    if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, key: crypto.randomUUID() };
    try {
      const { data } = await api.post(`/feedback/admin/${detail.id}/replies`, { ...payload, requestKey: pending.current.key });
      if (sequence !== selection.current) return;
      setDetail(data);
      setText('');
      setStatus(data.status);
      pending.current = null;
      await load();
    } catch (err: any) {
      if (sequence === selection.current) setError(err.response?.data?.error || '提交失败，请重试；如提示版本冲突，请刷新详情');
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  const closeDetail = () => {
    if (!saving && (!text.trim() || window.confirm('有未发送的内容，确定放弃吗？'))) {
      selection.current++;
      setDetail(null);
      setText('');
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="用户反馈" description="公开回复会通知用户；内部备注仅管理员可见，不改变公开处理状态。" />
      {error ? (
        <p role="alert" className="border-destructive/20 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-sm">
          {error}
        </p>
      ) : null}
      <FilterBar>
        <AdminField label="状态">
          <AdminSelect aria-label="反馈状态筛选" value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }}>
            <option value="">全部状态</option>
            {Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </AdminSelect>
        </AdminField>
        <AdminField label="类型">
          <AdminSelect aria-label="反馈类型筛选" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }}>
            <option value="">全部类型</option>
            <option value="issue">问题</option>
            <option value="suggestion">建议</option>
            <option value="support">客服</option>
          </AdminSelect>
        </AdminField>
        <AdminButton type="button" disabled={loading} onClick={() => void load()}>刷新列表</AdminButton>
      </FilterBar>

      <div className={cn('grid gap-5', detail ? 'lg:grid-cols-[minmax(0,22rem)_1fr]' : 'lg:grid-cols-1')}>
        <Card className="gap-0 py-0">
          <CardHeader className="border-b py-3">
            <CardTitle className="text-sm">反馈列表</CardTitle>
            <CardDescription>选择一条查看详情与回复</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 py-3">
            {loading ? <p role="status" className="text-muted-foreground text-sm">正在加载…</p> : null}
            {!loading && !error && !items.length ? <EmptyState /> : null}
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={detail?.id === item.id}
                onClick={() => void open(item.id)}
                className={cn(
                  'w-full rounded-lg border px-3 py-3 text-left text-sm transition-colors',
                  detail?.id === item.id
                    ? 'border-primary/30 bg-primary/5 ring-1 ring-primary/20'
                    : 'border-border hover:bg-muted/50',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <strong className="text-foreground">#{item.id}</strong>
                  <StatusBadge tone={feedbackTone(item.status)}>{labels[item.status]}</StatusBadge>
                </div>
                <p className="text-muted-foreground mt-2 line-clamp-3">{item.content}</p>
                <p className="text-muted-foreground mt-2 text-xs">
                  用户 {item.userId}
                  {item.category && categoryLabels[item.category] ? ` · ${categoryLabels[item.category]}` : ''}
                  {' · '}
                  {new Date(item.createdAt).toLocaleString('zh-CN')}
                </p>
              </button>
            ))}
            <AdminPagination page={page} pageSize={pageSize} total={total} disabled={loading} onChange={setPage} />
          </CardContent>
        </Card>

        {detail ? (
          <Card className="gap-0 py-0">
            <CardHeader className="flex flex-col gap-3 border-b py-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-2">
                <AdminButton type="button" className="h-8" disabled={saving} onClick={closeDetail}>
                  ← 返回列表
                </AdminButton>
                <CardTitle className="text-base">
                  反馈 #{detail.id}
                  {' '}
                  <StatusBadge tone={feedbackTone(detail.status)}>{labels[detail.status]}</StatusBadge>
                </CardTitle>
              </div>
              <AdminButton type="button" disabled={saving} onClick={() => void open(detail.id)}>刷新详情</AdminButton>
            </CardHeader>
            <CardContent className="space-y-4 py-4">
              <p className="text-foreground whitespace-pre-wrap break-words text-sm">{detail.content}</p>
              <p className="text-muted-foreground text-xs">
                页面：{detail.context?.page || '未附带'} · 版本：{detail.context?.appVersion || '未知'} · 平台：{detail.context?.platform || '未知'}
              </p>
              <div className="space-y-3">
                {detail.messages.map((message) => (
                  <article
                    key={message.id}
                    className={cn(
                      'rounded-lg border px-3 py-3',
                      message.visibility === 'internal'
                        ? 'border-amber-200/80 bg-amber-50/80'
                        : 'border-border bg-muted/30',
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
                      <span>{message.authorRole === 'admin' ? '管理员' : '用户补充'}</span>
                      <Badge variant={message.visibility === 'internal' ? 'warning' : 'outline'}>
                        {message.visibility === 'internal' ? '内部备注' : '公开'}
                      </Badge>
                      <StatusBadge tone={feedbackTone(message.status)}>{labels[message.status]}</StatusBadge>
                    </div>
                    <p className="text-foreground mt-2 whitespace-pre-wrap break-words text-sm">{message.content}</p>
                    <time className="text-muted-foreground mt-2 block text-xs">
                      {new Date(message.createdAt).toLocaleString('zh-CN')}
                    </time>
                  </article>
                ))}
              </div>

              <Tabs
                value={internal ? 'internal' : 'public'}
                onValueChange={(value) => setInternal(value === 'internal')}
              >
                <TabsList>
                  <TabsTrigger value="public">回复用户</TabsTrigger>
                  <TabsTrigger value="internal">内部备注</TabsTrigger>
                </TabsList>
                <TabsContent value="public" className="space-y-3 pt-3">
                  <AdminField label="处理状态">
                    <AdminSelect aria-label="处理状态" value={status} onChange={(e) => setStatus(e.target.value as Status)}>
                      {Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                    </AdminSelect>
                  </AdminField>
                </TabsContent>
                <TabsContent value="internal" className="pt-3">
                  <p className="text-muted-foreground text-sm">仅管理员可见，不通知用户，也不改变公开状态。</p>
                </TabsContent>
              </Tabs>

              <AdminTextarea
                aria-label={internal ? '内部备注' : '公开回复'}
                className="min-h-32 w-full"
                maxLength={2000}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={internal ? '填写内部处理说明' : '向用户说明处理结果或需要补充的信息'}
              />
              <div className="flex flex-wrap gap-2">
                <AdminButton type="button" variant="primary" disabled={saving || !text.trim()} onClick={() => void submit()}>
                  {saving ? '提交中…' : internal ? '保存内部备注' : '发送回复并更新状态'}
                </AdminButton>
                <AdminButton type="button" disabled={saving} onClick={closeDetail}>关闭详情</AdminButton>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="hidden gap-0 py-0 lg:block">
            <CardContent className="py-12">
              <EmptyState>选择一条反馈查看详情。</EmptyState>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}