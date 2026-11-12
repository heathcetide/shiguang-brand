import { useEffect, useState } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';
export const THEME_STORAGE_KEY = 'shiwei.admin.theme';
export const isThemePreference = (value: unknown): value is ThemePreference =>
  value === 'system' || value === 'light' || value === 'dark';

export function readThemePreference(): ThemePreference {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(value) ? value : 'system';
  } catch { return 'system'; }
}

export function applyTheme(preference: ThemePreference) {
  const systemDark = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const resolved = preference === 'system' ? systemDark ? 'dark' : 'light' : preference;
  document.documentElement.classList.toggle('dark', resolved === 'dark');
  document.documentElement.style.colorScheme = resolved;
  document.documentElement.dataset.theme = resolved;
  return resolved;
}

export function useAdminTheme() {
  const [preference, setPreferenceState] = useState<ThemePreference>(readThemePreference);
  useEffect(() => {
    applyTheme(preference);
    const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    const onSystemChange = () => { if (preference === 'system') applyTheme('system'); };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
      const next = isThemePreference(event.newValue) ? event.newValue : 'system';
      setPreferenceState(next);
      applyTheme(next);
    };
    media?.addEventListener('change', onSystemChange);
    window.addEventListener('storage', onStorage);
    return () => {
      media?.removeEventListener('change', onSystemChange);
      window.removeEventListener('storage', onStorage);
    };
  }, [preference]);
  const setPreference = (next: ThemePreference) => {
    setPreferenceState(next);
    applyTheme(next);
    try { localStorage.setItem(THEME_STORAGE_KEY, next); }
    catch { /* Switching remains functional when browser storage is disabled. */ }
  };
  return { preference, setPreference };
}
