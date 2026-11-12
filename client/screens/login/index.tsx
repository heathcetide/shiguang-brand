import React, { useEffect, useRef, useState } from 'react';
import { Animated, Image, Text, TextInput, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import FontAwesome6 from '@/components/ThemedFontAwesome6';
import { useCSSVariable } from 'uniwind';
import { Screen } from '@/components/Screen';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button, IconButton, Panel } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import { useSafeRouter, useSafeSearchParams } from '@/hooks/useSafeRouter';
import { validateAuthReturnTo } from '@/utils/authReturnTo';
import { useAuthTransition } from '@/hooks/useAuthTransition';
import { getDemoLogin } from '@/utils/demoLogin';

const REMEMBERED_IDENTIFIER_KEY = '@remembered_login_identifier';
const REMEMBER_PREFERENCE_KEY = '@remember_login_identifier';

export default function LoginScreen() {
  const [demoLogin] = useState(getDemoLogin);
  const [identifier, setIdentifier] = useState(demoLogin?.identifier ?? '');
  const [password, setPassword] = useState(demoLogin?.password ?? '');
  const { animatedStyle, switchScreen, switching } = useAuthTransition(-1);
  const [rememberIdentifier, setRememberIdentifier] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const identifierWasEdited = useRef(false);
  const passwordWasEdited = useRef(false);
  const rememberWasEdited = useRef(false);
  const rememberWrites = useRef<Promise<void>>(Promise.resolve());
  const { login, sessionMessage } = useAuth();
  const router = useSafeRouter();
  const { returnTo: rawReturnTo } = useSafeSearchParams<{ returnTo?: unknown }>();
  const returnTo = validateAuthReturnTo(rawReturnTo);
  const [brand, muted, critical] = useCSSVariable(['--color-brand', '--color-copy-muted', '--color-critical']) as string[];

  useEffect(() => {
    let active = true;
    void Promise.all([
      AsyncStorage.getItem(REMEMBERED_IDENTIFIER_KEY),
      AsyncStorage.getItem(REMEMBER_PREFERENCE_KEY),
    ]).then(([saved, preference]) => {
      // Slow storage must not overwrite edits or a checkbox click made while loading.
      if (!active || rememberWasEdited.current) return;
      const enabled = preference !== 'false';
      setRememberIdentifier(enabled);
      if (!identifierWasEdited.current) {
        const nextIdentifier = enabled ? saved || demoLogin?.identifier || '' : '';
        setIdentifier(nextIdentifier);
        // Keep demo password only when the visible identifier matches the demo account.
        if (!passwordWasEdited.current) {
          const matchesDemo = Boolean(demoLogin?.identifier)
            && nextIdentifier.trim().toLowerCase() === demoLogin.identifier.trim().toLowerCase();
          if (matchesDemo) setPassword(demoLogin.password);
          else if (!enabled || (saved && saved !== demoLogin?.identifier)) setPassword('');
        }
      }
    }).catch(() => undefined);
    return () => { active = false; };
  }, [demoLogin]);

  const persistRemember = (enabled: boolean, account?: string) => {
    // Keep rapid toggles ordered so the last selection wins in persistent storage too.
    rememberWrites.current = rememberWrites.current.then(async () => {
      await AsyncStorage.setItem(REMEMBER_PREFERENCE_KEY, String(enabled));
      if (!enabled) await AsyncStorage.removeItem(REMEMBERED_IDENTIFIER_KEY);
      else if (account) await AsyncStorage.setItem(REMEMBERED_IDENTIFIER_KEY, account);
    }).catch(() => undefined);
    return rememberWrites.current;
  };

  const toggleRemember = () => {
    rememberWasEdited.current = true;
    const enabled = !rememberIdentifier;
    setRememberIdentifier(enabled);
    // Opting out clears a previously saved account immediately; no login is required.
    void persistRemember(enabled);
  };

  const handlePasswordLogin = async () => {
    const normalized = identifier.trim().toLowerCase();
    const atIndex = normalized.indexOf('@');
    const validEmail = atIndex > 0 && normalized.slice(atIndex + 1).includes('.') && !normalized.includes(' ');
    const validIdentifier = validEmail || /^1[3-9]\d{9}$/.test(normalized);
    if (!validIdentifier || !password) return setError('请输入注册邮箱/手机号和密码');
    setLoading(true);
    setError('');
    const result = await login(normalized, password);
    if (result.success) {
      await persistRemember(rememberIdentifier, normalized);
      setLoading(false);
      router.replace(returnTo || '/');
    } else {
      setLoading(false);
      setError(result.error || '登录失败');
      setPassword('');
    }
  };

  const disabled = loading || !identifier.trim() || !password;

  return (
    <Screen>
      <View className="flex-1 px-5 pb-6">
        <View className="flex-row items-center justify-between pt-2">
          <IconButton
            name="chevron-left"
            accessibilityLabel="返回"
            onPress={() => router.canGoBack() ? router.back() : router.replace('/')}
            tone="brand"
          />
          <View className="flex-row items-center gap-2">
            <ThemeToggle />
            <IconButton
              name="circle-question"
              accessibilityLabel="帮助"
              onPress={() => router.push('/feedback', { category: 'support', page: '登录页' })}
              tone="muted"
              bordered={false}
            />
          </View>
        </View>

        <View className="grow shrink-0 justify-center py-6">
          <Animated.View className="w-full max-w-[420px] self-center" style={animatedStyle} pointerEvents={switching ? 'none' : 'auto'}>
            <View className="flex-row items-center gap-3">
              <Image source={require('@/assets/logo.png')} style={{ width: 36, height: 36 }} resizeMode="contain" accessible={false} />
              <View>
                <Text className="text-[16px] font-semibold tracking-tight text-brand-strong">拾味日常</Text>
                <Text className="mt-0.5 text-[10px] font-medium tracking-[1.1px] text-copy-muted">SHIWEI · DAILY</Text>
              </View>
            </View>

            <View className="mt-8">
              <Text className="text-[26px] font-semibold leading-8 tracking-tight text-ink" accessibilityRole="header">
                继续你的拾味记录
              </Text>
              <Text className="mt-2 text-sm leading-5 text-copy-muted">登录后同步饮食、库存与健康资料</Text>
            </View>

            <View className="mt-7 gap-4">
              <Panel padded={false} className="overflow-hidden">
                <View className="h-12 flex-row items-center px-3.5">
                  <FontAwesome6 name="user" size={14} color={brand} className="mr-2.5" />
                  <TextInput
                    className="h-full min-w-0 flex-1 py-0 text-[15px] text-ink outline-none"
                    textAlignVertical="center"
                    style={{ outlineStyle: 'none' } as object}
                    placeholder="注册邮箱或手机号"
                    placeholderTextColor={muted}
                    value={identifier}
                    onChangeText={(value) => { identifierWasEdited.current = true; setIdentifier(value); }}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="username"
                    textContentType="username"
                    accessibilityLabel="邮箱或手机号"
                  />
                </View>
                <View className="mx-3.5 h-px bg-line" />
                <View className="h-12 flex-row items-center px-3.5">
                  <FontAwesome6 name="lock" size={14} color={brand} className="mr-2.5" />
                  <TextInput
                    className="h-full min-w-0 flex-1 py-0 text-[15px] text-ink outline-none"
                    textAlignVertical="center"
                    style={{ outlineStyle: 'none' } as object}
                    placeholder="密码"
                    placeholderTextColor={muted}
                    value={password}
                    onChangeText={(value) => { passwordWasEdited.current = true; setPassword(value); }}
                    secureTextEntry={!showPassword}
                    autoComplete="current-password"
                    textContentType="password"
                    accessibilityLabel="密码"
                  />
                  <TouchableOpacity
                    onPress={() => setShowPassword((value) => !value)}
                    className="-mr-1.5 h-11 w-11 items-center justify-center"
                    accessibilityRole="button"
                    accessibilityLabel={showPassword ? '隐藏密码' : '显示密码'}
                  >
                    <FontAwesome6 name={showPassword ? 'eye-slash' : 'eye'} size={14} color={muted} />
                  </TouchableOpacity>
                </View>
              </Panel>

              <View className="flex-row items-center justify-between">
                <TouchableOpacity
                  className="min-h-11 flex-row items-center gap-2 pr-3"
                  onPress={toggleRemember}
                  disabled={loading}
                  accessibilityRole="checkbox"
                  accessibilityLabel="记住"
                  accessibilityHint="登录成功后记住账号，下次自动填入；不保存密码。取消勾选会立即清除已保存的账号。"
                  accessibilityState={{ checked: rememberIdentifier, disabled: loading }}
                  aria-checked={rememberIdentifier}
                  aria-disabled={loading}
                >
                  <FontAwesome6 name={rememberIdentifier ? 'square-check' : 'square'} size={15} color={rememberIdentifier ? brand : muted} />
                  <Text className="text-[13px] text-copy-muted">记住</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={() => router.push('/forgot-password')}
                  className="min-h-11 justify-center pl-3"
                >
                  <Text className="text-[13px] font-medium text-brand">忘记密码？</Text>
                </TouchableOpacity>
              </View>

              {error || sessionMessage ? (
                <View className="flex-row items-center rounded-lg border border-critical/20 bg-danger-soft px-3 py-2.5" accessibilityRole="alert">
                  <FontAwesome6 name="circle-exclamation" size={13} color={critical} style={{ marginRight: 8 }} />
                  <Text className="flex-shrink text-sm font-medium text-critical">{error || sessionMessage}</Text>
                </View>
              ) : null}

              <View className="gap-3">
                <Button
                  onPress={handlePasswordLogin}
                  disabled={disabled}
                  loading={loading}
                  size="lg"
                  className="bg-[#164B35] border-[#164B35]"
                  labelClassName="text-[15px] font-semibold"
                  accessibilityLabel="登录并继续"
                >
                  登录并继续
                </Button>

                <Button
                  variant="outline"
                  size="lg"
                  onPress={() => switchScreen(() => router.push('/register', returnTo ? { returnTo } : {}))}
                  disabled={switching}
                  accessibilityLabel="创建账号"
                >
                  <Text className="text-[13px] font-semibold text-ink">创建账号</Text>
                  <FontAwesome6 name="chevron-right" size={11} colorClassName="accent-copy-muted" />
                </Button>
              </View>

              <View className="flex-row flex-wrap items-center justify-center gap-x-1">
                <Text className="text-[11px] text-copy-muted">继续即表示你已阅读并同意</Text>
                <TouchableOpacity onPress={() => router.push('/legal', { type: 'terms' })} accessibilityRole="link">
                  <Text className="text-[11px] font-medium text-brand">服务协议</Text>
                </TouchableOpacity>
                <Text className="text-[11px] text-copy-muted">与</Text>
                <TouchableOpacity onPress={() => router.push('/legal', { type: 'privacy' })} accessibilityRole="link">
                  <Text className="text-[11px] font-medium text-brand">隐私政策</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Animated.View>
        </View>
      </View>
    </Screen>
  );
}
