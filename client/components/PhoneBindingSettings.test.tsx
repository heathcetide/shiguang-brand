import React from "react";
import renderer, { act } from "react-test-renderer";
import { Modal, Text, TextInput, TouchableOpacity } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
jest.mock("@/services/api/cache", () => ({ registerApiFetchScope: jest.fn(), invalidateApiCacheForMutation: jest.fn() }));
const account = { id: 1, username: "Synthetic A", email: "a@example.invalid" as string | null, phone: null as string | null | undefined, phone_verified_at: null as string | null, hasPassword: true, role: "user" };
let mockUser: typeof account | null = { ...account };
let mockGeneration = 1;
const mockFetch = jest.fn();
const mockRefresh = jest.fn();
const mockCurrent = jest.fn((id: number, generation: number) => id === mockUser?.id && generation === mockGeneration);
const mockBlur = new Set<() => void>();
const mockFocus = new Set<() => void>();
jest.mock("expo-router", () => ({ useFocusEffect: (callback: () => () => void) => {
  require("react").useEffect(() => {
    let cleanup = callback(); mockBlur.add(cleanup);
    const focus = () => { mockBlur.delete(cleanup); cleanup = callback(); mockBlur.add(cleanup); };
    mockFocus.add(focus);
    return () => { mockFocus.delete(focus); mockBlur.delete(cleanup); cleanup(); };
  }, [callback]);
} }));
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: mockUser, sessionGeneration: mockGeneration, isSessionCurrent: mockCurrent, refreshUser: mockRefresh }), useAuthFetch: () => mockFetch }));
import { PhoneBindingSettings } from "./PhoneBindingSettings";
const sent = { challengeId: "12345678-1234-4234-8234-123456789abc", phoneMasked: "138****0000", expiresIn: 300, resendAfter: 60 };
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, headers: new Headers(), json: async () => body }) as Response;
const deferred = () => { let resolve!: (value: Response) => void; const promise = new Promise<Response>(r => { resolve = r; }); return { promise, resolve }; };
let tree: renderer.ReactTestRenderer;
const button = (label: string) => tree.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === label)!;
const hasText = (text: string) => tree.root.findAllByType(Text).some(node => JSON.stringify(node.props.children).includes(text));
const input = (label: string, value: string) => act(() => tree.root.findAllByType(TextInput).find(node => node.props.accessibilityLabel === label)!.props.onChangeText(value));
const press = async (label: string) => { await act(async () => { button(label).props.onPress(); }); };
const open = () => press("首次绑定手机号");
const fill = () => { input("绑定手机号", "+8613800000000"); input("绑定当前密码", "synthetic-password"); };
const send = async () => { fill(); mockFetch.mockResolvedValueOnce(json(sent, 201)); await press("发送绑定验证码"); };
const rerender = async () => { await act(async () => tree.update(<PhoneBindingSettings key={`${mockUser?.id}:${mockGeneration}`} />)); };
const textButton = (label: string) => tree.root.findAllByType(TouchableOpacity).find(node => node.findAllByType(Text).some(text => text.props.children === label))!;
beforeEach(async () => {
  jest.useFakeTimers(); jest.clearAllMocks(); mockUser = { ...account }; mockGeneration = 1;
  mockFetch.mockReset(); mockRefresh.mockReset().mockResolvedValue(true); await AsyncStorage.clear();
  await act(async () => { tree = renderer.create(<PhoneBindingSettings key="1:1" />); });
});
afterEach(() => { act(() => tree.unmount()); jest.useRealTimers(); });

it("only offers first binding for eligible accounts and masks verified and legacy phones", async () => {
  expect(button("首次绑定手机号")).toBeDefined();
  for (const patch of [{ phone: undefined }, { hasPassword: false }, { role: "admin" }, { email: "" }]) {
    mockUser = { ...account, ...patch }; await rerender(); expect(button("首次绑定手机号")).toBeUndefined();
  }
  mockUser = { ...account, phone: "+8613800000000", phone_verified_at: "2026-10-25" }; await rerender();
  expect(hasText("138****0000")).toBe(true); expect(hasText("已验证")).toBe(true); expect(hasText("13800000000")).toBe(false);
  mockUser = { ...mockUser, phone_verified_at: null }; await rerender(); expect(hasText("未验证")).toBe(true); expect(button("首次绑定手机号")).toBeUndefined();
  mockUser = null; await rerender(); expect(tree.toJSON()).toBeNull();
});
it("uses binding contracts, clears secrets, refreshes the original account without persisting or logging proofs", async () => {
  const log = jest.spyOn(console, "log"); const error = jest.spyOn(console, "error");
  await open(); await send();
  expect(mockFetch.mock.calls[0][0]).toMatch(/\/auth\/phone-binding\/send$/);
  expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ phone: "13800000000", currentPassword: "synthetic-password" });
  expect(tree.root.findByProps({ accessibilityLabel: "绑定当前密码" }).props.value).toBe(""); expect(hasText("实际送达以手机收码为准")).toBe(true);
  input("绑定验证码", "123456"); mockFetch.mockResolvedValueOnce(json({ success: true, phoneMasked: sent.phoneMasked })); await press("确认绑定");
  expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual({ challengeId: sent.challengeId, code: "123456" }); expect(mockFetch.mock.calls[1][0]).toMatch(/\/auth\/phone-binding\/verify$/);
  expect(mockRefresh).toHaveBeenCalledTimes(3); expect(hasText("账号状态已刷新")).toBe(true); expect(button("确认绑定")).toBeUndefined();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled(); expect(JSON.stringify([...log.mock.calls, ...error.mock.calls])).not.toMatch(/synthetic-password|123456/);
  log.mockRestore(); error.mockRestore(); await press("关闭手机号绑定"); expect(button("首次绑定手机号")).toBeUndefined(); expect(hasText("已验证")).toBe(true);
});
it.each([[403, "INVALID_PASSWORD", "当前密码不正确"], [409, "PHONE_EXISTS", "该手机号已被使用"], [429, "PHONE_BINDING_RATE_LIMITED", "绑定请求过于频繁"], [503, "SMS_DISABLED", "短信服务未启用"], [502, "SMS_PROVIDER_REJECTED", "短信发送失败"]])("shows real send errors %s %s without success", async (status, code, error) => {
  await open(); fill(); mockFetch.mockResolvedValueOnce(json({ code, error }, status as number)); await press("发送绑定验证码");
  expect(hasText(error as string)).toBe(true); expect(hasText("已受理")).toBe(false); expect(button("确认绑定")).toBeUndefined(); expect(tree.root.findByProps({ accessibilityLabel: "绑定当前密码" }).props.value).toBe("");
});
it.each([[400, "SMS_CODE_INVALID", true], [410, "SMS_CODE_EXPIRED", false], [409, "PHONE_EXISTS", false], [429, "SMS_VERIFY_LIMITED", false], [403, "PHONE_BINDING_INVALID", false], [502, "SMS_VERIFY_UNAVAILABLE", true]])("handles verify failure %s %s", async (status, code, retryable) => {
  await open(); await send(); input("绑定验证码", "123456"); mockFetch.mockResolvedValueOnce(json({ code, error: "真实服务错误" }, status as number)); await press("确认绑定");
  expect(hasText("真实服务错误")).toBe(true); expect(!!button("确认绑定")).toBe(retryable); expect(hasText("手机号已绑定并验证")).toBe(false);
  if (retryable) expect(tree.root.findByProps({ accessibilityLabel: "绑定验证码" }).props.value).toBe("");
});
it("locks same-tick duplicate sends and verifies", async () => {
  await open(); fill(); const sending = deferred(); mockFetch.mockReturnValueOnce(sending.promise); const click = button("发送绑定验证码").props.onPress;
  act(() => { click(); click(); }); expect(mockFetch).toHaveBeenCalledTimes(1); await act(async () => sending.resolve(json(sent)));
  input("绑定验证码", "123456"); const verifying = deferred(); mockFetch.mockReturnValueOnce(verifying.promise); const verify = button("确认绑定").props.onPress;
  act(() => { verify(); verify(); }); expect(mockFetch).toHaveBeenCalledTimes(2); await act(async () => verifying.resolve(json({ success: true, phoneMasked: sent.phoneMasked })));
});
it.each(["cancel", "hardware", "blur", "unmount"])("ignores late send after %s and aborts transport", async mode => {
  await open(); fill(); const request = deferred(); mockFetch.mockReturnValueOnce(request.promise); await press("发送绑定验证码"); const signal = mockFetch.mock.calls[0][1].signal;
  if (mode === "cancel") await press("关闭手机号绑定"); else if (mode === "hardware") act(() => tree.root.findByType(Modal).props.onRequestClose()); else if (mode === "blur") act(() => { [...mockBlur].forEach(cleanup => cleanup()); }); else act(() => tree.unmount());
  expect(signal.aborted).toBe(true); await act(async () => request.resolve(json(sent))); expect(mockRefresh).toHaveBeenCalledTimes(2);
  if (mode === "blur") await act(async () => { [...mockFocus].forEach(focus => focus()); });
  if (mode !== "unmount") { await open(); expect(button("确认绑定")).toBeUndefined(); expect(tree.root.findByProps({ accessibilityLabel: "绑定当前密码" }).props.value).toBe(""); }
});
it("does not share aborted mutations when reopened", async () => {
  await open(); fill(); const old = deferred(); mockFetch.mockReturnValueOnce(old.promise); await press("发送绑定验证码"); await press("关闭手机号绑定"); await open(); await send(); expect(mockFetch).toHaveBeenCalledTimes(2);
  await act(async () => old.resolve(json({ error: "old error" }, 502))); expect(hasText("old error")).toBe(false);
});
it.each(["switch", "same-user-session", "logout", "close"])("isolates late verification after %s", async mode => {
  await open(); await send(); input("绑定验证码", "123456"); const request = deferred(); mockFetch.mockReturnValueOnce(request.promise); await press("确认绑定");
  if (mode === "close") await press("关闭手机号绑定"); else { mockGeneration++; if (mode === "switch") mockUser = { ...account, id: 2 }; if (mode === "logout") mockUser = null; await rerender(); }
  const count = mockRefresh.mock.calls.length; await act(async () => request.resolve(json({ success: true, phoneMasked: sent.phoneMasked })));
  expect(mockRefresh).toHaveBeenCalledTimes(count); expect(hasText("手机号已绑定并验证")).toBe(false);
});
it("keeps cooldown on back, expires by wall clock, and requires a new password for resend", async () => {
  await open(); await send(); input("绑定验证码", "123456"); act(() => jest.advanceTimersByTime(300000)); expect(button("确认绑定").props.disabled).toBe(true); expect(hasText("验证码已过期")).toBe(true); expect(button("发送绑定验证码").props.disabled).toBe(true);
  input("绑定当前密码", "new-proof"); mockFetch.mockResolvedValueOnce(json(sent)); await press("发送绑定验证码"); act(() => textButton("返回修改手机号").props.onPress()); expect(button("确认绑定")).toBeUndefined();
  input("绑定当前密码", "new-proof"); expect(button("发送绑定验证码").props.disabled).toBe(true);
});
it("rejects malformed success and invalid input", async () => {
  await open(); input("绑定手机号", "bad"); input("绑定当前密码", "secret"); await press("发送绑定验证码"); expect(mockFetch).not.toHaveBeenCalled(); fill(); mockFetch.mockResolvedValueOnce(json({ success: true })); await press("发送绑定验证码"); expect(hasText("不符合 API 契约")).toBe(true);
  await send(); input("绑定验证码", "123456"); mockFetch.mockResolvedValueOnce(json({ success: false })); await press("确认绑定"); expect(hasText("手机号已绑定并验证")).toBe(false);
});
it("retries only refresh when binding succeeded but account refresh failed", async () => {
  await open(); await send(); input("绑定验证码", "123456"); mockRefresh.mockResolvedValueOnce(false); mockFetch.mockResolvedValueOnce(json({ success: true, phoneMasked: sent.phoneMasked })); await press("确认绑定");
  expect(hasText("账号状态刷新失败")).toBe(true); expect(button("确认绑定")).toBeUndefined(); await act(async () => textButton("重新刷新账号状态").props.onPress()); expect(hasText("账号状态已刷新")).toBe(true); expect(mockFetch).toHaveBeenCalledTimes(2);
});


it("reconciles a binding committed after cancellation before reopening", async () => {
  await open(); await send(); input("绑定验证码", "123456");
  const request = deferred(); mockFetch.mockReturnValueOnce(request.promise); await press("确认绑定");
  await press("关闭手机号绑定"); await act(async () => request.resolve(json({ success: true, phoneMasked: sent.phoneMasked })));
  expect(button("首次绑定手机号")).toBeDefined();
  mockRefresh.mockImplementationOnce(async () => { mockUser = { ...account, phone: "13800000000", phone_verified_at: "2026-10-25" }; return true; });
  await open();
  expect(button("首次绑定手机号")).toBeUndefined(); expect(button("发送绑定验证码")).toBeUndefined(); expect(hasText("已验证")).toBe(true);
  expect(mockFetch).toHaveBeenCalledTimes(2);
});

it("does not open with stale account state when the preflight read fails or the screen leaves", async () => {
  mockRefresh.mockResolvedValueOnce(false); await open(); expect(button("发送绑定验证码")).toBeUndefined(); expect(hasText("暂时无法确认手机号状态")).toBe(true);
  let resolve!: (value: boolean) => void;
  mockRefresh.mockReturnValueOnce(new Promise<boolean>(r => { resolve = r; }));
  const click = button("首次绑定手机号").props.onPress; act(() => { click(); click(); });
  expect(mockRefresh).toHaveBeenCalledTimes(3);
  act(() => { [...mockBlur].forEach(cleanup => cleanup()); });
  await act(async () => { [...mockFocus].forEach(focus => focus()); });
  await act(async () => resolve(true)); expect(button("发送绑定验证码")).toBeUndefined();
  await open(); expect(button("发送绑定验证码")).toBeDefined();
});

it.each(["send", "verify"])("reports transport failure during %s without claiming binding or delivery", async stage => {
  await open();
  if (stage === "verify") { await send(); input("绑定验证码", "123456"); } else fill();
  mockFetch.mockRejectedValueOnce(new TypeError("Network request failed"));
  await press(stage === "send" ? "发送绑定验证码" : "确认绑定");
  expect(hasText("网络连接不可用")).toBe(true); expect(hasText("手机号已绑定并验证")).toBe(false);
  if (stage === "send") expect(hasText("已受理")).toBe(false);
});

describe("phone replacement flow", () => {
  const verifiedAccount = { ...account, phone: "+8613800000000", phone_verified_at: "2026-10-25" };
  const openReplace = () => press("更换手机号");
  const fillReplace = () => { input("新手机号", "+8613900000000"); input("更换当前密码", "synthetic-password"); };

  it.each([
    ["present", "a@example.invalid"],
    ["null", null],
  ])("only offers replacement for accounts with verified phone and password (email %s)", async (_, email) => {
    const base = { ...verifiedAccount, email };
    mockUser = { ...base }; await rerender();
    expect(button("更换手机号")).toBeDefined();
    expect(button("首次绑定手机号")).toBeUndefined();

    for (const patch of [{ phone: null }, { phone_verified_at: null }, { hasPassword: false }, { role: "admin" }]) {
      mockUser = { ...base, ...patch }; await rerender();
      expect(button("更换手机号")).toBeUndefined();
    }
  });

  it("allows SMS-registered users without email to replace phone", async () => {
    mockUser = { ...verifiedAccount, email: null, hasPassword: true, role: "user" };
    await rerender();
    expect(button("更换手机号")).toBeDefined();
    expect(button("首次绑定手机号")).toBeUndefined();

    const refreshCallsBefore = mockRefresh.mock.calls.length;
    await openReplace();
    expect(mockRefresh.mock.calls.length).toBe(refreshCallsBefore + 1);
    expect(hasText("更换前需先验证当前登录密码和新手机")).toBe(true);

    fillReplace();
    expect(tree.root.findByProps({ accessibilityLabel: "新手机号" }).props.value).toBe("+8613900000000");
    expect(tree.root.findByProps({ accessibilityLabel: "更换当前密码" }).props.value).toBe("synthetic-password");

    await press("关闭手机号更换");
    expect(hasText("更换前需先验证当前登录密码和新手机")).toBe(false);
    expect(button("更换手机号")).toBeDefined();

    await openReplace();
    expect(hasText("更换前需先验证当前登录密码和新手机")).toBe(true);
    expect(tree.root.findByProps({ accessibilityLabel: "新手机号" }).props.value).toBe("");
    expect(tree.root.findByProps({ accessibilityLabel: "更换当前密码" }).props.value).toBe("");
  });

  it("performs replacement end-to-end and cleans up secrets", async () => {
    mockUser = { ...verifiedAccount }; await rerender();
    await openReplace();
    expect(hasText("更换前需先验证当前登录密码和新手机")).toBe(true);

    fillReplace();
    mockFetch.mockResolvedValueOnce(json({ challengeId: sent.challengeId, phoneMasked: "139****0000", expiresIn: 300, resendAfter: 60 }, 201));
    await press("发送更换验证码");

    expect(mockFetch.mock.calls[0][0]).toMatch(/\/auth\/phone-binding\/replace\/send$/);
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ newPhone: "13900000000", currentPassword: "synthetic-password" });
    expect(tree.root.findByProps({ accessibilityLabel: "更换当前密码" }).props.value).toBe("");

    input("更换验证码", "123456");
    mockFetch.mockResolvedValueOnce(json({ success: true, phoneMasked: "139****0000" }));
    await press("确认更换");

    expect(mockFetch.mock.calls[1][0]).toMatch(/\/auth\/phone-binding\/replace\/verify$/);
    expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual({ challengeId: sent.challengeId, code: "123456" });
    expect(hasText("手机号已更换并验证")).toBe(true);
    expect(button("确认更换")).toBeUndefined();

    await press("关闭手机号更换");
    expect(hasText("139****0000")).toBe(true);
    expect(button("更换手机号")).toBeDefined();
  });

  it.each([
    [403, "INVALID_PASSWORD", "当前密码不正确"],
    [409, "PHONE_EXISTS", "该手机号已被其他账号使用"],
    [400, "PHONE_UNCHANGED", "新手机号不能与当前手机号相同"],
    [429, "PHONE_BINDING_RATE_LIMITED", "换绑请求过于频繁"],
  ])("shows real replacement send errors %s %s without success", async (status, code, error) => {
    mockUser = { ...verifiedAccount }; await rerender();
    await openReplace(); fillReplace();
    mockFetch.mockResolvedValueOnce(json({ code, error }, status as number));
    await press("发送更换验证码");
    expect(hasText(error as string)).toBe(true);
    expect(button("确认更换")).toBeUndefined();
    expect(tree.root.findByProps({ accessibilityLabel: "更换当前密码" }).props.value).toBe("");
  });

  it("locks same-tick duplicate replacement sends and verifies", async () => {
    mockUser = { ...verifiedAccount }; await rerender();
    await openReplace(); fillReplace();
    const sending = deferred(); mockFetch.mockReturnValueOnce(sending.promise);
    const click = button("发送更换验证码").props.onPress;
    act(() => { click(); click(); });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    await act(async () => sending.resolve(json({ ...sent, phoneMasked: "139****0000" }, 201)));

    input("更换验证码", "123456");
    const verifying = deferred(); mockFetch.mockReturnValueOnce(verifying.promise);
    const verify = button("确认更换").props.onPress;
    act(() => { verify(); verify(); });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    await act(async () => verifying.resolve(json({ success: true, phoneMasked: "139****0000" })));
  });

  it.each(["cancel", "blur"])("aborts replacement in flight after %s", async mode => {
    mockUser = { ...verifiedAccount }; await rerender();
    await openReplace(); fillReplace();
    const req = deferred(); mockFetch.mockReturnValueOnce(req.promise);
    await press("发送更换验证码");
    const signal = mockFetch.mock.calls[0][1].signal;
    if (mode === "cancel") await press("关闭手机号更换");
    else act(() => { [...mockBlur].forEach(c => c()); });
    expect(signal.aborted).toBe(true);
  });
});
