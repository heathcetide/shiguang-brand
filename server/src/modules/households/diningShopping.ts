import { isDeepStrictEqual } from "node:util";
import type { HouseholdDiningPlan } from "@dietdigidose/contracts";
import { InventoryQuantityError } from "../../services/inventoryQuantity.js";
import { checkDiningRecipe } from "./recipeConstraints.js";
import type { Row } from "./types.js";

export function prepareDiningShopping(dining: HouseholdDiningPlan, expected: HouseholdDiningPlan, recipe: Row, existing: Row[], fingerprint?: string) {
  if (!isDeepStrictEqual(dining,expected)) throw new InventoryQuantityError("DINING_PLAN_CHANGED","采购预览与已保存共餐安排不同，请先保存安排后重新核对");
  if (existing.some(row => Number(row.household_id)!==dining.householdId || row.checked || row.transferred_at || row.deleted_at || Number(row.version)!==Number(row.source_generated_version)))
    throw new InventoryQuantityError("DINING_SHOPPING_CHANGED","来源采购已购买、入库或手动修改，请先核对家庭清单，不自动覆盖或重复加购");
  const servings = dining.participants.reduce((sum,person) => sum+Math.round(person.servings*1_000_000),0)/1_000_000;
  const checked = checkDiningRecipe(recipe,[],servings);
  if (fingerprint !== checked.fingerprint) throw new InventoryQuantityError("DINING_RECIPE_CHANGED","菜谱内容已变化，请重新核对采购预览");
  if (checked.materials.status !== "known") throw new InventoryQuantityError("DINING_QUANTITY_UNKNOWN","共餐原料用量不完整，无法生成采购总需求");
  const demands = new Map<string,{ key: string; name: string; amount: number; unit: string }>();
  for (const item of checked.materials.demands) {
    const key = JSON.stringify([item.food_name.trim().toLocaleLowerCase(),item.unit]);
    const previous = demands.get(key);
    const amount = Math.round(((previous?.amount ?? 0)+item.amount_value)*1_000_000)/1_000_000;
    if (amount>1_000_000_000) throw new InventoryQuantityError("DINING_QUANTITY_UNKNOWN","共餐原料总量超出计量范围");
    demands.set(key,{ key,name: item.food_name,amount,unit: item.unit });
  }
  const units: Record<string,string> = { piece: '个',serving: '份',bag: '袋',box: '盒',bottle: '瓶',can: '罐' };
  return [...demands.values()].map(item => ({ key: item.key,name: item.name,amount: `${item.amount}${units[item.unit] ?? item.unit}` }));
}
