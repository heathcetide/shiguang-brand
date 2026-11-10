import { useCallback, useEffect, useState } from 'react';
import { Bell, CheckCircle2, Eye, Inbox, Loader2, MousePointerClick, RefreshCw, Send, Smartphone, Users } from 'lucide-react';
import api from '../services/api';

type Campaign = { id: number; title: string; body: string; status: string; recipientCount: number; successCount: number; failureCount: number; createdAt: string; sentAt: string | null; adminName: string };
type Automatic = { deliveryDate: string; status: string; count: number };
type NotificationMetrics = { created: number; pushSubmitted: number; pushDelivered: number; opened: number; actionClicks: number; pushFailures: number };
type Overview = { interventionsEnabled?: boolean; interventionMetrics?: Record<string,number>; activeDevices: number; enabledUsers: number; campaigns: Campaign[]; automatic: Automatic[]; metrics: NotificationMetrics };

export default function Notifications() {
  const [data, setData] = useState<Overview | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try { setError(''); setData((await api.get<Overview>('/admin/notifications')).data); }
    catch (e) { setError(e instanceof Error ? e.message : '加载通知数据失败'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const send = async () => {
    if (!title.trim() || !body.trim() || sending) return;
    if (!window.confirm('将为所有有效用户创建站内通知，并向已授权设备额外推送，确认继续？')) return;
    setSending(true);
    try {
      await api.post('/admin/notifications/campaigns', { title: title.trim(), body: body.trim() });
      setTitle(''); setBody(''); await load();
    } catch (e) { setError(e instanceof Error ? e.message : '发送失败'); }
    finally { setSending(false); }
  };

  return <div className="space-y-6 p-7">
    <div className="flex items-center justify-between"><div><h1 className="text-2xl font-bold text-text-main">通知中心</h1><p className="mt-1 text-sm text-text-muted">发送运营通知，并追踪自动临期提醒的投递情况。</p></div><button onClick={() => void load()} className="rounded-xl border border-gray-200 p-2 text-text-muted hover:bg-gray-50"><RefreshCw size={18}/></button></div>
    {error && <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5"><Stat icon={Smartphone} label="活跃推送设备" value={data?.activeDevices ?? '—'} /><Stat icon={Users} label="已开启提醒用户" value={data?.enabledUsers ?? '—'} /><Stat icon={Inbox} label="30 天创建" value={data?.metrics.created ?? '—'} /><Stat icon={Eye} label="30 天打开" value={data?.metrics.opened ?? '—'} /><Stat icon={MousePointerClick} label="30 天动作点击" value={data?.metrics.actionClicks ?? '—'} /></div>
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"><h2 className="font-bold text-text-main">推送链路（近 30 天）</h2><div className="mt-4 grid gap-3 sm:grid-cols-3"><Metric label="已提交 Expo" value={data?.metrics.pushSubmitted ?? 0}/><Metric label="Receipt 已送达" value={data?.metrics.pushDelivered ?? 0}/><Metric label="投递失败" value={data?.metrics.pushFailures ?? 0} danger/></div></section>
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"><div className="mb-4 flex items-center gap-2"><Send size={18} className="text-primary"/><h2 className="font-bold text-text-main">发送通知</h2></div><div className="space-y-3"><input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="通知标题" className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-primary"/><textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={500} rows={3} placeholder="通知内容" className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-primary"/><div className="flex items-center justify-between"><span className="text-xs text-text-muted">所有有效用户收到站内信；已授权设备同时收到推送</span><button disabled={!title.trim() || !body.trim() || sending} onClick={() => void send()} className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{sending ? <Loader2 size={16} className="animate-spin"/> : <Send size={16}/>}发送</button></div></div></section>
    <section className="rounded-2xl border border-gray-200 bg-white shadow-sm"><div className="border-b border-gray-100 p-5"><h2 className="font-bold text-text-main">手动通知记录</h2></div><div className="divide-y divide-gray-100">{data?.campaigns.length ? data.campaigns.map((item) => <div key={item.id} className="p-5"><div className="flex items-start justify-between gap-4"><div><div className="font-semibold text-text-main">{item.title}</div><p className="mt-1 text-sm text-text-muted">{item.body}</p><p className="mt-2 text-xs text-text-muted">{item.adminName} · {new Date(item.createdAt).toLocaleString('zh-CN')}</p></div><div className="shrink-0 text-right text-xs text-text-muted"><div className="font-semibold text-primary">{item.status}</div><div className="mt-1">{item.successCount}/{item.recipientCount} 已接受</div>{item.failureCount > 0 && <div className="mt-1 text-red-600">{item.failureCount} 失败</div>}</div></div></div>) : <Empty label="还没有手动发送记录"/>}</div></section>
    <section className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4"><h2 className="font-bold">主动食物提醒 · {data?.interventionsEnabled ? '服务端已启用' : '服务端已关闭'}</h2><p className="text-sm text-text-muted">最近 30 天建立的候选及其已关联业务结果。加入队列不等于开始烹饪；推送接受不等于用户收到。结果只说明关联，不代表提醒造成了行为改变。</p><div className="grid grid-cols-2 gap-3 md:grid-cols-4">{Object.entries({ candidates: '候选数', suppressed: '策略未发送', inbox_only: '仅站内', accepted: '推送已接受', uncertain: '投递不确定', failed: '投递失败', acted: '已处理候选', action_plan_recipe: '安排菜谱', cooking_started: '实际开始烹饪', inventory_used: '确认已使用', inventory_discarded: '确认已丢弃', action_not_helpful: '反馈没帮助', expired_unhandled: '已过期未处理' }).map(([key,label]) => <Metric key={key} label={label} value={data?.interventionMetrics?.[key] ?? 0} danger={key === 'failed' || key === 'uncertain'} />)}</div><div className="grid gap-3 md:grid-cols-3"><Metric label="进入队列的可见候选比例" value={rate(data?.interventionMetrics?.action_plan_recipe,data?.interventionMetrics?.visible)} /><Metric label="临期候选及时使用率" value={rate(data?.interventionMetrics?.timely_used,data?.interventionMetrics?.expiry_visible)} /><Metric label="已确认使用/丢弃结果中的使用比例" value={rate(data?.interventionMetrics?.inventory_used,(data?.interventionMetrics?.inventory_used ?? 0)+(data?.interventionMetrics?.inventory_discarded ?? 0))} /></div><p className="text-xs text-text-muted">及时指在候选建立至机会失效期间确认使用；未处理不代表用户看过或忽略。无分母时不显示百分比。</p><p className="text-xs text-text-muted">停用时将服务端 PROACTIVE_INTERVENTIONS_ENABLED 设为 0 并重新加载服务；待发送记录会取消，已提交的推送无法撤回。具体任务失败见 worker 运行记录。</p></section>
    <section className="rounded-2xl border border-gray-200 bg-white shadow-sm"><div className="border-b border-gray-100 p-5"><h2 className="font-bold text-text-main">自动临期提醒</h2></div><div className="divide-y divide-gray-100">{data?.automatic.length ? data.automatic.map((item, index) => <div key={`${item.deliveryDate}-${item.status}-${index}`} className="flex items-center justify-between p-4 text-sm"><span>{item.deliveryDate}</span><span className="text-text-muted">{item.status} · {item.count} 条</span></div>) : <Empty label="暂无自动提醒投递记录"/>}</div></section>
  </div>;
}

function Stat({ icon: Icon, label, value }: { icon: typeof Bell; label: string; value: number | string }) { return <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-3"><div className="rounded-xl bg-primary/10 p-2.5 text-primary"><Icon size={20}/></div><div><div className="text-sm text-text-muted">{label}</div><div className="mt-1 text-2xl font-bold text-text-main">{value}</div></div></div></div>; }
function Metric({ label, value, danger = false }: { label: string; value: number | string; danger?: boolean }) { return <div className="rounded-xl bg-gray-50 p-4"><div className="text-xs text-text-muted">{label}</div><div className={`mt-1 text-xl font-bold ${danger && Number(value) > 0 ? 'text-red-600' : 'text-text-main'}`}>{value}</div></div>; }
function Empty({ label }: { label: string }) { return <div className="p-8 text-center text-sm text-text-muted"><CheckCircle2 className="mx-auto mb-2 text-gray-300" size={22}/>{label}</div>; }

function rate(numerator = 0, denominator = 0) { return denominator > 0 ? `${(100*numerator/denominator).toFixed(1)}%` : "暂无数据"; }
