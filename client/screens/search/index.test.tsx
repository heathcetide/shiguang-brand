import React from "react";
import renderer, { act } from "react-test-renderer";
import { Linking, Text, TouchableOpacity } from "react-native";
import SearchScreen from "./index";

const mockPush = jest.fn();
const mockAuthFetch = jest.fn();
let mockFoods: unknown[] = [];
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null }), useAuthFetch: () => mockAuthFetch }));
jest.mock("@/hooks/useSafeRouter", () => ({
  useSafeRouter: () => ({ push: mockPush, back: jest.fn() }),
  useSafeSearchParams: () => ({ initialQuery: "食材" }),
}));
jest.mock("@/components/Screen", () => ({ Screen: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("@/components/ThemedFontAwesome6", () => "Icon");
jest.mock("@/components/RecipeCover", () => ({ RecipeCover: () => null }));
jest.mock("@react-native-async-storage/async-storage", () => ({ getItem: async () => null, setItem: jest.fn() }));
jest.mock("@/services/api", () => ({
  recipesApi: { listPage: async () => ({ items: [] }) },
  foodsApi: { search: async () => mockFoods },
  communityApi: { posts: async () => [], users: async () => [] },
}));

let tree: renderer.ReactTestRenderer;
const button = (label: string) => tree.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === label)!;
const labels = () => tree.root.findAllByType(Text).map(node => React.Children.toArray(node.props.children).join(""));
async function renderSearch() {
  await act(async () => { tree = renderer.create(<SearchScreen />); });
  await act(async () => { jest.advanceTimersByTime(420); });
}
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
});
afterEach(() => {
  if (tree) act(() => tree.unmount());
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test("USDA source opens independently of the existing 100g record action", async () => {
  mockFoods = [{ name: "Water", source: "open_api", source_data_type: "Branded", nutrition_basis: "per_100g", fdc_id: 1,
    source_url: "https://fdc.nal.usda.gov/food-details/1/nutrients",
    calories_100g: 0, protein_100g: null, carbs_100g: 0.01, fat_100g: null }];
  await renderSearch();
  expect(labels()).toContain("USDA · 品牌食品标签 · 每 100g · 待复核");
  const source = button("查看 USDA 来源 · FDC 1");
  const record = button("记录食材Water");
  for (let ancestor = source.parent; ancestor; ancestor = ancestor.parent) expect(ancestor).not.toBe(record);
  await act(async () => { source.props.onPress(); });
  expect(Linking.openURL).toHaveBeenCalledWith("https://fdc.nal.usda.gov/food-details/1/nutrients");
  expect(mockPush).not.toHaveBeenCalled();
  act(() => { record.props.onPress(); });
  expect(mockPush).toHaveBeenCalledWith("/diet-record", {
    prefill_food: "Water", prefill_amount: "100g", prefill_calories: 0, prefill_protein: "", prefill_carbs: 0.01, prefill_fat: "",
  });
});

test("scoped references disclose unknown nutrients without binding a sample to the food concept", async () => {
  mockFoods = [{ id: 2, name: "花生", source: "concept_base", calories_100g: null, protein_100g: null, carbs_100g: null, fat_100g: null,
    nutrition_references: [{ id: "peanut-raw", display_name: "生花生仁", scope: "生鲜去壳花生，非炒熟花生",
      source_kind: "TFDA", source_name: "花生仁(生)", source_food_id: "TFDA:sample", source_url: "https://data.gov.tw/dataset/8543",
      basis: "per_100g_edible_portion", nutrients_per_100g: {
        calories: { amount: 550, unit: "kcal" }, protein: { amount: null, unit: "g" }, carbs: { amount: 0, unit: "g" },
      } }],
  }];
  await renderSearch();
  expect(labels()).not.toContain("适用范围：生鲜去壳花生，非炒熟花生");
  act(() => { button("形态营养参考").props.onPress(); });
  expect(button("形态营养参考").props.accessibilityState).toEqual({ expanded: true });
  expect(labels()).toEqual(expect.arrayContaining([
    "适用范围：生鲜去壳花生，非炒熟花生", "每 100g 可食部", "热量：550 kcal", "蛋白质：未知", "碳水：0 g", "脂肪：未知",
    "来源：台湾食药署", "样品：花生仁(生) · TFDA:sample",
    "仅适用于注明形态和条件的样品；不会自动绑定整个食材概念，也不会自动填入记餐。",
  ]));
  await act(async () => { button("查看样品来源：生花生仁").props.onPress(); });
  expect(Linking.openURL).toHaveBeenCalledWith("https://data.gov.tw/dataset/8543");
  expect(mockPush).not.toHaveBeenCalled();
  act(() => { button("记录食材花生").props.onPress(); });
  expect(mockPush).toHaveBeenCalledWith("/diet-record", {
    prefill_food: "花生", prefill_amount: "100g", prefill_calories: "", prefill_protein: "", prefill_carbs: "", prefill_fat: "",
  });
  act(() => { button("形态营养参考").props.onPress(); });
  expect(labels()).not.toContain("适用范围：生鲜去壳花生，非炒熟花生");
});

test.each([
  { source: "concept_base", nutrition_basis: "per_100g" },
  { source: "manual", nutrition_basis: "per_100g", automatic_calculation_allowed: false },
  { source: "open_api", nutrition_basis: "per_100ml" },
  { source: "open_api", nutrition_basis: "unknown" },
  { source: "open_api" },
])("does not display or prefill unsafe 100g values from a stale response: %j", async metadata => {
  mockFoods = [{ ...metadata, name: "待核对样品", calories_100g: 42, protein_100g: 1.2, carbs_100g: 10.8, fat_100g: 0,
    source_data_type: "Branded", fdc_id: 123, source_url: "https://fdc.nal.usda.gov/food-details/123/nutrients" }];
  await renderSearch();
  expect(labels()).toContain("营养待补全");
  expect(labels()).toContain("蛋白质 —g · 碳水 —g · 脂肪 —g");
  if (metadata.source === "open_api") {
    const basis = metadata.nutrition_basis === "per_100ml" ? "来源每 100ml" : "计量基准待核对";
    expect(labels()).toContain(`USDA · 品牌食品标签 · ${basis} · 未换算为 100g · 待复核`);
    await act(async () => { button("查看 USDA 来源 · FDC 123").props.onPress(); });
    expect(Linking.openURL).toHaveBeenCalledWith("https://fdc.nal.usda.gov/food-details/123/nutrients");
    expect(mockPush).not.toHaveBeenCalled();
  }
  act(() => { button("记录食材待核对样品").props.onPress(); });
  expect(mockPush).toHaveBeenCalledWith("/diet-record", {
    prefill_food: "待核对样品", prefill_amount: "100g", prefill_calories: "", prefill_protein: "", prefill_carbs: "", prefill_fat: "",
  });
});

test("unsafe source links cannot open a native URL or create a diet record", async () => {
  mockFoods = [{ name: "无效来源", source: "open_api", source_url: "javascript:alert(1)", nutrition_basis: "unknown" }];
  await renderSearch();
  expect(labels()).toContain("来源链接未提供");
  expect(tree.root.findAllByType(TouchableOpacity).filter(node => node.props.accessibilityRole === "link")).toHaveLength(0);
  expect(Linking.openURL).not.toHaveBeenCalled();
  expect(mockPush).not.toHaveBeenCalled();
});

test("failed source navigation is visible and retrying does not record food", async () => {
  mockFoods = [{ name: "来源样品", source: "open_api", source_url: "https://fdc.nal.usda.gov/food-details/1/nutrients", fdc_id: 1 }];
  jest.mocked(Linking.openURL).mockRejectedValueOnce(new Error("unavailable"));
  await renderSearch();
  await act(async () => { button("查看 USDA 来源 · FDC 1").props.onPress(); });
  expect(labels()).toContain("暂时无法打开来源链接");
  await act(async () => { button("查看 USDA 来源 · FDC 1").props.onPress(); });
  expect(labels()).not.toContain("暂时无法打开来源链接");
  expect(Linking.openURL).toHaveBeenCalledTimes(2);
  expect(mockPush).not.toHaveBeenCalled();
});
