import { useEffect, useState } from 'react';
import { ExternalLink, Globe2, LoaderCircle, Save, ShieldCheck } from 'lucide-react';
import api from '../services/api';

type SiteSettingsForm = {
  filingEnabled: boolean;
  filingText: string;
  filingUrl: string;
};

const emptySettings: SiteSettingsForm = {
  filingEnabled: false,
  filingText: '',
  filingUrl: '',
};

export default function SiteSettings() {
  const [form, setForm] = useState<SiteSettingsForm>(emptySettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api.get('/admin/site-settings')
      .then(({ data }) => { if (active) setForm(data); })
      .catch(() => { if (active) setError('网站设置加载失败，请稍后重试'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const save = async () => {
    setSaving(true);
    setMessage('');
    setError('');
    try {
      const { data } = await api.put('/admin/site-settings', form);
      setMessage(data.message || '网站设置已保存');
    } catch (requestError: any) {
      const detail = requestError.response?.data?.details?.[0]?.message;
      setError(detail || requestError.response?.data?.error || '保存失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex min-h-[360px] items-center justify-center text-sm text-text-muted"><LoaderCircle className="mr-2 animate-spin" size={18} />正在加载网站设置…</div>;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="text-sm font-semibold text-primary">网站运营</p>
        <h2 className="mt-1 text-3xl font-bold text-text-main">网站设置</h2>
        <p className="mt-2 text-sm text-text-muted">管理产品官网对外展示的信息，修改保存后首页会自动读取最新内容。</p>
      </div>

      <section className="rounded-3xl border border-gray-100 bg-background p-6 shadow-sm sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"><ShieldCheck size={21} /></span>
            <div><h3 className="font-bold text-text-main">ICP备案信息</h3><p className="mt-1 text-sm leading-6 text-text-muted">显示在官网页脚。关闭后保留已填写内容，但官网不展示。</p></div>
          </div>
          <label className="flex shrink-0 items-center gap-3 rounded-2xl bg-background-alt px-4 py-3 text-sm font-medium text-text-main">
            <span>{form.filingEnabled ? '已启用' : '未启用'}</span>
            <input type="checkbox" checked={form.filingEnabled} onChange={(event) => setForm({ ...form, filingEnabled: event.target.checked })} className="h-5 w-5 accent-primary" />
          </label>
        </div>

        <div className="mt-7 grid gap-5">
          <label className="grid gap-2 text-sm font-medium text-text-main">
            备案展示内容
            <input value={form.filingText} maxLength={120} onChange={(event) => setForm({ ...form, filingText: event.target.value })} placeholder="例如：京ICP备XXXXXXXX号-X" className="rounded-2xl border border-gray-200 bg-white px-4 py-3 font-normal outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10" />
            <span className="text-xs font-normal text-text-muted">请填写工信部审核通过后的完整备案号。</span>
          </label>
          <label className="grid gap-2 text-sm font-medium text-text-main">
            点击跳转地址
            <input value={form.filingUrl} onChange={(event) => setForm({ ...form, filingUrl: event.target.value })} placeholder="https://beian.miit.gov.cn/" className="rounded-2xl border border-gray-200 bg-white px-4 py-3 font-normal outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10" />
            <span className="text-xs font-normal text-text-muted">留空时仅显示文字，不提供跳转链接。</span>
          </label>
        </div>

        <div className="mt-7 rounded-2xl border border-dashed border-gray-200 bg-background-alt p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">官网页脚预览</p>
          <div className="mt-3 flex min-h-8 items-center text-sm text-text-main">
            {form.filingEnabled && form.filingText ? (
              form.filingUrl ? <span className="inline-flex items-center gap-1.5 font-medium text-primary">{form.filingText}<ExternalLink size={13} /></span> : <span>{form.filingText}</span>
            ) : <span className="text-text-muted">备案信息当前不会显示</span>}
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm">{error ? <span className="text-red-600">{error}</span> : message ? <span className="text-emerald-700">{message}</span> : null}</div>
          <button type="button" onClick={save} disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-3 text-sm font-semibold text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60">
            {saving ? <LoaderCircle className="animate-spin" size={17} /> : <Save size={17} />}{saving ? '保存中…' : '保存设置'}
          </button>
        </div>
      </section>

      <div className="flex items-center gap-2 rounded-2xl bg-primary/5 px-4 py-3 text-xs text-text-muted"><Globe2 size={15} className="text-primary" />首页读取公开配置接口，不会暴露管理权限或其他系统设置。</div>
    </div>
  );
}
