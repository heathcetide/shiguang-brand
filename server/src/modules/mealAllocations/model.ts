import type { CookingPlanDraft, PreparedMealAllocation, PreparedMealEventInput } from "@dietdigidose/contracts";
import { InventoryQuantityError } from "../../services/inventoryQuantity.js";
const quantum = (value: number) => Math.round(value * 1_000_000);
export type Row = Record<string, unknown>;
export function formatAllocation(row: Row): PreparedMealAllocation {
  return { id: String(row.id), planId: String(row.plan_id), targetMealId: String(row.target_meal_id), preparedMealId: String(row.prepared_meal_id),
    plannedDate: String(row.planned_date), mealType: String(row.meal_type), servings: Number(row.servings), remainingServings: Number(row.remaining_servings),
    version: Number(row.version), status: row.status as PreparedMealAllocation["status"] };
}
export function allocationRows(userId: number, planId: string, targets: CookingPlanDraft["meals"]) {
  return targets.flatMap(target => target.allocations.map(item => ({ id: `${planId}:${target.id}:${item.preparedMealId}`, user_id: userId,
    plan_id: planId, target_meal_id: target.id, prepared_meal_id: item.preparedMealId, servings: item.servings, remaining_servings: item.servings,
    planned_date: target.date, meal_type: target.mealType, status: "active", version: 1, source_json: JSON.stringify(item) })));
}
export function chooseAllocation(rows: PreparedMealAllocation[], input: PreparedMealEventInput, physicalRemaining: number) {
  if (input.type === "reschedule" && input.planned_date === undefined && input.meal_type === undefined && !input.allocation_id) return null;
  const active = rows.filter(row => row.status === "active" || row.status === "conflict");
  if (!input.release_allocation && active.some(row => row.status === "conflict")) throw new InventoryQuantityError("MEAL_ALLOCATION_CONFLICT", "该批次存在旧安排冲突，请先取消或核对冲突餐单");
  if (input.allocation_id === null) {
    const unallocated = physicalRemaining - active.reduce((sum, row) => sum + row.remainingServings, 0);
    if (unallocated <= 0 || (input.type !== "reschedule" && quantum(input.servings!) > quantum(unallocated))) throw new InventoryQuantityError("MEAL_ALLOCATION_INSUFFICIENT", "未安排份量不足，请选择对应餐次");
    return null;
  }
  if (!input.allocation_id && active.length > 1) throw new InventoryQuantityError("MEAL_ALLOCATION_AMBIGUOUS", "这份餐食安排了多个餐次，请选择要食用、丢弃或延期的餐次");
  const selected = input.allocation_id ? active.find(row => row.id === input.allocation_id) : active[0];
  if (input.allocation_id && (!selected || selected.version !== input.allocation_version)) throw new InventoryQuantityError("MEAL_ALLOCATION_VERSION_CONFLICT", "餐次安排已变化，请刷新后重试");
  if (!selected) return null;
  if (input.type === "reschedule" && input.planned_date === null) throw new InventoryQuantityError("MEAL_ALLOCATION_DATE_REQUIRED", "餐次安排需要明确日期，取消安排请使用单独取消操作");
  if (input.type !== "reschedule" && quantum(input.servings!) > quantum(selected.remainingServings)) throw new InventoryQuantityError("MEAL_ALLOCATION_INSUFFICIENT", "操作份量超过所选餐次安排，请核对份量");
  const remaining = input.type === "reschedule" ? selected.remainingServings : Math.round((selected.remainingServings - input.servings!) * 1e6) / 1e6;
  return { ...selected, remainingServings: Math.max(0, remaining), plannedDate: input.type === "reschedule" ? input.planned_date ?? selected.plannedDate : selected.plannedDate,
    mealType: input.type === "reschedule" ? input.meal_type ?? selected.mealType : selected.mealType,
    status: input.release_allocation ? "released" as const : remaining <= 0 ? "settled" as const : "active" as const, version: selected.version + 1 };
}

export function restoredAllocation(rows: PreparedMealAllocation[], result: unknown, servings: number) {
  const saved = (typeof result === "string" ? JSON.parse(result) : result) as { allocation?: PreparedMealAllocation };
  if (!saved.allocation) return null;
  const row = rows.find(item => item.id === saved.allocation!.id);
  if (!row || row.version !== saved.allocation.version || !["active", "settled"].includes(row.status)
    || quantum(row.remainingServings) + quantum(servings) > quantum(row.servings)) throw new InventoryQuantityError("MEAL_ALLOCATION_VERSION_CONFLICT", "餐次安排在食用后已变化，不能直接归还份量");
  return { ...row, remainingServings: Math.round((row.remainingServings + servings) * 1e6) / 1e6, status: "active" as const, version: row.version + 1 };
}

export function allocationMealType(allocation: PreparedMealAllocation | null, fallback: string) {
  const labels: Record<string,string> = { breakfast: "早餐", lunch: "午餐", dinner: "晚餐", snack: "加餐" };
  return allocation ? labels[allocation.mealType] ?? allocation.mealType : fallback;
}
