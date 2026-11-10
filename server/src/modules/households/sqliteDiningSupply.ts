import type Database from "better-sqlite3";
import { InventoryQuantityError } from "../../services/inventoryQuantity.js";
import { currentDateKey } from "../../utils/date.js";
import type { Row } from "./types.js";
export function readSqliteDiningSupply(database: Database.Database,userId: number,householdId: number,target: { planId: string; itemId: string; version: number },totalServings: number,recipeFingerprint: string) {
  const plans = database.prepare(`SELECT i.id,i.user_id,i.plan_id,i.version,i.planned_date,i.dining_json,i.recipe_id,r.title AS recipe_title,r.description AS recipe_description,r.ingredients_json AS recipe_ingredients,r.serving_size AS recipe_yield,
  (i.confirmed_at IS NOT NULL OR i.status IN ('queued','cooking') OR EXISTS(SELECT 1 FROM household_shopping_items hs WHERE hs.source_plan_item_id=i.id AND (hs.checked<>false OR hs.transferred_at IS NOT NULL)) OR EXISTS(SELECT 1 FROM shopping_list_items ps WHERE ps.user_id=i.user_id AND ps.client_id LIKE ('meal-plan:' || i.id || ':%') AND ps.checked<>false)) AS protected
  FROM meal_plan_items i JOIN meal_plans p ON p.id=i.plan_id LEFT JOIN recipes r ON r.id=i.recipe_id
  WHERE i.user_id=p.user_id AND i.deleted_at IS NULL AND p.deleted_at IS NULL AND p.status='active' AND i.status NOT IN ('completed','skipped') AND (json_extract(i.dining_json,'$.householdId')=? OR (i.id=? AND i.user_id=?))`).all(householdId,target.itemId,userId) as Row[];
  const item = plans.find(row => String(row.id)===target.itemId && Number(row.user_id)===userId && String(row.plan_id)===target.planId && Number(row.version)===target.version);
  if (!item) throw new InventoryQuantityError("PLAN_ITEM_CHANGED","餐次已变化，请重新读取后核对");
  const inventory = database.prepare("SELECT id,version,food_name,quantity,expiration_date,is_available FROM household_inventory_items WHERE household_id=?").all(householdId) as Row[];
  const shopping = database.prepare("SELECT id,household_id,version,name,amount,checked,expiration_date,source_plan_item_id,source_demand_key,source_generated_version,deleted_at,transferred_at FROM household_shopping_items WHERE household_id=?").all(householdId) as Row[];

  return { plans,inventory,shopping,targetId: target.itemId,totalServings,recipeFingerprint,today: currentDateKey() };
}
