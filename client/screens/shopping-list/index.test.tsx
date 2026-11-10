import React from "react";
import renderer, { act } from "react-test-renderer";
import { Alert, Text, TouchableOpacity } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ApiError } from "@/services/api/client";

jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
const mockAuthFetch = jest.fn();
let mockUserId = 42;
let mockSession = 1;
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: mockUserId }, sessionGeneration: mockSession }), useAuthFetch: () => mockAuthFetch }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));
jest.mock("@/components/Screen", () => ({ Screen: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("@/components/ThemedFontAwesome6", () => "Icon");
const mockImport = jest.fn();
const mockRemove = jest.fn();
const mockLoad = jest.fn();
const mockMine = jest.fn();
const mockFamilyLoad = jest.fn();
jest.mock("@/services/api", () => ({
  householdApi: { mine: (...args: unknown[]) => mockMine(...args), shoppingList: (...args: unknown[]) => mockFamilyLoad(...args) },
  shoppingListApi: { import: (...args: unknown[]) => mockLoad(...args), remove: (...args: unknown[]) => mockRemove(...args) },
  inventoryApi: { importShoppingList: (...args: unknown[]) => mockImport(...args) },
}));
const mockLog = jest.fn();
jest.mock("@/utils/inventoryHistory", () => ({ addInventoryLog: (...args: unknown[]) => mockLog(...args) }));
import ShoppingListScreen from "./index";

const item = { id: "00000000-0000-4000-8000-000000000001", name: "番茄", amount: "2个", category: "蔬菜", checked: true, version: 2, createdAt: 1 };
let tree: renderer.ReactTestRenderer;
function pressIntake() {
  const button = tree.root.findAllByType(TouchableOpacity).find(node => node.findAllByType(Text).some(text => JSON.stringify(text.props.children).includes("一键存入")));
  if (!button) throw new Error("Missing intake button");
  return button.props.onPress();
}
beforeEach(async () => {
  jest.clearAllMocks();
  mockUserId = 42; mockSession = 1;
  mockMine.mockReset().mockResolvedValue([{ id: 7, name: "测试家庭" }]);
  mockFamilyLoad.mockReset().mockResolvedValue([]);
  await AsyncStorage.clear();
  jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  mockLoad.mockResolvedValue({ items: [item] });
  mockImport.mockResolvedValue({ items: [], repeated: false });
  await act(async () => { tree = renderer.create(<ShoppingListScreen />); });
});
afterEach(async () => { await act(async () => { tree.unmount(); }); jest.restoreAllMocks(); });

test("intake passes source versions once and never issues separate shopping deletes", async () => {
  await act(async () => { await Promise.all([pressIntake(), pressIntake()]); });
  expect(mockImport).toHaveBeenCalledTimes(1);
  expect(mockImport.mock.calls[0][3]).toEqual([{ id: item.id, version: 2 }]);
  expect(mockRemove).not.toHaveBeenCalled();
  expect(mockLog).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(tree.toJSON())).not.toContain("一键存入");
});

test("lost response retry reuses its key and repeated result does not duplicate local history", async () => {
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  mockImport.mockRejectedValueOnce(new Error("连接中断")).mockResolvedValueOnce({ items: [], repeated: true });
  await act(async () => { await pressIntake(); });
  await act(async () => { await pressIntake(); });
  expect(mockImport.mock.calls[0][1]).toBe(mockImport.mock.calls[1][1]);
  expect(mockRemove).not.toHaveBeenCalled();
  expect(mockLog).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenLastCalledWith("入库成功！", expect.any(String), expect.any(Array));
});

test("cache failure after a committed intake still reports success and removes purchased rows", async () => {
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error("storage full"));
  await act(async () => { await pressIntake(); });
  expect(Alert.alert).toHaveBeenLastCalledWith("入库成功！", expect.any(String), expect.any(Array));
  expect(JSON.stringify(tree.toJSON())).not.toContain("一键存入");
  expect(mockImport).toHaveBeenCalledTimes(1);
});

test("an already transferred or changed source refreshes the list without another intake", async () => {
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  mockLoad.mockResolvedValueOnce({ items: [] });
  mockImport.mockRejectedValueOnce(new ApiError("采购项已变更或已入库", 409, { code: "SHOPPING_ITEM_CONFLICT" }));
  await act(async () => { await pressIntake(); });
  expect(mockLoad).toHaveBeenCalledTimes(2);
  expect(mockImport).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(tree.toJSON())).not.toContain("一键存入");
});

function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function press(label: string) {
  const button = tree.root.findAllByType(TouchableOpacity).find(node => node.findAllByType(Text).some(text => text.props.children === label));
  if (!button) throw new Error(`Missing button: ${label}`);
  return button.props.onPress();
}

test("late household responses never replace a newly selected personal list", async () => {
  const late = deferred<unknown[]>(); mockFamilyLoad.mockReturnValueOnce(late.promise);
  await act(async () => { press("测试家庭"); });
  expect(JSON.stringify(tree.toJSON())).not.toContain("一键存入");
  await act(async () => { press("个人清单"); });
  await act(async () => { late.resolve([{ ...item, name: "家庭私有牛奶", checked: false }]); });
  expect(JSON.stringify(tree.toJSON())).not.toContain("家庭私有牛奶");
  expect(JSON.stringify(tree.toJSON())).toContain("一键存入");
});

test("leaving and reentering the same household invalidates the first visit", async () => {
  const late = deferred<unknown[]>(); mockFamilyLoad.mockReturnValueOnce(late.promise);
  await act(async () => { press("测试家庭"); });
  await act(async () => { press("个人清单"); });
  mockFamilyLoad.mockResolvedValueOnce([{ ...item, name: "最新家庭采购", checked: false }]);
  await act(async () => { press("测试家庭"); });
  await act(async () => { late.resolve([{ ...item, name: "过期家庭采购", checked: false }]); });
  expect(JSON.stringify(tree.toJSON())).toContain("最新家庭采购");
  expect(JSON.stringify(tree.toJSON())).not.toContain("过期家庭采购");
});

test("a late household failure cannot disable the personal list", async () => {
  const late = deferred<unknown[]>(); mockFamilyLoad.mockReturnValueOnce(late.promise);
  await act(async () => { press("测试家庭"); });
  await act(async () => { press("个人清单"); });
  await act(async () => { late.reject(new Error("old household failure")); });
  await act(async () => { await pressIntake(); });
  expect(mockImport).toHaveBeenCalledTimes(1);
});

test("a late successful intake cannot change another list or show a stale success alert", async () => {
  const late = deferred<{ items: unknown[]; repeated: boolean }>(); mockImport.mockReturnValueOnce(late.promise);
  let pending!: Promise<void>; await act(async () => { pending = pressIntake(); });
  mockFamilyLoad.mockResolvedValueOnce([{ ...item, name: "当前家庭采购", checked: false }]);
  await act(async () => { press("测试家庭"); });
  jest.mocked(AsyncStorage.setItem).mockClear();
  await act(async () => { late.resolve({ items: [], repeated: false }); await pending; });
  expect(JSON.stringify(tree.toJSON())).toContain("当前家庭采购");
  expect(Alert.alert).not.toHaveBeenCalled(); expect(mockLog).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test("session changes clear family selection and ignore old personal responses and cache writes", async () => {
  const late = deferred<{ items: unknown[] }>();
  await act(async () => { press("测试家庭"); });
  mockLoad.mockReturnValueOnce(late.promise);
  await act(async () => { press("个人清单"); });
  mockUserId = 43; mockSession = 2;
  mockLoad.mockResolvedValueOnce({ items: [{ ...item, name: "新账号采购", checked: false }] });
  await act(async () => { tree.update(<ShoppingListScreen />); });
  jest.mocked(AsyncStorage.setItem).mockClear();
  await act(async () => { late.resolve({ items: [{ ...item, name: "旧账号采购", checked: false }] }); });
  expect(JSON.stringify(tree.toJSON())).toContain("新账号采购");
  expect(JSON.stringify(tree.toJSON())).not.toContain("旧账号采购");
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});


test("a confirmation opened in a previous list cannot delete after switching", async () => {
  await act(async () => { press("清空已买"); });
  const buttons = jest.mocked(Alert.alert).mock.calls.at(-1)![2]!;
  const confirm = buttons.find(button => button.text === "确认清除")!.onPress!;
  await act(async () => { press("测试家庭"); });
  await act(async () => { confirm(); });
  expect(mockRemove).not.toHaveBeenCalled();
});

test("a new session of the same account discards a previous intake callback", async () => {
  const late = deferred<{ items: unknown[]; repeated: boolean }>(); mockImport.mockReturnValueOnce(late.promise);
  let pending!: Promise<void>; await act(async () => { pending = pressIntake(); });
  mockSession += 1;
  mockLoad.mockResolvedValueOnce({ items: [] });
  await act(async () => { tree.update(<ShoppingListScreen />); });
  await act(async () => { late.resolve({ items: [], repeated: false }); await pending; });
  expect(Alert.alert).not.toHaveBeenCalled(); expect(mockLog).not.toHaveBeenCalled();
  expect(JSON.stringify(tree.toJSON())).not.toContain("一键存入");
});
