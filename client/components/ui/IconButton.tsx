import { type ComponentProps } from 'react';
import { TouchableOpacity } from 'react-native';
import FontAwesome6 from '@/components/ThemedFontAwesome6';
import { cn } from './cn';
import { ui } from './tokens';

type Props = {
  name: ComponentProps<typeof FontAwesome6>['name'];
  onPress?: () => void;
  accessibilityLabel: string;
  size?: 'sm' | 'md';
  tone?: 'default' | 'brand' | 'muted';
  bordered?: boolean;
  className?: string;
};

const toneColor = {
  default: 'accent-ink',
  brand: 'accent-brand',
  muted: 'accent-copy-muted',
} as const;

export function IconButton({
  name,
  onPress,
  accessibilityLabel,
  size = 'md',
  tone = 'default',
  bordered = true,
  className,
}: Props) {
  const dim = size === 'sm' ? 'h-8 w-8' : 'h-9 w-9';
  const iconSize = size === 'sm' ? 12 : 13;

  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      activeOpacity={0.7}
      className={cn(
        dim,
        'items-center justify-center',
        ui.radius.control,
        bordered ? 'border border-line bg-surface' : 'bg-transparent',
        className,
      )}
    >
      <FontAwesome6 name={name} size={iconSize} colorClassName={toneColor[tone]} />
    </TouchableOpacity>
  );
}
