import type { ReactNode } from 'react';
export function StatusBadge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'success' | 'warning' | 'danger' }) {
  return <span className={`admin-badge admin-badge-${tone}`}>{children}</span>;
}
