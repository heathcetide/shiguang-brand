export type DemoLogin = { identifier: string; password: string };

/** Public, disposable demo credentials only. Never map server secrets into Expo. */
export function getDemoLogin(): DemoLogin | null {
  if (!__DEV__) return null;
  const identifier = process.env.EXPO_PUBLIC_DEMO_LOGIN_IDENTIFIER?.trim();
  const password = process.env.EXPO_PUBLIC_DEMO_LOGIN_PASSWORD;
  return identifier && password ? { identifier, password } : null;
}
