import { Monitor, Moon, Sun } from 'lucide-react';
import { useAdminTheme, type ThemePreference } from '../hooks/useAdminTheme';

export function ThemeSwitch() {
  const { preference, setPreference } = useAdminTheme();
  return <label className="admin-theme-switch">
    {preference === 'dark' ? <Moon size={15} aria-hidden="true" /> : preference === 'light' ? <Sun size={15} aria-hidden="true" /> : <Monitor size={15} aria-hidden="true" />}
    <select aria-label="外观模式" value={preference} onChange={event => setPreference(event.target.value as ThemePreference)}>
      <option value="system">跟随系统</option>
      <option value="light">浅色</option>
      <option value="dark">深色</option>
    </select>
  </label>;
}
