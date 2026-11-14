import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { DialogFrame } from './DialogFrame'
import { Button } from '@/components/ui/button'

export function DetailPanel({
  title,
  children,
  onClose,
  dirty = false,
  busy = false,
}: {
  title: string
  children: ReactNode
  onClose: () => void
  dirty?: boolean
  busy?: boolean
}) {
  const close = () => {
    if (!busy) onClose()
  }

  return (
    <DialogFrame
      className="admin-dialog-backdrop"
      aria-label={title}
      onClose={onClose}
      dirty={dirty}
      busy={busy}
    >
      <section className="bg-card text-card-foreground flex h-full w-full max-w-xl flex-col rounded-l-2xl shadow-xl ring-1 ring-foreground/10 sm:max-w-[680px]">
        <header className="border-border flex items-center justify-between gap-3 border-b px-5 py-4">
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="关闭" disabled={busy} onClick={close}>
            <X />
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">{children}</div>
      </section>
    </DialogFrame>
  )
}
