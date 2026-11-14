import type { ReactNode } from 'react'
import type { RemoteState } from '@/hooks/useRemoteSection'
import { Button } from '@/components/ui/button'

export function Section<T>({
  title,
  icon,
  state,
  children,
  action,
}: {
  title: string
  icon?: ReactNode
  state?: RemoteState<T> & { reload: () => void }
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <section className="bg-card text-card-foreground overflow-hidden rounded-xl ring-1 ring-foreground/10">
      <header className="flex flex-row items-center justify-between gap-3 border-b px-4 py-3">
        <h2 className="m-0 flex items-center gap-2 text-sm font-semibold">
          {icon ? <span className="text-primary inline-flex" aria-hidden="true">{icon}</span> : null}
          {title}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {action}
          {state ? (
            <Button type="button" variant="outline" size="sm" onClick={state.reload} disabled={state.loading}>
              刷新
            </Button>
          ) : null}
        </div>
      </header>
      <div className="space-y-3 px-4 py-4">
        {state?.error ? (
          <p role="alert" className="admin-error border-destructive/20 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-sm">
            {state.error}
            {state.data !== null ? ' 当前保留上次读取的数据。' : ''}
          </p>
        ) : null}
        {state?.loading ? <p role="status" className="text-muted-foreground text-sm">正在读取…</p> : null}
        {!state || state.data !== null ? children : null}
        {state?.updatedAt ? (
          <p className="admin-updated text-muted-foreground text-xs">更新于 {new Date(state.updatedAt).toLocaleString('zh-CN')}</p>
        ) : null}
      </div>
    </section>
  )
}
