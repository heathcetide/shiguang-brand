import type { HouseholdMealProductionInput } from "@dietdigidose/contracts";
import { calculateInventoryConsumption, InventoryQuantityError } from "../../services/inventoryQuantity.js";
import { recipeDemands } from "../recommendations/quantities.js";
import { HouseholdsError } from "./errors.js";
import type { Row } from "./types.js";
export function productionRequest(input: HouseholdMealProductionInput) {
  return { ...(input.planItem ? { planItem: { planId: input.planItem.planId,itemId: input.planItem.itemId,version: input.planItem.version } } : {}),idempotencyKey: input.idempotencyKey,membershipId: input.membershipId,foodName: input.foodName,producedServings: input.producedServings,inventory: [...input.inventory].sort((a,b) => a.itemId-b.itemId).map(item => ({ itemId: item.itemId,version: item.version,amount: item.amount,unit: item.unit })) };
}
export function productionResult(row: Row, repeated: boolean) {
  return { id: String(row.id),householdId: Number(row.household_id),foodName: String(row.food_name),
    ...(row.reserved_total === undefined ? {} : { reservedServings: Math.round(Number(row.reserved_total)*1_000_000)/1_000_000,myReservedServings: Math.round(Number(row.reserved_mine)*1_000_000)/1_000_000,availableServings: Math.round((Number(row.remaining_servings)-Number(row.reserved_total)+Number(row.reserved_mine))*1_000_000)/1_000_000 }),
    producedServings: Number(row.produced_servings),remainingServings: Number(row.remaining_servings),version: Number(row.version),repeated };
}
export function repeatProduction(row: Row,userId: number,input: HouseholdMealProductionInput) {
  const request = typeof row.request_json === "string" ? JSON.parse(row.request_json) : row.request_json;
  if (Number(row.created_by_user_id) !== userId || Number(row.membership_id) !== input.membershipId || JSON.stringify(productionRequest(request)) !== JSON.stringify(productionRequest(input)))
    throw new HouseholdsError(409,"制作编号已用于另一项记录，请重新核对","PRODUCTION_KEY_CONFLICT");
  return productionResult(row,true);
}
export function consumeProductionItem(row: Row, input: HouseholdMealProductionInput["inventory"][number]) {
  const measured = recipeDemands([{ name: String(row.food_name),amount: String(row.quantity).trim() }],1,1)?.[0];
  try {
    const next = calculateInventoryConsumption({ ...row,id: row.id,food_name: row.food_name,quantity: row.quantity,is_available: row.is_available,version: row.version,
      quantity_value: measured?.amount_value ?? null,quantity_unit: measured?.unit ?? null },
    { item_id: input.itemId,version: input.version,mode: "amount",amount_value: input.amount,unit: input.unit });
    return next;
  } catch (error) {
    if (error instanceof InventoryQuantityError) throw new HouseholdsError(409,error.message,error.code);
    throw error;
  }
}


export function validateProductionPlan(item: Row | undefined, input: HouseholdMealProductionInput) {
  if (!input.planItem) return;
  if (!item) throw new HouseholdsError(404,"来源餐次不存在或不是本人有效计划","PLAN_ITEM_UNAVAILABLE");
  if (Number(item.version) !== input.planItem.version || item.status !== "planned" || item.queue_item_id || item.diet_record_id)
    throw new HouseholdsError(409,"来源餐次已变化或进入执行，请回到个人计划核对","PLAN_ITEM_CHANGED");
}
