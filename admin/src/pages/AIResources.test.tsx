// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import AIResources from './AIResources';
import api from '../services/api';
import { capabilities, serviceIds, writableConfiguration, validateConfiguration, type ResourceConfiguration } from '../services/aiResources';
vi.mock('../services/api', () => ({ default: { get: vi.fn(), put: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(api.get), put = vi.mocked(api.put);
function fixture(): ResourceConfiguration {
  return { schemaVersion: 1, revision: 3, migrated: true, lifecycle: { pending: false, publishedRevision: 3, conflict: false, test: null, changedServices: [], changedSettings: [] },
    resources: [...capabilities.map(scope => ({ id: `legacy-${scope}`, name: `Legacy ${scope}`, kind: 'legacy' as const, scope })),
      { id: 'demo', name: 'Demo provider', kind: 'connection', protocol: 'openai-compatible', baseUrl: 'https://demo.invalid/v1', models: [{ id: 'demo-chat', capabilities: ['chat'] }], hasApiKey: true, verification: 'unverified' }],
    defaults: { chat: { resourceId: 'demo', model: 'demo-chat' }, vision: { resourceId: 'legacy-vision' }, asr: { resourceId: 'legacy-asr' } },
    services: Object.fromEntries(serviceIds.map(s => [s, { inherit: true }])) as ResourceConfiguration['services'],
    catalog: serviceIds.map(id => ({ id, capability: id === 'vision' || id === 'asr' ? id : 'chat', input: 'messages', output: 'chat-completion' })),
    effective: Object.fromEntries(serviceIds.map(s => [s, { resourceId: 'demo', model: 'demo-chat', baseUrl: 'https://demo.invalid/v1', source: s === 'nutrition' ? 'service:chat+legacy-role-model' : 'default:chat', hasApiKey: true }])) as unknown as ResourceConfiguration['effective'],
  };
}
const deferred = () => { let resolve!: (value: any) => void, reject!: (value: any) => void; const promise = new Promise<any>((yes, no) => { resolve = value => yes({ data: value }); reject = no; }); return { promise, resolve, reject }; };
let host: HTMLDivElement, root: Root;
let router: ReturnType<typeof createMemoryRouter>;
async function mount(page: 'providers' | 'services' = 'providers') {
  router = createMemoryRouter([{ path: '/', element: <AIResources page={page} /> }, { path: '/other', element: <p>Other page</p> }]);
  await act(async () => root.render(<RouterProvider router={router} />));
}
async function click(text: string) { const b = [...host.querySelectorAll('button')].find(b => b.textContent === text)!; expect(b, text).toBeDefined(); await act(async () => b.click()); }
async function change(label: string, value: string) {
  const el = [...host.querySelectorAll('label')].find(l => l.firstChild?.textContent === label)!.querySelector('input, select') as HTMLInputElement;
  await act(async () => { Object.getOwnPropertyDescriptor(el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); });
}
async function submit(count = 1) { await act(async () => { for (let i = 0; i < count; i++) host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); }
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; vi.resetAllMocks(); vi.spyOn(window, 'confirm').mockReturnValue(true); get.mockResolvedValue({ data: fixture() }); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); router?.dispose(); host.remove(); vi.restoreAllMocks(); });
it('allowlists PUT fields, preserves legacy bindings, and never submits GET metadata', () => {
  const data = fixture(); (data.resources[3] as any).maskedKey = '********'; (data.resources[3] as any).apiKey = 'must-not-copy';
  const body = writableConfiguration(data); expect(Object.keys(body).sort()).toEqual(['defaults', 'resources', 'revision', 'schemaVersion', 'services']);
  expect(JSON.stringify(body)).not.toMatch(/maskedKey|hasApiKey|verification|must-not-copy|effective|migrated/);
  expect(body.services).toEqual(data.services); expect(body.resources[3]).toHaveProperty('credential', { action: 'keep' });
});
it('validates URL credentials, models, replacement, IDs and incompatible bindings', () => {
  const data = writableConfiguration(fixture()); expect(validateConfiguration(data)).toBeNull(); const r = data.resources[3]; if (r.kind !== 'connection') throw Error();
  r.baseUrl = 'https://user:secret@demo.invalid'; expect(validateConfiguration(data)).toContain('端点'); r.baseUrl = 'https://demo.invalid';
  r.credential = { action: 'replace', value: ' ' }; expect(validateConfiguration(data)).toContain('密钥'); r.credential = { action: 'clear' };
  r.models.push({ ...r.models[0] }); expect(validateConfiguration(data)).toContain('重复'); r.models.pop();
  data.services.vision = { resourceId: 'demo', model: 'demo-chat' }; expect(validateConfiguration(data)).toContain('不兼容');
});
it('does not echo saved keys and cancellation discards replacement without a write', async () => {
  await mount(); expect(host.querySelector('input[type=password]')).toBeNull(); expect(host.textContent).not.toContain('********');
  await change('密钥操作', 'replace'); await change('新密钥', 'demo-only-secret'); expect(host.querySelector('input[type=password]')).not.toBeNull();
  await click('取消修改'); expect(host.querySelector('input[type=password]')).toBeNull(); expect(put).not.toHaveBeenCalled();
});
it.each(['keep', 'replace', 'clear'])('sends explicit %s credentials and prevents same-tick duplicate saves', async action => {
  const pending = deferred(); put.mockReturnValue(pending.promise); await mount(); await change('连接名称', 'Renamed');
  if (action !== 'keep') await change('密钥操作', action); if (action === 'replace') await change('新密钥', 'demo-only-secret');
  await submit(2); expect(put).toHaveBeenCalledTimes(1); const r = (put.mock.calls[0][1] as ReturnType<typeof writableConfiguration>).resources[3]; if (r.kind !== 'connection') throw Error(); expect(r.credential).toEqual(action === 'replace' ? { action, value: 'demo-only-secret' } : { action });
  await click('取消修改'); expect((host.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(true);
  await act(async () => pending.resolve({ ...fixture(), revision: 4 })); expect(host.textContent).toContain('已保存'); expect(host.querySelector('input[type=password]')).toBeNull();
});
it('blocks stale revision before PUT and requires reload instead of automatic retry', async () => {
  await mount(); await change('连接名称', 'Renamed'); get.mockResolvedValue({ data: { ...fixture(), revision: 4 } }); await submit(); expect(put).not.toHaveBeenCalled(); expect(host.textContent).toContain('配置版本已变更');
  await submit(); expect(put).not.toHaveBeenCalled(); await click('重新读取'); expect(host.textContent).toContain('版本 4');
});
it('handles the backend generic conflict/error without leaking response contents or resubmitting', async () => {
  await mount(); await change('连接名称', 'Renamed'); put.mockRejectedValue({ response: { status: 400, data: { error: 'sensitive-secret' } } }); await submit(); await submit();
  expect(put).toHaveBeenCalledTimes(1); expect(host.textContent).toContain('保存未确认'); expect(host.textContent).not.toContain('sensitive-secret');
});
it.each(['resolve', 'reject'])('ignores late save %s after unmount', async outcome => {
  const pending = deferred(); put.mockReturnValue(pending.promise); await mount(); await change('连接名称', 'Renamed'); await submit(); await act(async () => root.render(null));
  await mount(); await change('连接名称', 'New draft'); await act(async () => outcome === 'resolve' ? pending.resolve({ ...fixture(), revision: 99 }) : pending.reject(Error('old')));
  expect(host.textContent).not.toContain('99'); expect((host.querySelector('input') as HTMLInputElement).value).toBe('New draft'); expect(host.textContent).not.toContain('保存未确认');
});
it('ignores late reads and supports initial load failure retry', async () => {
  get.mockRejectedValueOnce(Error('offline')); await mount(); expect(host.textContent).toContain('读取配置失败'); await click('重新读取'); expect(host.textContent).toContain('Demo provider');
  const old = deferred(), latest = deferred(); get.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
  await click('重新读取'); await act(async () => root.render(null)); await mount(); await act(async () => latest.resolve({ ...fixture(), revision: 7 })); await act(async () => old.resolve({ ...fixture(), revision: 99 })); expect(host.textContent).toContain('版本 7'); expect(host.textContent).not.toContain('99');
});
it('guards unsaved navigation, and displays effective sources separately from changes', async () => {
  await mount('services'); expect(host.textContent).toContain('service:chat+legacy-role-model'); await change('绑定方式', 'override'); expect(host.textContent).toContain('不含未保存修改');
  vi.mocked(window.confirm).mockReturnValue(false); await act(async () => router.navigate('/other')); expect(host.textContent).not.toContain('Other page');
  vi.mocked(window.confirm).mockReturnValue(true); await act(async () => router.navigate('/other')); expect(host.textContent).toContain('Other page');
});
it('supports two independent connections and filters models by required capability', async () => {
  const data = fixture(); data.resources.push({ id: 'media', name: 'Media provider', kind: 'connection', protocol: 'openai-compatible', baseUrl: 'https://media.invalid/v1', models: [{ id: 'image-model', capabilities: ['vision'] }, { id: 'audio-model', capabilities: ['asr'] }] });
  data.defaults.vision = { resourceId: 'media', model: 'image-model' }; data.services.vision = { resourceId: 'media', model: 'image-model' };
  get.mockResolvedValue({ data }); await mount('services');
  const visionDefault = host.querySelectorAll('.ai-resource-card')[1]; const selects = visionDefault.querySelectorAll('select');
  expect([...selects[0].options].map(o => o.value)).toEqual(['', 'legacy-vision', 'media']);
  expect([...selects[1].options].map(o => o.value)).toEqual(['', 'image-model']);
  expect(validateConfiguration(writableConfiguration(data))).toBeNull();
});
it('rejects invalid form contents without network writes and clears the error after cancel', async () => {
  await mount(); await change('API 地址', 'https://user:password@demo.invalid/v1'); await submit(); expect(put).not.toHaveBeenCalled(); expect(host.textContent).toContain('端点必须');
  await click('取消修改'); expect(host.querySelector('[role=alert]')).toBeNull();
  await change('密钥操作', 'replace'); await submit(); expect(put).not.toHaveBeenCalled(); expect(host.textContent).toContain('替换密钥必须非空');
});
it('keeps pending saves owned, blocks navigation, and warns on browser close', async () => {
  const pending = deferred(); put.mockReturnValue(pending.promise); await mount(); await change('连接名称', 'Pending'); await submit();
  await act(async () => router.navigate('/other')); expect(host.textContent).not.toContain('Other page');
  const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
  await act(async () => pending.resolve({ ...fixture(), revision: 4 })); await act(async () => router.navigate('/other')); expect(host.textContent).toContain('Other page');
});
it('does not send a save when unmounted during the revision preflight', async () => {
  await mount(); await change('连接名称', 'Pending'); const pending = deferred(); get.mockReturnValue(pending.promise); await submit(); await act(async () => root.render(null)); await act(async () => pending.resolve(fixture())); expect(put).not.toHaveBeenCalled();
});
it.each(['resource', 'binding', 'catalog'])('refuses unknown future %s fields instead of discarding them', async kind => {
  const data = fixture();
  if (kind === 'resource') (data.resources as any[]).push({ id: 'web', name: 'Web', kind: 'tool', protocol: 'future-tools', baseUrl: 'https://api.deepseek.com', tools: ['search', 'fetch'] });
  if (kind === 'binding') (data.services as any).futureSearch = { disabled: true };
  if (kind === 'catalog') (data.catalog as any[]).push({ id: 'futureSearch', capability: 'futureSearch', kind: 'tool', automaticExecution: false });
  expect(() => writableConfiguration(data)).toThrow('已停止编辑'); get.mockResolvedValue({ data }); await mount(); expect(host.textContent).toContain('已停止编辑'); expect(host.querySelector('form')).toBeNull(); expect(put).not.toHaveBeenCalled();
});
it('stops a write if a unknown future backend appears during preflight', async () => {
  await mount(); await change('连接名称', 'Renamed'); const data = fixture(); (data.defaults as any).futureSearch = { resourceId: 'web' }; get.mockResolvedValue({ data }); await submit(); expect(put).not.toHaveBeenCalled(); expect(host.textContent).toContain('已停止编辑');
});
it('does not render an unsupported save response as a model-only document', async () => {
  await mount(); await change('连接名称', 'Renamed'); const data = fixture(); (data.services as any).futureFetch = { disabled: true }; put.mockResolvedValue({ data }); await submit();
  expect(host.textContent).toContain('已停止编辑'); expect(host.textContent).not.toContain('已保存，后续'); expect((host.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(true);
});
function toolFixture() {
  const data = fixture();
  data.resources.push({ id: 'web', name: 'Web tools', kind: 'tool', protocol: 'deepseek-tools', baseUrl: 'https://api.deepseek.com', tools: ['search', 'fetch'], hasApiKey: true });
  data.defaults.search = { resourceId: 'web' }; data.defaults.fetch = { resourceId: 'web' };
  data.services.search = { inherit: true }; data.services.fetch = { resourceId: 'web' };
  data.catalog.push({ id: 'search', capability: 'search', kind: 'tool', input: 'public-query', output: 'untrusted-web-results', automaticExecution: false }, { id: 'fetch', capability: 'fetch', kind: 'tool', input: 'public-url', output: 'untrusted-web-results', automaticExecution: false });
  data.effective.search = { status: 'unverified', resourceId: 'web', source: 'default:search', hasApiKey: true };
  data.effective.fetch = { status: 'disabled', resourceId: 'web', reason: 'redirect-safety-unavailable' };
  return data;
}
it('allows model edits while preserving untouched tool defaults, bindings and credentials', async () => {
  const data = toolFixture(); get.mockResolvedValue({ data }); put.mockResolvedValue({ data: { ...data, revision: 4 } });
  await mount(); await change('连接名称', 'Renamed model resource'); await submit();
  const body = put.mock.calls[0][1] as ReturnType<typeof writableConfiguration>;
  expect(body.defaults.search).toEqual(data.defaults.search); expect(body.defaults.fetch).toEqual(data.defaults.fetch);
  expect(body.services.search).toEqual(data.services.search); expect(body.services.fetch).toEqual(data.services.fetch);
  expect(body.resources.at(-1)).toEqual({ id: 'web', name: 'Web tools', kind: 'tool', protocol: 'deepseek-tools', baseUrl: 'https://api.deepseek.com', tools: ['search', 'fetch'], credential: { action: 'keep' } });
});
it.each(['replace', 'clear'])('supports tool credential %s and confirms clearing', async action => {
  const data = toolFixture(); data.resources = data.resources.filter(r => r.kind !== 'connection'); data.defaults.chat = { resourceId: 'legacy-chat' };
  get.mockResolvedValue({ data }); put.mockResolvedValue({ data: { ...data, revision: 4 } }); await mount(); await change('密钥操作', action);
  if (action === 'replace') await change('新密钥', 'synthetic-tool-secret');
  if (action === 'clear') { vi.mocked(window.confirm).mockReturnValue(false); await submit(); expect(put).not.toHaveBeenCalled(); vi.mocked(window.confirm).mockReturnValue(true); }
  await submit(); expect((put.mock.calls[0][1] as ReturnType<typeof writableConfiguration>).resources.at(-1)).toHaveProperty('credential', action === 'replace' ? { action, value: 'synthetic-tool-secret' } : { action });
});
it('edits Search without a model, retains Fetch disabled and does not claim Agent execution', async () => {
  const data = toolFixture(); get.mockResolvedValue({ data }); put.mockResolvedValue({ data: { ...data, revision: 4 } }); await mount('services');
  expect(host.textContent).toContain('未接入 Agent 自动调用或执行路由'); expect(host.textContent).toContain('Fetch · 不可用');
  await change('搜索绑定方式', 'override'); await change('搜索资源', 'web'); await submit();
  const body = put.mock.calls[0][1] as ReturnType<typeof writableConfiguration>; expect(body.services.search).toEqual({ resourceId: 'web' }); expect(body.services.fetch).toEqual(data.services.fetch);
});
it('recognizes real HTTP conflict codes without exposing response bodies', async () => {
  await mount(); await change('连接名称', 'Renamed'); put.mockRejectedValue({ response: { status: 409, data: { code: 'AI_RESOURCE_CONFLICT', error: 'not-for-display' } } }); await submit(); expect(host.textContent).toContain('配置版本冲突'); expect(host.textContent).not.toContain('not-for-display'); await submit(); expect(put).toHaveBeenCalledTimes(1);
});

it.each(['connection', 'tool'])('never reuses a removed saved %s ID with credential keep', async kind => {
  const data = fixture();
  data.resources.push(kind === 'connection'
    ? { id: 'provider-1', name: 'Old', kind: 'connection', protocol: 'openai-compatible', baseUrl: 'https://old.invalid', models: [{ id: 'old', capabilities: ['chat'] }] }
    : { id: 'web-1', name: 'Old', kind: 'tool', protocol: 'deepseek-tools', baseUrl: 'https://api.deepseek.com', tools: ['search'] });
  get.mockResolvedValue({ data }); await mount();
  const card = [...host.querySelectorAll('article')].at(-1)!;
  await act(async () => [...card.querySelectorAll('button')].find(b => b.textContent === '移除连接')!.click());
  await click(kind === 'connection' ? '新增连接' : '新增搜索工具资源');
  expect([...host.querySelectorAll('article')].at(-1)!.querySelector('small')!.textContent).toBe(kind === 'connection' ? 'provider-2' : 'web-2');
});

function draftFixture(revision = 3): ResourceConfiguration {
  return { ...fixture(), revision, lifecycle: { pending: true, publishedRevision: 2, conflict: false, test: null, changedServices: ['chat'], changedSettings: [] } };
}
it('tests the exact saved revision, invalidates results on edit, confirms impact and prevents duplicate publishes', async () => {
  get.mockResolvedValue({ data: draftFixture() }); await mount();
  const tested = draftFixture(); tested.lifecycle!.test = { revision: 3, scope: 'configuration-validation', success: true };
  vi.mocked(api.post).mockResolvedValue({ data: tested }); await click('校验草稿配置');
  expect(api.post).toHaveBeenCalledWith('/admin/ai-config/resources/test', { revision: 3 }, { signal: expect.any(AbortSignal) });
  expect(host.textContent).toContain('不代表生产能力可用');
  await change('连接名称', 'Edited after test');
  expect([...host.querySelectorAll('button')].find(b => b.textContent === '确认影响并发布')!.disabled).toBe(true);
  await click('取消修改');
  vi.mocked(window.confirm).mockReturnValue(false); await click('确认影响并发布'); expect(api.post).toHaveBeenCalledTimes(1);
  vi.mocked(window.confirm).mockReturnValue(true);
  const pending = deferred(); vi.mocked(api.post).mockReturnValue(pending.promise);
  await click('确认影响并发布'); await click('确认影响并发布'); expect(api.post).toHaveBeenCalledTimes(2);
  expect(window.confirm).toHaveBeenLastCalledWith(expect.stringContaining('影响服务：chat'));
  await act(async () => pending.resolve({ ...tested, lifecycle: { ...tested.lifecycle, pending: false } }));
  expect(host.textContent).toContain('发布成功');
});
it.each(['test', 'publish'] as const)('ignores late %s replies after close and requires reload after uncertain errors', async action => {
  const data = draftFixture(); data.lifecycle!.test = { revision: 3, scope: 'configuration-validation', success: true };
  get.mockResolvedValue({ data }); const pending = deferred(); vi.mocked(api.post).mockReturnValue(pending.promise);
  await mount(); await click(action === 'test' ? '校验草稿配置' : '确认影响并发布');
  await act(async () => root.render(null)); await mount();
  await act(async () => pending.resolve({ ...data, revision: 99 })); expect(host.textContent).not.toContain('99');
  vi.mocked(api.post).mockRejectedValue(Error('secret-must-not-show'));
  await click(action === 'test' ? '校验草稿配置' : '确认影响并发布');
  expect(host.textContent).toContain('操作未确认'); expect(host.textContent).not.toContain('secret-must-not-show');
});

it('sends a versioned service probe, labels its limited scope, and cancels pending testing', async () => {
  const data = draftFixture(); get.mockResolvedValue({ data }); await mount('services');
  vi.mocked(api.post).mockResolvedValue({ data: { ...data, lifecycle: { ...data.lifecycle, test: { revision: 3, scope: 'connection-probe', service: 'chat', success: true } } } });
  await click('测试 对话 草稿连接');
  expect(api.post).toHaveBeenLastCalledWith('/admin/ai-config/resources/test', { revision: 3, service: 'chat' }, { signal: expect.any(AbortSignal) });
  expect(host.textContent).toContain('不证明视觉、ASR、工具或生产能力');
  vi.mocked(api.post).mockImplementation((_url, _body, config) => new Promise((_resolve, reject) => { config?.signal?.addEventListener?.('abort', () => reject(Error('cancelled'))); }));
  await click('测试 对话 草稿连接'); await click('取消测试'); expect(host.textContent).toContain('操作未确认');
});
