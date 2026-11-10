import { inventoryFoodNamesMatch } from "../../services/inventoryQuantity.js";
import { ingredient, parseJson, type Row } from "../mealPlans/formatters.js";

export type MaintenanceScope = {
  items: { planId: string; itemId: string; version: number; planVersion: number; eventIds: string[] }[];
  preparedTargets: { planId: string; targetId: string; eventIds: string[] }[];
  checks: { eventId: string; reason: string; level?: "info" }[];
};

function object(value: unknown): Row {
  const parsed = parseJson<unknown>(value,null);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Row : {};
}

/** Dependency discovery only: eligibility to change still belongs to #195's decision policy. */
export function maintenanceScope(input: {
  dailyEnabled?: boolean; userId: number; fromDate: string; events: Row[]; inventory: Row[]; prepared: Row[]; plans: Row[]; items: Row[];
}): MaintenanceScope {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.fromDate)
    || new Date(`${input.fromDate}T00:00:00Z`).toISOString().slice(0,10) !== input.fromDate) throw new Error("Invalid maintenance date");
  const owned = (row: Row) => Number(row.user_id) === input.userId;
  const plans = input.plans.filter(row => owned(row) && row.status === "active" && !row.deleted_at);
  const byPlan = new Map(plans.map(row => [String(row.id),row]));
  const items = input.items.filter(row => owned(row) && byPlan.has(String(row.plan_id)) && !row.deleted_at
    && String(row.planned_date) >= input.fromDate && !["completed","skipped"].includes(String(row.status)));
  const affected = new Map<string,Set<string>>();
  const targets = new Map<string,{ planId: string; targetId: string; eventIds: Set<string> }>();
  const checks: MaintenanceScope["checks"] = [];
  const mark = (item: Row,eventId: string) => {
    const ids = affected.get(String(item.id)) ?? new Set<string>(); ids.add(eventId); affected.set(String(item.id),ids);
  };
  const events = [...new Map(input.events.filter(owned).map(row => [String(row.id),row])).values()];
  for (const event of events) {
    const id = String(event.id);
    const kind = String(event.event_type);
    const details = object(event.details_json);
    if (kind === "daily_check") {
      if (!input.dailyEnabled) { checks.push({ eventId: id,reason: "每日检查已关闭，跳过该定时事件",level: "info" }); continue; }
      for (const item of items) mark(item,id);
      for (const plan of plans) {
        const constraints = object(plan.constraints_json);
        const saved = object(constraints.savedCookingDraft);
        const draft = object(constraints.currentCookingDraft ?? saved.draft);
        for (const target of (Array.isArray(draft.meals) ? draft.meals : []) as Row[]) {
          if (!target || String(target.date) < input.fromDate || !Array.isArray(target.allocations)
            || !target.allocations.some((allocation: Row) => allocation?.preparedMealId)) continue;
          const planId = String(plan.id), targetId = String(target.id), key = JSON.stringify([planId,targetId]);
          const entry = targets.get(key) ?? { planId,targetId,eventIds: new Set<string>() };
          entry.eventIds.add(id); targets.set(key,entry);
        }
      }
      continue;
    }

    const stockIds = ["inventory_created","inventory_changed"].includes(kind) ? [Number(event.subject_id)]
      : Array.isArray(details.inventoryItemIds) ? details.inventoryItemIds.map(Number) : [];
    const stocks = stockIds.map(stockId => input.inventory.find(row => owned(row) && Number(row.id) === stockId));
    if (stocks.some(row => !row)) checks.push({ eventId: id,reason: "关联库存已不存在，无法确定原料影响范围" });
    for (const item of items) {
      if (String(item.id) === details.planItemId) mark(item,id);
      const raw = parseJson<unknown>(item.ingredients_json,null);
      const ingredients = Array.isArray(raw) ? raw.map(ingredient).filter(value => value !== null) : [];
      if (stocks.length && !ingredients.length) checks.push({ eventId: id,reason: `餐次 ${item.id} 缺少原料信息，需核对影响` });
      if (stocks.some(stock => stock && ingredients.some(part => inventoryFoodNamesMatch(String(stock.food_name),part.name)))
        || (kind === "inventory_changed" && typeof details.previousFoodName === "string" && ingredients.some(part => inventoryFoodNamesMatch(details.previousFoodName as string,part.name)))) mark(item,id);
    }
    if (["production","eat","discard","reschedule","intake_correction"].includes(kind)) {
      const meal = input.prepared.find(row => owned(row) && String(row.id) === String(event.subject_id));
      if (!meal) { checks.push({ eventId: id,reason: "关联待吃餐已不存在，需核对分配" }); continue; }
      const direct = items.find(item => String(item.id) === meal.plan_item_id);
      if (direct) mark(direct,id);
      let linked = false;
      for (const plan of plans) {
        const constraints = object(plan.constraints_json);
        const saved = constraints.savedCookingDraft as { draft?: unknown } | undefined;
        const draft = object(constraints.currentCookingDraft ?? saved?.draft);
        const meals = Array.isArray(draft.meals) ? draft.meals as Row[] : [];
        for (const target of meals) {
          if (!target || typeof target !== "object") { checks.push({ eventId: id,reason: "餐次分配数据损坏，需核对影响范围" }); continue; }
          if (String(target.date) < input.fromDate || !Array.isArray(target.allocations)
            || !target.allocations.some((value: Row) => value && String(value.preparedMealId) === String(meal.id))) continue;
          linked = true;
          const planId = String(plan.id), targetId = String(target.id), key = JSON.stringify([planId,targetId]);
          const entry = targets.get(key) ?? { planId,targetId,eventIds: new Set<string>() };
          entry.eventIds.add(id); targets.set(key,entry);
          const executions = object(constraints.executionItems) as Record<string,Row>;
          for (const item of items) if (String(item.plan_id) === planId && executions[String(item.id)]?.targetMealId === targetId) mark(item,id);
        }
      }
      if (!linked && kind === "production" && Number(meal.remaining_servings)>0 && plans.length) {
        checks.push({ eventId: id,reason: "新增待吃餐尚无未来餐次分配，需核对可覆盖的需求" });
      }
    } else if (!["inventory_created","inventory_changed","cooking_completion"].includes(kind)) {
      checks.push({ eventId: id,reason: "未知业务事件类型，未自动扩大影响范围" });
    }
  }
  return {
    items: items.filter(item => affected.has(String(item.id))).map(item => ({ planId: String(item.plan_id),itemId: String(item.id),version: Number(item.version),
      planVersion: Number(byPlan.get(String(item.plan_id))!.version),eventIds: [...affected.get(String(item.id))!].sort() })).sort((a,b) => a.itemId.localeCompare(b.itemId)),
    preparedTargets: [...targets.values()].map(value => ({ ...value,eventIds: [...value.eventIds].sort() })).sort((a,b) => JSON.stringify([a.planId,a.targetId]).localeCompare(JSON.stringify([b.planId,b.targetId]))),
    checks: [...new Map(checks.map(check => [JSON.stringify(check),check])).values()],
  };
}
