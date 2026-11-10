import type { ReactNode } from 'react';
import { Check, Circle, Clock3, TriangleAlert } from 'lucide-react';

const toneIcons = { neutral: Circle, success: Check, warning: Clock3, danger: TriangleAlert };

export function StatusBadge({ children, tone = 'neutral' }: { children: ReactNode; tone?: keyof typeof toneIcons }) {
  const Icon = toneIcons[tone];
  return <span className={`admin-badge admin-badge-${tone}`}><Icon size={11} aria-hidden="true" />{children}</span>;
}
