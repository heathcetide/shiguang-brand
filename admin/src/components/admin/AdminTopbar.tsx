import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Menu } from 'lucide-react'
import { ThemeSwitch } from '../ThemeSwitch'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

type Breadcrumb = {
  groupLabel?: string
  pageLabel?: string
  showPage: boolean
}

type AdminTopbarProps = {
  breadcrumb: Breadcrumb
  onOpenMenu: () => void
  trailing?: ReactNode
}

export function AdminTopbar({ breadcrumb, onOpenMenu, trailing }: AdminTopbarProps) {
  return (
    <header className="bg-card/80 supports-[backdrop-filter]:bg-card/70 sticky top-0 z-20 flex h-12 items-center gap-3 border-b border-border px-3 backdrop-blur md:px-5">
      <Button type="button" variant="ghost" size="icon-sm" className="md:hidden" aria-label="打开菜单" onClick={onOpenMenu}>
        <Menu />
      </Button>
      <nav aria-label="面包屑" className="text-muted-foreground flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-sm">
        <Link to="/admin" className="hover:text-foreground shrink-0 transition-colors">工作台</Link>
        {breadcrumb.groupLabel ? (
          <>
            <span className="opacity-40">/</span>
            <span className="truncate">{breadcrumb.groupLabel}</span>
          </>
        ) : null}
        {breadcrumb.showPage ? (
          <>
            <span className="opacity-40">/</span>
            <span className="text-foreground truncate font-medium" aria-current="page">{breadcrumb.pageLabel || '页面'}</span>
          </>
        ) : null}
      </nav>
      <Separator orientation="vertical" className="hidden h-5 sm:block" />
      <div className="flex shrink-0 items-center gap-2">
        <ThemeSwitch />
        {trailing}
      </div>
    </header>
  )
}
