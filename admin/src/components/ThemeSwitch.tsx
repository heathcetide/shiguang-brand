import { Monitor, Moon, Sun } from 'lucide-react'
import { useAdminTheme, type ThemePreference } from '../hooks/useAdminTheme'
import { cn } from '@/utils/cn'

export function ThemeSwitch() {
  const { preference, setPreference } = useAdminTheme()
  const Icon = preference === 'dark' ? Moon : preference === 'light' ? Sun : Monitor

  return (
    <label
      className={cn(
        'border-border bg-card text-muted-foreground hover:text-foreground inline-flex h-8 items-center gap-1.5 rounded-lg border px-2 text-xs transition-colors',
      )}
    >
      <Icon size={15} aria-hidden="true" className="shrink-0" />
      <select
        aria-label="外观模式"
        value={preference}
        onChange={(event) => setPreference(event.target.value as ThemePreference)}
        className="bg-transparent text-foreground max-w-[7.5rem] cursor-pointer border-0 py-0.5 pr-1 text-xs outline-none"
      >
        <option value="system">跟随系统</option>
        <option value="light">浅色</option>
        <option value="dark">深色</option>
      </select>
    </label>
  )
}
