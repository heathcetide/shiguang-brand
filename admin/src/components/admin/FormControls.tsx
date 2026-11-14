import type { ReactNode, SelectHTMLAttributes, InputHTMLAttributes, ButtonHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/utils/cn'

/** Native select kept for `<option>` compatibility; chrome matches shadcn Input. */
export function AdminSelect({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className={cn('relative inline-flex w-full min-w-[8rem]', className)}>
      <select
        {...props}
        className={cn(
          'border-input bg-background focus-visible:border-ring focus-visible:ring-ring/40 h-8 w-full appearance-none rounded-lg border px-3 pr-8 text-sm outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        {children}
      </select>
      <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-[10px]" aria-hidden="true">
        ▾
      </span>
    </span>
  )
}

export function AdminInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <Input className={className} {...props} />
}

export function AdminTextarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <Textarea className={className} {...props} />
}

export function AdminField({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn('flex min-w-[10rem] flex-col gap-1.5 text-xs font-medium text-foreground', className)}>
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

export function AdminPagination({
  page,
  pageSize,
  total,
  onChange,
  disabled,
}: {
  page: number
  pageSize: number
  total: number
  onChange: (page: number) => void
  disabled?: boolean
}) {
  const pageCount = Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)))
  const safePage = Math.min(Math.max(1, page), pageCount)
  const from = total === 0 ? 0 : (safePage - 1) * pageSize + 1
  const to = Math.min(safePage * pageSize, total)
  return (
    <div className="flex flex-col gap-2 border-t border-border/80 px-1 pt-3 sm:flex-row sm:items-center sm:justify-between" role="navigation" aria-label="分页">
      <span className="text-muted-foreground text-xs">
        显示 {from}–{to} / 共 {total.toLocaleString()} 条 · 第 {safePage} / {pageCount} 页
      </span>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={disabled || safePage <= 1} onClick={() => onChange(safePage - 1)}>
          上一页
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={disabled || safePage >= pageCount} onClick={() => onChange(safePage + 1)}>
          下一页
        </Button>
      </div>
    </div>
  )
}

export function AdminButton({
  variant = 'default',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'danger' }) {
  const mapped = variant === 'primary' ? 'default' : variant === 'danger' ? 'destructive' : 'outline'
  return <Button {...props} variant={mapped} className={className} />
}
