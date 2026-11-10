import { type ReactNode } from 'react';
import { ActivityIndicator, Text, type GestureResponderEvent } from 'react-native';
import { Button as HeroButton } from '@/heroui/components/button';
import { cn } from './cn';
import { ui } from './tokens';

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const variantMap = {
  primary: 'primary',
  secondary: 'secondary',
  outline: 'outline',
  ghost: 'ghost',
  danger: 'danger',
} as const;

const sizeMap = {
  sm: 'sm',
  md: 'md',
  lg: 'lg',
} as const;

const sizeClass: Record<Size, string> = {
  sm: `${ui.control.sm} ${ui.radius.control}`,
  md: `${ui.control.md} ${ui.radius.control}`,
  lg: `${ui.control.lg} ${ui.radius.control}`,
};

const labelClass: Record<Variant, string> = {
  primary: 'text-xs font-semibold text-white',
  secondary: 'text-xs font-semibold text-brand-strong',
  outline: 'text-xs font-semibold text-ink',
  ghost: 'text-xs font-medium text-copy-muted',
  danger: 'text-xs font-semibold text-white',
};

const variantClass: Record<Variant, string> = {
  primary: 'bg-brand-fill border border-brand-fill',
  secondary: 'bg-brand-soft border border-transparent',
  outline: 'bg-surface border border-line',
  ghost: 'bg-transparent border border-transparent',
  danger: 'bg-critical-fill border border-critical-fill',
};

export type ButtonProps = {
  children: ReactNode;
  onPress?: (event: GestureResponderEvent) => void;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  accessibilityLabel?: string;
};

/**
 * Product Button — wraps HeroUI Native Button with denser, less playful defaults.
 */
export function Button({
  children,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  className,
  accessibilityLabel,
}: ButtonProps) {
  const busy = disabled || loading;

  return (
    <HeroButton
      variant={variantMap[variant]}
      size={sizeMap[size]}
      isDisabled={busy}
      feedbackVariant="none"
      animation="disable-all"
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: busy, busy: loading }}
      className={cn(sizeClass[size], variantClass[variant], 'gap-1.5', className)}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          colorClassName={variant === 'primary' || variant === 'danger' ? 'accent-on-brand' : 'accent-brand'}
        />
      ) : typeof children === 'string' ? (
        <Text className={labelClass[variant]}>{children}</Text>
      ) : (
        children
      )}
    </HeroButton>
  );
}
