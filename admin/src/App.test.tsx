// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Outlet, useLocation } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import api from './services/api';

vi.mock('./services/api', () => ({ default: { get: vi.fn() } }));
vi.mock('./layout/AdminLayout', () => ({ default: () => <main><Outlet /></main> }));
vi.mock('./pages/Login', () => ({ default: () => <h1>管理后台登录</h1> }));
vi.mock('./pages/Dashboard', () => ({ default: () => <h1>后台工作台</h1> }));
vi.mock('./pages/Users', () => ({ default: () => <h1>用户管理</h1> }));
vi.mock('./pages/AdminNotFound', () => ({ default: () => <h1>未找到管理页面</h1> }));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const values = new Map<string, string>();
  const storage: Storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, String(value)); },
    removeItem: (key) => { values.delete(key); },
    clear: () => { values.clear(); },
    key: (index) => Array.from(values.keys())[index] ?? null,
    get length() { return values.size; },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
  vi.mocked(api.get).mockReset();
  vi.mocked(api.get).mockResolvedValue({ data: { role: 'admin' } });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
});

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

async function visit(path: string) {
  await act(async () => root.render(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      <App />
    </MemoryRouter>,
  ));
}

function currentPath() {
  return container.querySelector('[data-testid="location"]')?.textContent;
}

it('opens the admin login from the root when signed out', async () => {
  await visit('/');
  await vi.waitFor(() => expect(container.querySelector('h1')?.textContent).toBe('管理后台登录'));
  expect(currentPath()).toBe('/login');
  expect(api.get).not.toHaveBeenCalled();
});

it('opens the workbench from the root after validating the admin session', async () => {
  localStorage.setItem('adminToken', 'test-admin-token');
  await visit('/');
  await vi.waitFor(() => expect(container.querySelector('h1')?.textContent).toBe('后台工作台'));
  expect(currentPath()).toBe('/admin');
  expect(api.get).toHaveBeenCalledWith('/auth/me');
});

it('clears an expired token instead of exposing the workbench', async () => {
  localStorage.setItem('adminToken', 'expired-token');
  vi.mocked(api.get).mockRejectedValue({ response: { status: 401 } });
  await visit('/');
  await vi.waitFor(() => expect(currentPath()).toBe('/login'));
  expect(api.get).toHaveBeenCalledWith('/auth/me');
  expect(localStorage.getItem('adminToken')).toBeNull();
  expect(container.textContent).not.toContain('后台工作台');
});

it('rejects an ordinary user session at the admin entry', async () => {
  localStorage.setItem('adminToken', 'ordinary-user-token');
  vi.mocked(api.get).mockResolvedValue({ data: { role: 'user' } });
  await visit('/');
  await vi.waitFor(() => expect(currentPath()).toBe('/login'));
  expect(api.get).toHaveBeenCalledWith('/auth/me');
  expect(localStorage.getItem('adminToken')).toBeNull();
  expect(container.textContent).not.toContain('后台工作台');
});

it.each(['/changelog', '/journal?id=onion-in-the-fridge', '/privacy', '/terms', '/unknown'])(
  'redirects the former public or unknown path %s into the admin workbench',
  async (path) => {
    localStorage.setItem('adminToken', 'test-admin-token');
    await visit(path);
    await vi.waitFor(() => expect(container.querySelector('h1')?.textContent).toBe('后台工作台'));
    expect(currentPath()).toBe('/admin');
    expect(api.get).toHaveBeenCalledWith('/auth/me');
  },
);

it('keeps management deep links available to administrators', async () => {
  localStorage.setItem('adminToken', 'test-admin-token');
  await visit('/admin/users');
  await vi.waitFor(() => expect(container.querySelector('h1')?.textContent).toBe('用户管理'));
  expect(currentPath()).toBe('/admin/users');
});

it('keeps management deep links protected when signed out', async () => {
  await visit('/admin/users');
  await vi.waitFor(() => expect(container.querySelector('h1')?.textContent).toBe('管理后台登录'));
  expect(currentPath()).toBe('/login');
  expect(api.get).not.toHaveBeenCalled();
});

it('keeps the admin not-found page for the removed website settings route', async () => {
  localStorage.setItem('adminToken', 'test-admin-token');
  await visit('/admin/site-settings');
  await vi.waitFor(() => expect(container.querySelector('h1')?.textContent).toBe('未找到管理页面'));
  expect(currentPath()).toBe('/admin/site-settings');
});
