import { type ReactNode } from 'react';
import { Text, View } from 'react-native';
import { cn } from './cn';
import { ui } from './tokens';

type PanelProps = {
  children: ReactNode;
  className?: string;
  title?: string;
  description?: string;
  action?: ReactNode;
  padded?: boolean;
};

/** Bordered content panel — structure container, not a decorative card. */
export function Panel({
  children,
  className,
  title,
  description,
  action,
  padded = true,
}: PanelProps) {
  return (
    <View className={cn('overflow-hidden', ui.radius.panel, ui.surface.panel, className)}>
      {(title || action) ? (
        <View className="flex-row items-start justify-between gap-3 border-b border-line px-4 py-3">
          <View className="min-w-0 flex-1">
            {title ? <Text className="text-sm font-semibold text-ink">{title}</Text> : null}
            {description ? <Text className="mt-0.5 text-xs text-copy-muted">{description}</Text> : null}
          </View>
          {action}
        </View>
      ) : null}
      <View className={padded ? 'px-4 py-3' : undefined}>{children}</View>
    </View>
  );
}
