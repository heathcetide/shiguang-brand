import React from "react";
import renderer, { act } from "react-test-renderer";
import { Text } from "react-native";
import { addLocalDays, toLocalDateKey } from "@/utils/date";

const mockList = jest.fn();
const mockAuthFetch = jest.fn();
jest.mock("@/services/api", () => ({
  dietApi: { list: () => mockList() },
  healthApi: { latest: async () => null, list: async () => [], profile: async () => null },
  recipesApi: { favoriteCount: async () => ({ count: 0 }) },
  communityApi: { following: async () => [], level: async () => null },
}));
jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, username: "验收用户" }, isAuthenticated: true, isLoading: false }),
  useAuthFetch: () => mockAuthFetch,
}));
jest.mock("@/hooks/useSafeRouter", () => ({ useSafeRouter: () => ({ push: jest.fn() }) }));
jest.mock("expo-router", () => ({ useFocusEffect: (callback: () => void) => require("react").useEffect(callback, [callback]) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@/hooks/useAppThemeColors", () => ({ useAppThemeColors: () => ({ surface: "white", brand: "green" }) }));
jest.mock("@/components/Screen", () => ({ Screen: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("@/components/ThemedFontAwesome6", () => "Icon");
jest.mock("react-native-chart-kit", () => ({ LineChart: "LineChart" }));

import ProfileScreen from "./index";

test("profile distinguishes unknown from zero calories and totals every recorded meal", async () => {
  mockList.mockResolvedValue([null, 0, 100, 100, 100, 100].map((calories, index) => ({
    id: index + 1, food_name: `第${index + 1}餐`, meal_type: "午餐", amount: "1份", calories,
    recorded_at: toLocalDateKey(),
  })));
  let tree!: renderer.ReactTestRenderer;
  try {
    await act(async () => { tree = renderer.create(<ProfileScreen />); });
    const labels = tree.root.findAllByType(Text).map(node =>
      React.Children.toArray(node.props.children).filter(child => typeof child === "string" || typeof child === "number").join(""));
    expect(labels).toContain("热量未知");
    expect(labels).toContain("0 kcal");
    expect(labels).toContain("今日已知热量合计");
    expect(labels).toContain("400 kcal");
  } finally {
    if (tree) act(() => tree.unmount());
  }
});

test("seven-day trend excludes unknown and unrecorded days from the mean, retaining zero", async () => {
  mockList.mockResolvedValue([
    { id: 1, calories: null, recorded_at: toLocalDateKey() },
    { id: 2, calories: 0, recorded_at: toLocalDateKey(addLocalDays(-1)) },
    { id: 3, calories: 200, recorded_at: toLocalDateKey(addLocalDays(-2)) },
    { id: 4, calories: null, recorded_at: toLocalDateKey(addLocalDays(-3)) },
    { id: 5, calories: 50, recorded_at: toLocalDateKey(addLocalDays(-3)) },
  ]);
  let tree!: renderer.ReactTestRenderer;
  try {
    await act(async () => { tree = renderer.create(<ProfileScreen />); });
    const labels = tree.root.findAllByType(Text).map(node =>
      React.Children.toArray(node.props.children).filter(child => typeof child === "string" || typeof child === "number").join(""));
    expect(labels).toContain("热量齐全的 2 天均值 100 kcal");
    expect(labels).toContain("已知 50 kcal");
    expect(labels).toContain("0 kcal");
    expect(labels).toContain("热量未知");
    expect(labels).toContain("未记录");
  } finally { if (tree) act(() => tree.unmount()); }
});
