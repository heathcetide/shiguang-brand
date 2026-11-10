import React, { useState, useMemo, useRef, useEffect, createElement } from 'react';
import { 
  View, 
  Text, 
  TouchableOpacity, 
  StyleSheet, 
  Keyboard,
  Platform,
  ViewStyle,
  TextStyle
} from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import dayjs from 'dayjs';
import FontAwesome6 from '@/components/ThemedFontAwesome6';
import { useAppThemeColors } from '@/hooks/useAppThemeColors';
import { useThemePreference } from '@/contexts/ThemeContext';

// --------------------------------------------------------
// 1. 配置 Dayjs 
// --------------------------------------------------------
// 即使服务端返回 '2023-10-20T10:00:00Z' (UTC)，
// dayjs(utcString).format() 会自动转为手机当前的本地时区显示。
// 如果需要传回给后端，我们再转回 ISO 格式。

interface SmartDateInputProps {
  disabled?: boolean;
  accessibilityLabel?: string;
  label?: string;           // 表单标题 (可选)
  value?: string | null;    // 服务端返回的时间字符串 (ISO 8601, 带 T)
  onChange: (isoDate: string) => void; // 回调给父组件的值，依然是标准 ISO 字符串
  placeholder?: string;
  mode?: 'date' | 'time' | 'datetime'; // 支持日期、时间、或两者
  displayFormat?: string;   // UI展示的格式，默认 YYYY-MM-DD
  error?: string;           // 错误信息
  
  // 样式自定义（可选）
  containerStyle?: ViewStyle;        // 外层容器样式
  inputStyle?: ViewStyle;            // 输入框样式
  textStyle?: TextStyle;             // 文字样式
  labelStyle?: TextStyle;            // 标签样式
  placeholderTextStyle?: TextStyle;  // 占位符文字样式
  errorTextStyle?: TextStyle;        // 错误信息文字样式
  iconColor?: string;                // 图标颜色
  iconSize?: number;                 // 图标大小
}

export const SmartDateInput = ({ 
  label,
  accessibilityLabel,
  disabled = false,
  value, 
  onChange, 
  placeholder = '请选择',
  mode = 'date',
  displayFormat,
  error,
  containerStyle,
  inputStyle,
  textStyle,
  labelStyle,
  placeholderTextStyle,
  errorTextStyle,
  iconColor,
  iconSize = 18
}: SmartDateInputProps) => {
  const [isDatePickerVisible, setDatePickerVisibility] = useState(false);
  const pickerSession = useRef(0);
  const pickerOpen = useRef(false);
  const session = pickerSession.current;
  useEffect(() => () => { pickerOpen.current = false; pickerSession.current++; }, []);
  if (disabled && isDatePickerVisible) setDatePickerVisibility(false);
  useEffect(() => { if (disabled) pickerOpen.current = false; }, [disabled]);
  const colors = useAppThemeColors();
  const { resolvedTheme } = useThemePreference();
  const styles = createStyles(colors);

  // 默认展示格式
  const format = displayFormat || (mode === 'time' ? 'HH:mm' : 'YYYY-MM-DD');

  // --------------------------------------------------------
  // 2. 核心：数据转换逻辑 
  // --------------------------------------------------------
  
  // 解析服务端值，确保无效值不传给控件；time 模式兼容仅时间字符串
  const parsedValue = useMemo(() => {
    if (!value) return null;
    if (mode === 'time' && /^\d{2}:\d{2}$/.test(value)) {
      return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? dayjs(`1970-01-01T${value}`) : null;
    }

    const direct = dayjs(value);
    if (direct.isValid()) return direct;

    if (mode === 'time') {
      const timeOnly = dayjs(`1970-01-01T${value}`);
      if (timeOnly.isValid()) return timeOnly;
    }

    return null;
  }, [value, mode]);

  // A. 将字符串转为 JS Date 对象给控件使用
  // 如果 value 是空或无效，回退到当前时间
  const dateObjectForPicker = useMemo(() => {
    return parsedValue ? parsedValue.toDate() : new Date();
  }, [parsedValue]);

  // B. 将 Date 对象转为展示字符串
  const displayString = useMemo(() => {
    if (!parsedValue) return '';
    return parsedValue.format(format);
  }, [parsedValue, format]);

  // --------------------------------------------------------
  // 3. 核心：交互逻辑 (解决键盘遮挡/无法收起)
  // --------------------------------------------------------

  const showDatePicker = () => {
    // 【关键点】打开日期控件前，必须强制收起键盘！
    // 否则键盘会遮挡 iOS 的底部滚轮，或者导致 Android 焦点混乱
    if (disabled || pickerOpen.current) return;
    pickerOpen.current = true;
    pickerSession.current++;
    Keyboard.dismiss(); 
    setDatePickerVisibility(true);
  };

  const hideDatePicker = () => {
    pickerOpen.current = false;
    setDatePickerVisibility(false);
  };

  const handleConfirm = (date: Date) => {
    hideDatePicker();
    // 采用带本地偏移的 ISO 字符串，避免 date 模式在非 UTC 时区出现跨天
    const serverString = dayjs(date).format(format);
    onChange(serverString);
  };

  const handleNativeChange = (event: DateTimePickerEvent, date?: Date) => {
    if (!pickerOpen.current || session !== pickerSession.current || disabled) return;
    // Android picker closes after either confirmation or dismissal. Keeping
    // this controlled here avoids the extra modal wrapper that crashed in
    // production builds when the kitchenware form re-rendered.
    if (Platform.OS === 'android') hideDatePicker();
    if (event.type !== 'set' || !date || !Number.isFinite(date.getTime())) return;
    handleConfirm(date);
  };

  // 根据 mode 选择图标
  const iconName = mode === 'time' ? 'clock' : 'calendar';

  if (Platform.OS === 'web') {
    return (
      <View style={[styles.container, containerStyle]}>
        {label && <Text style={[styles.label, labelStyle]}>{label}</Text>}
        <View style={[styles.inputBox, error ? styles.inputBoxError : null, inputStyle]}>
          {createElement('input', {
            type: mode === 'time' ? 'time' : 'date',
            disabled,
            'aria-label': accessibilityLabel || label || placeholder,
            'aria-invalid': !!error,
            value: displayString || '',
            onChange: (e: any) => {
              if (disabled) return;
              if (e.target.value === '') {
                onChange('');
                return;
              }
              if (e.target.value) {
                if (mode === 'time') {
                  if (/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(e.target.value)) onChange(e.target.value);
                  return;
                }
                const d = dayjs(e.target.value);
                if (d.isValid()) {
                  onChange(d.format(format));
                }
              }
            },
            style: {
              flex: 1,
              minWidth: 0,
              colorScheme: resolvedTheme,
              borderWidth: 0,
              outline: 'none',
              backgroundColor: 'transparent',
              fontSize: 16,
              color: colors.ink,
              fontFamily: 'inherit',
            }
          })}
          <FontAwesome6 
            name={iconName} 
            size={iconSize} 
            color={iconColor || (value ? colors.ink : colors['copy-muted'])}
            style={styles.icon}
          />
        </View>
        {error && <Text style={[styles.errorText, errorTextStyle]}>{error}</Text>}
      </View>
    );
  }

  return (
    <View style={[styles.container, containerStyle]}>
      {/* 标题 */}
      {label && <Text style={[styles.label, labelStyle]}>{label}</Text>}

      {/* 
         这里用 TouchableOpacity 模拟 Input。
         模拟组件永远不会唤起键盘。
      */}
      <TouchableOpacity 
        style={[
          styles.inputBox, 
          error ? styles.inputBoxError : null,
          inputStyle
        ]} 
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel || label || placeholder}
        accessibilityValue={{ text: displayString || placeholder }}
        accessibilityState={{ disabled, expanded: isDatePickerVisible }}
        onPress={showDatePicker}
        activeOpacity={0.7}
      >
        <Text 
          style={[
            styles.text,
            textStyle,
            !value && styles.placeholder,
            !value && placeholderTextStyle
          ]}
        >
          {displayString || placeholder}
        </Text>
        
        <FontAwesome6 
          name={iconName} 
          size={iconSize} 
          color={iconColor || (value ? colors.ink : colors['copy-muted'])}
          style={styles.icon}
        />
      </TouchableOpacity>
      
      {error && <Text style={[styles.errorText, errorTextStyle]}>{error}</Text>}

      {isDatePickerVisible ? (
        <View style={Platform.OS === 'ios' ? styles.iosPicker : undefined}>
          <DateTimePicker
            value={dateObjectForPicker}
            mode={mode}
            is24Hour={mode === 'time'}
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            locale="zh-CN"
            themeVariant={resolvedTheme}
            onChange={handleNativeChange}
          />
          {Platform.OS === 'ios' ? (
            <TouchableOpacity onPress={hideDatePicker} style={styles.iosDoneButton}>
              <Text style={styles.iosDoneText}>完成</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </View>
  );
};

// 设计样式
const createStyles = (colors: ReturnType<typeof useAppThemeColors>) => StyleSheet.create({
  container: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.ink,
    marginBottom: 8,
    marginLeft: 2,
  },
  inputBox: {
    minHeight: 52,
    paddingVertical: 12,
    backgroundColor: colors.surface,
    borderRadius: 12, // 更圆润的角
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: colors.line,
    // 增加轻微阴影提升层次感 (iOS)
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    // Android
    elevation: 1,
  },
  inputBoxError: {
    borderColor: colors.critical,
    backgroundColor: colors['danger-soft'],
  },
  text: {
    fontSize: 16,
    color: colors.ink,
    flex: 1,
  },
  placeholder: {
    color: colors['copy-muted'],
  },
  icon: {
    marginLeft: 12,
  },
  errorText: {
    marginTop: 4,
    marginLeft: 2,
    fontSize: 12,
    color: colors.critical,
  },
  iosPicker: {
    marginTop: 8,
    overflow: 'hidden',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  iosDoneButton: {
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingVertical: 10,
  },
  iosDoneText: {
    color: colors.brand,
    fontSize: 14,
    fontWeight: '700',
  },
});
