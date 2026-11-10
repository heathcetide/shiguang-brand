import { analyzeRecipeInventoryMatch, filterAndRankRecipes, filterInventoryItems, filterKitchenware } from "./selectors";
import type { InventoryItem, KitchenwareItem, Recipe } from "./types";
import { buildInventoryStorageGroups } from "./storageGroups";
import { dateKeyAfterDays } from "@/utils/date";

const inventory = [
  { id: 1, food_name: "番茄", category: "蔬菜", storage_location: "冷藏", quantity: "2个", expiration_date: dateKeyAfterDays(1), image_url: null, is_available: true },
  { id: 2, food_name: "鸡蛋", category: "乳制品", storage_location: "未知", quantity: "6个", expiration_date: dateKeyAfterDays(10), image_url: null, is_available: true },
] satisfies InventoryItem[];

const recipes = [
  { id: 1, title: "清炒时蔬", description: "简单", image_url: "", cook_time: 10, difficulty: "简单", calories: 100, protein: 2, carbs: 10, fat: 2, category: "快手菜", tags: [] },
  { id: 2, title: "番茄炒鸡蛋", description: "番茄与鸡蛋", image_url: "", cook_time: 12, difficulty: "简单", calories: 220, protein: 12, carbs: 15, fat: 8, category: "快手菜", tags: [] },
  { id: 3, title: "慢炖红烧肉", description: "猪肉大火慢炖", image_url: "", cook_time: 60, difficulty: "中等", calories: 600, protein: 25, carbs: 10, fat: 40, category: "大菜", tags: [] },
] satisfies Recipe[];

test("filters inventory by storage without treating unknown locations as room temperature", () => {
  expect(filterInventoryItems(inventory, "冷藏库").map((item) => item.id)).toEqual([1]);
  expect(filterInventoryItems(inventory, "常温库")).toEqual([]);
  expect(filterInventoryItems(inventory, "位置待确认").map((item) => item.id)).toEqual([2]);
});

test("ranks recipes by matching inventory foods and prioritizes expiring items", () => {
  expect(filterAndRankRecipes(recipes, inventory, "全部", "").map((recipe) => recipe.id)).toEqual([2, 1, 3]);
  expect(filterAndRankRecipes(recipes, inventory, "冰箱可做", "").map((recipe) => recipe.id)).toEqual([2]);
});

test("filters recipes by cook time limit", () => {
  expect(filterAndRankRecipes(recipes, inventory, "全部", "", 15).map((r) => r.id)).toEqual([2, 1]);
  expect(filterAndRankRecipes(recipes, inventory, "全部", "", 10).map((r) => r.id)).toEqual([1]);
});

test("never includes recipes marked as needs review in recommendations", () => {
  const unsafe = { ...recipes[1], id: 99, quality_status: "needs_review" as const };
  expect(filterAndRankRecipes([...recipes, unsafe], inventory, "全部", "").some((recipe) => recipe.id === 99)).toBe(false);
});

test("analyzeRecipeInventoryMatch detects expiring ingredients and calculates status", () => {
  const recipeWithDetails: Recipe & { ingredients?: Array<{ name: string; amount?: string }> } = {
    ...recipes[1],
    ingredients: [
      { name: "番茄", amount: "2个" },
      { name: "鸡蛋", amount: "3个" },
      { name: "牛肉", amount: "200g" },
    ],
  };

  const analysis = analyzeRecipeInventoryMatch(recipeWithDetails, inventory);
  expect(analysis.matchStatus).toBe("partial");
  expect(analysis.matchedIngredients.map((i) => i.name)).toEqual(["番茄", "鸡蛋"]);
  expect(analysis.missingIngredients.map((i) => i.name)).toEqual(["牛肉"]);
  expect(analysis.expiringIngredients.map((i) => i.name)).toEqual(["番茄"]);
  expect(analysis.coveragePercent).toBe(67);
});

test("explains substitutes and blocks severe allergy or missing required kitchenware", () => {
  const stock = [
    ...inventory,
    { id: 3, food_name: "豆浆", category: "乳制品", storage_location: "冷藏", quantity: "500ml", expiration_date: dateKeyAfterDays(5), image_url: null, is_available: true, updated_at: "2026-08-26 10:00:00" },
  ] satisfies InventoryItem[];
  const recipe: Recipe = {
    ...recipes[0],
    ingredients: [{ name: "牛奶", amount: "200ml" }, { name: "鸡蛋", amount: "2个" }],
    required_kitchenware: ["烤箱"],
  };
  const analysis = analyzeRecipeInventoryMatch(recipe, stock, {
    healthProfile: { allergies: [{ name: "乳制品", type: "allergy", severity: "severe" }] },
    kitchenware: [{ id: 1, name: "平底锅", category: "锅具", status: "良好", image_url: null }],
  });

  expect(analysis.coveragePercent).toBe(50);
  expect(analysis.availableSubstitutes).toContainEqual({ missing: "牛奶", substitute: "豆浆" });
  expect(analysis.healthConflicts).toContainEqual({ name: "乳制品", severity: "severe" });
  expect(analysis.missingKitchenware).toEqual(["烤箱"]);
  expect(analysis.dataUpdatedAt).toBe("2026-08-26 10:00:00");
  expect(analysis.blocked).toBe(true);
});

test("filters kitchenware by category", () => {
  const items = [{ id: 1, name: "炒锅", category: "锅具", status: "良好", image_url: null }] satisfies KitchenwareItem[];
  expect(filterKitchenware(items, "锅具")).toEqual(items);
  expect(filterKitchenware(items, "刀具")).toEqual([]);
});

test("storage filters partition explicit and unknown locations without loss or duplicates", () => {
  const locations = ["冷藏", "冷冻", "常温", "", null, undefined, "未知", "柜子"];
  const items = locations.map((storage_location, index) => ({ ...inventory[0], id: index, storage_location })) as InventoryItem[];
  const groups = ["冷藏库", "冷冻库", "常温库", "位置待确认"].map(category => filterInventoryItems(items, category));
  expect(groups.map(group => group.map(item => item.id))).toEqual([[0], [1], [2], [3, 4, 5, 6, 7]]);
  const displayGroups = buildInventoryStorageGroups(items);
  expect(displayGroups.map(group => group.items)).toEqual(groups);
  expect(displayGroups.map(group => group.key)).toEqual(["冷藏", "冷冻", "常温", "位置待确认"]);
  expect(displayGroups.map(group => group.subtitle).join(" ")).not.toMatch(/°C|保鲜中|锁鲜中/);
  expect(groups.flat()).toHaveLength(items.length);
  expect(new Set(groups.flat().map(item => item.id)).size).toBe(items.length);
  expect(items.map(item => item.storage_location)).toEqual(locations);
});
