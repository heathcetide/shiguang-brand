// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useNavigate, type NavigateFunction } from 'react-router';
import { expect, it, vi } from 'vitest';
import AdminLayout from './AdminLayout';

vi.mock('../services/api', () => ({ default: {
  get: vi.fn(async () => ({ data: { role: 'admin', username: 'Admin' } })),
} }));

it('respects manual technical collapse until re-entering from daily management', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  HTMLElement.prototype.scrollTo = () => {};
  const storage = new Map<string, string>();
  const mockStorage: Storage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, val: string) => { storage.set(key, String(val)); },
    removeItem: (key: string) => { storage.delete(key); },
    clear: () => { storage.clear(); },
    key: (index: number) => Array.from(storage.keys())[index] ?? null,
    get length() { return storage.size; },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: mockStorage, configurable: true, writable: true });
  localStorage.clear();
  let navigate!: NavigateFunction;
  function Probe() { navigate = useNavigate(); return <p>Page content</p>; }
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<MemoryRouter initialEntries={['/admin/agent-runs']}><Routes>
      <Route element={<AdminLayout />}>
        {['/admin/agent-runs', '/admin/ai-conversations', '/admin/users'].map(path =>
          <Route key={path} path={path} element={<Probe />} />)}
      </Route>
    </Routes></MemoryRouter>));
    const technical = () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === '技术管理')!;
    const expanded = () => technical().getAttribute('aria-expanded');
    expect(expanded()).toBe('true'); // Initial deep link opens its section.
    await act(async () => technical().click());
    expect(expanded()).toBe('false');
    await act(async () => navigate('?status=failed'));
    expect(expanded()).toBe('false');
    await act(async () => navigate('/admin/ai-conversations'));
    expect(expanded()).toBe('false');
    await act(async () => navigate('/admin/users'));
    expect(expanded()).toBe('false');
    await act(async () => navigate('/admin/agent-runs?status=failed'));
    expect(expanded()).toBe('true');
    expect(container.querySelector('a[href="/admin/ai-conversations"][aria-current="page"]')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    localStorage.clear();
  }
});
