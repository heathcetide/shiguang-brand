import React, { useState } from 'react';
import { Animated, Image, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button, IconButton, Panel } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import { useSafeRouter, useSafeSearchParams } from '@/hooks/useSafeRouter';
import { validateAuthReturnTo } from '@/utils/authReturnTo';
import { useAuthTransition } from '@/hooks/useAuthTransition';
import FontAwesome6 from '@/components/ThemedFontAwesome6';
import { useCSSVariable } from 'uniwind';
import { accountPasswordSchema, ACCOUNT_PASSWORD_REQUIREMENTS } from '@dietdigidose/contracts';

export default function RegisterScreen() {
  const { animatedStyle, switchScreen, switching } = useAuthTransition(1);
  const [identifier, setIdentifier] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { register } = useAuth();
  const router = useSafeRouter();
  const { returnTo: rawReturnTo } = useSafeSearchParams<{ returnTo?: unknown }>();
  const returnTo = validateAuthReturnTo(rawReturnTo);
  const [brand, muted, critical] = useCSSVariable([
    '--color-brand',
    '--color-copy-muted',
    '--color-critical',
  ]) as string[];

  const handleRegister = async () => {
    if (!identifier.trim() || !username.trim() || !password.trim()) {
      setError('请输入用户名、邮箱和密码');
      return;
    }
    if (username.trim().length < 2 || username.trim().length > 30) {
      setError('用户名需为 2～30 个字符');
      return;
    }
    const normalizedIdentifier = identifier.trim();
    const atIndex = normalizedIdentifier.indexOf('@');
    const isEmail = atIndex > 0 && normalizedIdentifier.slice(atIndex + 1).includes('.') && !normalizedIdentifier.includes(' ');
    if (!isEmail) {
      setError('请输入有效的邮箱');
      return;
    }
    if (!accountPasswordSchema.safeParse(password).success) {
      setError(ACCOUNT_PASSWORD_REQUIREMENTS);
      return;
    }
    if (password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }
    setError('');
    setLoading(true);
    const result = await register(identifier.trim(), username.trim(), password);
    setLoading(false);
    if (result.success) {
      router.replace(returnTo || '/onboarding');
    } else {
      setError(result.error || '注册失败');
    }
  };

  const handleBackToLogin = () => {
    switchScreen(() => {
      if (router.canGoBack()) router.back();
      else router.replace('/login', returnTo ? { returnTo } : {});
    });
  };

  const isRegisterDisabled = loading
    || !username.trim()
    || !identifier.trim()
    || !password
    || !confirmPassword;

  return (
    <Screen>
      <View className="flex-1 px-5 pb-6">
        <View className="flex-row items-center justify-between pt-2">
          <IconButton
            name="chevron-left"
            accessibilityLabel="返回登录"
            onPress={handleBackToLogin}
            tone="brand"
          />
          <View className="flex-row items-center gap-2">
            <ThemeToggle />
            <IconButton
              name="circle-question"
              accessibilityLabel="帮助"
              onPress={() => router.push('/feedback', { category: 'support', page: '注册页' })}
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
              <Text className="max-w-[300px] text-[26px] font-semibold leading-8 tracking-tight text-ink" accessibilityRole="header">
                创建你的拾味账号
              </Text>
              <Text className="mt-2 text-sm leading-5 text-copy-muted">注册后同步饮食、库存与健康资料</Text>
            </View>

            <View className="mt-8 gap-3">
              <Panel padded={false} className="overflow-hidden">
                <View className="h-11 flex-row items-center px-3.5">
                  <FontAwesome6 name="user" size={14} color={brand} className="mr-2.5" />
                  <TextInput
                    className="flex-1 py-0 text-[15px] text-ink outline-none"
                    style={{ outlineStyle: 'none' } as object}
                    placeholder="用户名（公开显示）"
                    placeholderTextColor={muted}
                    value={username}
                    onChangeText={setUsername}
                    maxLength={30}
                    autoComplete="username-new"
                    textContentType="username"
                    accessibilityLabel="用户名"
                  />
                </View>
                <View className="mx-3.5 h-px bg-line" />
                <View className="h-11 flex-row items-center px-3.5">
                  <FontAwesome6 name="envelope" size={14} color={brand} className="mr-2.5" />
                  <TextInput
                    className="flex-1 py-0 text-[15px] text-ink outline-none"
                    style={{ outlineStyle: 'none' } as object}
                    placeholder="邮箱"
                    placeholderTextColor={muted}
                    value={identifier}
                    onChangeText={setIdentifier}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    autoComplete="email"
                    textContentType="emailAddress"
                    accessibilityLabel="邮箱"
                  />
                </View>
                <View className="mx-3.5 h-px bg-line" />
                <View className="h-11 flex-row items-center px-3.5">
                  <FontAwesome6 name="lock" size={14} color={brand} className="mr-2.5" />
                  <TextInput
                    className="flex-1 py-0 text-[15px] text-ink outline-none"
                    style={{ outlineStyle: 'none' } as object}
                    placeholder="设置密码"
                    placeholderTextColor={muted}
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={!showPassword}
                    autoComplete="new-password"
                    textContentType="newPassword"
                    accessibilityLabel="密码"
                    maxLength={128}
                  />
                  <TouchableOpacity
                    onPress={() => setShowPassword((value) => !value)}
                    className="h-9 w-9 items-center justify-center"
                    accessibilityRole="button"
                    accessibilityLabel={showPassword ? '隐藏密码' : '显示密码'}
                  >
                    <FontAwesome6 name={showPassword ? 'eye-slash' : 'eye'} size={14} color={muted} />
                  </TouchableOpacity>
                </View>
                <View className="mx-3.5 h-px bg-line" />
                <View className="h-11 flex-row items-center px-3.5">
                  <FontAwesome6 name="shield" size={14} color={brand} className="mr-2.5" />
                  <TextInput
                    className="flex-1 py-0 text-[15px] text-ink outline-none"
                    style={{ outlineStyle: 'none' } as object}
                    placeholder="再次输入密码"
                    placeholderTextColor={muted}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    secureTextEntry={!showPassword}
                    autoComplete="new-password"
                    textContentType="newPassword"
                    accessibilityLabel="确认密码"
                    maxLength={128}
                  />
                </View>
              </Panel>

              <Text className="text-xs leading-4 text-copy-muted">{ACCOUNT_PASSWORD_REQUIREMENTS}。</Text>

              {error ? (
                <View className="flex-row items-center rounded-lg border border-critical/20 bg-danger-soft px-3 py-2.5" accessibilityRole="alert">
                  <FontAwesome6 name="circle-exclamation" size={13} color={critical} style={{ marginRight: 8 }} />
                  <Text className="flex-shrink text-sm font-medium text-critical">{error}</Text>
                </View>
              ) : null}

              <Button
                onPress={handleRegister}
                disabled={isRegisterDisabled}
                loading={loading}
                size="lg"
                className="bg-[#164B35] border-[#164B35]"
                labelClassName="text-[15px] font-semibold"
                accessibilityLabel="创建账号"
              >
                创建账号
              </Button>

              <Button variant="outline" size="lg" disabled={switching} onPress={handleBackToLogin} accessibilityLabel="已有账号，返回登录">
                已有账号，去登录
              </Button>

              <View className="mt-2 flex-row flex-wrap items-center justify-center gap-x-1">
                <Text className="text-[11px] text-copy-muted">创建账号即表示你已阅读并同意</Text>
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
