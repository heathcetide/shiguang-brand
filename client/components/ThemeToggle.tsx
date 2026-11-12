import { Text, TouchableOpacity } from 'react-native';
import FontAwesome6 from '@/components/ThemedFontAwesome6';
import { useThemePreference, type ThemePreference } from '@/contexts/ThemeContext';

const OPTIONS = [
  { value: 'system', label: '跟随系统', icon: 'circle-half-stroke' },
  { value: 'light', label: '浅色', icon: 'sun' },
  { value: 'dark', label: '深色', icon: 'moon' },
] as const;

/** Compact, signed-out-accessible shortcut; settings also provides direct selection. */
export function ThemeToggle() {
  const { preference, setPreference } = useThemePreference();
  const index = OPTIONS.findIndex(option => option.value === preference);
  const current = OPTIONS[index] ?? OPTIONS[0];
  const next = OPTIONS[(index + 1) % OPTIONS.length];
  return <TouchableOpacity
    accessibilityRole="button"
    accessibilityLabel={`外观：${current.label}`}
    accessibilityHint={`点击切换为${next.label}，依次切换浅色、深色和跟随系统`}
    onPress={() => void setPreference(next.value as ThemePreference)}
    className="min-h-11 flex-row items-center gap-2 rounded-full border border-line bg-surface px-3"
  >
    <FontAwesome6 name={current.icon} size={13} colorClassName="accent-brand" />
    <Text className="text-xs font-medium text-ink">{current.label}</Text>
  </TouchableOpacity>;
}
