import { createHash } from "node:crypto";
import { QuantityDecimal } from "@dietdigidose/contracts/quantity-decimal";
import { createPlanningBudget } from "../recommendations/planningBudget.js";
import { recipeDemands } from "../recommendations/quantities.js";
import { inventoryFoodNamesMatch } from "../../services/inventoryQuantity.js";
import { ingredient, parseJson, queueMealType, type Row } from "./formatters.js";

const labels: Record<string,string> = { piece: "个", serving: "份", bag: "袋", box: "盒", bottle: "瓶", can: "罐", l: "L" };
export function personalShoppingClientId(itemId: string, requestKey: string, index: number) {
  return `meal-plan:${itemId}:${createHash("sha256").update(JSON.stringify([requestKey,index])).digest("hex").slice(0,40)}`;
}

/** Read-only, current-plan budget. Purchases are intentions, never stock or reservations. */
export function preparePersonalShopping(itemId: string, items: Row[], inventory: Row[], shopping: Row[], today: string) {
  const reviewItems: Array<{ name: string; reason: string; itemIds?: string[] }> = [];
  const missing: Array<{ name: string; amount: string }> = [];
  const meals = items.filter(item => !item.deleted_at && !item.dining_json && !item.prepared_only && !["completed","skipped"].includes(String(item.status)))
    .sort((a,b) => String(a.planned_date).localeCompare(String(b.planned_date)) ||
      ["breakfast","lunch","dinner","snack"].indexOf(queueMealType(a.meal_type)!) - ["breakfast","lunch","dinner","snack"].indexOf(queueMealType(b.meal_type)!) || String(a.id).localeCompare(String(b.id)));
  const current = meals.find(item => item.id === itemId);
  if (!current) return { missing, coverage: "needs_review" as const, reviewItems: [{ name: "本餐", reason: "本餐不属于当前待制作安排，请刷新餐单" }] };
  // Unknown commitments must not allow earlier meals to claim shared stock either.
  const unknown = meals.some(item => !recipeDemands(parseJson<unknown[]>(item.ingredients_json,[]).map(ingredient).filter((entry): entry is NonNullable<ReturnType<typeof ingredient>> => Boolean(entry)),1,1));
  if (unknown) return { missing, coverage: "needs_review" as const, reviewItems: [{ name: "本餐单", reason: "本餐单有未明确用量的安排，请核对后再计算库存缺口" }] };
  const budget = createPlanningBudget(inventory,meals.map(item => ({ ...item, planned_date: String(item.planned_date) < today ? today : String(item.planned_date) })));
  const parts = budget.commitmentPreviews.get(itemId) ?? [];
  for (const part of parts) {
    if (part.quantity_status === "unknown") { reviewItems.push({ name: part.food_name,reason: "库存数量或单位无法确认，请核对采购缺口" }); continue; }
    if (part.deductions.some(deduction => !/^\d{4}-\d{2}-\d{2}$/.test(String(deduction.expiration_date)))) {
      reviewItems.push({ name: part.food_name,reason: "使用的库存未明确到期日，请核对后再采购" }); continue;
    }
    if (part.fully_covered) continue;
    const existing = shopping.filter(row => !row.checked && !row.deleted_at && inventoryFoodNamesMatch(String(row.name),part.food_name));
    if (existing.length) { reviewItems.push({ name: part.food_name,reason: "已有未购清单项，已保留原内容，请核对数量",itemIds: existing.map(row => String(row.id)) }); continue; }
    missing.push({ name: part.food_name,amount: `${QuantityDecimal.from(part.missing_value).toString()}${labels[part.unit] ?? part.unit}` });
  }
  return { missing, coverage: reviewItems.length ? "needs_review" as const : missing.length ? "shortfall" as const : "covered" as const,reviewItems };
}
