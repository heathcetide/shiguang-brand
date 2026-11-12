import { User } from 'lucide-react';
import { cn } from '../../utils/cn';

type AdminAvatarProps = {
  name: string;
  size?: 'sm' | 'md';
  className?: string;
};

export function AdminAvatar({ name, size = 'md', className }: AdminAvatarProps) {
  return (
    <span
      className={cn(
        'admin-avatar',
        size === 'sm' && 'admin-avatar-sm',
        className,
      )}
      title={name}
      aria-hidden="true"
    >
      <User size={size === 'sm' ? 14 : 18} />
    </span>
  );
}
