import React, { useEffect, useRef, useState } from 'react';
import { Image, Text, TextInput, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import FontAwesome6 from '@/components/ThemedFontAwesome6';
import { useCSSVariable } from 'uniwind';
import { Screen } from '@/components/Screen';
import { Button, IconButton, Panel } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import { useSafeRouter, useSafeSearchParams } from '@/hooks/useSafeRouter';
import { validateAuthReturnTo } from '@/utils/authReturnTo';

const REMEMBERED_IDENTIFIER_KEY = '@remembered_login_identifier';

export default function LoginScreen() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [rememberIdentifier, setRememberIdentifier] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const identifierWasEdited = useRef(false);
  const { login, sessionMessage } = useAuth();
  const router = useSafeRouter();
  const { returnTo: rawReturnTo } = useSafeSearchParams<{ returnTo?: unknown }>();
  const returnTo = validateAuthReturnTo(rawReturnTo);
  const [brand, muted, critical] = useCSSVariable(['--color-brand', '--color-copy-muted', '--color-critical']) as string[];

  useEffect(() => {
    void AsyncStorage.getItem(REMEMBERED_IDENTIFIER_KEY).then((saved) => {
      if (saved && !identifierWasEdited.current) setIdentifier(saved);
    }).catch(() => undefined);
  }, []);

  const handlePasswordLogin = async () => {
    const normalized = identifier.trim().toLowerCase();
    const atIndex = normalized.indexOf('@');
    const validEmail = atIndex > 0 && normalized.slice(atIndex + 1).includes('.') && !normalized.includes(' ');
    const validIdentifier = validEmail || /^1[3-9]\d{9}$/.test(normalized);
    if (!validIdentifier || !password) return setError('请输入注册邮箱/手机号和密码');
    setLoading(true);
    setError('');
    if (rememberIdentifier) await AsyncStorage.setItem(REMEMBERED_IDENTIFIER_KEY, normalized).catch(() => undefined);
    else await AsyncStorage.removeItem(REMEMBERED_IDENTIFIER_KEY).catch(() => undefined);
    const result = await login(normalized, password);
    setLoading(false);
    if (result.success) router.replace(returnTo || '/');
    else { setError(result.error || '登录失败'); setPassword(''); }
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
          <IconButton
            name="circle-question"
            accessibilityLabel="帮助"
            onPress={() => router.push('/feedback', { category: 'support', page: '登录页' })}
            tone="muted"
            bordered={false}
          />
        </View>

        <View className="mt-8 flex-row items-center gap-3">
          <Image source={require('@/assets/logo.png')} style={{ width: 36, height: 36 }} resizeMode="contain" accessible={false} />
          <View>
            <Text className="text-[16px] font-semibold tracking-tight text-brand-strong">拾味日常</Text>
            <Text className="mt-0.5 text-[10px] font-medium tracking-[1.1px] text-copy-muted">SHIWEI · DAILY</Text>
          </View>
        </View>

        <View className="mt-8">
          <Text className="max-w-[300px] text-[26px] font-semibold leading-8 tracking-tight text-ink" accessibilityRole="header">
            继续你的拾味记录
          </Text>
          <Text className="mt-2 text-sm leading-5 text-copy-muted">登录后同步饮食、库存与健康资料</Text>
        </View>

        <View className="mt-8 gap-3">
          <Panel padded={false} className="overflow-hidden">
            <View className="h-11 flex-row items-center px-3.5">
              <FontAwesome6 name="user" size={14} color={brand} className="mr-2.5" />
              <TextInput
                className="flex-1 py-0 text-[15px] text-ink outline-none"
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
              <TouchableOpacity
                className="ml-2 flex-row items-center gap-1.5 py-2"
                onPress={() => setRememberIdentifier((value) => !value)}
                accessibilityRole="checkbox"
                accessibilityLabel="记住登录账号"
                accessibilityState={{ checked: rememberIdentifier }}
              >
                <FontAwesome6 name={rememberIdentifier ? 'square-check' : 'square'} size={13} color={rememberIdentifier ? brand : muted} />
                <Text className="text-xs text-copy-muted">记住</Text>
              </TouchableOpacity>
            </View>
            <View className="mx-3.5 h-px bg-line" />
            <View className="h-11 flex-row items-center px-3.5">
              <FontAwesome6 name="lock" size={14} color={brand} className="mr-2.5" />
              <TextInput
                className="flex-1 py-0 text-[15px] text-ink outline-none"
                style={{ outlineStyle: 'none' } as object}
                placeholder="密码"
                placeholderTextColor={muted}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                autoComplete="current-password"
                textContentType="password"
                accessibilityLabel="密码"
              />
              <TouchableOpacity onPress={() => setShowPassword((value) => !value)} className="h-9 w-9 items-center justify-center">
                <FontAwesome6 name={showPassword ? 'eye-slash' : 'eye'} size={14} color={muted} />
              </TouchableOpacity>
            </View>
          </Panel>

          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => router.push('/forgot-password')}
            className="min-h-9 justify-center self-end px-1"
          >
            <Text className="text-sm font-medium text-brand">忘记密码？</Text>
          </TouchableOpacity>

          {error || sessionMessage ? (
            <View className="flex-row items-center rounded-lg border border-critical/20 bg-danger-soft px-3 py-2.5" accessibilityRole="alert">
              <FontAwesome6 name="circle-exclamation" size={13} color={critical} style={{ marginRight: 8 }} />
              <Text className="flex-shrink text-sm font-medium text-critical">{error || sessionMessage}</Text>
            </View>
          ) : null}

          <Button onPress={handlePasswordLogin} disabled={disabled} loading={loading} accessibilityLabel="登录并继续">
            登录并继续
          </Button>

          <Button
            variant="outline"
            onPress={() => router.push('/register', returnTo ? { returnTo } : {})}
            accessibilityLabel="创建账号"
          >
            创建账号
          </Button>

          <View className="mt-2 flex-row flex-wrap items-center justify-center gap-x-1">
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
      </View>
    </Screen>
  );
}
