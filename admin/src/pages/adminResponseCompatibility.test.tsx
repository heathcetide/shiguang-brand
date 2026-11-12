// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Users from './Users';
import Notifications from './Notifications';
import api from '../services/api';

vi.mock('../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(api.get);
const post = vi.mocked(api.post);
const user = (id = 1) => ({ id, username: `Test user ${id}`, role: 'user', created_at: '2026-11-11' });
const completeOverview = () => ({
  activeDevices: 0, enabledUsers: 2, campaigns: [], automatic: [],
  metrics: { created: 4, opened: 1, actionClicks: 0, pushSubmitted: 3, pushDelivered: 2, pushFailures: 0 },
  interventionsEnabled: false,
  interventionMetrics: { candidates: 0, action_plan_recipe: 0, visible: 0 },
});
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  get.mockReset(); post.mockReset();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
async function mount(page: ReactNode) { await act(async () => root.render(<MemoryRouter>{page}</MemoryRouter>)); }
function button(label: string) {
  const found = [...host.querySelectorAll('button')].find(item => item.textContent === label || item.getAttribute('aria-label') === label);
  expect(found, label).toBeDefined(); return found!;
}
async function click(label: string) { await act(async () => button(label).click()); }
async function fill(selector: string, value: string) {
  const input = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
  const prototype = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
}
function metric(label: string) { return [...host.querySelectorAll('div')].find(item => item.textContent === label)?.parentElement?.textContent; }

it.each(['items', 'users'])('renders the %s user envelope without crashing and supports search/detail', async key => {
  get.mockResolvedValue({ data: { [key]: [user(), user(2)] } });
  await mount(<Users />);
  expect(host.querySelectorAll('tbody tr')).toHaveLength(2);
  expect(host.querySelector('[role="alert"]')).toBeNull();
  await fill('[aria-label="搜索已加载用户"]', 'Test user 2');
  expect(host.querySelectorAll('tbody tr')).toHaveLength(1);
  await click('Test user 2');
  expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Test user 2');
});
it('preserves cursor pagination and deduplicates users', async () => {
  get.mockResolvedValueOnce({ data: { items: [user()], nextCursor: 'cursor-1' } }).mockResolvedValueOnce({ data: { items: [user(), user(2)], nextCursor: null } });
  await mount(<Users />); await click('加载更多用户');
  expect(get).toHaveBeenLastCalledWith('/admin/users', { params: { pageSize: 50, cursor: 'cursor-1' } });
  expect(host.querySelectorAll('tbody tr')).toHaveLength(2);
  expect(host.textContent).not.toContain('加载更多用户');
});
it.each([null, {}, { items: null }, { items: [null] }, { users: [{ ...user(), username: null }] }, { items: {}, users: [user()] }])('shows a retryable error, not a false empty state, for malformed user data %#', async data => {
  get.mockResolvedValueOnce({ data }).mockResolvedValueOnce({ data: { users: [user()] } });
  await mount(<Users />);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('读取用户失败');
  expect(host.textContent).not.toContain('未找到符合条件的用户');
  await click('重试');
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.querySelectorAll('tbody tr')).toHaveLength(1);
});
it('distinguishes an actual empty user list from a failed request', async () => {
  get.mockResolvedValue({ data: { users: [] } }); await mount(<Users />);
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.textContent).toContain('未找到符合条件的用户');
});
it('retains loaded users if a refresh response is malformed', async () => {
  get.mockResolvedValueOnce({ data: { users: [user()] } }).mockResolvedValueOnce({ data: {} });
  await mount(<Users />); await click('刷新');
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(host.querySelectorAll('tbody tr')).toHaveLength(1);
});

it('renders the Go notification envelope with unavailable metrics, not fabricated zeros', async () => {
  get.mockResolvedValue({ data: { campaigns: [], notifications: [] } }); await mount(<Notifications />);
  expect(host.textContent).toContain('当前接口仅提供部分通知数据');
  expect(metric('30 天创建')).toBe('30 天创建不可用');
  expect(metric('已提交 Expo')).toBe('已提交 Expo不可用');
  expect(host.textContent).toContain('服务端状态不可用');
  expect(host.textContent).toContain('还没有手动发送记录');
  expect(host.textContent).toContain('自动提醒投递记录暂不可用');
  expect(host.textContent).not.toContain('暂无自动提醒投递记录');
  await fill('[placeholder="通知标题"]', 'Test'); await fill('[placeholder="通知内容"]', 'Test body');
  expect(button('发送').disabled).toBe(true); await click('发送'); expect(post).not.toHaveBeenCalled();
});
it('does not relabel per-user inbox entries as notification campaigns', async () => {
  get.mockResolvedValue({ data: { notifications: [{ id: 1, title: 'Inbox entry' }] } }); await mount(<Notifications />);
  expect(host.textContent).toContain('手动通知记录暂不可用');
  expect(host.textContent).not.toContain('还没有手动发送记录');
  expect(host.textContent).not.toContain('Inbox entry');
});
it('renders available campaign records even when overview statistics are missing', async () => {
  get.mockResolvedValue({ data: { campaigns: [{ id: 1, title: 'Saved draft', body: 'Draft body', status: 'draft', createdAt: '2026-11-11' }] } });
  await mount(<Notifications />);
  expect(host.textContent).toContain('Saved draft'); expect(host.textContent).toContain('不可用/不可用 已接受');
});
it('keeps valid zero metrics and the complete Express overview usable', async () => {
  get.mockResolvedValue({ data: completeOverview() }); await mount(<Notifications />);
  expect(host.textContent).not.toContain('当前接口仅提供部分通知数据');
  expect(metric('活跃推送设备')).toBe('活跃推送设备0');
  expect(metric('30 天创建')).toBe('30 天创建4');
  expect(metric('候选数')).toBe('候选数0');
  expect(metric('进入队列的可见候选比例')).toBe('进入队列的可见候选比例暂无数据');
  expect(host.textContent).toContain('服务端已关闭');
  expect(host.textContent).toContain('暂无自动提醒投递记录');
  await fill('[placeholder="通知标题"]', 'Test'); await fill('[placeholder="通知内容"]', 'Test body');
  expect(button('发送').disabled).toBe(false);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  await click('发送'); expect(confirm).toHaveBeenCalledOnce(); expect(post).not.toHaveBeenCalled();
});
it('preserves confirmed sending and reloads the complete overview after success', async () => {
  get.mockResolvedValue({ data: completeOverview() }); post.mockResolvedValue({ data: { ok: true } });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  await mount(<Notifications />);
  await fill('[placeholder="通知标题"]', '  Test  '); await fill('[placeholder="通知内容"]', '  Test body  ');
  await click('发送');
  expect(post).toHaveBeenCalledExactlyOnceWith('/admin/notifications/campaigns', { title: 'Test', body: 'Test body' });
  expect(get).toHaveBeenCalledTimes(2);
  expect(host.querySelector<HTMLInputElement>('[placeholder="通知标题"]')?.value).toBe('');
  expect(button('发送').disabled).toBe(true);
});
it('renders complete campaign and automatic delivery records', async () => {
  get.mockResolvedValue({ data: { ...completeOverview(),
    campaigns: [{ id: 1, title: 'Notice', body: 'Content', status: 'sent', createdAt: '2026-11-11', adminName: 'Operator', successCount: 1, recipientCount: 2, failureCount: 1 }],
    automatic: [{ deliveryDate: '2026-11-11', status: 'accepted', count: 3 }],
  } });
  await mount(<Notifications />);
  expect(host.textContent).toContain('Notice'); expect(host.textContent).toContain('1/2 已接受');
  expect(host.textContent).toContain('1 失败'); expect(host.textContent).toContain('accepted · 3 条');
});
it('handles partial metrics and distinguishes unknown rates from zero', async () => {
  get.mockResolvedValue({ data: { metrics: { created: 0 }, interventionMetrics: { visible: 3 } } }); await mount(<Notifications />);
  expect(metric('30 天创建')).toBe('30 天创建0');
  expect(metric('30 天打开')).toBe('30 天打开不可用');
  expect(metric('进入队列的可见候选比例')).toBe('进入队列的可见候选比例不可用');
});
it.each([null, {}, { campaigns: null }, { campaigns: [null] }, { automatic: {} }, { metrics: null }, { metrics: { created: '0' } }, { interventionMetrics: { visible: null } }])('handles malformed notification data with a recoverable error %#', async data => {
  get.mockResolvedValueOnce({ data }).mockResolvedValueOnce({ data: completeOverview() });
  await mount(<Notifications />);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('通知数据响应格式不正确');
  expect(host.textContent).not.toContain('还没有手动发送记录');
  expect(button('发送').disabled).toBe(true);
  await click('刷新通知数据');
  expect(host.querySelector('[role="alert"]')).toBeNull(); expect(metric('30 天创建')).toBe('30 天创建4');
});
it('clears stale notification data after a failed refresh', async () => {
  get.mockResolvedValueOnce({ data: completeOverview() }).mockRejectedValueOnce(new Error('offline'));
  await mount(<Notifications />); await click('刷新通知数据');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('offline');
  expect(metric('30 天创建')).toBe('30 天创建不可用'); expect(button('发送').disabled).toBe(true);
});
