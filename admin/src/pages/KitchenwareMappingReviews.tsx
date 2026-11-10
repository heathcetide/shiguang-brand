import { useQueryState } from '../hooks/useQueryState';
import { useEffect, useState } from 'react';
import api from '../services/api';
type Review = { id: number;raw_name: string;source_type: string;source_id: string | null;confidence: number;status: string;token: string };
type Catalog = { id: number;name: string;quality_status: string };
export default function KitchenwareMappingReviews() {
  const [rows,setRows] = useState<Review[]>([]),[catalog,setCatalog] = useState<Catalog[]>([]);
  const [confirming,setConfirming] = useState<number | null>(null);
  const [status,setStatus] = useQueryState<string>('status', 'pending', ["pending", "approved", "rejected"]),[reload,setReload] = useState(0),[message,setMessage] = useState('');
  const [selected,setSelected] = useState<Record<number,string>>({}),[busy,setBusy] = useState(false),[loading,setLoading] = useState(true),[more,setMore] = useState(false);
  useEffect(() => {
    let active = true; setLoading(true); setRows([]); setSelected({}); setConfirming(null); setMessage('');
    void Promise.all([api.get<{ items: Review[];hasMore: boolean }>('/admin/kitchenware/mapping-reviews',{ params: { status } }),api.get<Catalog[]>('/admin/kitchenware/catalog')])
      .then(([reviews,tools]) => { if (active) { setRows(reviews.data.items); setMore(reviews.data.hasMore); setCatalog(tools.data.filter(item => item.quality_status === 'trusted')); } })
      .catch(() => { if (active) setMessage('读取失败，请刷新重试。'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  },[status,reload]);
  async function decide(row: Review,decision: 'approved' | 'rejected') {
    const catalogId = Number(selected[row.id]); if (busy || (decision === 'approved' && !catalogId)) return;
    if (decision === 'approved' && confirming !== row.id) { setConfirming(row.id); return; }
    setBusy(true);
    try { await api.post(`/admin/kitchenware/mapping-reviews/${row.id}`,{ token: row.token,decision,...(decision === 'approved' ? { catalogId } : {}) }); setReload(value => value+1); }
    catch (error) { setMessage((error as { response?: { data?: { error?: string } } }).response?.data?.error || '审核未完成，请刷新核对后重试。'); }
    finally { setBusy(false); }
  }
  return <main className="space-y-5 p-6"><h1 className="text-2xl font-semibold">厨具映射审核</h1>
    <p className="text-sm text-slate-600">核对原始名称与标准设备。批准会建立全局别名，并修复仍匹配的来源菜谱要求；拒绝不会赋予设备能力。不要仅因名称相似就批准。</p>
    <div className="flex gap-3"><select aria-label="审核状态" disabled={busy} value={status} onChange={event => setStatus(event.target.value)} className="rounded border p-2"><option value="pending">待审核</option><option value="approved">已批准</option><option value="rejected">已拒绝</option></select><button disabled={busy} onClick={() => setReload(value => value+1)}>刷新</button></div>
    {message && <p role="alert" className="rounded bg-amber-50 p-3 text-amber-900">{message}</p>}
    {loading ? <p>正在读取…</p> : <div className="overflow-x-auto rounded border bg-white"><table className="min-w-[760px] w-full text-left text-sm"><thead><tr><th className="whitespace-nowrap p-3">原始名称</th><th className="whitespace-nowrap p-3">来源</th><th className="whitespace-nowrap p-3">匹配置信度</th><th className="whitespace-nowrap p-3">处理</th></tr></thead><tbody>{rows.map(row => <tr key={row.id} className="border-t"><td className="p-3">{row.raw_name}</td><td className="p-3">{row.source_type === 'recipe' ? '菜谱' : row.source_type === 'user_kitchenware' ? '用户厨具' : '导入词条'} / {row.source_id || '—'}</td><td className="p-3">{row.confidence}</td><td className="flex flex-wrap gap-2 p-3">{status === 'pending' ? <><select aria-label={`标准厨具 ${row.id}`} disabled={busy} value={selected[row.id] || ''} onChange={event => { setConfirming(null); setSelected(value => ({ ...value,[row.id]: event.target.value })); }} className="rounded border p-2"><option value="">选择已核实的标准厨具</option>{catalog.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button className="rounded bg-slate-900 px-3 py-2 text-white disabled:opacity-50" disabled={busy || !selected[row.id]} onClick={() => void decide(row,'approved')}>{confirming === row.id ? '确认全局别名' : '批准为别名'}</button><button disabled={busy} onClick={() => void decide(row,'rejected')}>拒绝映射</button>{confirming === row.id && <p role="alert" className="w-full text-amber-800">确认将“{row.raw_name}”作为“{catalog.find(item => item.id === Number(selected[row.id]))?.name}”的全局别名，并修复来源菜谱要求。<button className="ml-2 underline" onClick={() => setConfirming(null)}>取消</button></p>}</> : row.status === 'approved' ? '已批准' : '已拒绝'}</td></tr>)}</tbody></table>{!rows.length && <p className="p-4">暂无该状态的词条。</p>}</div>}
    {more && <p className="text-sm">当前显示前 200 条；处理待审词条后刷新继续。</p>}
  </main>;
}
