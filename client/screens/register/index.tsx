import React, { useState } from 'react';
import { ActivityIndicator, Image, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { useAuth } from '@/contexts/AuthContext';
import { useSafeRouter, useSafeSearchParams } from '@/hooks/useSafeRouter';
import { validateAuthReturnTo } from '@/utils/authReturnTo';
import FontAwesome6 from '@/components/ThemedFontAwesome6';
import { useCSSVariable } from 'uniwind';
import { accountPasswordSchema, ACCOUNT_PASSWORD_REQUIREMENTS } from '@dietdigidose/contracts';

export default function RegisterScreen() {
  const [identifier, setIdentifier] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { register, pendingSmsRegistration, completeSmsRegistration, clearPendingSmsRegistration } = useAuth();
  const router = useSafeRouter();
  const { returnTo: rawReturnTo, mode } = useSafeSearchParams<{ returnTo?: unknown; mode?: unknown }>();
  const returnTo = validateAuthReturnTo(rawReturnTo);
  const isSmsRegistration = mode === 'sms';
  const [brand, muted, critical] = useCSSVariable([
    '--color-brand',
    '--color-copy-muted',
    '--color-critical',
  ]) as string[];

  const handleRegister = async () => {
    if ((!isSmsRegistration && !identifier.trim()) || !username.trim() || !password.trim()) {
      setError(isSmsRegistration ? '请输入用户名和备用密码' : '请输入用户名、邮箱和密码');
      return;
    }
    if (isSmsRegistration && !pendingSmsRegistration) {
      setError('手机号验证已失效，请返回登录页重新验证');
      return;
    }
    if (username.trim().length < 2 || username.trim().length > 30) {
      setError('用户名需为 2～30 个字符');
      return;
    }
    const normalizedIdentifier = identifier.trim();
    const atIndex = normalizedIdentifier.indexOf('@');
    const isEmail = atIndex > 0 && normalizedIdentifier.slice(atIndex + 1).includes('.') && !normalizedIdentifier.includes(' ');
    if (!isSmsRegistration && !isEmail) {
      setError('请输入有效的邮箱；手机号请在登录页使用验证码注册');
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
    const result = isSmsRegistration
      ? await completeSmsRegistration(username.trim(), password)
      : await register(identifier.trim(), username.trim(), password);
    setLoading(false);
    if (result.success) {
      router.replace(returnTo || '/onboarding');
    } else {
      setError(result.error || '注册失败');
    }
  };

  const handleBackToLogin = () => {
    if (isSmsRegistration) clearPendingSmsRegistration();
    if (router.canGoBack()) router.back();
    else router.replace('/login');
  };

  const isRegisterDisabled = loading
    || !username.trim()
    || (!isSmsRegistration && !identifier.trim())
    || !password
    || !confirmPassword;

  return (
    <Screen>
      <View className="flex-1 px-6 pb-5">
        <View className="flex-row items-center justify-between pt-2">
          <TouchableOpacity
            onPress={handleBackToLogin}
            accessibilityRole="button"
            accessibilityLabel="返回登录"
            className="h-10 w-10 items-center justify-center active:opacity-70"
          >
            <FontAwesome6 name="chevron-left" size={14} color={brand} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push('/feedback', { category: 'support', page: '注册页' })}
            accessibilityRole="link"
            accessibilityLabel="帮助"
            className="h-10 w-10 items-center justify-center active:opacity-70"
          >
            <FontAwesome6 name="circle-question" size={16} color={muted} />
          </TouchableOpacity>
        </View>

        <View className="mt-5 flex-row items-center gap-2.5">
          <Image source={require('@/assets/logo.png')} style={{ width: 42, height: 42 }} resizeMode="contain" accessible={false} />
          <View>
            <Text className="text-base font-black text-brand-strong">食光烙记</Text>
            <Text className="mt-0.5 text-[9px] font-bold tracking-[1.5px] text-copy-muted">DIET · MEMORY · LIFE</Text>
          </View>
        </View>

        <View className="mt-10">
          <Text className="max-w-[350px] text-[32px] font-black leading-[39px] text-ink" accessibilityRole="header">
            {isSmsRegistration ? '完成你的账号设置' : '创建你的食光账号'}
          </Text>
          <Text className="mt-2 text-[12px] font-medium text-copy-muted">
            {isSmsRegistration ? `手机号 ${pendingSmsRegistration?.phoneMasked || ''} 已验证` : '保存饮食记忆，从第一餐开始'}
          </Text>
        </View>

        <View className="mt-auto pt-8">
          <View className="overflow-hidden rounded-[24px] border border-line bg-surface/90 shadow-2xs">
            <View className="h-[62px] flex-row items-center px-5">
              <FontAwesome6 name="user" size={18} color={brand} className="mr-3" />
              <TextInput
                className="flex-1 py-0 text-base text-ink"
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
            {!isSmsRegistration ? (
              <>
                <View className="mx-5 h-px bg-line" />
                <View className="h-[62px] flex-row items-center px-5">
                  <FontAwesome6 name="envelope" size={18} color={brand} className="mr-3" />
                  <TextInput
                    className="flex-1 py-0 text-base text-ink"
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
              </>
            ) : null}
            <View className="mx-5 h-px bg-line" />
            <View className="h-[62px] flex-row items-center px-5">
              <FontAwesome6 name="lock" size={18} color={brand} className="mr-3" />
              <TextInput
                className="flex-1 py-0 text-base text-ink"
                placeholder={isSmsRegistration ? '设置备用密码' : '设置密码'}
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
                className="min-h-touch min-w-touch items-center justify-center"
                accessibilityRole="button"
                accessibilityLabel={showPassword ? '隐藏密码' : '显示密码'}
              >
                <FontAwesome6 name={showPassword ? 'eye-slash' : 'eye'} size={18} color={muted} />
              </TouchableOpacity>
            </View>
            <View className="mx-5 h-px bg-line" />
            <View className="h-[62px] flex-row items-center px-5">
              <FontAwesome6 name="shield" size={18} color={brand} className="mr-3" />
              <TextInput
                className="flex-1 py-0 text-base text-ink"
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

          <Text className="mx-5 mt-3 text-sm text-copy-muted">{ACCOUNT_PASSWORD_REQUIREMENTS}。</Text>
          {error ? (
            <View className="mx-3 mt-3 flex-row items-center rounded-2xl bg-danger-soft px-4 py-2.5" accessibilityRole="alert">
              <FontAwesome6 name="circle-exclamation" size={14} color={critical} style={{ marginRight: 6 }} />
              <Text className="flex-shrink text-body font-medium text-critical">{error}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            className={`mx-3 mb-3 mt-3 h-14 flex-row items-center justify-between rounded-full bg-brand-fill py-1.5 pl-6 pr-1.5 shadow-xs ${isRegisterDisabled ? 'opacity-disabled' : ''}`}
            onPress={handleRegister}
            disabled={isRegisterDisabled}
            accessibilityRole="button"
            accessibilityLabel="创建账号"
            accessibilityState={{ disabled: isRegisterDisabled, busy: loading }}
          >
            {loading ? (
              <View className="flex-1 items-center"><ActivityIndicator colorClassName="accent-on-brand" /></View>
            ) : (
              <>
                <Text className="text-[15px] font-black text-white">{isSmsRegistration ? '完成注册' : '创建账号'}</Text>
                <View className="h-11 w-11 items-center justify-center rounded-full bg-surface/20">
                  <FontAwesome6 name="arrow-right" size={13} colorClassName="accent-on-brand" />
                </View>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            className="mx-3 mb-3 h-14 flex-row items-center justify-between rounded-full bg-background-secondary py-1.5 pl-1.5 pr-6"
            onPress={handleBackToLogin}
            accessibilityRole="button"
            accessibilityLabel="已有账号，返回登录"
          >
            <View className="h-11 w-11 items-center justify-center rounded-full bg-surface/80">
              <FontAwesome6 name="arrow-left" size={13} color={brand} />
            </View>
            <Text className="text-[15px] font-bold text-brand-strong">
              {isSmsRegistration ? '暂不注册' : '已有账号'}
            </Text>
          </TouchableOpacity>

          <View className="mb-3 flex-row flex-wrap items-center justify-center">
            <Text className="text-[9px] text-copy-muted">创建账号即表示你已阅读并同意</Text>
            <TouchableOpacity onPress={() => router.push('/legal', { type: 'terms' })} accessibilityRole="link">
              <Text className="text-[9px] font-medium text-brand">服务协议</Text>
            </TouchableOpacity>
            <Text className="text-[9px] text-copy-muted">与</Text>
            <TouchableOpacity onPress={() => router.push('/legal', { type: 'privacy' })} accessibilityRole="link">
              <Text className="text-[9px] font-medium text-brand">隐私政策</Text>
            </TouchableOpacity>
          </View>
          </View>
        </View>
      </View>
    </Screen>
  );
}
