import React from "react";
import renderer, { act } from "react-test-renderer";
import { Text, TouchableOpacity } from "react-native";
let mockPlanItem: { planId: string; itemId: string; version: number } | undefined;
const mockProduce = jest.fn(); const mockInventory = jest.fn(); const mockFetch = jest.fn();
const mockStore = new Map<string,string>(); let mockUser = { id: 61 };
const mockRemove = jest.fn(async (key: string) => { mockStore.delete(key); });
const mockWrite = jest.fn(async (key: string,value: string) => { mockStore.set(key,value); });
jest.mock("@/contexts/AuthContext",() => ({ useAuth: () => ({ user: mockUser }),useAuthFetch: () => mockFetch }));
jest.mock("@/hooks/useSafeRouter",() => ({ useSafeSearchParams: () => ({ householdId: 8,planItem: mockPlanItem }),useSafeRouter: () => ({ back: jest.fn(),push: jest.fn() }) }));
jest.mock("@/components/Screen",() => ({ Screen: "View" }));
jest.mock("expo-router",() => ({ useFocusEffect: (callback: () => void) => require("react").useEffect(callback,[callback]) }));
jest.mock("expo-crypto",() => ({ randomUUID: () => "78888888-8888-4888-8888-888888888881" }));
jest.mock("expo-file-system",() => ({ Paths: { cache: { size: 0 } } }));
jest.mock("@react-native-async-storage/async-storage",() => ({ __esModule: true,default: { getItem: async (key: string) => mockStore.get(key) ?? null,setItem: (...args: [string,string]) => mockWrite(...args),removeItem: (key: string) => mockRemove(key) } }));
jest.mock("@/services/api/households",() => ({ householdApi: { inventoryList: (...args: unknown[]) => mockInventory(...args),diningPreferences: async () => ({ membershipId: 5 }),produceMeal: (...args: unknown[]) => mockProduce(...args) } }));
import HouseholdProductionScreen from "./index";
import { actualQuantity } from "./input";
import { ApiError } from "@/services/api/client";
const key = "household-production-pending:8:user:61";
function press(tree: renderer.ReactTestRenderer,label: string) { tree.root.findAllByType(TouchableOpacity).find(node => node.findAllByType(Text).some(text => text.props.children === label))!.props.onPress(); }
function fill(tree: renderer.ReactTestRenderer) {
  tree.root.findByProps({ accessibilityLabel: "家庭制作名称" }).props.onChangeText("三人米饭");
  tree.root.findByProps({ accessibilityLabel: "总制作份量" }).props.onChangeText("3");
  tree.root.findByProps({ accessibilityLabel: "使用大米" }).props.onValueChange(true);
}
beforeEach(() => { mockPlanItem = undefined; jest.clearAllMocks(); mockUser = { id: 61 }; mockStore.clear(); mockProduce.mockReset(); mockInventory.mockReset().mockResolvedValue([{ id: 9,food_name: "大米",quantity: "1kg",version: 2,is_available: true }]); });
test("only exact positive quantities are accepted",() => {
  for (const input of ["-2个","1-2个","大约100g","100g加一点","适量","0g"]) expect(actualQuantity(input)).toBeNull();
  expect(actualQuantity(" 0.3 kg ")).toEqual({ amount: 0.3,unit: "kg" });
});
test("persists chosen inventory versions and retries the original production without re-entering stock",async () => {
  mockProduce.mockImplementationOnce(async () => { expect(mockStore.has(key)).toBe(true); throw new Error("timeout"); }).mockResolvedValueOnce({});
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<HouseholdProductionScreen />); });
  act(() => fill(tree)); act(() => tree.root.findByProps({ accessibilityLabel: "大米实际扣量" }).props.onChangeText("300g"));
  await act(async () => { press(tree,"确认完成制作并扣减所选原料"); });
  expect(mockProduce.mock.calls[0][2]).toEqual({ idempotencyKey: "78888888-8888-4888-8888-888888888881",membershipId: 5,foodName: "三人米饭",producedServings: 3,inventory: [{ itemId: 9,version: 2,amount: 300,unit: "g" }] });
  act(() => tree.unmount());
  await act(async () => { tree = renderer.create(<HouseholdProductionScreen />); });
  await act(async () => { press(tree,"重试原制作"); });
  expect(mockProduce.mock.calls[1][2]).toEqual(mockProduce.mock.calls[0][2]);
  expect(mockStore.has(key)).toBe(false);
  expect(JSON.stringify(tree.toJSON())).toContain("尚未记录任何人的食用"); act(() => tree.unmount());
});
test("a stock version conflict clears the rejected request and requires fresh stock selection",async () => {
  mockProduce.mockRejectedValueOnce(new ApiError("changed",409,{ code: "INVENTORY_VERSION_CONFLICT" }));
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<HouseholdProductionScreen />); });
  act(() => fill(tree)); act(() => tree.root.findByProps({ accessibilityLabel: "大米实际扣量" }).props.onChangeText("300g"));
  await act(async () => { press(tree,"确认完成制作并扣减所选原料"); });
  expect(mockStore.has(key)).toBe(false); expect(JSON.stringify(tree.toJSON())).toContain("本次没有扣库");
  expect(tree.root.findAllByProps({ accessibilityLabel: "大米实际扣量" })).toHaveLength(0);
  act(() => tree.unmount());
});
test("late production results from another account cannot show success or clear its pending request",async () => {
  let resolve!: (value: unknown) => void; mockProduce.mockReturnValue(new Promise(done => { resolve = done; }));
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<HouseholdProductionScreen />); });
  act(() => fill(tree)); act(() => tree.root.findByProps({ accessibilityLabel: "大米实际扣量" }).props.onChangeText("300g"));
  await act(async () => { press(tree,"确认完成制作并扣减所选原料"); });
  mockUser = { id: 62 };
  await act(async () => { tree.update(<HouseholdProductionScreen />); });
  await act(async () => { resolve({}); });
  expect(mockStore.has(key)).toBe(true); expect(JSON.stringify(tree.toJSON())).not.toContain("制作已记录");
  act(() => tree.unmount());
});

test("failed cleanup of a rejected production retains its retry instead of allowing a new request",async () => {
  mockProduce.mockRejectedValueOnce(new ApiError("changed",409,{ code: "INVENTORY_VERSION_CONFLICT" })); mockRemove.mockRejectedValueOnce(new Error("storage failed"));
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<HouseholdProductionScreen />); });
  act(() => fill(tree)); act(() => tree.root.findByProps({ accessibilityLabel: "大米实际扣量" }).props.onChangeText("300g"));
  await act(async () => { press(tree,"确认完成制作并扣减所选原料"); });
  expect(mockStore.has(key)).toBe(true); expect(JSON.stringify(tree.toJSON())).toContain("本地待确认项未能清除");
  act(() => tree.unmount());
});


test("persists the source meal version and keeps it when reopening from another meal",async () => {
  mockPlanItem = { planId: "personal-plan",itemId: "lunch",version: 4 };
  mockProduce.mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce({});
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<HouseholdProductionScreen />); });
  act(() => fill(tree));
  act(() => tree.root.findByProps({ accessibilityLabel: "大米实际扣量" }).props.onChangeText("300g"));
  await act(async () => { press(tree,"确认完成制作并扣减所选原料"); });
  const original = mockProduce.mock.calls[0][2];
  expect(original.planItem).toEqual(mockPlanItem);
  expect(JSON.parse(mockStore.get(key)!).planItem).toEqual(mockPlanItem);
  act(() => tree.unmount());
  mockPlanItem = { planId: "another-plan",itemId: "dinner",version: 1 };
  await act(async () => { tree = renderer.create(<HouseholdProductionScreen />); });
  await act(async () => { press(tree,"重试原制作"); });
  expect(mockProduce.mock.calls[1][2]).toEqual(original);
  act(() => tree.unmount());
});
