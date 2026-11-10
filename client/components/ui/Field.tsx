import { forwardRef, type ReactNode } from 'react';
import { Text, TextInput, View, type TextInputProps } from 'react-native';
import { cn } from './cn';
import { ui } from './tokens';

type FieldProps = TextInputProps & {
  label?: string;
  hint?: string;
  error?: string;
  startAdornment?: ReactNode;
  endAdornment?: ReactNode;
  containerClassName?: string;
};

/**
 * Form field — light border, no Chromium blue box, no oversized soft padding.
 */
export const Field = forwardRef<TextInput, FieldProps>(function Field(
  {
    label,
    hint,
    error,
    startAdornment,
    endAdornment,
    containerClassName,
    className,
    style,
    ...inputProps
  },
  ref,
) {
  return (
    <View className={cn('gap-1.5', containerClassName)}>
      {label ? <Text className={ui.type.label}>{label}</Text> : null}
      <View
        className={cn(
          'min-h-10 flex-row items-center gap-2 border bg-surface px-3',
          ui.radius.control,
          error ? 'border-critical/40' : 'border-line',
        )}
      >
        {startAdornment}
        <TextInput
          ref={ref}
          className={cn('min-h-10 flex-1 py-2 text-[15px] text-ink outline-none', className)}
          style={[{ outlineStyle: 'none' } as object, style]}
          placeholderTextColorClassName="accent-copy-muted"
          {...inputProps}
        />
        {endAdornment}
      </View>
      {error ? <Text className="text-xs text-critical">{error}</Text> : null}
      {!error && hint ? <Text className="text-xs text-copy-muted">{hint}</Text> : null}
    </View>
  );
});
