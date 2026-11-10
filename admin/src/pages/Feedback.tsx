import { PageHeader } from '../components/admin/PageHeader';
import { FilterBar, EmptyState } from '../components/admin/ListPrimitives';
import { StatusBadge } from '../components/admin/StatusBadge';
import { useQueryState } from '../hooks/useQueryState';
import { useCallback, useEffect, useRef, useState } from "react";
import api from "../services/api";
type Status = "received" | "processing" | "waiting_user" | "resolved" | "closed";
const labels: Record<Status, string> = { received: "已收到", processing: "处理中", waiting_user: "待用户补充", resolved: "已解决", closed: "已关闭" };
type Item = { id: number; userId: number; category: string; content: string; status: Status; version: number; createdAt: string; context: { page?: string; appVersion?: string; platform?: string } | null };
type Detail = Item & { messages: Array<{ id: number; authorRole: string; visibility: string; content: string; status: Status; createdAt: string }> };
export default function Feedback() {
  const [items, setItems] = useState<Item[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [filter, setFilter] = useQueryState<string>('status', "", ["", "received", "processing", "waiting_user", "resolved", "closed"]);
  const [category, setCategory] = useQueryState<string>('category', "", ["", "issue", "suggestion", "support"]);
  const [next, setNext] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status>("processing");
  const [internal, setInternal] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const generation = useRef(0);
  const selection = useRef(0);
  const busy = useRef(false);
  const pending = useRef<{ fingerprint: string; key: string } | null>(null);
  const load = useCallback(async (cursor?: number) => {
    const sequence = ++generation.current;
    setLoading(true); setError("");
    try {
      const { data } = await api.get("/feedback/admin", { params: { status: filter || undefined, category: category || undefined, before: cursor } });
      if (sequence !== generation.current) return;
      setItems(current => cursor ? [...current, ...data.items] : data.items); setNext(data.nextCursor);
    } catch (err: any) { if (sequence === generation.current) setError(err.response?.data?.error || "读取反馈失败"); }
    finally { if (sequence === generation.current) setLoading(false); }
  }, [filter, category]);
  useEffect(() => { void load(); const cancel = () => { generation.current++; }; return cancel; }, [load]);
  useEffect(() => { const cancel = () => { selection.current++; }; return cancel; }, []);
  const open = async (id: number) => {
    if (saving || (text.trim() && !window.confirm("有未发送的内容，确定放弃吗？"))) return;
    const sequence = ++selection.current;
    setDetail(null); setText(""); setInternal(false); setError("");
    try {
      const { data } = await api.get(`/feedback/admin/${id}`);
      if (sequence !== selection.current) return;
      setDetail(data); setStatus(data.status);
    } catch (err: any) { if (sequence === selection.current) setError(err.response?.data?.error || "读取详情失败"); }
  };
  const submit = async () => {
    if (!detail || !text.trim() || busy.current) return;
    const sequence = selection.current;
    busy.current = true; setSaving(true); setError("");
    const payload = { content: text.trim(), version: detail.version, visibility: internal ? "internal" : "public", status: internal ? detail.status : status };
    const fingerprint = JSON.stringify([detail.id, payload]);
    if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, key: crypto.randomUUID() };
    try {
      const { data } = await api.post(`/feedback/admin/${detail.id}/replies`, { ...payload, requestKey: pending.current.key });
      if (sequence !== selection.current) return;
      setDetail(data); setText(""); setStatus(data.status); pending.current = null;
      await load();
    } catch (err: any) { if (sequence === selection.current) setError(err.response?.data?.error || "提交失败，请重试；如提示版本冲突，请刷新详情"); }
    finally { busy.current = false; setSaving(false); }
  };
  const closeDetail = () => { if (!saving && (!text.trim() || window.confirm('有未发送的内容，确定放弃吗？'))) { selection.current++; setDetail(null); setText(''); } };
  return <div className="admin-stack">
    <PageHeader title="用户反馈" description="公开回复会通知用户；内部备注仅管理员可见，不改变公开处理状态。"/>
    {error && <div role="alert" className="admin-error">{error}</div>}
    <FilterBar>
      <label>状态 <select aria-label="反馈状态筛选" value={filter} onChange={e => setFilter(e.target.value)} className="border px-3"><option value="">全部状态</option>{Object.entries(labels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <label>类型 <select aria-label="反馈类型筛选" value={category} onChange={e=>setCategory(e.target.value)} className="border px-3"><option value="">全部类型</option><option value="issue">问题</option><option value="suggestion">建议</option><option value="support">客服</option></select></label>
      <button disabled={loading} onClick={()=>void load()} className="admin-button">刷新列表</button>
    </FilterBar>
    <div className={`admin-feedback-layout ${detail?'has-detail':''}`}>
      <section className="admin-feedback-list" aria-label="反馈列表">
        {loading && <p role="status" className="admin-muted">正在加载…</p>}
        {!loading && !error && !items.length && <EmptyState/>}
        {items.map(item=><button key={item.id} aria-pressed={detail?.id===item.id} onClick={()=>void open(item.id)} className="admin-feedback-item"><div className="flex items-center justify-between gap-2"><strong>#{item.id}</strong><StatusBadge tone={item.status==='received'?'warning':item.status==='resolved'?'success':'neutral'}>{labels[item.status]}</StatusBadge></div><p className="mt-2 line-clamp-3">{item.content}</p><p className="admin-muted mt-2">用户 {item.userId} · {new Date(item.createdAt).toLocaleString('zh-CN')}</p></button>)}
        {next && <button disabled={loading} onClick={()=>void load(next)} className="admin-button">加载更多</button>}
      </section>
      {detail ? <section aria-label="反馈详情" className="admin-panel space-y-4">
        <div className="admin-panel-heading"><div><button className="admin-feedback-back admin-button mb-3" disabled={saving} onClick={closeDetail}>← 返回列表</button><h2>反馈 #{detail.id} · {labels[detail.status]}</h2></div><button disabled={saving} onClick={()=>void open(detail.id)} className="admin-button">刷新详情</button></div>
        <p className="whitespace-pre-wrap break-words">{detail.content}</p>
        <p className="admin-muted">页面：{detail.context?.page || '未附带'} · 版本：{detail.context?.appVersion || '未知'} · 平台：{detail.context?.platform || '未知'}</p>
        <div className="space-y-3">{detail.messages.map(message=><article key={message.id} className={`rounded-lg border p-3 ${message.visibility==='internal'?'border-amber-200 bg-amber-50':'border-gray-200 bg-gray-50'}`}><p className="text-xs font-semibold">{message.authorRole==='admin'?'管理员':'用户补充'} · {message.visibility==='internal'?'内部备注':'公开'} · {labels[message.status]}</p><p className="mt-2 whitespace-pre-wrap break-words">{message.content}</p><time className="admin-muted">{new Date(message.createdAt).toLocaleString('zh-CN')}</time></article>)}</div>
        <div className="admin-tabs" role="tablist" aria-label="回复方式"><button role="tab" aria-selected={!internal} onClick={()=>setInternal(false)}>回复用户</button><button role="tab" aria-selected={internal} onClick={()=>setInternal(true)}>内部备注</button></div>
        {internal ? <p className="text-sm text-amber-800">仅管理员可见，不通知用户，也不改变公开状态。</p> : <label className="block">处理状态 <select aria-label="处理状态" className="ml-2 border px-3" value={status} onChange={e=>setStatus(e.target.value as Status)}>{Object.entries(labels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>}
        <textarea aria-label={internal?'内部备注':'公开回复'} className="w-full min-h-32 border border-gray-300 p-3" maxLength={2000} value={text} onChange={e=>setText(e.target.value)} placeholder={internal?'填写内部处理说明':'向用户说明处理结果或需要补充的信息'}/>
        <div className="admin-actions"><button disabled={saving || !text.trim()} onClick={()=>void submit()} className="admin-button admin-button-primary">{saving?'提交中…':internal?'保存内部备注':'发送回复并更新状态'}</button><button disabled={saving} onClick={closeDetail} className="admin-button">关闭详情</button></div>
      </section> : <section className="admin-panel hidden md:block"><EmptyState>选择一条反馈查看详情。</EmptyState></section>}
    </div>
  </div>;
}
