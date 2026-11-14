import type { ReactNode } from 'react'
import { cn } from '@/utils/cn'

export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'bg-card/80 flex flex-col gap-3 rounded-xl p-3 ring-1 ring-foreground/10 sm:flex-row sm:flex-wrap sm:items-end',
        className,
      )}
      role="search"
      aria-label="列表筛选"
    >
      {children}
    </div>
  )
}

export function TableContainer({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn('bg-card overflow-hidden rounded-xl ring-1 ring-foreground/10', className)}
      tabIndex={0}
      role="region"
      aria-label="数据列表"
    >
      {children}
    </div>
  )
}

export function EmptyState({ children = '没有符合条件的记录。', className }: { children?: ReactNode; className?: string }) {
  return <p className={cn('text-muted-foreground px-4 py-12 text-center text-sm', className)}>{children}</p>
}
