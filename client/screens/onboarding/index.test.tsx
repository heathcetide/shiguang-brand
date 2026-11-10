import React from "react";
import renderer, { act } from "react-test-renderer";
import { Text, TextInput, TouchableOpacity } from "react-native";
const mockGet = jest.fn(); const mockUpdate = jest.fn(); const mockFailure = jest.fn();
const mockProfile = jest.fn(); const mockPatch = jest.fn(); const mockFetch = jest.fn();
const mockRouter = { replace: jest.fn(), push: jest.fn() };
const initialState = { version: 0, selectedTask: null, status: "not_started", step: "choose_task", dismissed: false, startedAt: null, completedAt: null, completion: null, updatedAt: null };
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: 1 }, token: "test-token" }), useAuthFetch: () => mockFetch }));
jest.mock("@/services/api", () => ({ healthApi: { profile: (...args: unknown[]) => mockProfile(...args), patchProfile: (...args: unknown[]) => mockPatch(...args) } }));
jest.mock("@/services/api/onboarding", () => ({ onboardingApi: { get: (...args: unknown[]) => mockGet(...args), update: (...args: unknown[]) => mockUpdate(...args), saveFailed: (...args: unknown[]) => mockFailure(...args) } }));
jest.mock("@/hooks/useSafeRouter", () => ({ useSafeRouter: () => mockRouter, useSafeSearchParams: () => ({}) }));
jest.mock("expo-router", () => ({ useFocusEffect: (callback: () => void) => require("react").useEffect(callback, [callback]) }));
jest.mock("@/components/Screen", () => ({ Screen: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("@/components/ThemedFontAwesome6", () => "Icon");
jest.mock("@/components/PreferenceVoiceInput", () => ({ PreferenceVoiceInput: "PreferenceVoiceInput" }));
jest.mock("@/hooks/useUserDraft", () => ({ useUserDraft: (_name: string, initial: unknown) => {
  const [value, save] = (require("react") as typeof React).useState(initial);
  return { value, save, ready: true, error: "", clear: jest.fn() };
} }));
jest.mock("expo-crypto", () => ({ randomUUID: jest.fn(() => "00000000-0000-4000-8000-000000000001") }));
import OnboardingScreen from "./index";
function press(tree: renderer.ReactTestRenderer, label: string) {
  const button = tree.root.findAllByType(TouchableOpacity).find(node => node.findAllByType(Text).some(text => text.props.children === label));
  if (!button) throw new Error(`Missing button: ${label}`);
  button.props.onPress();
}
async function mount() { let tree!: renderer.ReactTestRenderer; await act(async () => { tree = renderer.create(<OnboardingScreen />); }); return tree; }
beforeEach(() => {
  jest.clearAllMocks(); mockGet.mockResolvedValue(initialState);
  mockUpdate.mockImplementation((_token, input) => Promise.resolve({ ...initialState, ...input, version: input.version + 1 }));
  mockProfile.mockResolvedValue({ version: 1, safety_status: "unknown", kitchen_constraints: null });
  mockPatch.mockResolvedValue({ version: 2, safety_status: "none" }); mockFailure.mockResolvedValue({});
});

test.each([["管理家里的食材", "/inventory"], ["记录刚吃的一餐", "/diet-record"]])("%s opens a real task without reading or writing body data", async (label, route) => {
  const tree = await mount(); await act(async () => { press(tree, label); });
  expect(mockRouter.push).toHaveBeenCalledWith(route, { action: "add", onboarding: true });
  expect(mockProfile).not.toHaveBeenCalled(); expect(mockPatch).not.toHaveBeenCalled();
  expect(mockUpdate.mock.calls[0][1].status).toBe("in_progress");
  await act(async () => { tree.unmount(); });
});

test("skipping pauses progress without inventing health values or confirming no allergies", async () => {
  const tree = await mount(); await act(async () => { press(tree, "稍后开始"); });
  expect(mockPatch).not.toHaveBeenCalled(); expect(mockUpdate.mock.calls[0][1]).toMatchObject({ status: "paused", dismissed: true });
  expect(mockRouter.replace).toHaveBeenCalledWith("/"); await act(async () => { tree.unmount(); });
});

test("meal conditions require an explicit safety choice; skip keeps unknown and quick choices stay temporary", async () => {
  const tree = await mount(); await act(async () => { press(tree, "安排一餐"); });
  await act(async () => { press(tree, "继续安排这一餐"); });
  expect(JSON.stringify(tree.toJSON())).toContain("请选择饮食限制状态"); expect(mockRouter.push).not.toHaveBeenCalled();
  await act(async () => { press(tree, "2 人"); });
  await act(async () => { press(tree, "20 分钟"); });
  await act(async () => { press(tree, "稍后填写"); });
  await act(async () => { press(tree, "继续安排这一餐"); });
  expect(mockPatch).not.toHaveBeenCalled();
  expect(mockRouter.push).toHaveBeenCalledWith("/cooking-plan", expect.objectContaining({ initialServings: 2, initialMinutes: 20 }));
  await act(async () => { tree.unmount(); });
});

test("explicit no-allergies saves only that field; duplicated taps issue one mutation", async () => {
  const tree = await mount(); await act(async () => { press(tree, "安排一餐"); });
  await act(async () => { press(tree, "确认没有"); });
  await act(async () => { press(tree, "继续安排这一餐"); press(tree, "继续安排这一餐"); });
  expect(mockPatch).toHaveBeenCalledTimes(1); expect(mockPatch.mock.calls[0][1]).toEqual({ version: 1, safety_status: "none" });
  await act(async () => { tree.unmount(); });
});

test("an uncertain start retry keeps the same idempotency key and never counts opening a screen as completion", async () => {
  mockUpdate.mockRejectedValueOnce(new Error("网络中断"));
  const tree = await mount(); await act(async () => { press(tree, "管理家里的食材"); });
  expect(mockRouter.push).not.toHaveBeenCalled();
  await act(async () => { press(tree, "管理家里的食材"); });
  expect(mockUpdate.mock.calls[0][1]).toEqual(mockUpdate.mock.calls[1][1]);
  expect(mockUpdate.mock.calls.every(call => call[1].status !== "completed")).toBe(true);
  await act(async () => { tree.unmount(); });
});


test.each([false, true])("complete confirmed voice preferences reach the meal request; persistent=%s", async (persistent) => {
  const tree = await mount(); await act(async () => { press(tree, "安排一餐"); });
  const kitchen = { servings: 2, meal_time_minutes: 20, usual_meals: ["lunch"], eating_location: "work", carry_meals: true, refrigeration_available: false, reheating_available: false, budget_per_meal: 30, cooking_level: "beginner", eating_out_frequency: "sometimes" };
  await act(async () => { tree.root.findByType("PreferenceVoiceInput" as never).props.onApply(kitchen, persistent); });
  await act(async () => { press(tree, "稍后填写"); });
  await act(async () => { press(tree, "继续安排这一餐"); });
  expect(mockRouter.push).toHaveBeenCalledWith("/cooking-plan", expect.objectContaining({ initialPreferences: kitchen, initialServings: 2, initialMinutes: 20 }));
  if (persistent) expect(mockPatch).toHaveBeenCalledWith(mockFetch, { version: 1, kitchen_constraints: kitchen });
  else expect(mockPatch).not.toHaveBeenCalled();
  await act(async () => { tree.unmount(); });
});


test("a later persistent voice summary does not promote earlier once-only fields or fallback defaults", async () => {
  const tree = await mount(); await act(async () => { press(tree, "安排一餐"); });
  await act(async () => { tree.root.findByType("PreferenceVoiceInput" as never).props.onApply({ servings: 2, refrigeration_available: false, eating_location: "work" }, false); });
  await act(async () => { tree.root.findByType("PreferenceVoiceInput" as never).props.onApply({ carry_meals: true }, true); });
  await act(async () => { press(tree, "稍后填写"); });
  await act(async () => { press(tree, "继续安排这一餐"); });
  expect(mockPatch).toHaveBeenCalledWith(mockFetch, { version: 1, kitchen_constraints: { carry_meals: true } });
  expect(mockRouter.push).toHaveBeenCalledWith("/cooking-plan", expect.objectContaining({ initialPreferences: { carry_meals: true }, initialServings: 1 }));
  act(() => tree.unmount());
});


test.each([null, { servings: 3, meal_time_minutes: 45 }])("cleared voice scalars are omitted from persistent settings and planning falls back to %s", async (stored) => {
  mockProfile.mockResolvedValue({ version: 1, safety_status: "unknown", kitchen_constraints: stored });
  const tree = await mount(); await act(async () => { press(tree, "安排一餐"); });
  await act(async () => { tree.root.findByType("PreferenceVoiceInput" as never).props.onApply({ servings: 2, meal_time_minutes: 20, carry_meals: true }, true); });
  await act(async () => { tree.root.findAllByType(TextInput).find(node => node.props.accessibilityLabel === "就餐人数")!.props.onChangeText(""); });
  await act(async () => { tree.root.findAllByType(TextInput).find(node => node.props.accessibilityLabel === "做饭分钟数")!.props.onChangeText(""); });
  await act(async () => { press(tree, "稍后填写"); });
  await act(async () => { press(tree, "继续安排这一餐"); });
  expect(mockPatch).toHaveBeenCalledWith(mockFetch, { version: 1, kitchen_constraints: { carry_meals: true } });
  expect(mockRouter.push).toHaveBeenCalledWith("/cooking-plan", expect.objectContaining({ initialServings: stored?.servings ?? 1, initialMinutes: stored?.meal_time_minutes ?? 30 }));
  act(() => tree.unmount());
});
