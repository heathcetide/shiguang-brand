import { readResources, saveResources, draftAction } from '../services/aiResourcesApi';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useBlocker } from 'react-router';
import { PageHeader } from '../components/admin/PageHeader';
import { Section } from '../components/admin/Section';
import { createLatestRequest } from '../utils/latestRequest';
import { capabilities, UnsupportedResourceConfiguration, validateConfiguration, writableConfiguration,
  type Capability, type ServiceId, type Resource, type ResourceConfiguration, type ResourceUpdate, type Target } from '../services/aiResources';
import './AIResources.css';

const labels: Record<string, string> = { chat: '对话', vision: '图像分析', asr: '语音转写', supervisor: '主助手', nutrition: '营养规划', recipe: '食谱', operations: '操作执行' };
function TargetFields({ value, capability, resources, onChange }: { value: Target; capability: Capability; resources: Resource[]; onChange: (t: Target) => void }) {
  const available = resources.filter(r => r.kind === 'legacy' ? r.scope === capability : r.kind === 'connection' && r.models.some(m => m.capabilities.includes(capability)));
  const selected = resources.find(r => r.id === value.resourceId);
  return <div className="ai-target"><label>提供商资源<select value={value.resourceId} onChange={e => {
    const r = resources.find(r => r.id === e.target.value);
    onChange({ resourceId: e.target.value, ...(r?.kind === 'connection' ? { model: r.models.find(m => m.capabilities.includes(capability))?.id } : {}) });
  }}><option value="">请选择资源</option>{available.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
    <label>模型{selected?.kind === 'connection' ? <select value={value.model || ''} onChange={e => onChange({ ...value, model: e.target.value })}><option value="">请选择模型</option>{selected.models.filter(m => m.capabilities.includes(capability)).map(m => <option key={m.id}>{m.id}</option>)}</select>
      : <input value={value.model || ''} maxLength={200} placeholder="留空沿用旧配置" onChange={e => onChange({ resourceId: value.resourceId, ...(e.target.value ? { model: e.target.value } : {}) })} />}</label></div>;
}
export default function AIResources({ page }: { page: 'providers' | 'services' }) {
  const [saved, setSaved] = useState<ResourceConfiguration | null>(null);
  const [draft, setDraft] = useState<ResourceUpdate | null>(null);
  const [testing, setTesting] = useState(false);
  const [loading, setLoading] = useState(false), [saving, setSaving] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [needsReload, setNeedsReload] = useState(false);
  const actionController = useRef<AbortController | null>(null);
  const reads = useRef(createLatestRequest()), busy = useRef(false), lifecycle = useRef({ generation: 0 });
  const dirty = !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(writableConfiguration(saved));
  const blocker = useBlocker(dirty || saving);
  useEffect(() => {
    if (blocker.state === 'blocked') {
      if (!busy.current && window.confirm('有未保存修改，确定放弃并离开？')) blocker.proceed();
      else blocker.reset();
    }
  }, [blocker]);
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => { if (dirty || busy.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', leave); return () => window.removeEventListener('beforeunload', leave);
  }, [dirty]);
  const fetchConfiguration = useCallback(async () => {
    if (busy.current) return;
    const request = reads.current.begin(); setLoading(true); setError(''); setNotice('');
    try {
      const data = await readResources(request.signal);
      if (request.isLatest()) { setSaved(data); setDraft(writableConfiguration(data)); setNeedsReload(false); }
    } catch (failure) {
      if (request.isLatest()) {
        setError(failure instanceof UnsupportedResourceConfiguration ? failure.message : '读取配置失败，请重试。');
        if (failure instanceof UnsupportedResourceConfiguration) { setSaved(null); setDraft(null); setNeedsReload(true); }
      }
    }
    finally { if (request.isLatest()) setLoading(false); }
  }, []);
  async function load() {
    if (dirty && !window.confirm('重新读取将放弃未保存修改，继续？')) return;
    await fetchConfiguration();
  }
  useEffect(() => {
    const requests = reads.current, owner = lifecycle.current;
    void fetchConfiguration();
    return () => { requests.cancel(); actionController.current?.abort(); owner.generation++; };
  }, [fetchConfiguration]);
  async function save() {
    if (!draft || busy.current || needsReload) return;
    const validation = validateConfiguration(draft); if (validation) { setError(validation); return; }
    if (draft.resources.some(r => r.kind !== 'legacy' && r.credential?.action === 'clear') && !window.confirm('确定清空所选资源的密钥？发布后生效，保存草稿不会影响当前请求。')) return;
    busy.current = true; setSaving(true); setError(''); setNotice(''); reads.current.cancel();
    const owner = lifecycle.current.generation;
    try {
      const current = await readResources();
      if (owner !== lifecycle.current.generation) return;
      if (current.revision !== draft.revision) { setNeedsReload(true); setError('配置版本已变更。未覆盖他人修改；请重新读取后核对再编辑。'); return; }
      const result = await saveResources(draft);
      if (owner !== lifecycle.current.generation) return;
      setSaved(result); setDraft(writableConfiguration(result)); setNotice('已保存草稿；已发布配置保持不变。');
    } catch (failure) {
      if (owner === lifecycle.current.generation) { setNeedsReload(true); setError(failure instanceof UnsupportedResourceConfiguration ? failure.message : (failure as { response?: { status?: number; data?: { code?: string } } })?.response?.status === 409 && (failure as { response?: { data?: { code?: string } } })?.response?.data?.code === 'AI_RESOURCE_CONFLICT' ? '配置版本冲突：未覆盖他人修改，请重新读取后核对。' : '保存未确认：可能存在版本冲突、能力/旧角色模型或策略不兼容，也可能已保存但响应丢失。请重新读取核对；不会自动重试。'); }
    } finally { if (owner === lifecycle.current.generation) { busy.current = false; setSaving(false); setTesting(false); } }
  }
  async function actOnDraft(action: 'test' | 'publish' | 'discard', service?: ServiceId) {
    if (!saved?.lifecycle?.pending || dirty || busy.current || needsReload) return;
    if (action === 'publish' && !window.confirm(`发布草稿版本 ${saved.revision}？影响服务：${saved.lifecycle.changedServices.join('、') || '无绑定变化'}；旧配置/策略字段：${saved.lifecycle.changedSettings.join('、') || '无'}。后续请求使用新配置，在途请求保持原版本。`)) return;
    setTesting(action === 'test');
    if (action === 'discard' && !window.confirm('放弃整份已保存草稿（包括旧配置与策略），恢复为已发布配置？')) return;
    busy.current = true; setSaving(true); setError(''); setNotice(''); reads.current.cancel();
    const owner = lifecycle.current.generation;
    try {
      actionController.current = new AbortController();
      const result = await draftAction(action, saved.revision, actionController.current.signal, service);
      if (owner !== lifecycle.current.generation) return;
      setSaved(result); setDraft(writableConfiguration(result));
      setNotice(action === 'test' ? service ? `草稿版本 ${saved.revision} · ${service} 文本连接探针${result.lifecycle?.test?.success ? '成功' : '失败'}；不证明视觉、ASR、工具或生产能力。` : `草稿版本 ${saved.revision} 配置校验通过；未调用供应商，不代表生产能力可用。` : action === 'discard' ? '已放弃草稿，已发布配置未改变。' : '发布成功，后续请求使用新配置。');
    } catch {
      if (owner === lifecycle.current.generation) { setNeedsReload(true); setError('操作未确认，请重新读取核对版本及发布状态；不会自动重试。'); }
    } finally { if (owner === lifecycle.current.generation) { busy.current = false; setSaving(false); setTesting(false); } }
  }
  function updateResource(index: number, resource: Resource) { if (draft) setDraft({ ...draft, resources: draft.resources.map((r, i) => i === index ? resource : r) }); }
  return <div className="ai-resources">
    <PageHeader title={page === 'providers' ? '服务提供商' : '业务服务'} description="统一资源与业务绑定 · v1 配置" actions={<button className="admin-button" disabled={saving || loading} onClick={() => void load()}>重新读取</button>} />
    <div className="ai-note">保存仅更新草稿。“校验草稿配置”不调用供应商；服务连接探针使用指定草稿版本的完整绑定发送文本请求，可能产生费用，但不证明视觉 / ASR 等生产能力。测试通过后可确认影响并发布。</div>
    {loading && <p role="status">正在读取配置…</p>}{error && <p role="alert" className="admin-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    {saved && draft && <form onSubmit={e => { e.preventDefault(); void save(); }}>
      <p className="admin-muted">版本 {saved.revision} · {saved.lifecycle?.pending ? '草稿待发布' : '已发布 / 沿用旧配置'} · 已发布资源版本 {saved.lifecycle?.publishedRevision ?? saved.revision} · {saved.lifecycle?.test?.revision === saved.revision ? `${saved.lifecycle.test.scope === 'connection-probe' ? `${saved.lifecycle.test.service} 文本连接探针` : '配置校验'}${saved.lifecycle.test.success ? '通过' : '失败'}（非生产能力验证）` : '本版本未测试'} · {dirty ? '有未保存修改' : '与读取结果一致'}</p>
      {saved.lifecycle && <div className="ai-note">发布影响：{saved.lifecycle.changedServices.join('、') || '无服务绑定变化'}；旧配置/策略字段：{saved.lifecycle.changedSettings.join('、') || '无'}。{saved.lifecycle.conflict && '发布基线已变更，禁止发布；请重新核对配置。'}</div>}
      <fieldset disabled={saving || loading || needsReload}>
        {page === 'providers' ? <>
          <button type="button" className="admin-button" onClick={() => {
            let i = 1; while ([...saved.resources, ...draft.resources].some(r => r.id === `web-${i}`)) i++;
            setDraft({ ...draft, resources: [...draft.resources, { id: `web-${i}`, name: '', kind: 'tool', protocol: 'deepseek-tools', baseUrl: 'https://api.deepseek.com', tools: ['search'], credential: { action: 'keep' } }] });
          }}>新增搜索工具资源</button>
          <Section title="连接与模型目录" action={<button type="button" className="admin-button" onClick={() => {
            let i = 1; while ([...saved.resources, ...draft.resources].some(r => r.id === `provider-${i}`)) i++;
            setDraft({ ...draft, resources: [...draft.resources, { id: `provider-${i}`, name: '', kind: 'connection', protocol: 'openai-compatible', baseUrl: '', models: [{ id: '', capabilities: ['chat'] }], credential: { action: 'keep' } }] });
          }}>新增连接</button>}>
            {draft.resources.map((r, index) => <article className="ai-resource-card" key={r.id}>
              <div className="ai-card-heading"><h3>{r.name || '新连接'} <small>{r.id}</small></h3><span className="ai-status">{r.kind === 'legacy' ? '旧配置引用' : '未验证'}</span></div>
              {r.kind === 'legacy' ? <p>保留 {labels[r.scope]} 的原地址、密钥及环境变量优先级。可在「旧配置与策略」维护。</p> : <>
                <div className="ai-target"><label>连接名称<input required maxLength={100} value={r.name} onChange={e => updateResource(index, { ...r, name: e.target.value })} /></label><label>连接协议<select value={r.protocol} onChange={() => {}}>{r.kind === 'tool' ? <option value="deepseek-tools">DeepSeek tools</option> : <option value="openai-compatible">OpenAI compatible</option>}</select></label></div>
                <label>API 地址<input required readOnly={r.kind === 'tool'} type="url" placeholder="https://provider.example/v1" value={r.baseUrl} onChange={e => updateResource(index, { ...r, baseUrl: e.target.value })} /></label>
                <div className="ai-target"><label>密钥操作<select value={r.credential?.action || 'keep'} onChange={e => updateResource(index, { ...r, credential: e.target.value === 'replace' ? { action: 'replace', value: '' } : { action: e.target.value as 'keep' | 'clear' } })}><option value="keep">保留已有密钥（新连接为空）</option><option value="replace">替换密钥</option><option value="clear">明确清空密钥</option></select></label>
                  <p className="admin-muted">{saved.resources.some(item => item.id === r.id && item.kind !== 'legacy' && item.hasApiKey) ? '服务端已配置密钥，不回显。' : '未配置密钥。'} 清空后不回退到全局密钥。</p></div>
                {r.credential?.action === 'replace' && <label>新密钥<input type="password" autoComplete="new-password" required maxLength={4096} value={r.credential.value} onChange={e => updateResource(index, { ...r, credential: { action: 'replace', value: e.target.value } })} /></label>}
                {r.kind === 'connection' ? <><h4>模型 / 声明能力</h4>{r.models.map((m, mi) => <div className="ai-model" key={mi}><label>模型标识<input required maxLength={200} value={m.id} onChange={e => updateResource(index, { ...r, models: r.models.map((old, j) => j === mi ? { ...m, id: e.target.value } : old) })} /></label>
                  <div className="ai-capabilities">{capabilities.map(c => <label key={c}><input type="checkbox" checked={m.capabilities.includes(c)} onChange={e => updateResource(index, { ...r, models: r.models.map((old, j) => j === mi ? { ...m, capabilities: e.target.checked ? [...m.capabilities, c] : m.capabilities.filter(v => v !== c) } : old) })} />{labels[c]}</label>)}</div>
                  <button type="button" className="admin-button" onClick={() => updateResource(index, { ...r, models: r.models.filter((_, j) => j !== mi) })}>移除模型</button></div>)}
                <button type="button" className="admin-button" onClick={() => updateResource(index, { ...r, models: [...r.models, { id: '', capabilities: ['chat'] }] })}>添加模型</button></> : <div className="ai-note">工具目录：{r.tools.join(' / ')}。Search 仅配置独立适配器，未接入 Agent 自动执行或执行路由；Fetch 始终禁用。此资源不使用模型字段，地址固定为官方端点。</div>}
                <div className="admin-actions">
                <button type="button" className="admin-button" onClick={() => { if (window.confirm('移除连接？仍被引用的连接将无法保存。')) setDraft({ ...draft, resources: draft.resources.filter((_, i) => i !== index) }); }}>移除连接</button></div>
              </>}
            </article>)}
          </Section>
        </> : <>
          <Section title="按能力默认配置">{capabilities.map(c => <article className="ai-resource-card" key={c}><h3>{labels[c]}默认</h3><TargetFields value={draft.defaults[c]} capability={c} resources={draft.resources} onChange={target => setDraft({ ...draft, defaults: { ...draft.defaults, [c]: target } })} /></article>)}</Section>
          <Section title="已实现的业务服务">{saved.catalog.filter((service): service is { id: ServiceId; capability: Capability; input: string; output: string } => !('kind' in service)).map(service => {
            const binding = draft.services[service.id], effective = saved.effective[service.id];
            return <article className="ai-resource-card" key={service.id}><div className="ai-card-heading"><h3>{labels[service.id]} <small>{service.id}</small></h3><span>{labels[service.capability]}</span></div>
              <p className="admin-muted">输入：{service.input} → 输出：{service.output}</p>
              <button type="button" className="admin-button" disabled={dirty || !saved.lifecycle?.pending} onClick={() => { if (window.confirm(`使用已保存草稿版本 ${saved.revision} 的 ${service.id} 完整绑定发送文本连接探针？可能产生供应商费用，不验证媒体或生产能力。`)) void actOnDraft('test', service.id); }}>测试 {labels[service.id]} 草稿连接</button>
              <label>绑定方式<select value={'inherit' in binding ? 'inherit' : 'override'} onChange={e => setDraft({ ...draft, services: { ...draft.services, [service.id]: e.target.value === 'inherit' ? { inherit: true } : { resourceId: effective.resourceId, model: effective.model } } })}><option value="inherit">继承{service.capability === 'chat' && service.id !== 'chat' ? '对话服务（保留旧角色模型覆盖）' : '能力默认配置'}</option><option value="override">独立覆盖</option></select></label>
              {!('inherit' in binding) && <TargetFields value={binding} capability={service.capability} resources={draft.resources} onChange={target => setDraft({ ...draft, services: { ...draft.services, [service.id]: target } })} />}
              {saved.lifecycle?.publishedEffective?.[service.id] && <div className="ai-effective"><strong>已发布配置</strong><p>{saved.lifecycle.publishedEffective[service.id].model} / {saved.lifecycle.publishedEffective[service.id].baseUrl} · 密钥{saved.lifecycle.publishedEffective[service.id].hasApiKey ? '已配置' : '未配置'}</p></div>}
              <div className="ai-effective"><strong>{saved.lifecycle?.pending ? '草稿解析配置（尚未发布）' : '已发布解析配置'}{dirty ? '（不含未保存修改）' : ''}</strong><p>{saved.resources.find(r => r.id === effective.resourceId)?.name || effective.resourceId} / {effective.model}</p><p>{effective.baseUrl}</p><p>来源：{effective.source} · 密钥{effective.hasApiKey ? '已配置' : '未配置'}</p></div>
            </article>;
          })}</Section>
          <Section title="工具服务配置（非 Agent 启用）">
            <article className="ai-resource-card"><h3>Search · 独立搜索适配器</h3>
              <p>仅保存工具配置；未接入 Agent 自动调用或执行路由。账号可用性未验证。</p>
              <label>搜索默认资源<select value={draft.defaults.search?.resourceId || ''} onChange={e => {
                const defaults = { ...draft.defaults }; if (e.target.value) defaults.search = { resourceId: e.target.value }; else delete defaults.search;
                setDraft({ ...draft, defaults });
              }}><option value="">不配置默认</option>{draft.resources.filter(r => r.kind === 'tool' && r.tools.includes('search')).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
              <label>搜索绑定方式<select value={!draft.services.search || 'disabled' in draft.services.search ? 'disabled' : 'inherit' in draft.services.search ? 'inherit' : 'override'} onChange={e => setDraft({ ...draft, services: { ...draft.services, search: e.target.value === 'disabled' ? { disabled: true } : e.target.value === 'inherit' ? { inherit: true } : { resourceId: draft.defaults.search?.resourceId || '' } } })}>
                <option value="disabled">禁用</option><option value="inherit">继承搜索默认（无默认则禁用）</option><option value="override">独立绑定</option>
              </select></label>
              {draft.services.search && 'resourceId' in draft.services.search && <label>搜索资源<select value={draft.services.search.resourceId} onChange={e => setDraft({ ...draft, services: { ...draft.services, search: { resourceId: e.target.value } } })}><option value="">请选择工具资源</option>{draft.resources.filter(r => r.kind === 'tool' && r.tools.includes('search')).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>}
              <div className="ai-effective">{saved.lifecycle?.pending ? '草稿状态（尚未发布）' : '已发布状态'}：{saved.effective.search?.status === 'unverified' ? '已配置，未验证' : saved.effective.search?.status === 'unconfigured' ? '缺少密钥' : '禁用'} · 来源：{saved.effective.search?.source || '无绑定'} · 资源：{saved.effective.search?.resourceId || '无'}{dirty && '（不含未保存修改）'}</div>
            </article>
            <article className="ai-resource-card"><h3>Fetch · 不可用</h3><p>始终禁用：提供商重定向安全保障尚不满足要求。现有 Fetch 字段原样保留，本页不提供启用操作。</p></article>
          </Section>
          <p className="admin-muted">继承角色可能保留旧模型覆盖；新连接目录需包含该模型，否则请独立绑定。调用预算、提示词、工具权限、TTS 回退与本地语音优先策略沿用现有设置。工具配置不改变 Agent 的批准与外传策略。</p>
        </>}
      </fieldset>
      <div className="ai-savebar">{testing && <button type="button" className="admin-button" onClick={() => actionController.current?.abort()}>取消测试</button>}<span>{saving ? '正在保存，请勿离开…' : '保存整份草稿，测试并确认影响后发布'}</span><button type="button" className="admin-button" disabled={saving || loading || !dirty} onClick={() => { if (window.confirm('放弃未保存修改？')) { setDraft(writableConfiguration(saved)); setError(''); setNotice(''); } }}>取消修改</button><button className="admin-button" type="submit" disabled={saving || loading || needsReload || !dirty}>保存草稿</button><button type="button" className="admin-button" disabled={saving || loading || needsReload || dirty || !saved.lifecycle?.pending} onClick={() => void actOnDraft('test')}>校验草稿配置</button><button type="button" className="admin-button" disabled={saving || loading || needsReload || dirty || !saved.lifecycle?.pending || saved.lifecycle.conflict || saved.lifecycle.test?.revision !== saved.revision || !saved.lifecycle.test?.success} onClick={() => void actOnDraft('publish')}>确认影响并发布</button><button type="button" className="admin-button" disabled={saving || loading || needsReload || dirty || !saved.lifecycle?.pending} onClick={() => void actOnDraft('discard')}>放弃已保存草稿</button></div>
    </form>}
  </div>;
}
