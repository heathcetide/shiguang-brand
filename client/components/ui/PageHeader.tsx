import { type ReactNode } from 'react';
import { Text, View } from 'react-native';
import { cn } from './cn';
import { ui } from './tokens';

type PageHeaderProps = {
  title: string;
  right?: ReactNode;
  left?: ReactNode;
  bordered?: boolean;
  className?: string;
};

/** Compact page chrome — title left, actions right. */
export function PageHeader({
  title,
  right,
  left,
  bordered = true,
  className,
}: PageHeaderProps) {
  return (
    <View
      className={cn(
        'h-12 flex-row items-center justify-between bg-surface px-4',
        bordered ? 'border-b border-line' : '',
        className,
      )}
    >
      <View className="min-w-0 flex-1 flex-row items-center gap-2">
        {left}
        <Text className={cn(ui.type.pageTitle)} numberOfLines={1}>{title}</Text>
      </View>
      {right ? <View className="flex-row items-center gap-2">{right}</View> : null}
    </View>
  );
}
