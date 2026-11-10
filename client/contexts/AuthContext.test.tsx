import React from "react";
import renderer, { act } from "react-test-renderer";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { authApi } from "@/services/api";
import { AUTH_USER_KEY, getStoredToken } from "@/utils/authStorage";
import { AuthProvider, useAuth } from "./AuthContext";

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
jest.mock("@/services/api", () => ({
  ApiError: class extends Error {},
  authApi: { login: jest.fn(), me: jest.fn(), updateProfile: jest.fn(),verifySmsCode:jest.fn() },
}));
jest.mock("@/services/api/cache", () => ({
  clearApiCacheScope: jest.fn().mockResolvedValue(undefined), registerApiFetchScope: jest.fn(),
  maintainApiCache: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/utils/authStorage", () => ({
  AUTH_USER_KEY: "@auth_user", getStoredToken: jest.fn(),
  setStoredToken: jest.fn().mockResolvedValue(undefined), removeStoredToken: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/utils/userStorage", () => ({
  activatePrivateStorage: jest.fn(), invalidatePrivateStorage: jest.fn(),
  purgeLegacyUnscopedPrivateStorage: jest.fn().mockResolvedValue(undefined),
  purgeUserPrivateStorage: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/utils/notifications", () => ({
  cancelAllLocalNotificationsForUser: jest.fn().mockResolvedValue(undefined),
  cancelLegacyUnscopedLocalNotifications: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/services/voicePackManager", () => ({
  purgeVoiceAudioCacheForUser: jest.fn().mockResolvedValue(undefined),
  stopVoiceOutput: jest.fn().mockResolvedValue(undefined),
}));

const userA = { id: 1, username: "A", avatar_url: null, bio: null };
const userB = { id: 2, username: "B", avatar_url: null, bio: null };
let auth: ReturnType<typeof useAuth>;
let tree: renderer.ReactTestRenderer;
function Probe() {
  const value = useAuth();
  React.useEffect(() => { auth = value; }, [value]);
  return null;
}
async function mount() {
  await act(async () => { tree = renderer.create(<AuthProvider><Probe /></AuthProvider>); });
}
async function loginAsB() {
  jest.mocked(authApi.login).mockResolvedValue({ token: "token-B", user: userB });
  await act(async () => { await auth.login("B", "password"); });
}

beforeEach(async () => {
  jest.clearAllMocks();
  jest.spyOn(AppState, "addEventListener").mockReturnValue({ remove: jest.fn() });
  await AsyncStorage.clear();
  jest.mocked(getStoredToken).mockResolvedValue(null);
});
afterEach(() => { act(() => tree?.unmount()); });

it("keeps the new-user signal after passwordless SMS authentication",async () => {
  await mount();
  jest.mocked(authApi.verifySmsCode).mockResolvedValue({status:"authenticated",token:"new-token",user:{...userA,hasPassword:false},isNewUser:true});
  let result:Awaited<ReturnType<typeof auth.verifySmsCode>> | undefined;
  await act(async () => {result=await auth.verifySmsCode("challenge","123456");});
  expect(result).toEqual({success:true,registrationRequired:false,isNewUser:true});
  expect(auth.user?.hasPassword).toBe(false);
  expect(auth.pendingSmsRegistration).toBeNull();
});

it.each(["profile", "refresh"])("ignores a delayed %s response from the previous account", async kind => {
  await mount();
  jest.mocked(authApi.login).mockResolvedValue({ token: "token-A", user: userA });
  await act(async () => { await auth.login("A", "password"); });
  let resolveResponse!: (value: typeof userA) => void;
  const response = new Promise<typeof userA>(resolve => { resolveResponse = resolve; });
  jest.mocked(authApi.updateProfile).mockReturnValue(response);
  jest.mocked(authApi.me).mockReturnValue(response);
  let pending!: Promise<unknown>;
  act(() => { pending = kind === "profile" ? auth.updateProfile({ bio: "updated" }) : auth.refreshUser(); });
  await act(async () => { await auth.logout(); });
  await loginAsB();
  await act(async () => { resolveResponse({ ...userA, username: "A updated" }); await pending; });
  expect(auth.token).toBe("token-B");
  expect(auth.user).toEqual(userB);
  expect(JSON.parse((await AsyncStorage.getItem(AUTH_USER_KEY))!)).toEqual({ id: userB.id, username: userB.username });
});

it("ignores delayed startup verification after the session changes", async () => {
  await AsyncStorage.setItem(AUTH_USER_KEY, JSON.stringify(userA));
  jest.mocked(getStoredToken).mockResolvedValue("token-A");
  let resolveResponse!: (value: typeof userA) => void;
  jest.mocked(authApi.me).mockReturnValue(new Promise(resolve => { resolveResponse = resolve; }));
  await mount();
  expect(auth.user).toEqual(userA);
  await act(async () => { await auth.logout(); });
  await loginAsB();
  await act(async () => { resolveResponse({ ...userA, username: "A refreshed" }); });
  expect(auth.token).toBe("token-B");
  expect(auth.user).toEqual(userB);
  expect(JSON.parse((await AsyncStorage.getItem(AUTH_USER_KEY))!)).toEqual({ id: userB.id, username: userB.username });
});

it("checks the live login generation after screen teardown, account changes and provider teardown", async () => {
  await mount();
  jest.mocked(authApi.login).mockResolvedValue({ token: "token-A", user: userA });
  await act(async () => { await auth.login("A", "password"); });
  const check = auth.isSessionCurrent;
  const firstGeneration = auth.sessionGeneration;
  expect(check(userA.id, firstGeneration)).toBe(true);
  jest.mocked(authApi.login).mockResolvedValue({ token: "token-A-replaced", user: userA });
  await act(async () => { await auth.login("A", "password"); });
  expect(check(userA.id, firstGeneration)).toBe(false);
  expect(check(userA.id, auth.sessionGeneration)).toBe(true);
  await loginAsB();
  const secondGeneration = auth.sessionGeneration;
  expect(check(userA.id, secondGeneration)).toBe(false);
  expect(check(userB.id, secondGeneration)).toBe(true);
  act(() => tree.unmount());
  expect(check(userB.id, secondGeneration)).toBe(false);
});


it("migrates the legacy profile before an offline session is exposed", async () => {
  const profile = { ...userA, bio: "private bio", email: "private@example.test", phone: "123", daily_calories_target: 1800, avatar_url: "data:image/private" };
  await AsyncStorage.setItem(AUTH_USER_KEY, JSON.stringify(profile));
  jest.mocked(getStoredToken).mockResolvedValue("token-A");
  jest.mocked(authApi.me).mockRejectedValue(new Error("offline"));
  await mount();
  expect(auth.isAuthenticated).toBe(true);
  expect(auth.user).toEqual(userA);
  expect(JSON.parse((await AsyncStorage.getItem(AUTH_USER_KEY))!)).toEqual({ id: 1, username: "A" });
});

it("refreshes the full profile online without persisting it", async () => {
  const profile = { ...userA, bio: "private bio", daily_calories_target: 1800 };
  await AsyncStorage.setItem(AUTH_USER_KEY, JSON.stringify({ id: 1, username: "A" }));
  jest.mocked(getStoredToken).mockResolvedValue("token-A");
  jest.mocked(authApi.me).mockResolvedValue(profile);
  await mount();
  expect(auth.user).toEqual(profile);
  expect(JSON.parse((await AsyncStorage.getItem(AUTH_USER_KEY))!)).toEqual({ id: 1, username: "A" });
});

it("removes an orphaned legacy profile when there is no saved session", async () => {
  await AsyncStorage.setItem(AUTH_USER_KEY, JSON.stringify({ ...userA, bio: "private bio" }));
  await mount();
  expect(await AsyncStorage.getItem(AUTH_USER_KEY)).toBeNull();
});

it("does not let delayed startup identity migration overwrite a newer login", async () => {
  let finish!: (value: string | null) => void;
  jest.mocked(getStoredToken).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  await mount();
  await loginAsB();
  await act(async () => { finish(null); });
  expect(auth.user).toEqual(userB);
  expect(JSON.parse((await AsyncStorage.getItem(AUTH_USER_KEY))!)).toEqual({ id: 2, username: "B" });
});


it("refreshes omitted profile fields when an offline session returns to foreground", async () => {
  let notify!: (state: "active") => void;
  const listener = jest.spyOn(AppState, "addEventListener").mockImplementation((_event, handler) => {
    notify = handler;
    return { remove: jest.fn() };
  });
  try {
    await AsyncStorage.setItem(AUTH_USER_KEY, JSON.stringify({ id: 1, username: "A" }));
    jest.mocked(getStoredToken).mockResolvedValue("token-A");
    jest.mocked(authApi.me).mockRejectedValueOnce(new Error("offline"));
    await mount();
    expect(auth.user).toEqual(userA);
    const profile = { ...userA, bio: "online profile", daily_calories_target: 1800 };
    jest.mocked(authApi.me).mockResolvedValue(profile);
    await act(async () => { notify("active"); });
    expect(auth.user).toEqual(profile);
    expect(JSON.parse((await AsyncStorage.getItem(AUTH_USER_KEY))!)).toEqual({ id: 1, username: "A" });
  } finally { listener.mockRestore(); }
});


it("keeps SMS-only recovery/deletion metadata after offline restore without retaining contact or health fields", async () => {
  await AsyncStorage.setItem(AUTH_USER_KEY, JSON.stringify({ ...userA, hasPassword: false, phone_verified_at: "2026-09-20", phone: "+861234", daily_calories_target: 1600 }));
  jest.mocked(getStoredToken).mockResolvedValue("token-A");
  jest.mocked(authApi.me).mockRejectedValue(new Error("offline"));
  await mount();
  expect(auth.user).toEqual({ ...userA, hasPassword: false, phone_verified_at: "2026-09-20" });
  expect(JSON.parse((await AsyncStorage.getItem(AUTH_USER_KEY))!)).toEqual({ id: 1, username: "A", hasPassword: false, phone_verified_at: "2026-09-20" });
});


it("cancels the previous account's local reminders on direct account switch and logout", async () => {
  const { cancelAllLocalNotificationsForUser } = jest.requireMock("@/utils/notifications");
  await mount();
  jest.mocked(authApi.login).mockResolvedValue({ token: "token-A", user: userA });
  await act(async () => { await auth.login("A", "password"); });
  await loginAsB();
  expect(cancelAllLocalNotificationsForUser).toHaveBeenCalledWith(userA.id);
  await act(async () => { await auth.logout(); });
  expect(cancelAllLocalNotificationsForUser).toHaveBeenCalledWith(userB.id);
});

it("reports refresh completion and keeps bound contact details out of durable storage", async () => {
  await mount();
  await expect(auth.refreshUser()).resolves.toBe(false);
  await loginAsB();
  const boundUser = { ...userB, phone: "13800000000", email: "b@example.invalid", hasPassword: true, phone_verified_at: "2026-10-25", role: "user" };
  jest.mocked(authApi.me).mockResolvedValueOnce(boundUser);
  await act(async () => { expect(await auth.refreshUser()).toBe(true); });
  expect(auth.user).toEqual(boundUser);
  expect(JSON.parse((await AsyncStorage.getItem(AUTH_USER_KEY))!)).toEqual({ id: 2, username: "B", hasPassword: true, phone_verified_at: "2026-10-25" });
  jest.mocked(authApi.me).mockRejectedValueOnce(new Error("offline"));
  await act(async () => { expect(await auth.refreshUser()).toBe(false); });
  expect(auth.user).toEqual(boundUser);
});
