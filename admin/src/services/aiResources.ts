export const capabilities = ['chat', 'vision', 'asr'] as const;
export type Capability = typeof capabilities[number];
export const serviceIds = ['chat', 'vision', 'asr', 'supervisor', 'nutrition', 'recipe', 'operations'] as const;
export type ServiceId = typeof serviceIds[number];
export const toolIds = ['search', 'fetch'] as const;
export type ToolId = typeof toolIds[number];
export type Target = { resourceId: string; model?: string };
export type Binding = Target | { inherit: true };
export type ToolBinding = { resourceId: string } | { inherit: true } | { disabled: true };
export type Credential = { action: 'keep' | 'clear' } | { action: 'replace'; value: string };
type SecretMetadata = { credential?: Credential; hasApiKey?: boolean; verification?: string };
export type Resource = { id: string; name: string } & ({ kind: 'legacy'; scope: Capability } | ({
  kind: 'connection'; protocol: 'openai-compatible'; baseUrl: string;
  models: { id: string; capabilities: Capability[] }[];
} & SecretMetadata) | ({ kind: 'tool'; protocol: 'deepseek-tools'; baseUrl: string; tools: ToolId[] } & SecretMetadata));
export interface ResourceUpdate {
  schemaVersion: 1; revision: number; resources: Resource[];
  defaults: Record<Capability, Target> & Partial<Record<ToolId, { resourceId: string }>>;
  services: Record<ServiceId, Binding> & Partial<Record<ToolId, ToolBinding>>;
}
export type ToolEffective = { status: 'disabled' | 'unconfigured' | 'unverified'; resourceId?: string; baseUrl?: string; source?: string; reason?: string; hasApiKey?: boolean };
export interface ResourceConfiguration extends ResourceUpdate {
  lifecycle?: { pending: boolean; publishedRevision: number; conflict: boolean;
    test: { revision: number; scope: 'configuration-validation' | 'connection-probe'; success: boolean; service?: ServiceId; latencyMs?: number } | null;
    publishedEffective?: Record<ServiceId, { model: string; baseUrl: string; hasApiKey: boolean }>;
    changedServices: string[]; changedSettings: string[] };
  migrated: boolean;
  catalog: ({ id: ServiceId; capability: Capability; input: string; output: string } | { id: ToolId; capability: ToolId; kind: 'tool'; input: string; output: string; automaticExecution: false })[];
  effective: Record<ServiceId, { resourceId: string; model: string; baseUrl: string; source: string; hasApiKey: boolean }> & Partial<Record<ToolId, ToolEffective>>;
}
export class UnsupportedResourceConfiguration extends Error {
  constructor() { super('检测到尚未支持的配置字段，已停止编辑以免丢失字段；请先升级对应管理界面。'); }
}
export function assertSupportedConfiguration(data: ResourceUpdate) {
  const known = (object: object, keys: readonly string[]) => Object.keys(object).every(key => keys.includes(key));
  const extra = data as ResourceConfiguration;
  const allServices: readonly string[] = [...serviceIds, ...toolIds];
  if (data.schemaVersion !== 1
    || !known(data, ['schemaVersion', 'revision', 'resources', 'defaults', 'services', 'migrated', 'catalog', 'effective', 'lifecycle'])
    || !known(data.defaults, [...capabilities, ...toolIds]) || !known(data.services, allServices)
    || extra.catalog?.some(s => !allServices.includes(s.id)) || (extra.effective && !known(extra.effective, allServices))
    || data.resources.some(r => r.kind === 'legacy'
      ? !capabilities.includes(r.scope) || !known(r, ['id', 'name', 'kind', 'scope'])
      : !known(r, ['id', 'name', 'kind', 'protocol', 'baseUrl', r.kind === 'tool' ? 'tools' : 'models', 'credential', 'hasApiKey', 'maskedKey', 'verification', 'apiKey'])
        || (r.kind === 'tool' ? r.protocol !== 'deepseek-tools' || r.tools.some(t => !toolIds.includes(t))
          : r.kind !== 'connection' || r.protocol !== 'openai-compatible' || r.models.some(m => !known(m, ['id', 'capabilities']) || m.capabilities.some(c => !capabilities.includes(c)))))
    || Object.entries(data.defaults).some(([key, t]) => !known(t, toolIds.includes(key as ToolId) ? ['resourceId'] : ['resourceId', 'model']))
    || Object.entries(data.services).some(([key, t]) => !known(t, toolIds.includes(key as ToolId) ? ['resourceId', 'inherit', 'disabled'] : ['resourceId', 'model', 'inherit']))) throw new UnsupportedResourceConfiguration();
}
// Explicit projection preserves optional tool fields while excluding GET-only metadata and secrets.
export function writableConfiguration(data: ResourceUpdate): ResourceUpdate {
  assertSupportedConfiguration(data);
  const target = (value: Target): Target => ({ resourceId: value.resourceId, ...(value.model?.trim() ? { model: value.model.trim() } : {}) });
  const defaults: ResourceUpdate['defaults'] = Object.fromEntries(capabilities.map(c => [c, target(data.defaults[c])])) as ResourceUpdate['defaults'];
  const services: ResourceUpdate['services'] = Object.fromEntries(serviceIds.map(s => [s, 'inherit' in data.services[s] ? { inherit: true } : target(data.services[s] as Target)])) as ResourceUpdate['services'];
  for (const t of toolIds) {
    if (data.defaults[t]) defaults[t] = { resourceId: data.defaults[t]!.resourceId };
    const b = data.services[t];
    if (b) services[t] = 'disabled' in b ? { disabled: true } : 'inherit' in b ? { inherit: true } : { resourceId: b.resourceId };
  }
  return { schemaVersion: 1, revision: data.revision, defaults, services,
    resources: data.resources.map(r => {
      if (r.kind === 'legacy') return { id: r.id, name: r.name, kind: r.kind, scope: r.scope };
      const credential: Credential = r.credential?.action === 'replace' ? { action: 'replace', value: r.credential.value.trim() } : { action: r.credential?.action || 'keep' };
      const common = { id: r.id, name: r.name.trim(), baseUrl: r.baseUrl.trim(), credential };
      return r.kind === 'tool' ? { ...common, kind: r.kind, protocol: r.protocol, tools: [...r.tools] }
        : { ...common, kind: r.kind, protocol: r.protocol, models: r.models.map(m => ({ id: m.id.trim(), capabilities: [...m.capabilities] })) };
    }),
  };
}
export function validateConfiguration(data: ResourceUpdate): string | null {
  if (data.resources.length > 100) return '最多支持 100 个资源。';
  if (new Set(data.resources.map(r => r.id)).size !== data.resources.length) return '资源标识不可重复。';
  for (const r of data.resources) {
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(r.id) || !r.name.trim() || r.name.trim().length > 100) return '请填写有效标识和名称（名称最多 100 字）。';
    if (r.kind === 'legacy') continue;
    try { const u = new URL(r.baseUrl); if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw Error(); }
    catch { return '端点必须是无凭据、查询参数或片段的 HTTP(S) 地址。'; }
    if (r.kind === 'tool') {
      if (r.baseUrl !== 'https://api.deepseek.com' || !r.tools.length || r.tools.length > 2 || r.tools.some(t => !toolIds.includes(t))) return '工具资源必须使用 DeepSeek 官方地址和已实现的工具目录。';
    } else {
      if (!r.models.length || r.models.length > 100 || r.models.some(m => !m.id.trim() || m.id.trim().length > 200 || !m.capabilities.length)) return '请填写模型标识并选择至少一种能力（最多 100 个模型）。';
      if (new Set(r.models.map(m => m.id.trim())).size !== r.models.length) return '模型标识不可重复。';
    }
    if (r.credential?.action === 'replace' && (!r.credential.value.trim() || r.credential.value.trim().length > 4096)) return '替换密钥必须非空且不超过 4096 字符。';
  }
  function compatible(t: Target, c: Capability) {
    const r = data.resources.find(r => r.id === t.resourceId);
    return r?.kind === 'legacy' ? r.scope === c && (!t.model || t.model.trim().length <= 200)
      : r?.kind === 'connection' && r.models.some(m => m.id.trim() === t.model && m.capabilities.includes(c));
  }
  for (const c of capabilities) if (!compatible(data.defaults[c], c)) return '默认配置的资源或模型能力不兼容。';
  for (const s of serviceIds) {
    const b = data.services[s];
    if (!('inherit' in b) && !compatible(b, capabilities.includes(s as Capability) ? s as Capability : 'chat')) return '业务服务的资源或模型能力不兼容。';
  }
  for (const t of toolIds) for (const b of [data.defaults[t], data.services[t]]) {
    if (b && 'resourceId' in b) {
      const r = data.resources.find(r => r.id === b.resourceId);
      if (r?.kind !== 'tool' || !r.tools.includes(t) || 'model' in b) return '工具绑定必须选择兼容工具资源，不能指定模型。';
    }
  }
  return null;
}
