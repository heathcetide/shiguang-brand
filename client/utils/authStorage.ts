import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

// Android SecureStore keys only allow alphanumeric characters, `.`, `-`, and `_`.
// Keep the old AsyncStorage key separate so installed builds can migrate safely.
const SECURE_TOKEN_KEY = "auth_token";
const LEGACY_TOKEN_KEY = "@auth_token";
export const AUTH_USER_KEY = "@auth_user";

export async function getStoredToken() {
  if (Platform.OS === "web") {
    const sessionToken = globalThis.sessionStorage?.getItem(SECURE_TOKEN_KEY) || null;
    if (sessionToken) return sessionToken;

    const legacySessionToken = globalThis.sessionStorage?.getItem(LEGACY_TOKEN_KEY) || null;
    const legacyToken = legacySessionToken || await AsyncStorage.getItem(LEGACY_TOKEN_KEY);
    if (legacyToken) globalThis.sessionStorage?.setItem(SECURE_TOKEN_KEY, legacyToken);
    globalThis.sessionStorage?.removeItem(LEGACY_TOKEN_KEY);
    await AsyncStorage.removeItem(LEGACY_TOKEN_KEY);
    return legacyToken;
  }
  const secureToken = await SecureStore.getItemAsync(SECURE_TOKEN_KEY);
  if (secureToken) return secureToken;

  const legacyToken = await AsyncStorage.getItem(LEGACY_TOKEN_KEY);
  if (legacyToken) {
    await SecureStore.setItemAsync(SECURE_TOKEN_KEY, legacyToken);
    await AsyncStorage.removeItem(LEGACY_TOKEN_KEY);
  }
  return legacyToken;
}

export async function setStoredToken(token: string) {
  if (Platform.OS === "web") {
    globalThis.sessionStorage?.setItem(SECURE_TOKEN_KEY, token);
    globalThis.sessionStorage?.removeItem(LEGACY_TOKEN_KEY);
    await AsyncStorage.removeItem(LEGACY_TOKEN_KEY);
    return;
  }
  await SecureStore.setItemAsync(SECURE_TOKEN_KEY, token);
  await AsyncStorage.removeItem(LEGACY_TOKEN_KEY);
}

export async function removeStoredToken() {
  if (Platform.OS === "web") {
    globalThis.sessionStorage?.removeItem(SECURE_TOKEN_KEY);
    globalThis.sessionStorage?.removeItem(LEGACY_TOKEN_KEY);
    await AsyncStorage.removeItem(LEGACY_TOKEN_KEY);
    return;
  }
  await Promise.all([
    SecureStore.deleteItemAsync(SECURE_TOKEN_KEY),
    AsyncStorage.removeItem(LEGACY_TOKEN_KEY),
  ]);
}
