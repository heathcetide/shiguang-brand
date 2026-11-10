/**
 * 安全路由 Hook - 完全代替原生的 useRouter 和 useLocalSearchParams
 *
 * 提供的 Hook：
 * - useSafeRouter: 代替 useRouter，包含所有路由方法，并对 push/replace/navigate/setParams 进行安全编码
 * - useSafeSearchParams: 代替 useLocalSearchParams，获取路由参数
 *
 * 解决的问题：
 * 1. URI 编解码不对称 - useLocalSearchParams 会自动解码，但 router.push 不会自动编码，
 *    当参数包含 % 等特殊字符时会拿到错误的值
 * 2. 类型丢失 - URL 参数全是 string，Number/Boolean 类型会丢失
 * 3. 嵌套对象无法传递 - URL search params 不支持嵌套结构
 *
 * 解决方案：
 * 采用 Payload 模式，将所有参数打包成 JSON 并 Base64 编码后传递，
 * 接收时再解码还原，确保数据完整性和类型安全。
 *
 * 优点：
 * 1. 自动处理所有特殊字符（如 %、&、=、中文、Emoji 等）
 * 2. 保留数据类型（Number、Boolean 不会变成 String）
 * 3. 支持嵌套对象和数组传递
 * 4. 三端兼容（iOS、Android、Web）
 *
 * 使用方式：
 * ```tsx
 * // 发送端 - 使用 useSafeRouter 代替 useRouter
 * const router = useSafeRouter();
 * router.push('/detail', { id: 123, uri: 'file:///path/%40test.mp3' });
 * router.replace('/home', { tab: 'settings' });
 * router.navigate('/profile', { userId: 456 });
 * router.back();
 * if (router.canGoBack()) { ... }
 * router.setParams({ updated: true });
 *
 * // 接收端 - 使用 useSafeSearchParams 代替 useLocalSearchParams
 * const { id, uri } = useSafeSearchParams<{ id: number; uri: string }>();
 * ```
 */
import { useMemo } from 'react';
import { useRouter as useExpoRouter, useLocalSearchParams as useExpoParams } from 'expo-router';
import { Base64 } from 'js-base64';

const PAYLOAD_KEY = '__safeRouterPayload__';
const LOG_PREFIX = '[SafeRouter]';
const SENSITIVE_PARAM_KEYS = new Set(['token', 'authorization', 'password', 'secret', 'user', 'userInfo']);


const getCurrentParams = (rawParams: Record<string, string | string[]>): Record<string, unknown> => {
  const payload = rawParams[PAYLOAD_KEY];
  if (payload && typeof payload === 'string') {
    const decoded = deserializeParams<Record<string, unknown>>(payload);
    if (decoded && Object.keys(decoded).length > 0) {
      return decoded;
    }
  }
  const { [PAYLOAD_KEY]: _, ...rest } = rawParams;
  return rest as Record<string, unknown>;
};

const hasParams = (params: Record<string, unknown>): boolean => {
  return Object.keys(params).length > 0;
};

const sanitizeParams = (params: Record<string, unknown>): Record<string, unknown> => {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (SENSITIVE_PARAM_KEYS.has(key)) continue;
    if (value !== undefined) {
      cleaned[key] = value;
    }
  }
  return cleaned;
};

const serializeParams = (params: Record<string, unknown>): string | null => {
  if (!hasParams(params)) return null;
  try {
    const jsonStr = JSON.stringify(params);
    if (jsonStr === '{}') return null;
    return Base64.encode(jsonStr);
  } catch (error) {
    console.error(LOG_PREFIX, 'serialize failed:', error instanceof Error ? error.message : 'Unknown error');
    return null;
  }
};

const deserializeParams = <T = Record<string, unknown>>(
  payload: string | string[] | undefined
): T | null => {
  if (!payload || typeof payload !== 'string') {
    return null;
  }
  try {
    const jsonStr = Base64.decode(payload);
    return JSON.parse(jsonStr) as T;
  } catch (error) {
    console.error(LOG_PREFIX, 'deserialize failed:', error instanceof Error ? error.message : 'Unknown error');
    return null;
  }
};


export type SafeRouterTarget = string | { pathname: string; params?: Record<string, unknown> };

const encodeTarget = (target: SafeRouterTarget, extraParams: Record<string, unknown> = {}) => {
  let pathname = '';
  let params: Record<string, unknown> = {};

  if (typeof target === 'string') {
    pathname = target;
    params = extraParams || {};
  } else if (target && typeof target === 'object') {
    pathname = target.pathname || '';
    params = { ...(target.params || {}), ...(extraParams || {}) };
  }

  const encodedPayload = serializeParams(sanitizeParams({ ...(params || {}) }));
  const path = pathname as `/${string}`;
  return encodedPayload ? { pathname: path, params: { [PAYLOAD_KEY]: encodedPayload } } : path;
};

/**
 * 安全路由 Hook，用于页面跳转，代替 useRouter
 * @returns 路由方法（继承 useRouter 所有方法，并对以下方法进行安全编码）
 * - push(pathname/target, params) - 入栈新页面
 * - replace(pathname/target, params) - 替换当前页面
 * - navigate(pathname/target, params) - 智能跳转（已存在则返回，否则 push）
 * - setParams(params) - 更新当前页面参数（合并现有参数）
 */
export function useSafeRouter() {
  const router = useExpoRouter();
  const rawParams = useExpoParams<Record<string, string | string[]>>();

  const setParams = (params: Record<string, unknown>) => {
    const shouldClearAll = Object.keys(params).length === 0;
    const currentParams = getCurrentParams(rawParams);
    const mergedParams = shouldClearAll ? {} : { ...currentParams, ...params };
    const cleanedMergedParams = sanitizeParams(mergedParams as Record<string, unknown>);
    const encodedPayload = serializeParams(cleanedMergedParams);
    if (!encodedPayload) {
      // Expo Router merges params. An empty object leaves the previous payload in
      // place, so explicitly remove our single encoded query parameter.
      router.setParams({ [PAYLOAD_KEY]: undefined });
      return;
    }
    router.setParams({ [PAYLOAD_KEY]: encodedPayload });
  };

  return {
    ...router,
    push: (target: SafeRouterTarget, params?: Record<string, unknown>) => router.push(encodeTarget(target, params)),
    replace: (target: SafeRouterTarget, params?: Record<string, unknown>) => router.replace(encodeTarget(target, params)),
    navigate: (target: SafeRouterTarget, params?: Record<string, unknown>) => router.navigate(encodeTarget(target, params)),
    setParams,
  };
}

/**
 * 安全获取路由参数 Hook，用于接收方，代替 useLocalSearchParams
 * 兼容两种跳转方式：
 * 1. useSafeRouter 跳转 - 自动解码 Payload
 * 2. 外部跳转（深链接、浏览器直接访问等）- 回退到原始参数
 * @returns 解码后的参数对象，类型安全
 */
export function useSafeSearchParams<T = Record<string, unknown>>(): T {
  const rawParams = useExpoParams<Record<string, string | string[]>>();

  const decodedParams = useMemo(() => {
    return getCurrentParams(rawParams) as T;
  }, [rawParams]);

  return decodedParams;
}
