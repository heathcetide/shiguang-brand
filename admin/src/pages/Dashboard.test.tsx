// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Dashboard from './Dashboard';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../services/api', () => ({ default: { get } }));
let container: HTMLDivElement;
let root: Root;
let failRuns: boolean;
let failRecipes: boolean;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  failRuns = false;
  failRecipes = false;
  get.mockReset().mockImplementation(async (path: string) => {
    if (path === '/admin/agent-runs') {
      if (failRuns) throw new Error('test run read failure');
      return { data: { statusCounts: [
        { status: 'failed', count: 2 }, { status: 'expired', count: 1 },
        { status: 'awaiting_input', count: 4 }, { status: 'awaiting_approval', count: 3 },
      ] } };
    }
    if (path === '/admin/stats/recent') return { data: { pendingFoods: [{ id: 7, name: '测试食材', author_name: '测试用户' }] } };
    if (path === '/admin/recipes' && failRecipes) throw new Error('test recipe read failure');
    return { data: { items: [] } };
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function render() {
  await act(async () => root.render(<MemoryRouter><Dashboard /></MemoryRouter>));
}
function section(title: string) {
  return Array.from(container.querySelectorAll('section')).find(node => node.querySelector('h2')?.textContent === title)!;
}

it('keeps the four real status counts and their existing diagnostic deep links', async () => {
  await render();
  for (const [status, count] of [['failed', '2'], ['expired', '1'], ['awaiting_input', '4'], ['awaiting_approval', '3']]) {
    expect(container.querySelector(`a[href*="status=${status}"] strong`)?.textContent).toBe(count);
  }
  expect(section('等待用户继续 · 近 7 天').textContent).toContain('不是运行失败');
  expect(get).toHaveBeenCalledWith('/admin/agent-runs', { params: { range: '7d', pageSize: 1 } });
});

it('does not turn a failed first status request into four zero counts', async () => {
  failRuns = true;
  await render();
  expect(container.querySelectorAll('.admin-metric')).toHaveLength(0);
  expect(section('运行异常 · 近 7 天').querySelector('[role="alert"]')?.textContent).toContain('读取失败');
  expect(container.textContent).toContain('测试食材');
});

it('retains real counts and the last updated time when a refresh fails', async () => {
  await render();
  failRuns = true;
  await act(async () => section('运行异常 · 近 7 天').querySelector<HTMLButtonElement>('button')!.click());
  expect(container.querySelector('a[href*="status=failed"] strong')?.textContent).toBe('2');
  expect(section('运行异常 · 近 7 天').textContent).toContain('保留上次读取的数据');
  expect(section('运行异常 · 近 7 天').textContent).toContain('更新于');
});

it('keeps queue failures independent and never manufactures a pending total', async () => {
  failRecipes = true;
  await render();
  expect(section('待审食谱').querySelector('[role="alert"]')).not.toBeNull();
  expect(section('待审食谱').textContent).not.toContain('当前没有该类待处理事项');
  expect(section('待审食材').textContent).toContain('近期待处理 · 最多展示 5 条');
  expect(section('待审食材').textContent).not.toContain('共 1 条');
  expect(container.querySelector('a[href*="status=failed"] strong')?.textContent).toBe('2');
});
