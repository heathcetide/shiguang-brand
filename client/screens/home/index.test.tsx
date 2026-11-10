import React from "react";
import renderer, { act } from "react-test-renderer";
import { Animated, Text } from "react-native";
import HomeScreen from "./index";

const mockAuthFetch = jest.fn();
const mockRefresh = jest.fn();
let mockRecords: unknown[] = [];
const mockInventory: unknown[] = [];
const mockRecipes = [{ id: 1, title: "未知营养菜谱", calories: null, protein: null, carbs: null, fat: null,
  nutrition_basis: "unknown", tags: [], ingredients: [], category: "其他" }];
jest.mock("./useHomeData", () => ({ useHomeData: () => ({
  todayRecords: mockRecords, recipes: mockRecipes, inventoryItems: mockInventory,
  expiringItems: [], posts: [], healthLogs: [], loading: false, error: null, refresh: mockRefresh,
}) }));
jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1 }, isAuthenticated: true }), useAuthFetch: () => mockAuthFetch,
}));
jest.mock("@/hooks/useSafeRouter", () => ({ useSafeRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/hooks/useHealthSummary", () => ({ useHealthSummary: () => ({ targetCalories: 2000, targetLabel: "参考目标" }) }));
jest.mock("expo-router", () => ({ useFocusEffect: (callback: () => void) => require("react").useEffect(callback, [callback]) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));
jest.mock("@react-native-async-storage/async-storage", () => ({ getItem: async () => null }));
jest.mock("@/components/Screen", () => ({ Screen: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("@/components/ThemedFontAwesome6", () => "Icon");
jest.mock("@/components/RecipeCover", () => ({ RecipeCover: () => null }));
jest.mock("@/components/OnboardingProgressCard", () => ({ OnboardingProgressCard: () => null }));
jest.mock("./TodayRecordsModal", () => ({ TodayRecordsModal: () => null }));
jest.mock("@/services/api", () => ({
  cookingQueueApi: { list: async () => [] },
  recipesApi: {}, recommendationsApi: { event: async () => ({}) },
  aiApi: { homeRecommendations: async () => ({ cards: [{ title: "未知营养菜谱", tag: "推荐", desc: "测试", calories: null, prompt: "查看菜谱", recipeId: 1 }],
    recommendations: { items: [{ recipeId: 1, recipe: mockRecipes[0], features: { matchedIngredients: [], expiringIngredients: [] } }], requestId: "test", scoringVersion: "test" } }) },
}));

test.each([
  { value: null, expected: "未知", macro: "未知", progress: "热量待补全" },
  { value: 0, expected: "0", macro: "0g", progress: "0%" },
])("home distinguishes nutrient value $value from zero", async ({ value, expected, macro, progress }) => {
  jest.useFakeTimers();
  mockRecords = [{ id: 1, food_name: "测试餐", calories: value, protein: value, carbs: value, fat: value }];
  let tree!: renderer.ReactTestRenderer;
  try {
    await act(async () => { tree = renderer.create(<HomeScreen />); });
    const labels = tree.root.findAllByType(Text).map(node =>
      React.Children.toArray(node.props.children).filter(child => typeof child === "string" || typeof child === "number").join(""));
    expect(labels).toContain(expected);
    expect(labels).toContain(macro);
    expect(labels).toContain(progress);
    expect(labels).toContain("营养待补全");
    expect(labels).toContain("蛋白质未知");
  } finally {
    if (tree) act(() => tree.unmount());
    jest.useRealTimers();
  }
});

test("home counts unconfirmed locations once and shows unknown latest-stock quantity", async () => {
  jest.useFakeTimers();
  const locations = ["", "冷藏", "冷冻", "常温", null, undefined, "未知", "柜子"];
  mockInventory.push(...locations.map((storage_location, id) => ({ id, food_name: `食材${id}`, storage_location, quantity: "" })));
  const animation = jest.spyOn(Animated, "parallel").mockImplementation(() => ({
    start: callback => callback?.({ finished: true }), stop: jest.fn(), reset: jest.fn(),
  }));
  let tree!: renderer.ReactTestRenderer;
  const labels = () => tree.root.findAllByType(Text).map(node =>
    React.Children.toArray(node.props.children).filter(child => typeof child === "string" || typeof child === "number").join(""));
  try {
    await act(async () => { tree = renderer.create(<HomeScreen />); });
    expect(labels()).toContain("冷藏 1 · 冷冻 1 · 常温 1 · 位置待确认 5");
    expect(labels()).toContain("当前共 8 种食材，随时可以开始配餐");
    expect(labels()).toContain("位置待确认");
    await act(async () => { jest.advanceTimersByTime(4200); });
    expect(labels()).toContain("位置待确认 · 数量未知，已加入你的保鲜库");
    expect(labels().join(" ")).not.toContain("1份");
    expect(mockInventory.map(item => (item as { storage_location?: string | null }).storage_location)).toEqual(locations);
  } finally {
    if (tree) act(() => tree.unmount());
    mockInventory.length = 0;
    animation.mockRestore();
    jest.useRealTimers();
  }
});
