// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ThemeSwitch } from './ThemeSwitch';
import { applyTheme, isThemePreference, readThemePreference, THEME_STORAGE_KEY } from '../hooks/useAdminTheme';

let dark = false;
let changes: EventTarget;
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  dark = false;
  changes = new EventTarget();
  vi.stubGlobal('matchMedia', () => ({
    get matches() { return dark; },
    addEventListener: changes.addEventListener.bind(changes),
    removeEventListener: changes.removeEventListener.bind(changes),
  }));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  localStorage.clear(); document.documentElement.classList.remove('dark');
});
async function choose(value: string) {
  const select = container.querySelector('select')!;
  await act(async () => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); });
}
it('restores dark mode, persists changes and applies matching native control colors', async () => {
  localStorage.setItem(THEME_STORAGE_KEY, 'dark');
  applyTheme(readThemePreference());
  expect(document.documentElement.classList.contains('dark')).toBe(true);
  await act(async () => root.render(<ThemeSwitch />));
  expect(container.querySelector('select')!.value).toBe('dark');
  await choose('light');
  expect(document.documentElement.style.colorScheme).toBe('light');
  expect(document.documentElement.classList.contains('dark')).toBe(false);
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
});
it('follows system changes only in system mode', async () => {
  await act(async () => root.render(<ThemeSwitch />));
  await act(async () => { dark = true; changes.dispatchEvent(new Event('change')); });
  expect(document.documentElement.dataset.theme).toBe('dark');
  await choose('light');
  await act(async () => { changes.dispatchEvent(new Event('change')); });
  expect(document.documentElement.dataset.theme).toBe('light');
  await choose('system');
  expect(document.documentElement.dataset.theme).toBe('dark');
});
it('reacts to theme changes in another tab', async () => {
  await act(async () => root.render(<ThemeSwitch />));
  await act(async () => window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: 'dark' })));
  expect(container.querySelector('select')!.value).toBe('dark');
  expect(document.documentElement.dataset.theme).toBe('dark');
});
it('ignores invalid stored modes and remains usable with blocked storage', async () => {
  localStorage.setItem(THEME_STORAGE_KEY, 'sepia');
  expect(readThemePreference()).toBe('system');
  expect(isThemePreference('blue')).toBe(false);
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
  await act(async () => root.render(<ThemeSwitch />));
  await choose('dark');
  expect(document.documentElement.dataset.theme).toBe('dark');
});
