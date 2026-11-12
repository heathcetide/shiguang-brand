// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import api from '../services/api';
import Login from './Login';
import ChangePassword from './ChangePassword';

vi.mock('../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const values = new Map<string, string>();
  const storage: Storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, String(value)); },
    removeItem: key => { values.delete(key); },
    clear: () => { values.clear(); },
    key: index => Array.from(values.keys())[index] ?? null,
    get length() { return values.size; },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
  vi.mocked(api.get).mockReset().mockResolvedValue({ data: { role: 'admin' } });
  vi.mocked(api.post).mockReset().mockResolvedValue({ data: { token: 'test-token' } });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function LocationProbe() {
  return <output data-location>{useLocation().pathname}</output>;
}
async function visit(path = '/login') {
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}>
    <LocationProbe />
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/change-password" element={<ChangePassword />} />
      <Route path="/admin" element={<p>管理工作台</p>} />
    </Routes>
  </MemoryRouter>));
}
async function fill(selector: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(selector)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit() {
  await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
}
async function fillLogin() {
  await fill('#admin-username', '  administrator  ');
  await fill('#admin-password', 'example-password');
}

it('shows the current brand and logo on the admin entry', async () => {
  await visit();
  expect(document.title).toBe('管理员登录｜拾味日常');
  expect(container.querySelector('[aria-label="拾味日常管理控制台"]')).not.toBeNull();
  expect(container.querySelector('.admin-auth-brand')?.textContent).toContain('SHIWEI DAILY');
  expect(container.querySelector('.admin-auth-brand img')?.getAttribute('src')).toContain('shiwei-daily-20261110');
  expect(container.querySelector('.admin-auth-mobile-brand')?.textContent).toContain('拾味日常');
});

it('provides associated labels, autofill hints and a non-submitting password visibility toggle', async () => {
  await visit();
  expect(container.querySelector('label[for="admin-username"]')?.textContent).toBe('管理员账号');
  expect(container.querySelector('#admin-username')?.getAttribute('autocomplete')).toBe('username');
  const password = container.querySelector<HTMLInputElement>('#admin-password')!;
  expect(password.autocomplete).toBe('current-password');
  await fill('#admin-password', 'visible-example');
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="显示密码"]')!.click());
  expect(password.type).toBe('text');
  expect(password.value).toBe('visible-example');
  expect(container.querySelector('[aria-label="隐藏密码"]')?.getAttribute('aria-pressed')).toBe('true');
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="隐藏密码"]')!.click());
  expect(password.type).toBe('password');
  expect(api.post).not.toHaveBeenCalled();
});

it('preserves the login payload and verifies the admin role before storing a session', async () => {
  await visit();
  await fillLogin();
  await submit();
  expect(api.post).toHaveBeenCalledWith('/auth/login', { identifier: 'administrator', password: 'example-password' });
  expect(api.get).toHaveBeenCalledWith('/auth/me', { headers: { Authorization: 'Bearer test-token' } });
  expect(localStorage.getItem('adminToken')).toBe('test-token');
  expect(container.querySelector('[data-location]')?.textContent).toBe('/admin');
});

it('rejects a non-admin role without saving the returned token', async () => {
  vi.mocked(api.get).mockResolvedValue({ data: { role: 'user' } });
  await visit();
  await fillLogin();
  await submit();
  expect(localStorage.getItem('adminToken')).toBeNull();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('您没有管理权限');
  expect(container.querySelector('[data-location]')?.textContent).toBe('/login');
});

it('keeps the initial-password change flow after an administrator logs in', async () => {
  vi.mocked(api.get).mockResolvedValue({ data: { role: 'admin', must_change_password: true } });
  await visit();
  await fillLogin();
  await submit();
  expect(container.querySelector('[data-location]')?.textContent).toBe('/change-password');
  expect(container.querySelector('h1')?.textContent).toBe('首次登录安全设置');
});

it('lets an administrator skip the password change and enter the console', async () => {
  localStorage.setItem('adminToken', 'skip-test-token');
  await visit('/change-password');
  const skip = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('稍后修改'));
  expect(skip).toBeTruthy();
  await act(async () => {
    skip!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  expect(localStorage.getItem('adminPasswordChangeDeferred')).toBe('1');
  expect(container.querySelector('[data-location]')?.textContent).toBe('/admin');
});

it('honors a deferred password-change preference on the next login', async () => {
  localStorage.setItem('adminPasswordChangeDeferred', '1');
  vi.mocked(api.get).mockResolvedValue({ data: { role: 'admin', must_change_password: true } });
  await visit();
  await fillLogin();
  await submit();
  expect(container.querySelector('[data-location]')?.textContent).toBe('/admin');
});

it('shows server login errors in an accessible alert and re-enables the form', async () => {
  vi.mocked(api.post).mockRejectedValue({ response: { data: { error: '账号或密码错误' } } });
  await visit();
  await fillLogin();
  await submit();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('账号或密码错误');
  expect(container.querySelector('form')?.getAttribute('aria-describedby')).toBe('login-error');
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
  expect(api.get).not.toHaveBeenCalled();
});

it('keeps the expired-session explanation', async () => {
  await visit('/login?reason=unauthenticated');
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('登录会话已失效');
});

it('does not send a password change when confirmation differs', async () => {
  await visit('/change-password');
  const fields = container.querySelectorAll('input');
  await fill('input[autocomplete="current-password"]', 'old-example');
  await fill('input[autocomplete="new-password"]', 'new-example1');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(fields[2], 'different-example');
    fields[2].dispatchEvent(new Event('input', { bubbles: true }));
  });
  await submit();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('两次输入的新密码不一致');
  expect(api.post).not.toHaveBeenCalled();
});

it('clears the old session after a password change and shows the login confirmation', async () => {
  localStorage.setItem('adminToken', 'old-test-token');
  await visit('/change-password');
  const fields = container.querySelectorAll('input');
  await act(async () => {
    ['old-example', 'new-example1', 'new-example1'].forEach((value, index) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(fields[index], value);
      fields[index].dispatchEvent(new Event('input', { bubbles: true }));
    });
  });
  await submit();
  expect(api.post).toHaveBeenCalledWith('/auth/change-password', { currentPassword: 'old-example', newPassword: 'new-example1' });
  expect(localStorage.getItem('adminToken')).toBeNull();
  expect(container.querySelector('[data-location]')?.textContent).toBe('/login');
  expect(container.querySelector('[role="status"]')?.textContent).toContain('密码已更新');
});
