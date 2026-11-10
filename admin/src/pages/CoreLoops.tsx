import { useQueryState } from '../hooks/useQueryState';
import { useEffect, useRef, useState } from 'react';
import api from '../services/api';

type Settings = { enabled: boolean; version: number; coverageStart: string | null; environment: string | null; timeZone: string };
type Actor = { userId: number; actorKey: string; kind: string; version: number };
type Report = { startDate: string; endDate: string; timeZone: string; version: string; status: string; users: number | null; loops: number | null; verifiedUsers: number; verifiedLoops: number; unknown: number; smallSample: boolean; coverageStart: string | null; evaluations: { productionId: string; actorKey: string; reason: string; completedAt: string | null }[]; detailsTruncated: boolean };
const labels: Record<string, string> = { included: '已计入', environment_unknown: '历史环境未知', non_target_environment: '非目标环境', excluded_actor: '排除的账号类型', actor_unclassified: '账号未分类', not_producer: '并非制作者本人', selection_missing: '缺少选菜来源', selection_mismatch: '选菜与制作不一致', stock_evidence_missing: '缺少确认入库证据', no_inventory_match: '未匹配到库存', deduction_evidence_missing: '扣减证据不足', no_verified_deduction: '无已核实扣减', no_surviving_intake: '无有效实际摄入', invalid_time: '时间证据待核对' };
const kinds: Record<string,string> = { unknown: '未分类',real: '真实内测用户',test: '测试账号',demo: '演示账号',automation: '自动化账号' };
const statuses: Record<string,string> = { not_collected: '尚未采集',partial: '证据或覆盖不完整',in_progress: '本周进行中',complete: '完整周数据' };
const errorMessage = (error: unknown) => (error as { response?: { data?: { error?: string } } }).response?.data?.error || '请求未完成，请刷新核对后重试。';
const inputStyle = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
const buttonStyle = 'rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50';

export default function CoreLoops() {
  const [date,setDate] = useQueryState<string>('date', new Intl.DateTimeFormat('en-CA',{ timeZone: 'Asia/Shanghai',year: 'numeric',month: '2-digit',day: '2-digit' }).format(new Date()), value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value);
  const [report,setReport] = useState<Report | null>(null), [settings,setSettings] = useState<Settings | null>(null);
  const [message,setMessage] = useState(''), [refresh,setRefresh] = useState(0), [saving,setSaving] = useState(false);
  const [userId,setUserId] = useState(''), [actor,setActor] = useState<Actor | null>(null), [kind,setKind] = useState('unknown');
  const actorSequence = useRef(0);
  useEffect(() => {
    let active = true; setReport(null); setMessage('');
    void Promise.all([api.get<Report>('/admin/core-loops',{ params: { date,details: '1' } }),api.get<Settings>('/admin/core-loops/settings')])
      .then(([reportResponse,settingsResponse]) => { if (active) { setReport(reportResponse.data); setSettings(settingsResponse.data); } })
      .catch(error => { if (active) setMessage(errorMessage(error)); });
    return () => { active = false; };
  },[date,refresh]);
  async function toggleCollection() {
    if (!settings || saving) return; setSaving(true);
    try { const { data } = await api.put<Settings>('/admin/core-loops/settings',{ enabled: !settings.enabled,version: settings.version }); setSettings(data); setRefresh(value => value+1); }
    catch (error) { setMessage(errorMessage(error)); setSettings(null); }
    finally { setSaving(false); }
  }
  async function readActor() {
    const sequence = ++actorSequence.current; setActor(null);
    if (!/^\d+$/.test(userId) || Number(userId) < 1) { setMessage('请输入有效用户 ID。'); return; }
    try { const { data } = await api.get<Actor>(`/admin/core-loops/actors/${userId}`); if (sequence === actorSequence.current) { setActor(data); setKind(data.kind); } }
    catch (error) { if (sequence === actorSequence.current) setMessage(errorMessage(error)); }
  }
  async function saveActor() {
    if (!actor || saving) return; setSaving(true); const sequence = actorSequence.current;
    try { const { data } = await api.put<Actor>(`/admin/core-loops/actors/${actor.userId}`,{ kind,version: actor.version }); if (sequence === actorSequence.current) { setActor(data); setRefresh(value => value+1); } }
    catch (error) { if (sequence === actorSequence.current) { setMessage(errorMessage(error)); setActor(null); } }
    finally { setSaving(false); }
  }
  return <main className="space-y-6 p-6">
    <div className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-2xl font-semibold text-slate-900">每周核心闭环</h1><p className="mt-2 text-sm text-slate-600">核对库存选菜、制作扣减和本人实际摄入。每人每周去重。当前可核实个人确认入库路径，其他来源证据不足时保留待核对。</p></div><button className={buttonStyle} onClick={() => setRefresh(value => value+1)}>刷新核对</button></div>
    {message && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-amber-900">{message}</p>}
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">统计周</h2><label className="flex items-center gap-3 text-sm">选择周内日期<input aria-label="统计日期" className={inputStyle} type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
      {!report ? <p className="text-sm text-slate-500">{message ? '尚未取得统计结果。' : '正在核对业务记录…'}</p> : <>
        <p>{report.startDate} 至 {report.endDate}（结束日不含）· {report.timeZone}</p><p className="text-sm text-slate-600">{statuses[report.status]} · 采集起点：{report.coverageStart || '尚未启用'}</p>
        <div className="grid gap-4 sm:grid-cols-2"><div className="rounded-lg bg-slate-50 p-4"><p className="text-sm">周闭环用户数</p><p className="mt-2 text-3xl font-semibold">{report.users === null ? '不可确定' : `${report.users} 人`}</p></div><div className="rounded-lg bg-slate-50 p-4"><p className="text-sm">有效闭环次数</p><p className="mt-2 text-3xl font-semibold">{report.loops === null ? '不可确定' : `${report.loops} 次`}</p></div></div>
        {report.status === 'partial' && <p className="text-sm text-amber-800">已核实下限：{report.verifiedUsers} 人、{report.verifiedLoops} 次；另有 {report.unknown} 条待核对。不能把未确定部分视为零。</p>}
        {report.smallSample && <p className="text-sm text-slate-600">已核实用户少于 30 人，只展示实际人数。</p>}
      </>}
    </section>
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">采集范围</h2><p className="text-sm text-slate-600">环境：{settings?.environment || '服务端尚未配置 CORE_LOOP_ENVIRONMENT'}。首次启用时记录采集起点；账号默认不计入，需明确分类。</p><button className={buttonStyle} disabled={!settings || saving || (!settings.enabled && !settings.environment)} onClick={() => void toggleCollection()}>{settings?.enabled ? '停用统计' : '启用统计'}</button></section>
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">账号分类</h2><p className="text-sm text-slate-600">使用用户管理页中的 ID。分类会记录审计日志，并影响历史周的重算结果。</p><div className="flex flex-wrap gap-3"><input aria-label="用户 ID" placeholder="用户 ID" className={inputStyle} value={userId} onChange={event => { actorSequence.current++; setUserId(event.target.value); setActor(null); }} /><button className={buttonStyle} onClick={() => void readActor()}>读取分类</button></div>{actor && <div className="flex flex-wrap items-center gap-3"><span>{actor.actorKey} · 已保存：{kinds[actor.kind]}</span><select aria-label="账号分类" className={inputStyle} value={kind} onChange={event => setKind(event.target.value)}>{Object.entries(kinds).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select><button className={buttonStyle} disabled={saving} onClick={() => void saveActor()}>保存分类</button></div>}</section>
    {report && <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-5"><h2 className="mb-3 font-semibold">受控核对明细</h2><p className="mb-3 text-sm text-slate-600">未计入的制作可能没有可确定的完成周。口径：{report.version}</p><table className="w-full text-left text-sm"><thead><tr><th className="p-2">制作 ID</th><th className="p-2">用户标识</th><th className="p-2">判定</th><th className="p-2">完成时间</th></tr></thead><tbody>{report.evaluations.map((item,index) => <tr key={`${item.productionId}-${index}`} className="border-t border-slate-100"><td className="p-2 font-mono">{item.productionId}</td><td className="p-2">{item.actorKey}</td><td className="p-2">{labels[item.reason] || '待核对'}</td><td className="p-2">{item.completedAt || '—'}</td></tr>)}</tbody></table>{report.detailsTruncated && <p className="mt-3 text-sm">明细仅显示前 200 条，汇总仍基于全部记录。</p>}</section>}
  </main>;
}
