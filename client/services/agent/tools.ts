import {
  cookingQueueApi,
  dietApi,
  healthApi,
  inventoryApi,
  mealPlansApi,
  recipesApi,
  shoppingListApi,
} from "@/services/api";
import { toLocalDateKey } from "@/utils/date";
import type { AgentToolDefinition } from "./types";

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
];

export function toolCatalogPrompt(tools: AgentToolDefinition[] = agentTools): string {
  return tools
    .map((tool) => `- ${tool.name}: ${tool.description}`)
    .join("\n");
}
