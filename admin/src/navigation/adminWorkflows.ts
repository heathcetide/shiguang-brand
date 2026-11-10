export interface WorkflowTab { path: string; label: string; query?: Record<string, string> }
export const adminWorkflows = {
  kitchenware: { label: '厨具管理', tabs: [
    { path: '/admin/kitchenware', label: '官方标准库', query: { tab: 'catalog' } },
    { path: '/admin/kitchenware', label: '用户厨具资产', query: { tab: 'assets' } },
    { path: '/admin/kitchenware-mapping-reviews', label: '映射审核' },
  ] },
  growth: { label: '用户成长', tabs: [
    { path: '/admin/users', label: '用户管理' },
    { path: '/admin/user-level-rule', label: '等级规则' },
  ] },
  configuration: { label: 'AI 服务配置', tabs: [
    { path: '/admin/ai-providers', label: '服务提供商' },
    { path: '/admin/ai-services', label: '业务服务' },
    { path: '/admin/ai-config', label: '旧配置与策略' },
    { path: '/admin/voice-packs', label: '音色目录' },
  ] },
  diagnostics: { label: 'AI 诊断', tabs: [
    { path: '/admin/ai-conversations', label: '对话记录' },
    { path: '/admin/agent-runs', label: '任务运行' },
  ] },
} satisfies Record<string, { label: string; tabs: WorkflowTab[] }>;
export type AdminWorkflow = keyof typeof adminWorkflows;
export function activeWorkflowTab(tabs: readonly WorkflowTab[], pathname: string, search: string) {
  const params = new URLSearchParams(search);
  return tabs.findIndex(tab => tab.path === pathname.replace(/\/$/, '') && (!tab.query || Object.entries(tab.query).every(([key, value]) => {
    const raw = params.get(key);
    const selected = key === 'tab' && !['assets', 'catalog'].includes(raw || '') ? 'catalog' : raw;
    return selected === value;
  })));
}
export function workflowTabHref(tab: WorkflowTab, search = '', hash = '') {
  const params = new URLSearchParams(search);
  for (const [key, value] of Object.entries(tab.query || {})) params.set(key, value);
  const query = params.toString();
  return `${tab.path}${query ? `?${query}` : ''}${hash}`;
}
