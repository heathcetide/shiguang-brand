import { StyleSheet } from 'react-native';
import { tv } from 'tailwind-variants';
import { combineStyles } from '../../helpers/internal/utils';

const root = tv({
  base: 'p-4 rounded-xl border border-border shadow-xs overflow-hidden',
  variants: {
    variant: {
      default: 'bg-surface',
      secondary: 'bg-surface-secondary',
      tertiary: 'bg-surface-tertiary',
      transparent: 'bg-transparent shadow-none',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

export const surfaceClassNames = combineStyles({
  root,
});

export const surfaceStyleSheet = StyleSheet.create({
  root: {
    borderCurve: 'continuous',
  },
});
