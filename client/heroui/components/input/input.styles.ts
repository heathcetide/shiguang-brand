import { StyleSheet } from 'react-native';
import { tv } from 'tailwind-variants';
import { combineStyles } from '../../helpers/internal/utils';

const input = tv({
  base: 'py-2.5 px-3 rounded-lg text-foreground text-[15px] font-normal border focus:border-accent outline-none',
  variants: {
    variant: {
      primary: 'bg-field border-border',
      secondary: 'bg-default border-border',
    },
    isInvalid: {
      true: 'border-danger focus:border-danger',
      false: '',
    },
    isDisabled: {
      true: 'opacity-disabled',
      false: '',
    },
  },
  defaultVariants: {
    variant: 'primary',
    isInvalid: false,
    isDisabled: false,
  },
});

const placeholderTextColor = tv({
  base: 'accent-field-placeholder',
});

const inputSelectionColor = tv({
  base: 'accent-accent',
  variants: {
    isInvalid: {
      true: 'accent-danger',
    },
  },
});

export const inputClassNames = combineStyles({
  input,
  inputSelectionColor,
  placeholderTextColor,
});

export const inputStyleSheet = StyleSheet.create({
  borderCurve: {
    borderCurve: 'continuous',
  },
});
