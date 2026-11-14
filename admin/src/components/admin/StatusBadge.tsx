import type { ReactNode } from 'react'
import { Check, Circle, Clock3, TriangleAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

const toneIcons = { neutral: Circle, success: Check, warning: Clock3, danger: TriangleAlert } as const
const toneVariant = {
  neutral: 'outline',
  success: 'success',
  warning: 'warning',
  danger: 'destructive',
} as const

export function StatusBadge({ children, tone = 'neutral' }: { children: ReactNode; tone?: keyof typeof toneIcons }) {
  const Icon = toneIcons[tone]
  return (
    <Badge variant={toneVariant[tone]} className="gap-1">
      <Icon aria-hidden="true" />
      {children}
    </Badge>
  )
}
