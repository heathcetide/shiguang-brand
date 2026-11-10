import type { InventoryItem, KitchenwareItem, Recipe } from "./types";
import { daysUntilDateKey, getInventoryStorageDisplay, type InventoryStorageDisplay } from "@/utils/inventory";
import { findRecipeAllergyRisks, type HealthProfile } from "@/utils/healthProfile";

const STORAGE_FILTERS: Record<string, InventoryStorageDisplay> = {
  冷藏库: "冷藏",
  冷冻库: "冷冻",
  常温库: "常温",
  位置待确认: "位置待确认",
};

export function filterInventoryItems(items: InventoryItem[], category: string) {
  if (category === "全部") return items;
  if (category === "家庭共享") return items.filter((item) => item.scope === "shared");
  const storageFilter = STORAGE_FILTERS[category];
  if (storageFilter) {
    return items.filter((item) => getInventoryStorageDisplay(item.storage_location) === storageFilter);
  }
  return items.filter((item) => item.category === category);
}

export interface RecipeInventoryAnalysis {
  matchStatus: "full" | "partial" | "low";
  matchedIngredients: Array<{ name: string; amount?: string }>;
  missingIngredients: Array<{ name: string; amount?: string }>;
  expiringIngredients: Array<{ name: string; daysLeft: number }>;
  coveragePercent: number;
  availableSubstitutes: Array<{ missing: string; substitute: string }>;
  healthConflicts: Array<{ name: string; severity: "mild" | "moderate" | "severe" }>;
  missingKitchenware: string[];
  dataUpdatedAt: string | null;
  blocked: boolean;
}

const SUBSTITUTE_GROUPS = [
  ["牛奶", "豆浆", "燕麦奶"],
  ["黄油", "橄榄油", "植物油"],
  ["鸡蛋", "亚麻籽", "香蕉"],
  ["米饭", "糙米", "藜麦"],
  ["面粉", "燕麦粉", "米粉"],
  ["生菜", "菠菜", "油麦菜"],
  ["鸡胸肉", "豆腐", "鱼肉"],
] as const;

function findStockSubstitute(missing: string, stockNames: string[]) {
  const group = SUBSTITUTE_GROUPS.find((items) => items.some((name) => missing.includes(name) || name.includes(missing)));
  return group?.find((candidate) => stockNames.some((stock) => stock.includes(candidate) || candidate.includes(stock))) || null;
}

export function analyzeRecipeInventoryMatch(
  recipe: Recipe & { ingredients?: Array<{ name: string; amount?: string }> },
  inventoryItems: InventoryItem[],
  options: { healthProfile?: HealthProfile | null; kitchenware?: KitchenwareItem[] } = {},
): RecipeInventoryAnalysis {
  const activeInventory = inventoryItems.filter((i) => i.is_available !== false);

  // Extract recipe ingredient names if available, or fall back to searching title/description
  const recipeIngredientList = Array.isArray(recipe.ingredients) && recipe.ingredients.length > 0
    ? recipe.ingredients
    : [];

  const matchedIngredients: Array<{ name: string; amount?: string }> = [];
  const missingIngredients: Array<{ name: string; amount?: string }> = [];
  const expiringIngredients: Array<{ name: string; daysLeft: number }> = [];

  if (recipeIngredientList.length > 0) {
    for (const req of recipeIngredientList) {
      const reqName = req.name.trim();
      const matchedItem = activeInventory.find(
        (inv) => inv.food_name.includes(reqName) || reqName.includes(inv.food_name)
      );

      if (matchedItem) {
        matchedIngredients.push({ name: reqName, amount: req.amount });
        const daysLeft = daysUntilDateKey(matchedItem.expiration_date);
        if (daysLeft !== null && daysLeft <= 3) {
          expiringIngredients.push({ name: matchedItem.food_name, daysLeft });
        }
      } else {
        missingIngredients.push({ name: reqName, amount: req.amount });
      }
    }
  } else {
    // Legacy fallback for recipes without detailed ingredient array
    for (const inv of activeInventory) {
      const invName = inv.food_name.trim();
      if (invName && (recipe.title.includes(invName) || recipe.description?.includes(invName))) {
        matchedIngredients.push({ name: invName, amount: inv.quantity });
        const daysLeft = daysUntilDateKey(inv.expiration_date);
        if (daysLeft !== null && daysLeft <= 3) {
          expiringIngredients.push({ name: invName, daysLeft });
        }
      }
    }
  }

  const missingCount = missingIngredients.length;
  const matchStatus: "full" | "partial" | "low" =
    recipeIngredientList.length > 0
      ? (missingCount === 0 ? "full" : missingCount <= 2 ? "partial" : "low")
      : (matchedIngredients.length > 0 ? "full" : "low");
  const stockNames = activeInventory.map((item) => item.food_name);
  const availableSubstitutes = missingIngredients.flatMap((ingredient) => {
    const substitute = findStockSubstitute(ingredient.name, stockNames);
    return substitute ? [{ missing: ingredient.name, substitute }] : [];
  });
  const healthConflicts = findRecipeAllergyRisks(
    recipeIngredientList.map((ingredient) => ingredient.name),
    options.healthProfile?.allergies,
  ).map((risk) => ({ name: risk.name, severity: risk.severity }));
  const ownedKitchenware = new Set((options.kitchenware || []).map((item) => item.name));
  const missingKitchenware = (recipe.required_kitchenware || []).filter((name) => !ownedKitchenware.has(name));
  const totalIngredients = recipeIngredientList.length || matchedIngredients.length + missingIngredients.length;
  const coveragePercent = totalIngredients ? Math.round(matchedIngredients.length / totalIngredients * 100) : 0;
  const dataUpdatedAt = activeInventory.map((item) => item.updated_at).filter(Boolean).sort().at(-1) || null;

  return {
    matchStatus,
    matchedIngredients,
    missingIngredients,
    expiringIngredients,
    coveragePercent,
    availableSubstitutes,
    healthConflicts,
    missingKitchenware,
    dataUpdatedAt,
    blocked: healthConflicts.some((risk) => risk.severity === "severe") || missingKitchenware.length > 0,
  };
}

export function filterAndRankRecipes(
  recipes: Recipe[],
  inventoryItems: InventoryItem[],
  category: string,
  searchQuery: string,
  cookTimeLimit: number = 0,
  matchStatusFilter: string = "全部"
) {
  const inventoryFoodNames = inventoryItems
    .filter((i) => i.is_available !== false)
    .map((item) => item.food_name.trim())
    .filter(Boolean);

  return recipes
    .filter((recipe) => recipe.quality_status !== "needs_review")
    .map((recipe) => {
      const analysis = analyzeRecipeInventoryMatch(recipe, inventoryItems);
      const inventoryMatchCount = inventoryFoodNames.reduce(
        (score, name) => recipe.title.includes(name) || recipe.description?.includes(name) ? score + 1 : score,
        0
      );

      // Score for ranking: expiring matches count * 100 + matched count * 10 - missing count * 5
      const score = (analysis.expiringIngredients.length * 100) +
        (analysis.matchedIngredients.length * 10) +
        (inventoryMatchCount * 5) -
        (analysis.missingIngredients.length * 2);

      return {
        recipe,
        analysis,
        score,
      };
    })
    .filter(({ recipe, analysis }) => {
      // 1. Cook time limit filter
      if (cookTimeLimit > 0 && recipe.cook_time > cookTimeLimit) return false;

      // 2. Search query match
      const searchMatch = !searchQuery ||
        recipe.title.includes(searchQuery) ||
        recipe.description?.includes(searchQuery) ||
        recipe.tags?.some((tag) => tag.includes(searchQuery));
      if (!searchMatch) return false;

      // 3. Match status filter
      if (matchStatusFilter === "完全可做" && analysis.matchStatus !== "full") return false;
      if (matchStatusFilter === "缺1-2样" && (analysis.missingIngredients.length < 1 || analysis.missingIngredients.length > 2)) return false;
      if (matchStatusFilter === "优先临期" && analysis.expiringIngredients.length === 0) return false;

      // 4. Category filter
      const categoryMatch = category === "全部" ||
        (category === "冰箱可做" && (analysis.matchStatus === "full" || analysis.matchedIngredients.length > 0)) ||
        recipe.category === category;

      return categoryMatch;
    })
    .sort((left, right) => right.score - left.score)
    .map(({ recipe }) => recipe);
}

export function filterKitchenware(items: KitchenwareItem[], category: string) {
  return category === "全部" ? items : items.filter((item) => item.category === category);
}
