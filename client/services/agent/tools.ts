import {
  cookingQueueApi,
  dietApi,
  foodsApi,
  healthApi,
  inventoryApi,
  mealPlansApi,
  recipesApi,
  recommendationsApi,
  shoppingListApi,
} from "@/services/api";
import { toLocalDateKey } from "@/utils/date";
import type { AgentToolDefinition } from "./types";

type FoodSearchHit = {
  id?: number;
  name?: string;
  calories_100g?: number | null;
  protein_100g?: number | null;
  fat_100g?: number | null;
  carbs_100g?: number | null;
  nutrition_references?: Array<{
    nutrients_per_100g?: Record<string, { value?: number } | number>;
  }>;
};

function scaleNutrient(per100: number | null | undefined, amount: number, unit: string): number | null {
  if (per100 == null || !Number.isFinite(per100)) return null;
  const grams = unit === "ml" || unit === "g" ? amount : unit === "serving" ? amount * 100 : amount * 50;
  return Math.round((per100 * grams) / 10) / 10; // per-100g * grams/100, one decimal
}

function nutrientFromReferences(hit: FoodSearchHit, key: string): number | null {
  const first = hit.nutrition_references?.[0]?.nutrients_per_100g;
  if (!first) return null;
  const raw = first[key] ?? first[key.replace("_", "-")];
  if (typeof raw === "number") return raw;
  if (raw && typeof raw === "object" && typeof raw.value === "number") return raw.value;
  return null;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function asLimit(value: unknown, fallback = 12, max = 40): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

export const agentTools: AgentToolDefinition[] = [
  {
    name: "list_inventory",
    description: "读取当前用户冰箱/库存中的食材列表（名称、数量、存放位置）。",
    parameters: {
      limit: { type: "number", description: "最多返回条数", optional: true },
    },
    hints: ["库存", "冰箱", "有什么", "食材", "剩"],
    execute: async (args, ctx) => {
      const data = await inventoryApi.list(ctx.apiFetch, true);
      const items = Array.isArray(data) ? data : [];
      return items.slice(0, asLimit(args.limit)).map((item) => ({
        id: item.id,
        name: item.food_name,
        quantity: item.quantity,
        location: item.storage_location,
        expiresAt: item.expiration_date,
      }));
    },
  },
  {
    name: "search_recipes",
    description: "按关键词搜索菜谱，用于推荐可做菜品。",
    parameters: {
      query: { type: "string", description: "搜索关键词，如番茄、减脂、快手" },
      limit: { type: "number", description: "最多返回条数", optional: true },
    },
    hints: ["菜谱", "做什么", "推荐", "怎么做", "晚饭", "午餐", "早餐"],
    execute: async (args, ctx) => {
      const query = asString(args.query) || "家常";
      const qs = `?search=${encodeURIComponent(query)}&limit=${asLimit(args.limit, 8)}`;
      const page = await recipesApi.listPage(qs, ctx.apiFetch);
      const items = Array.isArray(page?.items) ? page.items : [];
      return items.slice(0, asLimit(args.limit, 8)).map((item) => ({
        id: item.id,
        title: item.title,
        minutes: item.cook_time,
        calories: item.calories,
      }));
    },
  },
  {
    name: "get_health_profile",
    description: "读取用户健康档案摘要（过敏、限制、营养目标、厨房约束）。",
    parameters: {},
    hints: ["过敏", "健康", "营养", "热量", "禁忌", "档案", "安全"],
    execute: async (_args, ctx) => {
      const profile = await healthApi.profile<Record<string, unknown>>(ctx.apiFetch, { fresh: true });
      if (!profile) return { empty: true };
      return {
        version: profile.version ?? 1,
        allergies: profile.allergies,
        dietary_restrictions: profile.dietary_restrictions,
        medical_conditions: profile.medical_conditions,
        nutrition_targets: profile.nutrition_targets,
        kitchen_constraints: profile.kitchen_constraints,
        dietary_preference: profile.dietary_preference,
        disliked_foods: profile.disliked_foods,
      };
    },
  },
  {
    name: "list_diet_today",
    description: "读取今日已记录的饮食条目，用于热量/营养分析。",
    parameters: {
      limit: { type: "number", description: "最多返回条数", optional: true },
    },
    hints: ["今天吃了", "饮食记录", "热量", "摄入", "打卡"],
    execute: async (args, ctx) => {
      const today = toLocalDateKey(new Date());
      const records = await dietApi.list(ctx.apiFetch, today);
      const list = Array.isArray(records) ? records : [];
      return list.slice(0, asLimit(args.limit)).map((item) => ({
        id: item.id,
        name: item.food_name,
        mealType: item.meal_type,
        calories: item.calories,
        protein: item.protein,
      }));
    },
  },
  {
    name: "list_shopping",
    description: "读取当前采购清单条目。",
    parameters: {
      limit: { type: "number", description: "最多返回条数", optional: true },
    },
    hints: ["采购", "购物", "买什么", "缺"],
    execute: async (args, ctx) => {
      const data = await shoppingListApi.list<{ items?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>>(ctx.apiFetch);
      const items = Array.isArray(data)
        ? data
        : Array.isArray(data?.items)
          ? data.items
          : [];
      return items.slice(0, asLimit(args.limit)).map((item) => ({
        id: item.id,
        name: item.name ?? item.food_name,
        quantity: item.quantity,
        checked: item.checked ?? item.done,
      }));
    },
  },
  {
    name: "list_meal_plans",
    description: "读取近期膳食计划摘要。",
    parameters: {
      limit: { type: "number", description: "最多返回条数", optional: true },
    },
    hints: ["膳食计划", "周计划", "安排", "计划"],
    execute: async (args, ctx) => {
      const data = await mealPlansApi.list(ctx.apiFetch);
      const items = Array.isArray(data) ? data : [];
      return items.slice(0, asLimit(args.limit, 5)).map((item) => ({
        id: item.id,
        title: item.title,
        status: item.status,
        startDate: item.startDate,
        endDate: item.endDate,
      }));
    },
  },
  {
    name: "list_cooking_queue",
    description: "读取当前做饭队列。",
    parameters: {
      limit: { type: "number", description: "最多返回条数", optional: true },
    },
    hints: ["做饭", "队列", "烹饪", "下一步"],
    execute: async (args, ctx) => {
      const items = await cookingQueueApi.list(ctx.apiFetch);
      const list = Array.isArray(items) ? items : [];
      return list.slice(0, asLimit(args.limit, 10)).map((item) => ({
        id: item.id,
        title: item.title,
        status: item.status,
        position: item.position,
      }));
    },
  },
  {
    name: "estimate_meal_budget",
    description: "根据健康档案厨房约束估算一餐预算与份量建议（本地计算，不写库）。",
    parameters: {
      servings: { type: "number", description: "用餐人数，可选", optional: true },
    },
    hints: ["预算", "多少钱", "花费", "份量"],
    execute: async (args, ctx) => {
      const profile = await healthApi.profile<{
        kitchen_constraints?: { budget_per_meal?: number; servings?: number; meal_time_minutes?: number };
        nutrition_targets?: { calories_kcal?: number; protein_g?: number };
      }>(ctx.apiFetch, { fresh: true });
      const kitchen = profile?.kitchen_constraints ?? {};
      const servings = asLimit(args.servings, kitchen.servings ?? 2, 12);
      const budget = Number(kitchen.budget_per_meal ?? 40);
      return {
        servings,
        budgetPerMeal: budget,
        budgetTotal: Math.round(budget * servings),
        mealTimeMinutes: kitchen.meal_time_minutes ?? 45,
        calorieTarget: profile?.nutrition_targets?.calories_kcal ?? null,
        proteinTarget: profile?.nutrition_targets?.protein_g ?? null,
      };
    },
  },
  {
    name: "get_user_nutrition_context",
    description: "聚合读取健康目标、今日摄入、库存与过敏限制（对齐 Express nutrition tool）。",
    parameters: {},
    hints: ["营养上下文", "今日摄入", "还差多少", "下一餐", "分析今日"],
    execute: async (_args, ctx) => {
      const today = toLocalDateKey(new Date());
      const [profile, diet, inventory] = await Promise.all([
        healthApi.profile<Record<string, unknown>>(ctx.apiFetch, { fresh: true }),
        dietApi.list(ctx.apiFetch, today).catch(() => []),
        inventoryApi.list(ctx.apiFetch, true).catch(() => []),
      ]);
      const meals = Array.isArray(diet) ? diet : [];
      const stock = Array.isArray(inventory) ? inventory : [];
      const totals = meals.reduce(
        (acc, item) => ({
          calories: acc.calories + (Number(item.calories) || 0),
          protein: acc.protein + (Number(item.protein) || 0),
          carbs: acc.carbs + (Number(item.carbs) || 0),
          fat: acc.fat + (Number(item.fat) || 0),
        }),
        { calories: 0, protein: 0, carbs: 0, fat: 0 },
      );
      const targets = (profile?.nutrition_targets ?? {}) as Record<string, number | null | undefined>;
      return {
        date: today,
        healthProfile: {
          allergies: profile?.allergies,
          dietary_restrictions: profile?.dietary_restrictions,
          dietary_preference: profile?.dietary_preference,
          kitchen_constraints: profile?.kitchen_constraints,
          nutrition_targets: profile?.nutrition_targets,
        },
        todayIntake: { ...totals, mealCount: meals.length },
        remainingBudget: {
          calories: targets.calories_kcal != null ? Math.max(0, Number(targets.calories_kcal) - totals.calories) : null,
          protein: targets.protein_g != null ? Math.max(0, Number(targets.protein_g) - totals.protein) : null,
        },
        inventoryPreview: stock.slice(0, 20).map((item) => ({
          name: item.food_name,
          quantity: item.quantity,
          location: item.storage_location,
          expiresAt: item.expiration_date,
        })),
      };
    },
  },
  {
    name: "lookup_food_nutrition",
    description: "查询平台食材营养数据库，并按分量估算热量/宏量营养素。",
    parameters: {
      foodName: { type: "string", description: "食材名称" },
      amount: { type: "number", description: "数量" },
      unit: { type: "string", description: "单位：g/ml/piece/serving", optional: true },
    },
    hints: ["多少热量", "营养成分", "蛋白质", "卡路里", "查一下"],
    execute: async (args) => {
      const foodName = asString(args.foodName) || asString(args.query);
      const amount = Number(args.amount) || 100;
      const unit = asString(args.unit, "g") || "g";
      if (!foodName) return { matches: [], warnings: ["缺少有效食品名称"] };
      const hits = (await foodsApi.search<FoodSearchHit>(foodName)) ?? [];
      const list = Array.isArray(hits) ? hits : [];
      return {
        matches: list.slice(0, 5).map((hit) => {
          const calories100 = hit.calories_100g ?? nutrientFromReferences(hit, "energy-kcal") ?? nutrientFromReferences(hit, "calories");
          const protein100 = hit.protein_100g ?? nutrientFromReferences(hit, "proteins") ?? nutrientFromReferences(hit, "protein");
          const fat100 = hit.fat_100g ?? nutrientFromReferences(hit, "fat");
          const carbs100 = hit.carbs_100g ?? nutrientFromReferences(hit, "carbohydrates") ?? nutrientFromReferences(hit, "carbs");
          return {
            id: hit.id,
            name: hit.name,
            amount,
            unit,
            per100g: { calories: calories100, protein: protein100, fat: fat100, carbs: carbs100 },
            estimated: {
              calories: scaleNutrient(calories100, amount, unit),
              protein: scaleNutrient(protein100, amount, unit),
              fat: scaleNutrient(fat100, amount, unit),
              carbs: scaleNutrient(carbs100, amount, unit),
            },
          };
        }),
      };
    },
  },
  {
    name: "search_recipe_library",
    description: "按食材/时间/热量约束搜索已审核菜谱库。",
    parameters: {
      ingredientNames: { type: "array", description: "可用食材名称", optional: true },
      query: { type: "string", description: "搜索关键词", optional: true },
      maxTimeMinutes: { type: "number", optional: true },
      maxCalories: { type: "number", optional: true },
      limit: { type: "number", optional: true },
    },
    hints: ["菜谱库", "用这些食材", "几分钟", "低卡"],
    execute: async (args, ctx) => {
      const names = Array.isArray(args.ingredientNames)
        ? args.ingredientNames.map(String).filter(Boolean).slice(0, 8)
        : [];
      const query = asString(args.query) || names.join(" ") || "家常";
      const page = await recipesApi.listPage(
        `?search=${encodeURIComponent(query)}&limit=${asLimit(args.limit, 8)}`,
        ctx.apiFetch,
      );
      let items = Array.isArray(page?.items) ? page.items : [];
      const maxTime = Number(args.maxTimeMinutes);
      const maxCal = Number(args.maxCalories);
      if (Number.isFinite(maxTime) && maxTime > 0) {
        items = items.filter((item) => !item.cook_time || item.cook_time <= maxTime);
      }
      if (Number.isFinite(maxCal) && maxCal > 0) {
        items = items.filter((item) => !item.calories || item.calories <= maxCal);
      }
      return {
        recipes: items.slice(0, asLimit(args.limit, 8)).map((item) => ({
          id: item.id,
          title: item.title,
          minutes: item.cook_time,
          calories: item.calories,
          protein: item.protein,
        })),
      };
    },
  },
  {
    name: "calculate_meal_plan_requirements",
    description: "多餐规划草案：分配待吃餐、补做份量与原料预算（需继续校验，不写库）。",
    parameters: {
      mealType: { type: "string", description: "breakfast/lunch/dinner/snack", optional: true },
      servings: { type: "number", optional: true },
      date: { type: "string", description: "YYYY-MM-DD", optional: true },
    },
    hints: ["膳食规划", "一周吃什么", "补做", "安排三餐"],
    execute: async (args, ctx) => {
      const date = asString(args.date) || toLocalDateKey(new Date());
      const mealType = (asString(args.mealType, "dinner") || "dinner") as "breakfast" | "lunch" | "dinner" | "snack";
      const servings = Math.max(0.001, Math.min(Number(args.servings) || 2, 30));
      const draft = await recommendationsApi.cookingPlan(ctx.apiFetch, {
        meals: [{ id: `meal-${mealType}-${date}`, date, mealType, servings }],
        excludedPreparedMealIds: [],
      });
      return {
        status: draft.status,
        totalCookServings: draft.totalCookServings,
        cooking: draft.cooking?.slice(0, 8),
        unresolved: draft.unresolved?.slice(0, 8),
        ingredientBudget: draft.ingredientBudget?.slice(0, 20),
        checksPending: draft.checksPending,
      };
    },
  },
];

export function toolCatalogPrompt(tools: AgentToolDefinition[] = agentTools): string {
  return tools
    .map((tool) => `- ${tool.name}: ${tool.description}`)
    .join("\n");
}
