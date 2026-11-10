import React from "react";
import renderer, { act } from "react-test-renderer";
import { TextInput, TouchableOpacity } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { HealthProfile } from "@/utils/healthProfile";

const mockProfile = jest.fn(); const mockPatch = jest.fn(); const mockFetch = jest.fn();
const mockRouter = { back: jest.fn(), push: jest.fn(), replace: jest.fn() };
let mockParams: Record<string, string> = { section: "body" }; let mockUser = { id: 1, username: "小林" };
jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
jest.mock("@/services/api", () => ({
  healthApi: { profile: (...args: unknown[]) => mockProfile(...args), patchProfile: (...args: unknown[]) => mockPatch(...args) },
  ApiError: class extends Error { code?: string; details?: unknown; constructor(message: string, _status: number, body?: { code?: string; details?: unknown }) { super(message); this.code = body?.code; this.details = body?.details; } },
}));
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: mockUser }), useAuthFetch: () => mockFetch }));
jest.mock("@/hooks/useSafeRouter", () => ({ useSafeRouter: () => mockRouter, useSafeSearchParams: () => mockParams }));
jest.mock("expo-router", () => ({ useFocusEffect: (callback: () => void) => require("react").useEffect(callback, [callback]) }));
jest.mock("@/components/Screen", () => ({ Screen: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("@/components/ThemedFontAwesome6", () => "Icon");
jest.mock("@/components/PreferenceVoiceInput", () => ({ PreferenceVoiceInput: "VoiceInput" }));
import { ApiError } from "@/services/api";
import HealthProfileScreen from "./index";

const empty: HealthProfile = { version: 1, age: null, height: null, weight: null, health_goal: undefined, activity_level: undefined, nutrition_targets: {}, kitchen_constraints: {}, safety_status: "unknown", calorieTarget: { value: null, source: "unset", referenceValue: 2000 }, currentMeasurements: {} };
async function renderScreen() { let tree!: renderer.ReactTestRenderer; await act(async () => { tree = renderer.create(<HealthProfileScreen />); }); return tree; }
function input(tree: renderer.ReactTestRenderer, label: string) { return tree.root.findAllByType(TextInput).find(node => node.props.accessibilityLabel === label)!; }
function press(tree: renderer.ReactTestRenderer, label: string) { const button = tree.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === label); if (!button) throw new Error(`Missing button: ${label}`); button.props.onPress(); }
function output(tree: renderer.ReactTestRenderer) { return JSON.stringify(tree.toJSON()); }
beforeEach(async () => { jest.clearAllMocks(); await AsyncStorage.clear(); mockUser = { id: 1, username: "小林" }; mockParams = { section: "body" }; mockProfile.mockReset().mockResolvedValue(empty); mockPatch.mockReset().mockResolvedValue({ ...empty, version: 2 }); });

test("new body fields stay blank and saving age does not write other measurements or groups", async () => {
  const tree = await renderScreen();
  expect(mockProfile).toHaveBeenCalledWith(mockFetch, { fresh: true });
  expect(input(tree, "年龄").props.value).toBe(""); expect(input(tree, "当前体重").props.value).toBe("");
  expect(output(tree)).not.toContain("预估基础代谢");
  await act(async () => { input(tree, "年龄").props.onChangeText("28"); });
  await act(async () => { press(tree, "保存本组资料"); });
  expect(mockPatch).toHaveBeenCalledWith(mockFetch, { version: 1, age: 28 });
  act(() => tree.unmount());
});

test("a failed read shows retry and cannot submit an empty profile", async () => {
  mockProfile.mockRejectedValue(new Error("暂时离线")); const tree = await renderScreen();
  expect(output(tree)).toContain("暂时离线"); expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
  expect(output(tree)).not.toContain("保存本组资料"); expect(mockPatch).not.toHaveBeenCalled();
  act(() => tree.unmount());
});

test("nutrition clearing sends explicit null and leaves protein and other groups untouched", async () => {
  mockParams = { section: "nutrition" }; mockProfile.mockResolvedValue({ ...empty, nutrition_targets: { calories_kcal: 1800, protein_g: 90 }, calorieTarget: { value: 1800, source: "user", referenceValue: 2000 } });
  const tree = await renderScreen();
  await act(async () => { input(tree, "每日热量").props.onChangeText(""); });
  await act(async () => { press(tree, "保存本组资料"); });
  expect(mockPatch).toHaveBeenCalledWith(mockFetch, { version: 1, nutrition_targets: { calories_kcal: null } });
  act(() => tree.unmount());
});

test("invalid numbers remain in the form with a field error and are not converted to clearing", async () => {
  const tree = await renderScreen();
  await act(async () => { input(tree, "年龄").props.onChangeText("abc"); });
  await act(async () => { press(tree, "保存本组资料"); });
  expect(mockPatch).not.toHaveBeenCalled(); expect(input(tree, "年龄").props.value).toBe("abc"); expect(output(tree)).toContain("年龄格式或范围不正确");
  act(() => tree.unmount());
});

test("conflict preserves local edits and merges untouched server fields before an explicit retry", async () => {
  mockPatch.mockRejectedValueOnce(new ApiError("冲突", 409, { code: "HEALTH_PROFILE_VERSION_CONFLICT", details: { currentProfile: { ...empty, version: 2, height: 175 } } }));
  const tree = await renderScreen();
  await act(async () => { input(tree, "年龄").props.onChangeText("30"); });
  await act(async () => { press(tree, "保存本组资料"); });
  expect(input(tree, "年龄").props.value).toBe("30"); expect(mockPatch).toHaveBeenCalledTimes(1);
  await act(async () => { press(tree, "合并最新资料，保留我的修改"); });
  expect(input(tree, "身高").props.value).toBe("175"); expect(input(tree, "年龄").props.value).toBe("30");
  await act(async () => { press(tree, "保存本组资料"); });
  expect(mockPatch).toHaveBeenLastCalledWith(mockFetch, { version: 2, age: 30 });
  act(() => tree.unmount());
});

test("drafts survive leaving the page and are isolated when the account changes", async () => {
  let tree = await renderScreen();
  await act(async () => { input(tree, "年龄").props.onChangeText("29"); });
  act(() => tree.unmount()); tree = await renderScreen();
  expect(input(tree, "年龄").props.value).toBe("29");
  mockUser = { id: 2, username: "小夏" }; await act(async () => { tree.update(<HealthProfileScreen />); });
  expect(input(tree, "年龄").props.value).toBe("");
  expect(AsyncStorage.setItem).toHaveBeenCalledWith("health-profile-draft:body:user:1", expect.any(String));
  act(() => tree.unmount());
});

test("the default health entry is the five-group profile hub", async () => {
  mockParams = {}; const tree = await renderScreen();
  expect(output(tree)).toContain("我的资料与偏好"); expect(output(tree)).toContain("个人热量目标尚未设置");
  for (const label of ["公开资料", "饮食限制与健康资料", "厨房与做饭习惯", "身体资料与营养目标", "系统记住了什么"]) expect(output(tree)).toContain(label);
  act(() => { press(tree, "厨房与做饭习惯"); }); expect(mockRouter.push).toHaveBeenCalledWith("/health-profile", { section: "kitchen" });
  act(() => tree.unmount());
});

test("two save taps in the same render submit once", async () => {
  let complete!: (value: HealthProfile) => void;
  mockPatch.mockImplementation(() => new Promise<HealthProfile>(resolve => { complete = resolve; }));
  const tree = await renderScreen();
  await act(async () => { input(tree, "年龄").props.onChangeText("28"); });
  await act(async () => { press(tree, "保存本组资料"); press(tree, "保存本组资料"); });
  expect(mockPatch).toHaveBeenCalledTimes(1);
  await act(async () => { complete({ ...empty, version: 2, age: 28 }); });
  act(() => tree.unmount());
});

test("successful remote save remains successful when local draft cleanup fails", async () => {
  (AsyncStorage.removeItem as jest.Mock).mockRejectedValueOnce(new Error("存储暂不可用"));
  mockPatch.mockResolvedValue({ ...empty, version: 2, age: 28 });
  const tree = await renderScreen();
  await act(async () => { input(tree, "年龄").props.onChangeText("28"); });
  await act(async () => { press(tree, "保存本组资料"); });
  expect(output(tree)).toContain("资料已保存，但本机草稿清理失败");
  expect(output(tree)).not.toContain("合并最新资料，保留我的修改");
  await act(async () => { input(tree, "年龄").props.onChangeText("29"); });
  await act(async () => { press(tree, "保存本组资料"); });
  expect(mockPatch).toHaveBeenLastCalledWith(mockFetch, { version: 2, age: 29 });
  act(() => tree.unmount());
});


test("voice preference confirmation keeps the budget input consistent and never edits unrelated safety data", async () => {
  mockParams = { section: "kitchen" };
  const tree = await renderScreen();
  const kitchen = { budget_per_meal: 30, cooking_level: "beginner", eating_out_frequency: "sometimes", refrigeration_available: false };
  await act(async () => { tree.root.findByType("VoiceInput" as never).props.onApply(kitchen, false); });
  expect(input(tree, "每餐预算").props.value).toBe("");
  await act(async () => { tree.root.findByType("VoiceInput" as never).props.onApply(kitchen, true); });
  expect(input(tree, "每餐预算").props.value).toBe("30");
  await act(async () => { input(tree, "每餐预算").props.onChangeText("40"); });
  await act(async () => { press(tree, "保存本组资料"); });
  expect(mockPatch).toHaveBeenCalledWith(mockFetch, { version: 1, kitchen_constraints: { ...kitchen, budget_per_meal: 40 } });
  act(() => tree.unmount());
});
