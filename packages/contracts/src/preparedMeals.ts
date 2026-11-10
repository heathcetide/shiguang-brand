import { z } from "zod";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "日期无效");
// Use the same millionth-of-a-serving quantum as both repository drivers.
// Small existing remainders can be explicitly eaten or discarded without loss.
const preciseServings = z.number().finite().max(1000).refine(
  value => Math.abs(value * 1_000_000 - Math.round(value * 1_000_000)) < 0.000001,
  "份量最多保留六位小数",
);
const servings = preciseServings.pipe(z.number().min(0.000001));
const nutrition = z.number().finite().nonnegative().max(1_000_000).nullable().optional();
export const mealProductionSchema = z.object({
  reported_cooking_minutes: z.number().int().min(1).max(1440).nullable().optional().describe("仅填写用户明确报告的实际制作分钟；不得由菜谱预计时间、步骤倒计时或请求耗时推测"),
  food_name: z.string().trim().min(1).max(120),
  produced_servings: servings,
  eaten_servings: preciseServings.pipe(z.number().min(0)).refine(value => value === 0 || value >= 0.000001, "食用份量最少 0.000001 份").default(0),
  nutrition_per_serving: z.object({ calories: nutrition, protein: nutrition, carbs: nutrition, fat: nutrition }).strict().default({}),
  planned_date: date.nullable().optional(),
  meal_type: z.string().trim().max(30).default(""),
  eaten_at: date.optional(),
  eaten_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  storage_location: z.enum(["冷藏", "冷冻", "常温"]).nullable().optional(),
  queue_item_id: z.string().uuid().optional(),
  queue_version: z.number().int().positive().optional(),
  plan_item_id: z.string().uuid().optional(),
  plan_version: z.number().int().positive().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.eaten_servings > value.produced_servings) ctx.addIssue({ code: "custom", path: ["eaten_servings"], message: "食用份量不能超过制作份量" });
  for (const [id, version] of [["queue_item_id", "queue_version"], ["plan_item_id", "plan_version"]] as const) {
    if ((value[id] === undefined) !== (value[version] === undefined)) ctx.addIssue({ code: "custom", path: [version], message: "制作来源和版本必须同时提供" });
  }
});

export const preparedMealEventSchema = z.object({
  release_allocation: z.literal(true).optional(),
  allocation_id: z.string().min(1).max(300).nullable().optional(),
  allocation_version: z.number().int().positive().optional(),
  reported_cooking_minutes: z.number().int().min(1).max(1440).nullable().optional(),
  idempotency_key: z.string().trim().min(16).max(200),
  version: z.number().int().positive(),
  type: z.enum(["eat", "discard", "reschedule"]),
  servings: servings.optional(),
  recorded_at: date.optional(),
  recorded_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  planned_date: date.nullable().optional(),
  is_reserved: z.boolean().optional(),
  meal_type: z.string().trim().max(30).optional(),
}).strict().superRefine((value, ctx) => {
  if ((value.allocation_id == null) !== (value.allocation_version === undefined)) ctx.addIssue({ code: "custom", path: ["allocation_version"], message: "餐次安排和版本必须同时提供" });
  if (value.release_allocation && (value.type !== "reschedule" || !value.allocation_id || value.planned_date !== undefined || value.is_reserved !== undefined || value.meal_type !== undefined || value.reported_cooking_minutes !== undefined)) ctx.addIssue({ code: "custom", path: ["release_allocation"], message: "取消安排须指定唯一安排，不能同时改变其他字段" });
  if (value.type !== "reschedule" && value.reported_cooking_minutes !== undefined) ctx.addIssue({ code: "custom",path: ["reported_cooking_minutes"],message: "制作用时请使用单独调整操作" });
  if (value.type !== "reschedule" && value.servings === undefined) ctx.addIssue({ code: "custom", path: ["servings"], message: "请填写实际食用或丢弃的份量" });
  if (value.type === "reschedule" && (value.servings !== undefined || (value.planned_date === undefined && value.is_reserved === undefined && value.reported_cooking_minutes === undefined && !value.release_allocation))) ctx.addIssue({ code: "custom", path: ["planned_date"], message: "调整需指定日期、保留状态或制作用时，不能改变剩余份量" });
  if (value.type !== "reschedule" && value.is_reserved !== undefined) ctx.addIssue({ code: "custom", path: ["is_reserved"], message: "保留状态只能通过计划调整修改" });
  if (value.type !== "reschedule" && value.planned_date !== undefined) ctx.addIssue({ code: "custom", path: ["planned_date"], message: "请用延期操作修改计划日期" });
});
export type MealProduction = z.infer<typeof mealProductionSchema>;
export type PreparedMealEventInput = z.infer<typeof preparedMealEventSchema>;
export type PreparedMealAllocation = {
  id: string; planId: string; targetMealId: string; preparedMealId: string; plannedDate: string; mealType: string;
  servings: number; remainingServings: number; version: number; status: "active" | "conflict" | "released" | "settled";
};
export type PreparedMeal = {
  allocations?: PreparedMealAllocation[];
  reported_cooking_minutes?: number | null;
  is_reserved: boolean;
  id: string; food_name: string; recipe_id: number | null; produced_servings: number; remaining_servings: number;
  nutrition_per_serving: { calories?: number | null; protein?: number | null; carbs?: number | null; fat?: number | null };
  planned_date: string | null; meal_type: string; storage_location: string | null;
  produced_at: string; version: number; queue_item_id: string | null; plan_item_id: string | null;
};
