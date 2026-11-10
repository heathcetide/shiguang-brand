import { type ReactNode } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import FontAwesome6 from '@/components/ThemedFontAwesome6';
import { cn } from './cn';

type ListRowProps = {
  title: string;
  subtitle?: string;
  onPress?: () => void;
  trailing?: ReactNode;
  last?: boolean;
  className?: string;
};

/** Divided list row — settings / service menus without colorful icon tiles. */
export function ListRow({
  title,
  subtitle,
  onPress,
  trailing,
  last = false,
  className,
}: ListRowProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={0.7}
      className={cn(
        'flex-row items-center justify-between px-4 py-3 active:bg-background-secondary',
        last ? '' : 'border-b border-line',
        className,
      )}
    >
      <View className="min-w-0 flex-1 pr-3">
        <Text className="text-sm font-medium text-ink">{title}</Text>
        {subtitle ? <Text className="mt-0.5 text-xs text-copy-muted">{subtitle}</Text> : null}
      </View>
      {trailing ?? <FontAwesome6 name="chevron-right" size={11} colorClassName="accent-copy-muted" />}
    </TouchableOpacity>
  );
}
