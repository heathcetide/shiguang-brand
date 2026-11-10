// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useNavigate } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Users from './Users';
import AIConversations from './AIConversations';
import api from '../services/api';
vi.mock('../services/api', () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(api.get);
const deferred = () => { let resolve!: (data: any) => void; let reject!: (error: Error) => void; const promise = new Promise<any>((yes, no) => { resolve = data => yes({ data }); reject = no; }); return { promise, resolve, reject }; };
let host: HTMLDivElement;
let root: Root;
let navigate: ReturnType<typeof useNavigate>;
function Navigation() { navigate = useNavigate(); return null; }
async function mount(page: React.ReactNode) { await act(async () => root.render(<MemoryRouter><Navigation />{page}</MemoryRouter>)); }
async function click(text: string, index = 0) { const buttons = [...host.querySelectorAll('button')].filter(b => b.textContent === text || b.getAttribute('aria-label') === text); expect(buttons[index], text).toBeDefined(); await act(async () => buttons[index].click()); }
const conversation = (id: number) => ({ userId: id, sessionId: `session-${id}`, username: `Person ${id}`, turnCount: 1, messageCount: 1, avgResponseTimeMs: null, failedCount: 0, sources: null, updatedAt: '2026-01-01 00:00:00', lastUserMessage: `Question ${id}` });
const user = (id: number) => ({ id, username: `Person ${id}`, avatar_url: '', role: 'user', is_verified_expert: false, created_at: '2026-01-01' });
const profile = (id: number) => ({ user_id: id, profile: { medical_notes: `Profile ${id}` }, latest_tracking: null, tracking_count: 0 });
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; get.mockReset(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it.each([['resolve', 'button'], ['reject', 'button'], ['resolve', 'escape'], ['reject', 'escape'], ['resolve', 'backdrop'], ['reject', 'backdrop']] as const)('loads B after closing pending A and ignores stale %s via %s', async (outcome, dismissal) => {
  const a = deferred(); const b = deferred();
  get.mockImplementation((url: string) => url === '/admin/users' ? Promise.resolve({ data: { items: [user(1), user(2)] } }) : url.includes('/1/') ? a.promise : b.promise);
  await mount(<Users />); await click('Person 1'); await click('健康与饮食档案');
  if (dismissal === 'button') await click('关闭');
  else await act(async () => { if (dismissal === 'escape') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); else (host.querySelector('[role="dialog"]') as HTMLElement).click(); });
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  await click('Person 2'); await click('健康与饮食档案');
  expect(get.mock.calls.some(([url]) => url === '/admin/users/2/health-profile')).toBe(true);
  await act(async () => { if (outcome === 'resolve') a.resolve(profile(1)); else a.reject(new Error('stale')); });
  expect(host.textContent).toContain('正在读取已保存档案'); expect(host.textContent).not.toContain('Profile 1');
  await act(async () => b.resolve(profile(2))); expect(host.textContent).toContain('Profile 2');
});
it('starts a fresh health request when reopening the same user', async () => {
  const a = deferred(); const b = deferred(); let count = 0;
  get.mockImplementation((url: string) => url === '/admin/users' ? Promise.resolve({ data: { items: [user(1)] } }) : ++count === 1 ? a.promise : b.promise);
  await mount(<Users />); await click('Person 1'); await click('健康与饮食档案'); await click('关闭'); await click('Person 1'); await click('健康与饮食档案'); expect(count).toBe(2);
  await act(async () => b.resolve(profile(1))); await act(async () => a.reject(new Error('old'))); expect(host.textContent).toContain('Profile 1');
});
it('keeps the latest conversation query when old data arrives last', async () => {
  const a = deferred(); const b = deferred();
  get.mockImplementation((url: string, config: any) => url.includes('inventory') ? Promise.resolve({ data: { items: [] } }) : config.params.query === 'new' ? b.promise : a.promise);
  await mount(<AIConversations />); await act(async () => navigate('?q=new')); await act(async () => b.resolve({ items: [conversation(2)] })); await act(async () => a.resolve({ items: [conversation(1)] }));
  expect(host.textContent).toContain('Question 2'); expect(host.textContent).not.toContain('Question 1');
});

const scan = (id: string) => ({ id, status: 'completed', errorMessage: null, updatedAt: '2026-01-01 00:00:00', userId: 1, username: `Scan ${id}`, itemCount: 1, items: [{ foodName: `Food ${id}`, quantity: '1', suggestedStorageLocation: 'fridge', estimatedExpireDays: 2 }] });
const detail = (id: number) => ({ user: { id, username: `Person ${id}` }, sessionId: `session-${id}`, messages: [{ id, role: 'user', content: `Detail ${id}`, responseTimeMs: null, source: 'assistant', status: 'completed', payload: null, confirmationStatus: null, createdAt: '2026-01-01 00:00:00' }] });
it('shows list errors instead of empty states and retries each scope independently', async () => {
  get.mockRejectedValue(new Error('offline'));
  await mount(<AIConversations />);
  expect(host.querySelectorAll('[role="alert"]')).toHaveLength(2);
  expect(host.textContent).not.toContain('暂无图片识别记录'); expect(host.textContent).not.toContain('暂未记录 AI 对话');
  get.mockResolvedValue({ data: { items: [conversation(1)] } }); await click('重新加载', 0);
  expect(host.textContent).toContain('Question 1'); expect(host.querySelectorAll('[role="alert"]')).toHaveLength(1);
  get.mockResolvedValue({ data: { items: [scan('a')] } }); await click('重新加载'); expect(host.textContent).toContain('Scan a'); expect(host.querySelector('[role="alert"]')).toBeNull();
});
it.each(['resolve', 'reject'] as const)('ignores stale list and scan %s and finally while refreshed requests are pending', async outcome => {
  const pending = [deferred(), deferred(), deferred(), deferred()]; let index = 0;
  get.mockImplementation(() => pending[index++].promise);
  await mount(<AIConversations />); await click('刷新');
  await act(async () => { for (const old of pending.slice(0, 2)) { if (outcome === 'resolve') old.resolve({ items: [] }); else old.reject(new Error('old')); } });
  expect(host.textContent).toContain('正在加载会话记录'); expect(host.textContent).toContain('正在加载识别记录'); expect(host.querySelector('[role="alert"]')).toBeNull();
  await act(async () => { pending[2].resolve({ items: [conversation(2)] }); pending[3].resolve({ items: [scan('b')] }); });
  expect(host.textContent).toContain('Question 2'); expect(host.textContent).toContain('Scan b');
});
it.each([['conversation', 'resolve'], ['conversation', 'reject'], ['scan', 'resolve'], ['scan', 'reject']] as const)('closes pending %s detail, reopens another record and ignores stale %s', async (kind, outcome) => {
  const a = deferred(); const b = deferred(); let count = 0; const signals: AbortSignal[] = [];
  get.mockImplementation((url: string, config: any) => {
    if (url === '/admin/chat-conversations') return Promise.resolve({ data: { items: [conversation(1), conversation(2)] } });
    if (url === '/admin/inventory-scan-jobs') return Promise.resolve({ data: { items: [scan('a'), scan('b')] } });
    signals.push(config.signal); return ++count === 1 ? a.promise : b.promise;
  });
  await mount(<AIConversations />); const label = kind === 'conversation' ? '查看对话' : '查看详情';
  await click(label); await click('关闭'); expect(host.querySelector('[role="dialog"]')).toBeNull(); expect(signals[0].aborted).toBe(true);
  await click(label, 1); await act(async () => { if (outcome === 'resolve') a.resolve(kind === 'conversation' ? detail(1) : scan('a')); else a.reject(new Error('old')); });
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.querySelector('[role="dialog"]')!.textContent).toContain(kind === 'conversation' ? '正在加载对话' : '正在加载识别详情');
  expect(host.querySelector('[role="dialog"]')!.textContent).not.toContain(kind === 'conversation' ? 'Detail 1' : 'Food a');
  await act(async () => b.resolve(kind === 'conversation' ? detail(2) : scan('b')));
  expect(host.querySelector('[role="dialog"]')!.textContent).toContain(kind === 'conversation' ? 'Detail 2' : 'Food b');
});
it.each(['conversation', 'scan'] as const)('shows %s detail error and retry, rejecting wrong-record payloads', async kind => {
  let attempts = 0;
  get.mockImplementation((url: string) => {
    if (url === '/admin/chat-conversations') return Promise.resolve({ data: { items: [conversation(1)] } });
    if (url === '/admin/inventory-scan-jobs') return Promise.resolve({ data: { items: [scan('a')] } });
    attempts++; if (attempts === 1) return Promise.reject(new Error('offline'));
    return Promise.resolve({ data: kind === 'conversation' ? detail(attempts === 2 ? 2 : 1) : scan(attempts === 2 ? 'b' : 'a') });
  });
  await mount(<AIConversations />); await click(kind === 'conversation' ? '查看对话' : '查看详情'); expect(host.querySelector('[role="alert"]')).not.toBeNull();
  await click('重新加载'); expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(host.querySelector('[role="dialog"]')!.textContent).not.toContain(kind === 'conversation' ? 'Detail 2' : 'Food b');
  await click('重新加载'); expect(host.querySelector('[role="alert"]')).toBeNull(); expect(host.textContent).toContain(kind === 'conversation' ? 'Detail 1' : 'Food a');
});
it('aborts all pending list and detail scopes on unmount', async () => {
  const requests: { signal: AbortSignal; pending: ReturnType<typeof deferred> }[] = [];
  get.mockImplementation((url: string, config: any) => {
    if (requests.length < 2) { const pending = deferred(); requests.push({ signal: config.signal, pending }); pending.resolve({ items: url.includes('chat') ? [conversation(1)] : [scan('a')] }); return pending.promise; }
    const pending = deferred(); requests.push({ signal: config.signal, pending }); return pending.promise;
  });
  await mount(<AIConversations />); await click('查看对话'); await click('查看详情'); await click('刷新');
  await act(async () => root.render(null)); expect(requests.every(r => r.signal.aborted)).toBe(true);
  await act(async () => requests.slice(2).forEach(r => r.pending.reject(new Error('after unmount')))); expect(host.textContent).toBe('');
});
it('aborts health loading on unmount and supports failure retry', async () => {
  const pending = deferred(); let signal: AbortSignal | undefined; let count = 0;
  get.mockImplementation((url: string, config: any) => {
    if (url === '/admin/users') return Promise.resolve({ data: { items: [user(1)] } });
    signal = config.signal; return ++count === 1 ? Promise.reject(new Error('offline')) : pending.promise;
  });
  await mount(<Users />); await click('Person 1'); await click('健康与饮食档案'); expect(host.textContent).toContain('健康与饮食档案加载失败'); await click('重新加载');
  await act(async () => root.render(null)); expect(signal!.aborted).toBe(true); await act(async () => pending.resolve(profile(1))); expect(host.textContent).toBe('');
});
it('rejects wrong-user health payload without a false empty state and retries the owner', async () => {
  let count = 0;
  get.mockImplementation((url: string) => Promise.resolve({ data: url === '/admin/users' ? { items: [user(1)] } : profile(++count === 1 ? 2 : 1) }));
  await mount(<Users />); await click('Person 1'); await click('健康与饮食档案');
  expect(host.textContent).toContain('健康与饮食档案加载失败'); expect(host.textContent).not.toContain('该用户尚未建档'); expect(host.textContent).not.toContain('Profile 2');
  await click('重新加载'); expect(host.textContent).toContain('Profile 1'); expect(host.textContent).not.toContain('健康与饮食档案加载失败');
});
it('keeps a valid empty health profile distinct from request failure', async () => {
  get.mockImplementation((url: string) => Promise.resolve({ data: url === '/admin/users' ? { items: [user(1)] } : { user_id: 1, profile: null, latest_tracking: null, tracking_count: 0 } }));
  await mount(<Users />); await click('Person 1'); await click('健康与饮食档案'); expect(host.textContent).toContain('该用户尚未建档'); expect(host.textContent).not.toContain('健康与饮食档案加载失败');
});
