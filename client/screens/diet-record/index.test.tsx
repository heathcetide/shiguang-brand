import React from "react";
import renderer, { act } from "react-test-renderer";
import { ActivityIndicator, Alert, Modal, Text, TextInput, TouchableOpacity, View } from "react-native";
import type { DietRecord } from "@/services/api";

const mockList = jest.fn();
const mockCreate = jest.fn();
const mockRemove = jest.fn();
const mockVision = jest.fn();
const mockWait = jest.fn();
const mockPick = jest.fn();
const mockAuthFetch = jest.fn();
const mockRouter = { back: jest.fn(), push: jest.fn(), replace: jest.fn(), setParams: jest.fn(), canGoBack: () => true };
let mockUser: { id: number } | null = { id: 1 };
let mockSessionGeneration = 1;
let mockParams: Record<string, string> = {};

jest.mock("@/services/api", () => ({
  dietApi: { list: (...args: unknown[]) => mockList(...args), create: (...args: unknown[]) => mockCreate(...args), remove: (...args: unknown[]) => mockRemove(...args) },
  aiApi: { visionFood: (...args: unknown[]) => mockVision(...args) },
  waitForAgentRun: (...args: unknown[]) => mockWait(...args),
  ApiError: class extends Error {},
}));
jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: mockUser, isAuthenticated: Boolean(mockUser), sessionGeneration: mockSessionGeneration }),
  useAuthFetch: () => mockAuthFetch,
}));
jest.mock("@/hooks/useSafeRouter", () => ({ useSafeRouter: () => mockRouter, useSafeSearchParams: () => mockParams }));
jest.mock("@/hooks/useHealthSummary", () => ({ useHealthSummary: () => ({ profile: null, targetCalories: 2000, targetLabel: "系统参考，尚未设置目标", error: "" }) }));
jest.mock("@/hooks/usePendingDietSave", () => ({ usePendingDietSave: () => ({ save: (input: unknown) => mockCreate(mockAuthFetch, input), pending: null, error: "", ready: true }) }));
jest.mock("expo-router", () => ({ useFocusEffect: (callback: () => void) => require("react").useEffect(callback, [callback]) }));
jest.mock("@/components/Screen", () => ({ Screen: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("@/components/ThemedFontAwesome6", () => "Icon");
jest.mock("expo-image-picker", () => ({ MediaTypeOptions: { Images: "images" }, launchImageLibraryAsync: (...args: unknown[]) => mockPick(...args) }));

import DietRecordScreen from "./index";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function record(name: string, date = "2026-09-20"): DietRecord {
  return { id: 1, food_name: name, meal_type: "午餐", amount: "1份", calories: 345, protein: 10, carbs: 20, fat: 5, recorded_at: date, recorded_time: "12:00", image_url: null };
}
function press(tree: renderer.ReactTestRenderer, label: string) {
  const button = tree.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === label || node.findAllByType(Text).some(text => text.props.children === label));
  if (!button) throw new Error(`Missing button: ${label}`);
  button.props.onPress();
}
function output(tree: renderer.ReactTestRenderer) { return JSON.stringify(tree.toJSON()); }
function hasDayDot(tree: renderer.ReactTestRenderer, label: string) {
  const day = tree.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === label)!;
  return day.findAllByType(View).some(node => String(node.props.className).includes("absolute bottom-1") && String(node.props.className).includes("bg-brand-fill"));
}
async function renderScreen() {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<DietRecordScreen />); });
  return tree;
}

test.each([
  { name: 'all unknown', values: [null], expected: '未知', incomplete: true },
  { name: 'known subtotal', values: [null, 120], expected: '已知 120', incomplete: true },
  { name: 'actual zero', values: [0], expected: '0', remaining: '2000 kcal', incomplete: false },
  { name: 'decimal sum', values: [0.1, 0.2], expected: '0.3', remaining: '1999.7 kcal', incomplete: false },
  { name: 'small calorie value', values: [0.04], expected: '0.04', remaining: '1999.96 kcal', incomplete: false },
])('daily totals distinguish $name from complete intake', async ({ values, expected, remaining, incomplete }) => {
  mockList.mockResolvedValue(values.map((value, i) => ({ ...record(`餐次${i}`), id: i + 1,
    calories: value, protein: value, carbs: value, fat: value })));
  const tree = await renderScreen();
  const text = output(tree);
  expect(tree.root.findAllByType(Text).some(node => node.props.children === expected)).toBe(true);
  if (incomplete) {
    expect(text).toContain('热量数据不全');
    expect(text).toContain('暂不计算剩余额度');
    expect(text).not.toContain('剩余可摄入');
    expect(text).not.toContain('目标已达成');
  } else {
    expect(text).toContain('剩余可摄入');
    expect(text).toContain(remaining!);
    expect(text).not.toContain('热量数据不全');
  }
  act(() => tree.unmount());
});

test("an empty day is not described as incomplete nutrition", async () => {
  const tree = await renderScreen();
  expect(output(tree)).not.toContain('热量数据不全');
  expect(output(tree)).not.toContain('部分记录未填写热量');
  act(() => tree.unmount());
});

// React Native transforms some native components lazily on the first render.
// Keep that cold-start work in bounded setup, outside the behavioral test timeout.
beforeAll(async () => {
  mockList.mockResolvedValue([]);
  const tree = await renderScreen();
  act(() => tree.unmount());
}, 30_000);

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(new Date(2026, 8, 20, 12));
  mockUser = { id: 1 };
  mockSessionGeneration = 1;
  mockParams = {};
  mockList.mockReset().mockResolvedValue([]);
  mockCreate.mockReset().mockResolvedValue(record("已保存"));
  mockRemove.mockReset().mockResolvedValue({});
  mockRouter.setParams.mockImplementation(() => { mockParams = {}; });
  jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
});
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

test("a late response for another date cannot replace current records or nutrition", async () => {
  const older = deferred<DietRecord[]>();
  mockList.mockImplementation((_fetch, date) => Promise.resolve(date === "2026-09-20" ? [record("今天餐食")] : []));
  const tree = await renderScreen();
  expect(output(tree)).toContain("今天餐食");
  mockList.mockImplementation((_fetch, date) => date === "2026-09-19" ? older.promise : Promise.resolve([record("当前餐食", date)]));
  await act(async () => { press(tree, "周六 19日"); });
  expect(output(tree)).not.toContain("今天餐食");
  expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(1);
  await act(async () => { press(tree, "周五 18日"); });
  const currentOutput = output(tree);
  await act(async () => { older.resolve([record("迟到餐食", "2026-09-19")]); });
  expect(output(tree)).toBe(currentOutput);
  expect(output(tree)).toContain("当前餐食");
  act(() => tree.unmount());
});

test("an old request failure cannot stop the selected date's loading state", async () => {
  const older = deferred<DietRecord[]>();
  const current = deferred<DietRecord[]>();
  const tree = await renderScreen();
  mockList.mockImplementation((_fetch, date) => date === "2026-09-19" ? older.promise : current.promise);
  await act(async () => { press(tree, "周六 19日"); });
  await act(async () => { press(tree, "周五 18日"); });
  await act(async () => { older.reject(new Error("old request failed")); });
  expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(1);
  await act(async () => { current.resolve([record("新日期餐食", "2026-09-18")]); });
  expect(output(tree)).toContain("新日期餐食");
  act(() => tree.unmount());
});

test.each(["account", "session"])("drops previous %s records and pending daily/weekly responses", async change => {
  mockList.mockResolvedValue([record("原账号餐食")]);
  const tree = await renderScreen();
  const older = deferred<DietRecord[]>();
  mockList.mockReturnValue(older.promise);
  await act(async () => { press(tree, "查看更早七天"); });
  const current = deferred<DietRecord[]>();
  mockList.mockReturnValue(current.promise);
  if (change === "account") mockUser = { id: 2 };
  else mockSessionGeneration += 1;
  await act(async () => { tree.update(<DietRecordScreen />); });
  expect(output(tree)).not.toContain("原账号餐食");
  await act(async () => { older.resolve([record("旧会话迟到餐食")]); });
  expect(output(tree)).not.toContain("旧会话迟到餐食");
  expect(hasDayDot(tree, "周日 13日")).toBe(false);
  expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(1);
  await act(async () => { current.resolve([record("新会话餐食")]); });
  expect(output(tree)).toContain("新会话餐食");
  expect(hasDayDot(tree, "周日 13日")).toBe(true);
  act(() => tree.unmount());
});

test("returning to a week cannot reuse its earlier pending counts", async () => {
  const firstWeek = deferred<DietRecord[]>();
  mockList.mockReturnValue(firstWeek.promise);
  const tree = await renderScreen();
  mockList.mockResolvedValue([]);
  await act(async () => { press(tree, "查看更早七天"); });
  await act(async () => { press(tree, "查看较新七天"); });
  expect(hasDayDot(tree, "今天 20日")).toBe(false);
  await act(async () => { firstWeek.resolve([record("旧周查询")]); });
  expect(hasDayDot(tree, "今天 20日")).toBe(false);
  expect(output(tree)).not.toContain("旧周查询");
  act(() => tree.unmount());
});

test("a save finishing on another date only refreshes week counts and keeps a new form", async () => {
  const save = deferred<DietRecord>();
  mockCreate.mockReturnValue(save.promise);
  const tree = await renderScreen();
  await act(async () => { press(tree, "记录一餐"); });
  await act(async () => { press(tree, "水煮蛋"); });
  await act(async () => { press(tree, "保存这餐"); });
  expect(mockCreate.mock.calls[0][1]).toMatchObject({ recorded_at: "2026-09-20", food_name: "水煮蛋" });
  await act(async () => { press(tree, "关闭记餐弹层"); press(tree, "周六 19日"); });
  await act(async () => { press(tree, "记录一餐"); });
  await act(async () => { press(tree, "全麦面包"); });
  const calls = mockList.mock.calls.length;
  await act(async () => { save.resolve(record("旧日期已保存")); });
  expect(mockList).toHaveBeenCalledTimes(calls + 7);
  expect(tree.root.findAllByType(Modal).find(node => node.props.animationType === "slide")!.props.visible).toBe(true);
  expect(tree.root.findAllByType(TextInput).some(node => node.props.value === "全麦面包")).toBe(true);
  act(() => tree.unmount());
});

test("an old delete confirmation cannot start a request after an account switch", async () => {
  mockList.mockResolvedValue([record("待删除餐食")]);
  const tree = await renderScreen();
  await act(async () => { press(tree, "删除待删除餐食"); });
  const confirm = jest.mocked(Alert.alert).mock.calls.at(-1)![2]!.find(button => button.text === "删除")!.onPress!;
  mockUser = { id: 2 };
  mockList.mockResolvedValue([]);
  await act(async () => { tree.update(<DietRecordScreen />); });
  await act(async () => { confirm(); });
  expect(mockRemove).not.toHaveBeenCalled();
  act(() => tree.unmount());
});

test("a deletion finishing on another date refreshes week counts without changing daily records", async () => {
  const removal = deferred<unknown>();
  mockRemove.mockReturnValue(removal.promise);
  mockList.mockResolvedValue([record("删除中的餐食")]);
  const tree = await renderScreen();
  await act(async () => { press(tree, "删除删除中的餐食"); });
  const confirm = jest.mocked(Alert.alert).mock.calls.at(-1)![2]!.find(button => button.text === "删除")!.onPress!;
  await act(async () => { confirm(); });
  mockList.mockResolvedValue([record("另一天的餐食", "2026-09-19")]);
  await act(async () => { press(tree, "周六 19日"); });
  const calls = mockList.mock.calls.length;
  await act(async () => { removal.resolve({}); });
  expect(mockList).toHaveBeenCalledTimes(calls + 7);
  expect(output(tree)).toContain("另一天的餐食");
  act(() => tree.unmount());
});

test.each(["save", "delete"])("a completed %s refreshes its date after leaving and returning", async action => {
  const mutation = deferred<unknown>();
  mockCreate.mockReturnValue(mutation.promise);
  mockRemove.mockReturnValue(mutation.promise);
  mockList.mockResolvedValue([record("变更前餐食")]);
  const tree = await renderScreen();
  if (action === "save") {
    await act(async () => { press(tree, "记录一餐"); });
    await act(async () => { press(tree, "水煮蛋"); });
    await act(async () => { press(tree, "保存这餐"); });
    await act(async () => { press(tree, "关闭记餐弹层"); });
  } else {
    await act(async () => { press(tree, "删除变更前餐食"); });
    const confirm = jest.mocked(Alert.alert).mock.calls.at(-1)![2]!.find(button => button.text === "删除")!.onPress!;
    await act(async () => { confirm(); });
  }
  await act(async () => { press(tree, "周六 19日"); });
  await act(async () => { press(tree, "今天 20日"); });
  expect(output(tree)).toContain("变更前餐食");
  const calls = mockList.mock.calls.length;
  mockList.mockResolvedValue(action === "save" ? [record("变更后餐食")] : []);
  await act(async () => { mutation.resolve({}); });
  expect(mockList).toHaveBeenCalledTimes(calls + 8);
  expect(output(tree)).not.toContain("变更前餐食");
  expect(hasDayDot(tree, "今天 20日")).toBe(action === "save");
  if (action === "save") expect(output(tree)).toContain("变更后餐食");
  act(() => tree.unmount());
});

test("a late photo recognition cannot overwrite a newly opened meal form", async () => {
  const vision = deferred<unknown>();
  mockPick.mockResolvedValue({ canceled: false, assets: [{ uri: "photo.jpg", base64: "image" }] });
  mockVision.mockReturnValue(vision.promise);
  const tree = await renderScreen();
  await act(async () => { press(tree, "拍照识别第一餐"); });
  await act(async () => { press(tree, "关闭记餐弹层"); });
  await act(async () => { press(tree, "记录一餐"); });
  await act(async () => { press(tree, "水煮蛋"); });
  await act(async () => { vision.resolve({ data: { foodName: "旧照片餐食" }, run: { id: "old", status: "completed" } }); });
  expect(mockWait).not.toHaveBeenCalled();
  expect(tree.root.findAllByType(TextInput).some(node => node.props.value === "水煮蛋")).toBe(true);
  expect(tree.root.findAllByType(TextInput).some(node => node.props.value === "旧照片餐食")).toBe(false);
  act(() => tree.unmount());
});

test("prefilling a historical date keeps the meal form and local calendar label", async () => {
  mockParams = { prefill_food: "预填餐食", recorded_at: "2026-09-18", prefill_calories: "321" };
  const tree = await renderScreen();
  expect(output(tree)).toContain("9月18日 周五");
  expect(tree.root.findAllByType(Modal).find(node => node.props.animationType === "slide")!.props.visible).toBe(true);
  expect(tree.root.findAllByType(TextInput).some(node => node.props.value === "预填餐食")).toBe(true);
  await act(async () => { press(tree, "保存这餐"); });
  expect(mockCreate.mock.calls[0][1]).toMatchObject({ recorded_at: "2026-09-18", food_name: "预填餐食", calories: 321 });
  act(() => tree.unmount());
});

test("photo nutrition replaces a preset with actual zero, decimals and unknown values", async () => {
  mockPick.mockResolvedValue({ canceled: false, assets: [{ uri: "water.jpg", base64: "image" }] });
  mockVision.mockResolvedValue({ data: { foodName: "识别饮品", calories: 0, proteinGrams: null, carbsGrams: 0.04 }, run: { id: "photo", status: "completed" } });
  mockWait.mockResolvedValue({ id: "photo", status: "completed" });
  const tree = await renderScreen();
  await act(async () => { press(tree, "记录一餐"); });
  await act(async () => { press(tree, "水煮蛋"); });
  await act(async () => { press(tree, "AI 智能拍照识菜"); });
  await act(async () => { press(tree, "保存这餐"); });
  expect(mockCreate.mock.calls[0][1]).toMatchObject({
    food_name: "识别饮品", calories: 0, protein: null, carbs: 0.04, fat: null,
  });
  act(() => tree.unmount());
});
