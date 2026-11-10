import React from "react";
import renderer, { act } from "react-test-renderer";
import { Text, TouchableOpacity } from "react-native";
const mockReserve = jest.fn();
const mockList = jest.fn(); const mockEat = jest.fn(); const mockFetch = jest.fn();
const mockStore = new Map<string,string>(); let mockUser = { id: 51 };
const mockWrite = jest.fn(async (key: string,value: string) => { mockStore.set(key,value); });
jest.mock("@/contexts/AuthContext",() => ({ useAuth: () => ({ user: mockUser }),useAuthFetch: () => mockFetch }));
jest.mock("@/hooks/useSafeRouter",() => ({ useSafeSearchParams: () => ({ householdId: 8 }),useSafeRouter: () => ({ back: jest.fn(),push: jest.fn() }) }));
jest.mock("@/components/Screen",() => ({ Screen: "View" }));
jest.mock("expo-router",() => ({ useFocusEffect: (callback: () => void) => require("react").useEffect(callback,[callback]) }));
jest.mock("expo-crypto",() => ({ randomUUID: () => "78888888-8888-4888-8888-888888888881" }));
jest.mock("expo-file-system",() => ({ Paths: { cache: { size: 0 } } }));
jest.mock("@react-native-async-storage/async-storage",() => ({ __esModule: true,default: {
  getItem: async (key: string) => mockStore.get(key) ?? null,setItem: (...args: [string,string]) => mockWrite(...args),removeItem: async (key: string) => { mockStore.delete(key); },
} }));
jest.mock("@/services/api/households",() => ({ householdApi: { reserveMeal: (...args: unknown[]) => mockReserve(...args),meals: (...args: unknown[]) => mockList(...args),diningPreferences: async () => ({ membershipId: 5 }),eatMeal: (...args: unknown[]) => mockEat(...args) } }));
import HouseholdMealsScreen from "./index";
import { invalidatePrivateStorage,activatePrivateStorage } from "@/utils/userStorage";
const meal = { id: "78888888-8888-4888-8888-888888888888",householdId: 8,foodName: "家庭饭",producedServings: 3,remainingServings: 3,version: 1,repeated: false };
const key = "household-eating-pending:8:user:51";
function press(tree: renderer.ReactTestRenderer,label: string) {
  tree.root.findAllByType(TouchableOpacity).find(node => node.findAllByType(Text).some(text => text.props.children === label))!.props.onPress();
}
beforeEach(() => { jest.clearAllMocks(); mockUser = { id: 51 }; mockStore.clear(); mockList.mockReset().mockResolvedValue([meal]); mockEat.mockReset(); });
test("persists before sending and retries the identical request, then reloads current quantities",async () => {
  mockEat.mockImplementationOnce(async () => { expect(mockStore.has(key)).toBe(true); throw new Error("timeout"); }).mockResolvedValueOnce({ meal, dietRecordId: 1,repeated: true });
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<HouseholdMealsScreen />); });
  act(() => press(tree,"我吃了"));
  await act(async () => { press(tree,"确认本人食用"); });
  const original = mockEat.mock.calls[0][3];
  expect(JSON.stringify(tree.toJSON())).toContain("重试原提交");
  mockList.mockResolvedValue([{ ...meal,version: 4,remainingServings: 0 }]);
  await act(async () => { press(tree,"重试原提交"); });
  expect(mockEat.mock.calls[1][3]).toEqual(original);
  expect(mockStore.has(key)).toBe(false);
  expect(tree.root.findAllByType(Text).some(text => JSON.stringify(text.props.children) === JSON.stringify(["剩余 ",0," / 制作 ",3," 份"]))).toBe(true);
  act(() => tree.unmount());
});
test("restores a pending request after reopening without a new idempotency key",async () => {
  const input = { idempotencyKey: "78888888-8888-4888-8888-888888888889",membershipId: 5,version: 1,servings: 1,recordedDate: "2026-09-12",recordedTime: null,mealType: "lunch" };
  mockStore.set(key,JSON.stringify({ mealId: meal.id,input })); mockEat.mockResolvedValue({});
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<HouseholdMealsScreen />); });
  await act(async () => { press(tree,"重试原提交"); });
  expect(mockEat).toHaveBeenCalledWith(mockFetch,8,meal.id,input);
  act(() => tree.unmount());
});
test("an account change discards late mutation responses and cannot clear the next accounts pending state",async () => {
  let resolve!: (value: unknown) => void; mockEat.mockReturnValue(new Promise(done => { resolve = done; }));
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<HouseholdMealsScreen />); });
  act(() => press(tree,"我吃了")); await act(async () => { press(tree,"确认本人食用"); });
  mockUser = { id: 52 }; mockList.mockResolvedValue([]);
  await act(async () => { tree.update(<HouseholdMealsScreen />); });
  await act(async () => { resolve({ meal,dietRecordId: 1 }); });
  expect(JSON.stringify(tree.toJSON())).not.toContain("家庭饭");
  expect(mockStore.has(key)).toBe(true);
  act(() => tree.unmount());
});
test("failed durable storage prevents sending the meal mutation",async () => {
  mockWrite.mockRejectedValueOnce(new Error("storage failed"));
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<HouseholdMealsScreen />); });
  act(() => press(tree,"我吃了")); await act(async () => { press(tree,"确认本人食用"); });
  expect(mockEat).not.toHaveBeenCalled(); act(() => tree.unmount());
});
test("a new session of the same account cannot remain blocked by the old in-flight write",async () => {
  let resolve!: (value: unknown) => void; mockEat.mockReturnValue(new Promise(done => { resolve = done; }));
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<HouseholdMealsScreen />); });
  act(() => press(tree,"我吃了")); await act(async () => { press(tree,"确认本人食用"); });
  invalidatePrivateStorage(51); mockStore.delete(key); activatePrivateStorage(51); mockList.mockResolvedValue([]);
  await act(async () => { tree.update(<HouseholdMealsScreen />); });
  await act(async () => { resolve({ meal }); });
  expect(mockList).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(tree.toJSON())).not.toContain("家庭饭");
  act(() => tree.unmount());
});

test("reserving uses the displayed version and only changes the current members reservation",async () => {
  mockReserve.mockResolvedValue({ version: 2,myReservedServings: 1 });
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<HouseholdMealsScreen />); });
  act(() => press(tree,"设置我的预留"));
  act(() => tree.root.findByProps({ accessibilityLabel: "我的预留份量" }).props.onChangeText("1"));
  mockList.mockResolvedValue([{ ...meal,version: 2,reservedServings: 1,myReservedServings: 1,availableServings: 3 }]);
  await act(async () => { press(tree,"保存我的预留"); });
  expect(mockReserve).toHaveBeenCalledWith(mockFetch,8,meal.id,{ membershipId: 5,version: 1,servings: 1 });
  expect(mockEat).not.toHaveBeenCalled();
  act(() => press(tree,"设置我的预留"));
  act(() => tree.root.findByProps({ accessibilityLabel: "我的预留份量" }).props.onChangeText("0"));
  await act(async () => { press(tree,"保存我的预留"); });
  expect(mockReserve.mock.calls[1][3]).toEqual({ membershipId: 5,version: 2,servings: 0 });
  act(() => tree.unmount());
});
