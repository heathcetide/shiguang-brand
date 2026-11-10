import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Text, TextInput, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import FontAwesome6 from '@/components/ThemedFontAwesome6';
import { useCSSVariable } from 'uniwind';
import { Screen } from '@/components/Screen';
import { useAuth } from '@/contexts/AuthContext';
import { useSafeRouter, useSafeSearchParams } from '@/hooks/useSafeRouter';
import { useResendCooldown } from '@/hooks/useResendCooldown';
import { validateAuthReturnTo } from '@/utils/authReturnTo';

const REMEMBERED_IDENTIFIER_KEY = '@remembered_login_identifier';

export default function LoginScreen() {
  const [mode, setMode] = useState<'sms' | 'password'>('sms');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [phoneMasked, setPhoneMasked] = useState('');
  const { countdown, start: startCooldown, reset: resetCooldown, isCoolingDown } = useResendCooldown();
  const sendingCode = useRef(false);
  const active = useRef(true);
  const [rememberIdentifier, setRememberIdentifier] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const identifierWasEdited = useRef(false);
  const { login, sendSmsCode, verifySmsCode, sessionMessage } = useAuth();
  const router = useSafeRouter();
  const { returnTo: rawReturnTo } = useSafeSearchParams<{ returnTo?: unknown }>();
  const returnTo = validateAuthReturnTo(rawReturnTo);
  const [brand, muted, critical] = useCSSVariable(['--color-brand', '--color-copy-muted', '--color-critical']) as string[];

  useEffect(() => {
    void AsyncStorage.getItem(REMEMBERED_IDENTIFIER_KEY).then((saved) => {
      if (saved && !identifierWasEdited.current) setIdentifier(saved);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  const changeMode = (next: 'sms' | 'password') => {
    setMode(next);
    setError('');
  };

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

  const handleSendCode = async () => {
    const normalized = phone.replace(/[\s-]/g, '').replace(/^\+?86/, '');
    if (!/^1[3-9]\d{9}$/.test(normalized)) return setError('请输入有效的中国大陆手机号');
    if (sendingCode.current || loading || isCoolingDown()) return;
    sendingCode.current = true;
    setLoading(true);
    setError('');
    try {
      const result = await sendSmsCode(normalized);
      if (!active.current) return;
      if (!result.success || !result.challengeId) return setError(result.error || '验证码发送失败');
      setPhone(normalized);
      setChallengeId(result.challengeId);
      setPhoneMasked(result.phoneMasked || normalized.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2'));
      startCooldown(result.resendAfter || 60);
      setCode('');
    } catch (err) {
      if (active.current) setError(err instanceof Error ? err.message : '验证码发送失败');
    } finally {
      sendingCode.current = false;
      if (active.current) setLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    if (!challengeId) return handleSendCode();
    if (!/^\d{6}$/.test(code)) return setError('请输入 6 位数字验证码');
    setLoading(true);
    setError('');
    const result = await verifySmsCode(challengeId, code);
    setLoading(false);
    if (!result.success) return setError(result.error || '验证码核验失败');
    if (result.registrationRequired) router.push('/register', { mode: 'sms', ...(returnTo ? { returnTo } : {}) });
    else router.replace(returnTo || (result.isNewUser ? '/onboarding' : '/'));
  };

  const switchPhone = () => {
    if (sendingCode.current || loading) return;
    setChallengeId('');
    setCode('');
    setPhoneMasked('');
    resetCooldown();
    setError('');
  };

  const disabled = loading || (mode === 'password'
    ? !identifier.trim() || !password
    : challengeId ? !/^\d{6}$/.test(code) : !phone.trim());
  return (
    <Screen>
      <View className="flex-1 px-6 pb-5">
        <View className="flex-row items-center justify-between pt-2">
          <TouchableOpacity
            onPress={() => router.canGoBack() ? router.back() : router.replace('/')}
            accessibilityRole="button"
            accessibilityLabel="返回"
            className="h-10 w-10 items-center justify-center active:opacity-70"
          >
            <FontAwesome6 name="chevron-left" size={14} color={brand} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push('/feedback', { category: 'support', page: '登录页' })}
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
          <Text className="max-w-[330px] text-[32px] font-black leading-[39px] text-ink" accessibilityRole="header">
            继续你的食光记录
          </Text>
          <Text className="mt-2 text-[12px] font-medium text-copy-muted">登录后同步饮食、库存与健康资料</Text>
        </View>

        <View className="mt-auto pt-8">
        <View className="overflow-hidden rounded-[24px] border border-line bg-surface/90 shadow-2xs">
          {mode === 'sms' ? (
            <>
              <View className="h-[62px] flex-row items-center px-5">
                <FontAwesome6 name="mobile-screen-button" size={18} color={brand} className="mr-3" />
                <TextInput
                  className="flex-1 py-0 text-base text-ink"
                  placeholder="中国大陆手机号"
                  placeholderTextColor={muted}
                  value={phone}
                  onChangeText={(value) => { setPhone(value); if (challengeId) switchPhone(); }}
                  editable={!challengeId && !loading}
                  keyboardType="phone-pad"
                  autoComplete="tel"
                  textContentType="telephoneNumber"
                  maxLength={15}
                  accessibilityLabel="手机号"
                />
                {challengeId ? <TouchableOpacity onPress={switchPhone} disabled={loading}><Text className="text-body font-bold text-brand">更换</Text></TouchableOpacity> : null}
              </View>
              {challengeId ? (
                <>
                  <View className="mx-5 h-px bg-line" />
                  <View className="h-[62px] flex-row items-center px-5">
                    <FontAwesome6 name="shield-halved" size={18} color={brand} className="mr-3" />
                    <TextInput
                      className="flex-1 py-0 text-base tracking-widest text-ink"
                      placeholder="6 位验证码"
                      placeholderTextColor={muted}
                      value={code}
                      onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))}
                      keyboardType="number-pad"
                      autoComplete="sms-otp"
                      textContentType="oneTimeCode"
                      maxLength={6}
                      accessibilityLabel="短信验证码"
                    />
                    <TouchableOpacity onPress={handleSendCode} disabled={countdown > 0 || loading}>
                      <Text className={countdown > 0 ? 'text-copy-muted text-body' : 'text-brand text-body font-medium'}>
                        {countdown > 0 ? `${countdown}s` : '重新发送'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : null}
            </>
          ) : (
            <>
              <View className="h-[62px] flex-row items-center px-5">
                <FontAwesome6 name="user" size={18} color={brand} className="mr-3" />
                <TextInput className="flex-1 py-0 text-base text-ink" placeholder="注册邮箱或手机号" placeholderTextColor={muted} value={identifier}
                  onChangeText={(value) => { identifierWasEdited.current = true; setIdentifier(value); }} autoCapitalize="none" autoCorrect={false} autoComplete="username" textContentType="username" accessibilityLabel="邮箱或手机号" />
                <TouchableOpacity
                  className="ml-2 min-h-touch flex-row items-center gap-1"
                  onPress={() => setRememberIdentifier((value) => !value)}
                  accessibilityRole="checkbox"
                  accessibilityLabel="记住登录账号"
                  accessibilityState={{ checked: rememberIdentifier }}
                >
                  <FontAwesome6 name={rememberIdentifier ? 'square-check' : 'square'} size={14} color={rememberIdentifier ? brand : muted} />
                  <Text className="text-[10px] font-medium text-copy-muted">记住</Text>
                </TouchableOpacity>
              </View>
              <View className="mx-5 h-px bg-line" />
              <View className="h-[62px] flex-row items-center px-5">
                <FontAwesome6 name="lock" size={18} color={brand} className="mr-3" />
                <TextInput className="flex-1 py-0 text-base text-ink" placeholder="密码" placeholderTextColor={muted} value={password} onChangeText={setPassword}
                  secureTextEntry={!showPassword} autoComplete="current-password" textContentType="password" accessibilityLabel="密码" />
                <TouchableOpacity onPress={() => setShowPassword((value) => !value)} className="min-h-touch min-w-touch items-center justify-center">
                  <FontAwesome6 name={showPassword ? 'eye-slash' : 'eye'} size={18} color={muted} />
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>

        {mode === 'password' && <TouchableOpacity accessibilityRole="button" onPress={() => router.push('/forgot-password')} className="mt-2 min-h-touch justify-center self-end px-2"><Text className="text-sm text-brand">忘记密码？</Text></TouchableOpacity>}

        {mode === 'sms' && challengeId ? (
          <Text className="mt-2 px-1 text-caption text-copy-muted">验证码已发送至 {phoneMasked}，5 分钟内有效</Text>
        ) : null}

        {error || sessionMessage ? (
          <View className="mt-3 flex-row items-center rounded-2xl bg-danger-soft px-4 py-2.5" accessibilityRole="alert">
            <FontAwesome6 name="circle-exclamation" size={14} color={critical} style={{ marginRight: 6 }} />
            <Text className="flex-shrink text-body font-medium text-critical">{error || sessionMessage}</Text>
          </View>
        ) : null}

        <TouchableOpacity
          className={`mt-3 h-14 flex-row items-center justify-between rounded-full bg-brand-fill py-1.5 pl-6 pr-1.5 shadow-xs ${disabled ? 'opacity-disabled' : ''}`}
          onPress={mode === 'password' ? handlePasswordLogin : handleVerifyCode}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityState={{ disabled, busy: loading }}
        >
          {loading ? (
            <View className="flex-1 items-center"><ActivityIndicator colorClassName="accent-on-brand" /></View>
          ) : (
            <>
              <Text className="text-[15px] font-black text-white">
                {mode === 'sms' ? (challengeId ? '验证并继续' : '获取验证码') : '登录并继续'}
              </Text>
              <View className="h-11 w-11 items-center justify-center rounded-full bg-surface/20">
                <FontAwesome6 name="arrow-right" size={13} colorClassName="accent-on-brand" />
              </View>
            </>
          )}
        </TouchableOpacity>

        <View className="mt-2 h-14 flex-row gap-2">
          <View className="flex-row rounded-full bg-background-secondary p-1" style={{ flex: 2 }}>
            {(['sms', 'password'] as const).map((item) => {
              const selected = mode === item;
              return (
                <TouchableOpacity
                  key={item}
                  onPress={() => changeMode(item)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  className={`flex-1 items-center justify-center rounded-full ${selected ? 'bg-surface shadow-2xs' : ''}`}
                >
                  <Text className={`text-[11px] ${selected ? 'font-black text-brand-strong' : 'font-bold text-copy-muted'}`}>
                    {item === 'sms' ? '手机登录 / 注册' : '密码登录'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <TouchableOpacity
            className="flex-1 flex-row items-center justify-between rounded-full bg-background-secondary py-1 pl-4 pr-1"
            onPress={() => router.push('/register', returnTo ? { returnTo } : {})}
            accessibilityRole="button"
            accessibilityLabel="创建账号"
          >
            <Text className="text-[11px] font-bold text-brand-strong">创建账号</Text>
            <View className="h-10 w-10 items-center justify-center rounded-full bg-surface/80">
              <FontAwesome6 name="arrow-right" size={11} color={brand} />
            </View>
          </TouchableOpacity>
        </View>

        <View className="mt-3 flex-row flex-wrap items-center justify-center">
          <Text className="text-[9px] text-copy-muted">未注册手机号验证后将创建账号。继续即表示同意</Text>
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
    </Screen>
  );
}
