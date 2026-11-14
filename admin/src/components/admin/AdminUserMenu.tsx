import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import { ChevronDown, KeyRound, LogOut } from 'lucide-react'
import { AdminAvatar } from './AdminAvatar'
import { cn } from '@/utils/cn'

type AdminUserMenuProps = {
  name: string
  onLogout: () => void
}

export function AdminUserMenu({ name, onLogout }: AdminUserMenuProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative flex flex-col gap-1.5">
      {open ? (
        <div
          id={menuId}
          role="menu"
          className="bg-card border-border absolute right-0 bottom-[calc(100%+6px)] left-0 z-20 flex flex-col gap-0.5 rounded-xl border p-1 shadow-lg"
        >
          <Link
            to="/change-password"
            role="menuitem"
            className="text-muted-foreground hover:bg-muted hover:text-foreground flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs no-underline transition-colors"
            onClick={() => setOpen(false)}
          >
            <KeyRound size={15} aria-hidden="true" />
            修改密码
          </Link>
          <button
            type="button"
            role="menuitem"
            className="text-destructive hover:bg-destructive/10 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors"
            onClick={onLogout}
          >
            <LogOut size={15} aria-hidden="true" />
            退出登录
          </button>
        </div>
      ) : null}

      <button
        type="button"
        className={cn(
          'hover:bg-foreground/5 flex w-full items-center gap-2.5 rounded-[10px] px-2 py-2 text-left transition-colors',
          open && 'bg-foreground/5',
        )}
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`账户菜单：${name}`}
        onClick={() => setOpen((value) => !value)}
      >
        <AdminAvatar name={name} />
        <span className="min-w-0 flex-1">
          <strong className="text-foreground block truncate text-[13px] font-semibold">{name}</strong>
          <small className="text-muted-foreground block text-[11px]">管理员</small>
        </span>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className={cn('text-muted-foreground shrink-0 transition-transform', open && 'rotate-180')}
        />
      </button>
    </div>
  )
}
