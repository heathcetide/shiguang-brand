import { useQueryRecord } from '../hooks/useQueryRecord';
import { useCallback, useEffect, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Eye, KeyRound, MessageSquareText, RefreshCw, Save, Send, ShieldCheck } from 'lucide-react';
import api from '../services/api';

type SmsConfig = {
  enabled: boolean;
  signName: string;
  templateCode: string;
  packageTotal: number;
  packageBaselineRemaining: number;
  phoneHourlyLimit: number;
  phoneDailyLimit: number;
  ipHourlyLimit: number;
  ipDailyLimit: number;
  globalDailyLimit: number;
  provider: string;
  endpoint: string;
  credentials: { configured: boolean; maskedAccessKeyId: string | null; secretConfigured: boolean };
  callbackConfigured: boolean;
  auditEncryptionConfigured: boolean;
  fixedParameters: Record<string, string | number | boolean>;
};

type Overview = {
  totals: Record<string, number>;
  package: { total: number; estimatedRemaining: number; usedSinceBaseline: number; baselineAt: string | null };
  attacks: Array<{ ip: string; blocked: number }>;
};

type EventItem = {
  id: number;
  eventType: string;
  outcome: string;
  phoneMasked: string;
  userId: number | null;
  username: string | null;
  userStatus: string;
  sourceIp: string | null;
  providerCode: string | null;
  bizId: string | null;
  outId: string | null;
  createdAt: string;
};

const defaultEventFilters = { userId: '', username: '', phone: '', ip: '', outcome: '', providerId: '' };
const initialOverview: Overview = { totals: {}, package: { total: 0, estimatedRemaining: 0, usedSinceBaseline: 0, baselineAt: null }, attacks: [] };

export default function AuthServiceSms() {
  const [config, setConfig] = useState<SmsConfig | null>(null);
  const [overview, setOverview] = useState<Overview>(initialOverview);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useQueryRecord(defaultEventFilters);
  const [testPhone, setTestPhone] = useState('');
  const [reconcileRemaining, setReconcileRemaining] = useState('');
  const [revealed, setRevealed] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [testSending, setTestSending] = useState(false);
  const [message, setMessage] = useState('');

  const loadCore = useCallback(async () => {
    const [configResponse, overviewResponse] = await Promise.all([
      api.get('/admin/auth-services/sms/config'),
      api.get('/admin/auth-services/sms/overview?days=30'),
    ]);
    setConfig(configResponse.data);
    setOverview(overviewResponse.data);
    setReconcileRemaining(String(overviewResponse.data.package.estimatedRemaining ?? 0));
  }, []);

  const loadEvents = useCallback(async (targetPage = page) => {
    const params = new URLSearchParams({ page: String(targetPage), pageSize: '20' });
    Object.entries(filters).forEach(([key, value]) => { if (value.trim()) params.set(key, value.trim()); });
    const { data } = await api.get(`/admin/auth-services/sms/events?${params}`);
    setEvents(data.items || []);
    setTotal(data.total || 0);
    setPage(targetPage);
    setRevealed({});
  }, [filters, page]);

  useEffect(() => {
    void loadCore().catch(error => setLoadError(error instanceof Error ? error.message : '读取认证配置失败')).finally(()=>setLoading(false));
  }, [loadCore]);
  useEffect(() => { setPage(1); }, [filters]);
  useEffect(() => { void loadEvents().catch(error=>setLoadError(error instanceof Error ? error.message : '读取认证事件失败')); }, [loadEvents]);

  if (loading) return <div className="py-24 text-center text-text-muted">认证服务数据加载中…</div>;
  if (!config) return (
    <div className="mx-auto mt-24 max-w-xl rounded-3xl border border-red-200 bg-white p-8 text-center shadow-sm">
      <AlertTriangle className="mx-auto text-red-500" size={32} />
      <h2 className="mt-4 text-xl font-bold text-text-main">认证服务加载失败</h2>
      <p className="mt-2 text-sm leading-6 text-text-muted">{loadError}</p>
      <button type="button" onClick={() => window.location.reload()} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white">
        <RefreshCw size={16} />重新加载
      </button>
    </div>
  );

  const saveConfig = async () => {
    setSaving(true);
    try {
      await api.put('/admin/auth-services/sms/config', {
        enabled: config.enabled,
        signName: config.signName,
        templateCode: config.templateCode,
        packageTotal: Number(config.packageTotal),
        phoneHourlyLimit: Number(config.phoneHourlyLimit),
        phoneDailyLimit: Number(config.phoneDailyLimit),
        ipHourlyLimit: Number(config.ipHourlyLimit),
        ipDailyLimit: Number(config.ipDailyLimit),
        globalDailyLimit: Number(config.globalDailyLimit),
      });
      setMessage('短信认证配置已保存');
      await loadCore();
    } catch (error: any) {
      setMessage(error.response?.data?.error || '保存失败');
    } finally { setSaving(false); }
  };

  const testSend = async () => {
    if (testSending) return;
    if (!/^1[3-9]\d{9}$/.test(testPhone.trim())) {
      setMessage('请输入有效的中国大陆手机号');
      return;
    }
    setTestSending(true);
    try {
      const { data } = await api.post('/admin/auth-services/sms/test-send', { phone: testPhone.trim() });
      setMessage(`测试短信已提交至 ${data.phoneMasked}`);
      setTestPhone('');
      await Promise.all([loadCore(), loadEvents(1)]);
    } catch (error: any) {
      setMessage(error.response?.data?.error || '测试发送失败');
      await Promise.all([loadCore(), loadEvents(1)]).catch(() => undefined);
    } finally {
      setTestSending(false);
    }
  };

  const reconcile = async () => {
    try {
      await api.post('/admin/auth-services/sms/package/reconcile', { remaining: Number(reconcileRemaining) });
      setMessage('套餐剩余量基准已校准');
      await loadCore();
    } catch (error: any) { setMessage(error.response?.data?.error || '校准失败'); }
  };

  const revealPhone = async (id: number) => {
    const { data } = await api.post(`/admin/auth-services/sms/events/${id}/reveal-phone`);
    setRevealed((current) => ({ ...current, [id]: data.phone }));
  };

  const metrics = [
    ['API 调用', overview.totals.sendApiCalls || 0],
    ['供应商受理', overview.totals.accepted || 0],
    ['运营商送达', overview.totals.delivered || 0],
    ['核验通过', overview.totals.verifyPassed || 0],
    ['核验失败', overview.totals.verifyFailed || 0],
    ['本地拦截', overview.totals.rateLimited || 0],
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold text-text-main"><MessageSquareText className="text-primary" />短信认证服务</h2>
          <p className="mt-1 text-sm text-text-muted">阿里云号码认证 · 登录、注册、用量和安全审计</p>
        </div>
        <div className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium ${config.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
          {config.enabled ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}{config.enabled ? '服务已启用' : '服务未启用'}
        </div>
      </div>

      {message ? <div className="rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-primary">{message}</div> : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        {metrics.map(([label, value]) => <div key={label} className="rounded-2xl bg-white p-4 shadow-sm"><p className="text-xs text-text-muted">{label}</p><p className="mt-2 text-2xl font-bold text-text-main">{value}</p></div>)}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <section className="rounded-3xl bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center justify-between"><h3 className="flex items-center gap-2 font-bold text-text-main"><ShieldCheck size={19} className="text-primary" />服务与风控配置</h3><button onClick={saveConfig} disabled={saving} className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"><Save size={16} />{saving ? '保存中' : '保存'}</button></div>
          <label className="mb-5 flex items-center justify-between rounded-2xl bg-background-alt p-4"><span><span className="block font-medium text-text-main">启用短信登录/注册</span><span className="text-xs text-text-muted">关闭后公共发送接口立即停止服务</span></span><input type="checkbox" checked={config.enabled} onChange={(e) => setConfig({ ...config, enabled: e.target.checked })} className="h-5 w-5 accent-primary" /></label>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="签名" value={config.signName} onChange={(value) => setConfig({ ...config, signName: value })} />
            <Field label="模板 Code" value={config.templateCode} onChange={(value) => setConfig({ ...config, templateCode: value })} />
            <NumberField label="手机号每小时" value={config.phoneHourlyLimit} onChange={(value) => setConfig({ ...config, phoneHourlyLimit: value })} />
            <NumberField label="手机号每天" value={config.phoneDailyLimit} onChange={(value) => setConfig({ ...config, phoneDailyLimit: value })} />
            <NumberField label="IP 每小时" value={config.ipHourlyLimit} onChange={(value) => setConfig({ ...config, ipHourlyLimit: value })} />
            <NumberField label="IP 每天" value={config.ipDailyLimit} onChange={(value) => setConfig({ ...config, ipDailyLimit: value })} />
            <NumberField label="全站每天" value={config.globalDailyLimit} onChange={(value) => setConfig({ ...config, globalDailyLimit: value })} />
            <NumberField label="套餐总量" value={config.packageTotal} onChange={(value) => setConfig({ ...config, packageTotal: value })} min={0} />
          </div>
          <div className="mt-5 rounded-2xl border border-slate-200 p-4 text-xs text-text-muted">
            固定安全参数：6 位数字、5 分钟有效、60 秒重发覆盖、验证码不回传。单挑战最多核验 5 次。
          </div>
        </section>

        <div className="space-y-6">
          <section className="rounded-3xl bg-white p-6 shadow-sm">
            <h3 className="mb-4 flex items-center gap-2 font-bold text-text-main"><KeyRound size={19} className="text-primary" />部署状态</h3>
            <Status label="AccessKey" ok={config.credentials.configured} value={config.credentials.maskedAccessKeyId || '未配置'} />
            <Status label="回调 Token" ok={config.callbackConfigured} value={config.callbackConfigured ? '已配置' : '未配置'} />
            <Status label="审计加密密钥" ok={config.auditEncryptionConfigured} value={config.auditEncryptionConfigured ? '已配置' : '开发回退密钥'} />
            <p className="mt-3 text-xs leading-5 text-text-muted">AccessKey/Secret 只从部署环境读取，不能在后台写入或查看。</p>
          </section>
          <section className="rounded-3xl bg-white p-6 shadow-sm">
            <h3 className="mb-4 flex items-center gap-2 font-bold text-text-main"><Activity size={19} className="text-primary" />套餐估算</h3>
            <div className="flex items-end justify-between"><span className="text-sm text-text-muted">估算剩余</span><span className="text-3xl font-bold text-text-main">{overview.package.estimatedRemaining}</span></div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-primary" style={{ width: `${Math.min(100, overview.package.total ? overview.package.estimatedRemaining / overview.package.total * 100 : 0)}%` }} /></div>
            <div className="mt-4 flex gap-2"><input className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm" type="number" min={0} value={reconcileRemaining} onChange={(e) => setReconcileRemaining(e.target.value)} /><button onClick={reconcile} className="rounded-xl border border-primary px-3 py-2 text-sm font-medium text-primary">校准</button></div>
          </section>
          <section className="rounded-3xl bg-white p-6 shadow-sm">
            <h3 className="mb-4 flex items-center gap-2 font-bold text-text-main"><Send size={19} className="text-primary" />测试发送</h3>
            <div className="flex gap-2"><input className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="完整手机号" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} /><button onClick={testSend} disabled={testSending} className="rounded-xl bg-primary px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">{testSending ? '发送中…' : '发送'}</button></div>
          </section>
        </div>
      </div>

      <section className="rounded-3xl bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-bold text-text-main">认证事件与关联用户</h3><p className="text-xs text-text-muted">默认隐藏手机号；每次查看完整号码都会写入安全审计。</p></div><button onClick={() => void loadEvents(1)} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm"><RefreshCw size={15} />刷新</button></div>
        <div className="mb-4 grid gap-2 md:grid-cols-3 xl:grid-cols-6">
          <Filter placeholder="用户 ID" value={filters.userId} onChange={(value) => setFilters({ ...filters, userId: value })} />
          <Filter placeholder="用户名" value={filters.username} onChange={(value) => setFilters({ ...filters, username: value })} />
          <Filter placeholder="完整手机号" value={filters.phone} onChange={(value) => setFilters({ ...filters, phone: value })} />
          <Filter placeholder="来源 IP" value={filters.ip} onChange={(value) => setFilters({ ...filters, ip: value })} />
          <Filter placeholder="结果" value={filters.outcome} onChange={(value) => setFilters({ ...filters, outcome: value })} />
          <Filter placeholder="BizId / OutId" value={filters.providerId} onChange={(value) => setFilters({ ...filters, providerId: value })} />
        </div>
        <button onClick={() => void loadEvents(1)} className="mb-4 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white">查询</button>
        <div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-left text-sm"><thead className="border-b border-slate-100 text-xs text-text-muted"><tr><th className="px-3 py-3">时间</th><th className="px-3 py-3">事件 / 结果</th><th className="px-3 py-3">手机号</th><th className="px-3 py-3">关联用户</th><th className="px-3 py-3">来源 IP</th><th className="px-3 py-3">供应商</th><th className="px-3 py-3">流水号</th></tr></thead>
          <tbody>{events.map((event) => <tr key={event.id} className="border-b border-slate-50 align-top"><td className="px-3 py-3 whitespace-nowrap">{new Date(event.createdAt).toLocaleString()}</td><td className="px-3 py-3"><span className="font-medium text-text-main">{event.eventType}</span><br /><span className="text-xs text-text-muted">{event.outcome}</span></td><td className="px-3 py-3"><span className="font-mono">{revealed[event.id] || event.phoneMasked}</span>{!revealed[event.id] ? <button onClick={() => void revealPhone(event.id)} className="ml-2 text-primary" title="查看并审计"><Eye size={15} /></button> : null}</td><td className="px-3 py-3">{event.userId ? <><span>#{event.userId} {event.username}</span><br /><span className="text-xs text-text-muted">{event.userStatus}</span></> : <span className="text-text-muted">未注册</span>}</td><td className="px-3 py-3 font-mono text-xs">{event.sourceIp || '-'}</td><td className="px-3 py-3">{event.providerCode || '-'}</td><td className="max-w-56 break-all px-3 py-3 font-mono text-xs">{event.bizId || event.outId || '-'}</td></tr>)}</tbody>
        </table></div>
        {!events.length ? <div className="py-10 text-center text-sm text-text-muted">暂无符合条件的认证事件</div> : null}
        <div className="mt-4 flex items-center justify-between text-sm text-text-muted"><span>共 {total} 条</span><div className="flex gap-2"><button disabled={page <= 1} onClick={() => void loadEvents(page - 1)} className="rounded-lg border px-3 py-1.5 disabled:opacity-40">上一页</button><span className="px-2 py-1.5">第 {page} 页</span><button disabled={page * 20 >= total} onClick={() => void loadEvents(page + 1)} className="rounded-lg border px-3 py-1.5 disabled:opacity-40">下一页</button></div></div>
      </section>

      {overview.attacks.length ? <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5"><h3 className="mb-3 flex items-center gap-2 font-bold text-amber-900"><AlertTriangle size={18} />高频拦截来源</h3><div className="flex flex-wrap gap-2">{overview.attacks.map((item) => <span key={item.ip} className="rounded-full bg-white px-3 py-1.5 font-mono text-xs text-amber-900">{item.ip || '未知 IP'} · {item.blocked} 次</span>)}</div></section> : null}
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label><span className="mb-1.5 block text-xs font-medium text-text-muted">{label}</span><input className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" value={value} onChange={(e) => onChange(e.target.value)} /></label>; }
function NumberField({ label, value, onChange, min = 1 }: { label: string; value: number; onChange: (value: number) => void; min?: number }) { return <label><span className="mb-1.5 block text-xs font-medium text-text-muted">{label}</span><input type="number" min={min} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" value={value} onChange={(e) => onChange(Number(e.target.value))} /></label>; }
function Filter({ placeholder, value, onChange }: { placeholder: string; value: string; onChange: (value: string) => void }) { return <input className="min-w-0 rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />; }
function Status({ label, ok, value }: { label: string; ok: boolean; value: string }) { return <div className="flex items-center justify-between border-b border-slate-100 py-2.5 text-sm"><span className="text-text-muted">{label}</span><span className={`flex items-center gap-1.5 font-medium ${ok ? 'text-emerald-700' : 'text-amber-700'}`}>{ok ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}{value}</span></div>; }
