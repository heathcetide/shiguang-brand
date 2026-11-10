import { householdDiningPlanSchema, type HouseholdDiningPlan } from "@dietdigidose/contracts";
import { InventoryQuantityError } from "../../services/inventoryQuantity.js";
import { checkDiningRecipe } from "./recipeConstraints.js";
import type { Row } from "./types.js";

export function validateDiningPlan(raw: HouseholdDiningPlan, userId: number, members: Row[], recipe: Row | undefined) {
  const input = householdDiningPlanSchema.parse(raw);
  if (!members.some(row => Number(row.user_id) === userId)) throw new InventoryQuantityError("DINING_NOT_MEMBER","你已不属于所选家庭，请重新核对共餐安排");
  const participants = input.participants.map(selection => {
    const member = members.find(row => Number(row.id) === selection.membershipId);
    if (!member || Number(member.dining_version) !== selection.version || !member.dining_shared)
      throw new InventoryQuantityError("DINING_MEMBERS_CHANGED","参与成员或共享忌口已变化，请重新核对共餐安排");
    const preferences = (typeof member.dining_preferences_json === "string" ? JSON.parse(member.dining_preferences_json) : member.dining_preferences_json) as { allergies?: string[]; restrictions?: string[] };
    return { membershipId: selection.membershipId,allergies: preferences.allergies ?? [],restrictions: preferences.restrictions ?? [] };
  });
  if (!recipe || recipe.automatic_inventory_write_allowed === false || recipe.automatic_inventory_write_allowed === 0) throw new InventoryQuantityError("DINING_RECIPE_UNAVAILABLE","请先选择可用菜谱，再安排共餐");
  const checked = checkDiningRecipe(recipe,participants,input.participants.reduce((sum,item) => sum+Math.round(item.servings*1_000_000),0)/1_000_000);
  if (checked.status === "blocked") throw new InventoryQuantityError("DINING_CONSTRAINT_CONFLICT","菜谱与参与成员的明确忌口冲突，请先选择合适菜谱");
  return input;
}
