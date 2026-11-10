import { DialogFrame } from '../components/admin/DialogFrame';
import { useQueryState } from '../hooks/useQueryState';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Clock3,
  FileAudio2,
  History,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Upload,
  X,
} from 'lucide-react';
import api from '../services/api';
import { createLatestRequest } from '../utils/latestRequest';
import {
  voicePackActions,
  voicePackManifestChecks,
  voicePackStatusPresentation,
  voicePackTransitionConfirmation,
  type VoicePackStatus,
} from './voicePackModel';

type Manifest = Record<string, unknown> & {
  voiceId: string;
  name: string;
  version: string;
  distribution?: 'public' | 'internal-test';
  previewUrl?: string;
  license?: { name?: string; url?: string; speakerAuthorization?: string; modelNotice?: string };
  resources?: Array<{ path?: string; url?: string; sha256?: string; bytes?: number }>;
};
type VoicePackItem = {
  id: number;
  voiceId: string;
  name: string;
  version: string;
  styleTags: string[];
  manifest: Manifest;
  providerVoice: string | null;
  status: VoicePackStatus;
  revision: number;
  createdBy: number | null;
  reviewedBy: number | null;
  publishedAt: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
  updatedAt: string;
};
type HistoryItem = { id: number; actorUserId: number; fromStatus: VoicePackStatus | null; toStatus: VoicePackStatus; reason: string | null; revision: number; createdAt: string };

const draftTemplate: Manifest = {
  voiceId: 'voice-cn', name: '中文合成音色', version: '1.0.0', distribution: 'internal-test', language: 'zh-CN', gender: 'unspecified',
  deviceRequirements: ['Android 8 或更高版本'], sampleRate: 22050, outputFormat: 'pcm-f32',
  minimumAppVersion: '1.0.5', minimumMemoryMb: 2048,
  license: { name: '', url: 'https://', speakerAuthorization: '', modelNotice: '合成语音模型可能被设备使用者提取。' },
  resources: [
    { path: 'model.onnx', url: 'https://', sha256: '', bytes: 1 },
    { path: 'vocab.json', url: 'https://', sha256: '', bytes: 1 },
  ],
  model: { path: 'model.onnx', vocabularyPath: 'vocab.json', textProcessor: { type: 'character-v1' }, inputNames: { tokens: 'input', lengths: 'input_lengths' }, outputName: 'output' },
};

function errorMessage(error: unknown) {
  const responseError = error as { response?: { data?: { error?: string } }; message?: string };
  return responseError.response?.data?.error || responseError.message || '操作失败，请稍后重试';
}

export default function VoicePacks() {
  const [items, setItems] = useState<VoicePackItem[]>([]);
  const [search, setSearch] = useQueryState<string>('q', '');
  const [status, setStatus] = useQueryState<VoicePackStatus | 'all'>('status', 'all', ["all", "draft", "published", "disabled", "revoked"]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [editor, setEditor] = useState<VoicePackItem | 'new' | null>(null);
  const [manifestText, setManifestText] = useState(JSON.stringify(draftTemplate, null, 2));
  const [styleTags, setStyleTags] = useState('');
  const [providerVoice, setProviderVoice] = useState('');
  const [history, setHistory] = useState<{ item: VoicePackItem; rows: HistoryItem[] } | null>(null);
  const latestRequest = useRef(createLatestRequest());

  const load = useCallback(async () => {
    const request = latestRequest.current.begin();
    setLoading(true); setError('');
    try {
      const response = await api.get<{ items: VoicePackItem[] }>('/admin/voice-packs', {
        params: { search: search.trim() || undefined, status: status === 'all' ? undefined : status },
        signal: request.signal,
      });
      if (request.isLatest()) setItems(response.data.items);
    } catch (requestError) { if (request.isLatest()) setError(errorMessage(requestError)); }
    finally { if (request.isLatest()) setLoading(false); }
  }, [search, status]);

  useEffect(() => {
    latestRequest.current.cancel();
    const timer = window.setTimeout(() => void load(), 180);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(() => () => latestRequest.current.cancel(), []);

  const parsedManifest = useMemo(() => {
    try { return JSON.parse(manifestText) as Manifest; } catch { return null; }
  }, [manifestText]);
  const checks = useMemo(() => voicePackManifestChecks(parsedManifest), [parsedManifest]);

  const openEditor = (item?: VoicePackItem) => {
    setEditor(item || 'new');
    setManifestText(JSON.stringify(item?.manifest || draftTemplate, null, 2));
    setStyleTags(item?.styleTags.join(', ') || '');
    setProviderVoice(item?.providerVoice || '');
    setError('');
  };

  const saveDraft = async () => {
    if (!parsedManifest || checks.some((check) => !check.passed)) { setError('清单仍有未通过的本地校验，请修正后提交。'); return; }
    setBusyId(editor === 'new' ? -1 : editor?.id || null); setError('');
    const body = { manifest: parsedManifest, styleTags: styleTags.split(',').map((tag) => tag.trim()).filter(Boolean), providerVoice: providerVoice.trim() || null };
    try {
      if (editor === 'new') await api.post('/admin/voice-packs', body);
      else if (editor) await api.put(`/admin/voice-packs/${editor.id}`, { ...body, revision: editor.revision });
      setEditor(null); await load();
    } catch (requestError) { setError(errorMessage(requestError)); }
    finally { setBusyId(null); }
  };

  const transition = async (item: VoicePackItem, target: 'publish' | 'disable' | 'revoke') => {
    const identity = `${item.voiceId}@${item.version}`;
    if (!window.confirm(voicePackTransitionConfirmation(target, identity))) return;
    let reason = '';
    if (target !== 'publish') {
      reason = window.prompt(target === 'revoke' ? '请输入紧急撤销原因（至少 4 个字符）' : '请输入下架原因（至少 4 个字符）')?.trim() || '';
      if (reason.length < 4) { setError('状态变更原因至少需要 4 个字符。'); return; }
    }
    setBusyId(item.id); setError('');
    try { await api.post(`/admin/voice-packs/${item.id}/${target}`, { revision: item.revision, reason }); await load(); }
    catch (requestError) { setError(errorMessage(requestError)); }
    finally { setBusyId(null); }
  };

  const showHistory = async (item: VoicePackItem) => {
    setBusyId(item.id); setError('');
    try {
      const response = await api.get<{ items: HistoryItem[] }>(`/admin/voice-packs/${item.id}/history`);
      setHistory({ item, rows: response.data.items });
    } catch (requestError) { setError(errorMessage(requestError)); }
    finally { setBusyId(null); }
  };

  return <div className="space-y-6 p-1 sm:p-2">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div><h1 className="flex items-center gap-2 text-2xl font-bold text-text-main"><FileAudio2 className="text-primary"/>音色包目录</h1><p className="mt-1 text-sm text-text-muted">受控维护合成音色、授权、版本和发布状态；密钥不会在此页面展示。</p></div>
      <div className="flex gap-2"><button type="button" onClick={() => void load()} className="rounded-xl border border-gray-200 bg-white p-2.5 text-text-muted"><RefreshCw size={17} className={loading ? 'animate-spin' : ''}/></button><button type="button" onClick={() => openEditor()} className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white"><Plus size={17}/>创建草稿</button></div>
    </div>
    <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm text-amber-800"><ShieldAlert className="mr-2 inline" size={17}/>发布后关键资源不可原地覆盖；内容变化必须创建新版本。撤销会触发客户端停用和本地删除。</div>
    {error ? <div className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div> : null}
    <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-gray-100 p-5 sm:flex-row">
        <label className="flex flex-1 items-center gap-2 rounded-xl border border-gray-200 px-3"><Search size={16} className="text-text-muted"/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索名称、voiceId 或版本" className="w-full py-2.5 text-sm outline-none"/></label>
        <select value={status} onChange={(event) => setStatus(event.target.value as VoicePackStatus | 'all')} className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm"><option value="all">全部状态</option><option value="draft">草稿</option><option value="published">已发布</option><option value="disabled">已下架</option><option value="revoked">已撤销</option></select>
      </div>
      {loading && !items.length ? <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-text-muted"><Loader2 className="animate-spin" size={18}/>读取权威目录…</div> : null}
      {!loading && !items.length ? <div className="min-h-48 p-12 text-center text-sm text-text-muted">当前筛选条件下没有音色版本</div> : null}
      {items.length ? <div className="overflow-x-auto"><table className="w-full min-w-[1020px] text-left text-sm"><thead className="bg-gray-50 text-xs text-text-muted"><tr><th className="px-5 py-3">音色版本</th><th className="px-4 py-3">授权与资源</th><th className="px-4 py-3">状态</th><th className="px-4 py-3">审计</th><th className="px-5 py-3 text-right">操作</th></tr></thead><tbody className="divide-y divide-gray-100">{items.map((item) => {
        const presentation = voicePackStatusPresentation[item.status]; const actions = voicePackActions(item.status); const bytes = item.manifest.resources?.reduce((sum, resource) => sum + Number(resource.bytes || 0), 0) || 0;
        return <tr key={item.id} className="align-top"><td className="px-5 py-4"><p className="font-semibold text-text-main">{item.name}</p><p className="mt-1 font-mono text-xs text-text-muted">{item.voiceId}@{item.version}</p><span className={`mt-2 inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold ${item.manifest.distribution === 'internal-test' ? 'bg-violet-50 text-violet-700' : 'bg-blue-50 text-blue-700'}`}>{item.manifest.distribution === 'internal-test' ? '仅内部测试' : '生产公开'}</span><div className="mt-2 flex flex-wrap gap-1">{item.styleTags.map((tag) => <span key={tag} className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-text-muted">{tag}</span>)}</div>{item.manifest.previewUrl ? <audio controls preload="none" src={item.manifest.previewUrl} className="mt-3 h-8 max-w-64"/> : null}</td><td className="px-4 py-4 text-xs text-text-muted"><p>{item.manifest.license?.name || '未命名许可'}</p><p className="mt-1">{item.manifest.resources?.length || 0} 个资源 · {(bytes / 1024 / 1024).toFixed(1)} MB</p><p className="mt-1 line-clamp-2">授权：{item.manifest.license?.speakerAuthorization || '—'}</p></td><td className="px-4 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${presentation.className}`}>{presentation.label}</span>{item.revokeReason ? <p className="mt-2 max-w-52 text-xs text-red-600">{item.revokeReason}</p> : null}</td><td className="px-4 py-4 text-xs text-text-muted"><p>修订 #{item.revision}</p><p className="mt-1">更新 {new Date(item.updatedAt).toLocaleString('zh-CN')}</p><p className="mt-1">审核人 {item.reviewedBy || '—'}</p></td><td className="px-5 py-4"><div className="flex justify-end gap-1.5"><button type="button" disabled={busyId === item.id} onClick={() => void showHistory(item)} className="rounded-lg border border-gray-200 p-2 text-text-muted" title="操作历史"><History size={15}/></button>{actions.includes('edit') ? <button type="button" onClick={() => openEditor(item)} className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold">编辑</button> : null}{actions.includes('publish') ? <button type="button" disabled={busyId === item.id} onClick={() => void transition(item, 'publish')} className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white">发布</button> : null}{actions.includes('disable') ? <button type="button" disabled={busyId === item.id} onClick={() => void transition(item, 'disable')} className="rounded-lg bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-800">下架</button> : null}{actions.includes('revoke') ? <button type="button" disabled={busyId === item.id} onClick={() => void transition(item, 'revoke')} className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">撤销</button> : null}</div></td></tr>;
      })}</tbody></table></div> : null}
    </section>
    {editor ? <DialogFrame onClose={()=>setEditor(null)} busy={busyId !== null} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><section className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white shadow-xl"><div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-white p-5"><div><h2 className="font-bold text-text-main">{editor === 'new' ? '创建音色包草稿' : `编辑 ${editor.voiceId}@${editor.version}`}</h2><p className="mt-1 text-xs text-text-muted">服务端会再次强制校验资源、摘要、版本和授权。</p></div><button aria-label="关闭" type="button" onClick={() => setEditor(null)}><X size={20}/></button></div><div className="grid gap-5 p-5 lg:grid-cols-[1fr_280px]"><div><label className="text-xs font-semibold text-text-muted">Manifest JSON</label><textarea value={manifestText} onChange={(event) => setManifestText(event.target.value)} rows={25} spellCheck={false} className="mt-2 w-full rounded-xl border border-gray-200 p-3 font-mono text-xs leading-5 outline-none focus:border-primary"/><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-text-muted">风格/性别标签<input value={styleTags} onChange={(event) => setStyleTags(event.target.value)} placeholder="温暖, 女声, 叙述" className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-normal"/></label><label className="text-xs font-semibold text-text-muted">供应商音色映射（不会下发客户端）<input value={providerVoice} onChange={(event) => setProviderVoice(event.target.value)} placeholder="alloy" className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-normal"/></label></div></div><aside><h3 className="text-sm font-bold text-text-main">发布前校验</h3><div className="mt-3 space-y-2">{checks.map((check) => <div key={check.label} className={`flex gap-2 rounded-xl p-3 text-xs ${check.passed ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{check.passed ? <CheckCircle2 size={15}/> : <ShieldAlert size={15}/>}<span>{check.label}</span></div>)}</div><div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-text-muted">试听地址必须为 HTTPS。授权附件原件和对象存储密钥不应写入清单。</div></aside></div><div className="sticky bottom-0 flex justify-end gap-2 border-t border-gray-100 bg-white p-5"><button type="button" onClick={() => setEditor(null)} className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm">取消</button><button type="button" disabled={busyId !== null || !parsedManifest} onClick={() => void saveDraft()} className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busyId !== null ? <Loader2 size={16} className="animate-spin"/> : <Upload size={16}/>}保存草稿</button></div></section></DialogFrame> : null}
    {history ? <DialogFrame onClose={()=>setHistory(null)} busy={false} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><section className="w-full max-w-xl rounded-2xl bg-white shadow-xl"><div className="flex items-center justify-between border-b border-gray-100 p-5"><div><h2 className="font-bold">操作历史</h2><p className="mt-1 font-mono text-xs text-text-muted">{history.item.voiceId}@{history.item.version}</p></div><button aria-label="关闭" type="button" onClick={() => setHistory(null)}><X size={20}/></button></div><div className="max-h-[65vh] divide-y divide-gray-100 overflow-y-auto">{history.rows.map((row) => <div key={row.id} className="flex gap-3 p-5"><Clock3 size={17} className="mt-0.5 text-primary"/><div><p className="text-sm font-semibold text-text-main">{row.fromStatus || '无'} → {row.toStatus}</p><p className="mt-1 text-xs text-text-muted">管理员 #{row.actorUserId} · 修订 #{row.revision} · {new Date(row.createdAt).toLocaleString('zh-CN')}</p><p className="mt-2 text-xs text-text-main">{row.reason || '无附加原因'}</p></div></div>)}</div></section></DialogFrame> : null}
  </div>;
}
