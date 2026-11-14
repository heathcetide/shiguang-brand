import { User } from 'lucide-react'
import { cn } from '@/utils/cn'

type AdminAvatarProps = {
  name: string
  size?: 'sm' | 'md'
  className?: string
}

export function AdminAvatar({ name, size = 'md', className }: AdminAvatarProps) {
  return (
    <span
      className={cn(
        'bg-card border-border text-primary grid place-items-center rounded-[10px] border',
        size === 'sm' ? 'size-7 rounded-lg' : 'size-[34px]',
        className,
      )}
      title={name}
      aria-hidden="true"
    >
      <User size={size === 'sm' ? 14 : 18} />
    </span>
  )
}
