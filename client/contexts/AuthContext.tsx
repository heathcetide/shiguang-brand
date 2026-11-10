import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform } from 'react-native';
import { activatePrivateStorage, invalidatePrivateStorage, purgeLegacyUnscopedPrivateStorage, purgeUserPrivateStorage } from '@/utils/userStorage';
import { ApiError, authApi } from '@/services/api';
import { clearApiCacheScope, maintainApiCache, registerApiFetchScope } from '@/services/api/cache';
import { clearInventorySnapshots, maintainInventorySnapshots } from '@/services/offlineInventory';
import { restoredAuthIdentity, storedAuthIdentity } from '@/utils/authIdentity';
import { AUTH_USER_KEY, getStoredToken, removeStoredToken, setStoredToken } from '@/utils/authStorage';
import { AuthSessionCoordinator } from '@/utils/authSessionCoordinator';
import { cancelAllLocalNotificationsForUser, cancelLegacyUnscopedLocalNotifications } from '@/utils/notifications';
import { ACCOUNT_SECURITY_CAPABILITY, type AccountDeletionProof } from '@dietdigidose/contracts';
import { purgeVoiceAudioCacheForUser, stopVoiceOutput } from '@/services/voicePackManager';

interface User {
  id: number;
  username: string;
  email?: string | null;
  phone?: string | null;
  avatar_url: string | null;
  bio: string | null;
  daily_calories_target?: number | null;
  phone_verified_at?: string | null;
  email_verified_at?: string | null;
  hasPassword?: boolean;
  role?: string;
}

type PendingSmsRegistration = {
  registrationToken: string;
  phoneMasked: string;
};

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (identifier: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (identifier: string, username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  pendingSmsRegistration: PendingSmsRegistration | null;
  sessionMessage: string | null;
  clearSessionMessage: () => void;
  sendSmsCode: (phone: string) => Promise<{ success: boolean; challengeId?: string; phoneMasked?: string; resendAfter?: number; error?: string }>;
  verifySmsCode: (challengeId: string, code: string) => Promise<{ success: boolean; registrationRequired?: boolean; isNewUser?: boolean; error?: string }>;
  completeSmsRegistration: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  clearPendingSmsRegistration: () => void;
  logout: (message?: string, expectedGeneration?: number) => Promise<void>;
  sessionGeneration: number;
  isSessionCurrent: (userId: number, generation: number) => boolean;
  updateProfile: (data: Partial<User>) => Promise<{ success: boolean; error?: string }>;
  deleteAccount: (proof: string | AccountDeletionProof) => Promise<{ success: boolean; error?: string }>;
  refreshUser: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingSmsRegistration, setPendingSmsRegistration] = useState<PendingSmsRegistration | null>(null);
  const [sessionMessage, setSessionMessage] = useState<string | null>(null);
  const [sessionGeneration, setSessionGeneration] = useState(0);
  const sessionCoordinator = useRef(new AuthSessionCoordinator());
  const currentUserId = useRef(user?.id);
  currentUserId.current = user?.id;
  const providerMounted = useRef(true);
  useEffect(() => {
    providerMounted.current = true;
    return () => { providerMounted.current = false; };
  }, []);
  // Async work may outlive its screen, but never its authenticated session/provider.
  const isSessionCurrent = useCallback((userId: number, generation: number) =>
    providerMounted.current && currentUserId.current === userId
      && sessionCoordinator.current.currentGeneration() === generation, []);

  const applyAuthenticatedResult = useCallback(async (data: { token: string; user: User }) => {
    if (!data?.token || !data?.user) return false;
    const generation = await sessionCoordinator.current.authenticate(async () => {
      let previousUser: User | null = null;
      try {
        previousUser = JSON.parse(await AsyncStorage.getItem(AUTH_USER_KEY) || 'null') as User | null;
      } catch {
        previousUser = null;
      }
      await stopVoiceOutput().catch(() => undefined);
      if (previousUser?.id) {
        invalidatePrivateStorage(previousUser.id);
        await clearApiCacheScope(previousUser.id).catch(() => undefined);
        await clearInventorySnapshots(previousUser.id).catch(() => undefined);
      }
      if (previousUser?.id && previousUser.id !== data.user.id) {
        await cancelAllLocalNotificationsForUser(previousUser.id).catch(() => undefined);
        await purgeVoiceAudioCacheForUser(previousUser.id).catch(() => undefined);
        await purgeUserPrivateStorage(previousUser.id).catch(() => undefined);
      }
      await setStoredToken(data.token);
      await AsyncStorage.setItem(AUTH_USER_KEY, JSON.stringify(storedAuthIdentity(data.user)));
      activatePrivateStorage(data.user.id);
      setToken(data.token);
      setUser(data.user);
      setPendingSmsRegistration(null);
      setSessionMessage(null);
    });
    setSessionGeneration(generation);
    return true;
  }, []);

  const clearAuthState = useCallback(async (
    expectedGeneration: number,
    userId?: number | null,
    message?: string,
  ) => {
    const cleared = await sessionCoordinator.current.clearIfCurrent(expectedGeneration, async () => {
      invalidatePrivateStorage(userId);
      await stopVoiceOutput().catch(() => undefined);
      await purgeVoiceAudioCacheForUser(userId).catch(() => undefined);
      await cancelAllLocalNotificationsForUser(userId).catch(() => undefined);
      await clearApiCacheScope(userId).catch(() => undefined);
      await clearInventorySnapshots(userId).catch(() => undefined);
      await purgeUserPrivateStorage(userId).catch(() => undefined);
      await Promise.all([removeStoredToken(), AsyncStorage.removeItem(AUTH_USER_KEY)]);
      setToken(null);
      setUser(null);
      if (message) setSessionMessage(message);
    });
    if (cleared) setSessionGeneration(sessionCoordinator.current.currentGeneration());
    return cleared;
  }, []);

  useEffect(() => {
    // Load saved auth state with offline resilience. A newer login wins over startup.
    const startupGeneration = sessionCoordinator.current.currentGeneration();
    (async () => {
      try {
        await Promise.all([maintainApiCache(), maintainInventorySnapshots()]);
        await cancelLegacyUnscopedLocalNotifications();
        await purgeLegacyUnscopedPrivateStorage();
        const savedToken = await getStoredToken();
        const savedUser = await AsyncStorage.getItem(AUTH_USER_KEY);
        if (!savedToken && savedUser) {
          await sessionCoordinator.current.updateIfCurrent(startupGeneration, () => AsyncStorage.removeItem(AUTH_USER_KEY));
        }
        if (savedToken && savedUser) {
          let cachedUser: User;
          try {
            cachedUser = restoredAuthIdentity(JSON.parse(savedUser));
          } catch {
            await clearAuthState(startupGeneration);
            return;
          }
          const restoredGeneration = startupGeneration;
          const restored = await sessionCoordinator.current.updateIfCurrent(restoredGeneration, async () => {
            // Rewrite legacy full profiles before exposing an offline session.
            await AsyncStorage.setItem(AUTH_USER_KEY, JSON.stringify(storedAuthIdentity(cachedUser)));
            activatePrivateStorage(cachedUser.id);
            setToken(savedToken);
            setUser(cachedUser);
          });
          if (!restored) return;
          setSessionGeneration(restoredGeneration);

          // Verify token asynchronously with backend
          try {
            const freshUser = await authApi.me<User>(savedToken);
            await sessionCoordinator.current.updateIfCurrent(restoredGeneration, async () => {
              await AsyncStorage.setItem(AUTH_USER_KEY, JSON.stringify(storedAuthIdentity(freshUser)));
              setUser(freshUser);
            });
          } catch (error) {
            if (error instanceof ApiError && (error.status === 401 || error.code === 'ACCOUNT_DISABLED')) {
              await clearAuthState(
                restoredGeneration,
                cachedUser.id,
                error.code === 'ACCOUNT_DISABLED' ? '账号已停用，请联系管理员了解详情。' : '登录会话已失效，请重新登录。',
              );
            }
            // Network error/server down during verify: keep local cached auth state so user stays logged in offline
          }
        }
      } catch (e) {
        await clearAuthState(startupGeneration);
      } finally {
        setIsLoading(false);
      }
    })();
  }, [clearAuthState]);

  const login = useCallback(async (identifier: string, password: string) => {
    try {
      await cancelLegacyUnscopedLocalNotifications();
      await purgeLegacyUnscopedPrivateStorage();
      const data = await authApi.login<{ token: string; user: User }>(identifier, password);
      if (!await applyAuthenticatedResult(data)) {
        return { success: false, error: '返回数据不完整' };
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : '网络错误，请稍后重试' };
    }
  }, [applyAuthenticatedResult]);

  const register = useCallback(async (identifier: string, username: string, password: string) => {
    try {
      await cancelLegacyUnscopedLocalNotifications();
      await purgeLegacyUnscopedPrivateStorage();
      const data = await authApi.register<{ token: string; user: User }>(identifier, username, password);
      if (!await applyAuthenticatedResult(data)) {
        return { success: false, error: '返回数据不完整' };
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : '网络错误，请稍后重试' };
    }
  }, [applyAuthenticatedResult]);

  const sendSmsCode = useCallback(async (phone: string) => {
    try {
      const data = await authApi.sendSmsCode<{ challengeId: string; phoneMasked: string; resendAfter: number }>(phone);
      if (!data?.challengeId) return { success: false, error: '短信服务返回数据不完整' };
      return { success: true, ...data };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '验证码发送失败' };
    }
  }, []);

  const verifySmsCode = useCallback(async (challengeId: string, code: string) => {
    try {
      const data = await authApi.verifySmsCode<
        | { status: 'authenticated'; token: string; user: User; isNewUser?: boolean }
        | { status: 'registration_required'; registrationToken: string; phoneMasked: string }
      >(challengeId, code);
      if (data.status === 'authenticated') {
        if (!await applyAuthenticatedResult(data)) return { success: false, error: '登录返回数据不完整' };
        return { success: true, registrationRequired: false, isNewUser: data.isNewUser === true };
      }
      if (data.status === 'registration_required' && data.registrationToken) {
        setPendingSmsRegistration({ registrationToken: data.registrationToken, phoneMasked: data.phoneMasked });
        return { success: true, registrationRequired: true };
      }
      return { success: false, error: '验证码核验返回数据异常' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '验证码核验失败' };
    }
  }, [applyAuthenticatedResult]);

  const completeSmsRegistration = useCallback(async (username: string, password: string) => {
    if (!pendingSmsRegistration) return { success: false, error: '手机号验证已失效，请重新验证' };
    try {
      const data = await authApi.registerWithSms<{ token: string; user: User }>(pendingSmsRegistration.registrationToken, username, password);
      if (!await applyAuthenticatedResult(data)) return { success: false, error: '注册返回数据不完整' };
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '注册失败' };
    }
  }, [applyAuthenticatedResult, pendingSmsRegistration]);

  const clearPendingSmsRegistration = useCallback(() => setPendingSmsRegistration(null), []);

  const logout = useCallback(async (message?: string, expectedGeneration = sessionGeneration) => {
    await clearAuthState(expectedGeneration, user?.id, message);
  }, [clearAuthState, sessionGeneration, user?.id]);

  const updateProfile = useCallback(async (profileData: Partial<User>) => {
    if (!token) return { success: false, error: '未登录' };
    try {
      const data = await authApi.updateProfile<User>(token, profileData);
      if (!data) {
        return { success: false, error: '返回数据异常' };
      }
      const updatedUser = { ...user, ...data } as User;
      const applied = await sessionCoordinator.current.updateIfCurrent(sessionGeneration, async () => {
        await AsyncStorage.setItem(AUTH_USER_KEY, JSON.stringify(storedAuthIdentity(updatedUser)));
        setUser(updatedUser);
      });
      if (!applied) return { success: false, error: '登录账号已变化，请重新打开资料页面' };
      return { success: true };
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.code === 'ACCOUNT_DISABLED')) {
        await logout(e.code === 'ACCOUNT_DISABLED' ? '账号已停用，请联系管理员了解详情。' : '登录会话已失效，请重新登录。');
        return { success: false, error: e.code === 'ACCOUNT_DISABLED' ? '账号已停用' : '登录已过期，请重新登录' };
      }
      return { success: false, error: e instanceof Error ? e.message : '网络错误，请稍后重试' };
    }
  }, [token, user, logout, sessionGeneration]);

  const refreshUser = useCallback(async () => {
    if (!token) return false;
    try {
      const data = await authApi.me<User>(token);
      return await sessionCoordinator.current.updateIfCurrent(sessionGeneration, async () => {
        await AsyncStorage.setItem(AUTH_USER_KEY, JSON.stringify(storedAuthIdentity(data)));
        setUser(data);
      });
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.code === 'ACCOUNT_DISABLED')) {
        await logout(e.code === 'ACCOUNT_DISABLED' ? '账号已停用，请联系管理员了解详情。' : '登录会话已失效，请重新登录。');
      }
      return false;
    }
  }, [token, logout, sessionGeneration]);

  useEffect(() => {
    if (!token) return;
    const refresh = () => { void refreshUser(); };
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    const onVisibility = () => { if (document.visibilityState === 'visible') refresh(); };
    if (Platform.OS === 'web' && typeof window !== 'undefined') window.addEventListener('online', refresh);
    if (Platform.OS === 'web' && typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
    return () => {
      subscription.remove();
      if (Platform.OS === 'web' && typeof window !== 'undefined') window.removeEventListener('online', refresh);
      if (Platform.OS === 'web' && typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refreshUser, token]);

  const deleteAccount = useCallback(async (proof: string | AccountDeletionProof) => {
    if (!token || !user) return { success: false, error: '请先登录' };
    try {
      await authApi.deleteAccount(token, proof);
      await clearAuthState(sessionGeneration, user.id);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '账号删除失败' };
    }
  }, [clearAuthState, sessionGeneration, token, user]);

  const clearSessionMessage = useCallback(() => setSessionMessage(null), []);

  const value = React.useMemo(
    () => ({
      user,
      token,
      isLoading,
      isAuthenticated: !!token,
      login,
      register,
      pendingSmsRegistration,
      sessionMessage,
      clearSessionMessage,
      sendSmsCode,
      verifySmsCode,
      completeSmsRegistration,
      clearPendingSmsRegistration,
      logout,
      sessionGeneration,
      isSessionCurrent,
      updateProfile,
      deleteAccount,
      refreshUser,
    }),
    [user, token, isLoading, login, register, pendingSmsRegistration, sessionMessage, clearSessionMessage, sendSmsCode, verifySmsCode, completeSmsRegistration, clearPendingSmsRegistration, logout, sessionGeneration, isSessionCurrent, updateProfile, deleteAccount, refreshUser]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

/**
 * Helper to make authenticated API calls
 */
export function useAuthFetch() {
  const { token, user, logout, sessionGeneration } = useAuth();

  const authFetch = useCallback(async (url: string, options: RequestInit = {}) => {
    // requestJson 传入的是 Headers 实例。对象展开会丢失其中的
    // Content-Type，导致 Express 不解析 POST 的 JSON 正文。
    const headers = new Headers(options.headers);
    headers.set('X-Account-Security', ACCOUNT_SECURITY_CAPABILITY);
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    const response = await fetch(url, { ...options, headers });
    if (response.status === 401) {
      await logout('登录会话已失效，请重新登录。', sessionGeneration);
    } else if (response.status === 403) {
      const body = await response.clone().json().catch(() => null) as { code?: string } | null;
      if (body?.code === 'ACCOUNT_DISABLED') {
        await logout('账号已停用，请联系管理员了解详情。', sessionGeneration);
      }
    }
    return response;
  }, [token, logout, sessionGeneration]);
  registerApiFetchScope(authFetch, user?.id);
  return authFetch;
}
