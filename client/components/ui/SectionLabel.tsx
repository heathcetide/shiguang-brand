import { Text } from 'react-native';
import { cn } from './cn';
import { ui } from './tokens';

export function SectionLabel({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return <Text className={cn('mb-2 px-1', ui.type.section, className)}>{children}</Text>;
}
