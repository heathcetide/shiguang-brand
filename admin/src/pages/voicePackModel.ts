export type VoicePackStatus = 'draft' | 'published' | 'disabled' | 'revoked';

export const voicePackStatusPresentation: Record<VoicePackStatus, { label: string; className: string }> = {
  draft: { label: '草稿', className: 'bg-slate-100 text-slate-700' },
  published: { label: '已发布', className: 'bg-emerald-50 text-emerald-700' },
  disabled: { label: '已下架', className: 'bg-amber-50 text-amber-700' },
  revoked: { label: '已撤销', className: 'bg-red-50 text-red-700' },
};

export function voicePackActions(status: VoicePackStatus): Array<'edit' | 'publish' | 'disable' | 'revoke'> {
  if (status === 'draft') return ['edit', 'publish'];
  if (status === 'published') return ['disable', 'revoke'];
  if (status === 'disabled') return ['publish', 'revoke'];
  return [];
}

export function voicePackTransitionConfirmation(
  target: 'publish' | 'disable' | 'revoke',
  identity: string,
) {
  if (target === 'publish') return `确认发布 ${identity}？发布后普通用户可下载，关键资源不可原地覆盖。`;
  if (target === 'disable') return `确认下架 ${identity}？新用户将无法下载，已安装模型不会被强制删除。`;
  return `紧急撤销 ${identity}？客户端同步目录后会停止使用并删除已安装模型，此操作不可恢复。`;
}

export function voicePackManifestChecks(value: unknown) {
  const manifest = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const resources = Array.isArray(manifest.resources) ? manifest.resources as Array<Record<string, unknown>> : [];
  const license = manifest.license && typeof manifest.license === 'object' ? manifest.license as Record<string, unknown> : {};
  const model = manifest.model && typeof manifest.model === 'object' ? manifest.model as Record<string, unknown> : {};
  const processor = model.textProcessor && typeof model.textProcessor === 'object' ? model.textProcessor as Record<string, unknown> : {};
  const totalBytes = resources.reduce((sum, resource) => sum + Number(resource.bytes || 0), 0);
  const paths = new Set(resources.map((resource) => String(resource.path || '')));
  return [
    { label: '语义版本与唯一音色标识', passed: /^[a-z0-9][a-z0-9._-]{1,79}$/i.test(String(manifest.voiceId || '')) && /^\d+\.\d+\.\d+$/.test(String(manifest.version || '')) },
    { label: 'HTTPS 资源与 64 位 SHA-256', passed: resources.length > 0 && resources.every((resource) => String(resource.url || '').startsWith('https://') && /^[a-f0-9]{64}$/i.test(String(resource.sha256 || ''))) },
    { label: '安全且不重复的资源路径', passed: resources.length > 0 && new Set(resources.map((resource) => resource.path)).size === resources.length && resources.every((resource) => /^[a-z0-9][a-z0-9._/-]{0,199}$/i.test(String(resource.path || '')) && !String(resource.path || '').includes('..')) },
    { label: '单文件不超过 200 MB、总量不超过 350 MB', passed: resources.length <= 16 && resources.every((resource) => Number(resource.bytes) > 0 && Number(resource.bytes) <= 200 * 1024 * 1024) && totalBytes <= 350 * 1024 * 1024 },
    { label: '生产/内部测试发行范围明确', passed: ['public', 'internal-test'].includes(String(manifest.distribution || '')) },
    { label: '文本处理器及映射资源完整', passed: processor.type === 'character-v1' || (processor.type === 'token-map-v1' && paths.has(String(processor.mappingPath || ''))) },
    { label: '许可证、说话人授权与风险说明', passed: Boolean(license.name && String(license.url || '').startsWith('https://') && license.speakerAuthorization && license.modelNotice) },
  ];
}
