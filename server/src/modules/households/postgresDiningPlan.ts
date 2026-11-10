import type { PoolClient } from "pg";
import type { HouseholdDiningPlan } from "@dietdigidose/contracts";
import { validateDiningPlan } from "./diningPlanValidation.js";
import type { Row } from "./types.js";
export async function validatePostgresDiningPlan(client: PoolClient,userId: number,recipeId: unknown,input: HouseholdDiningPlan) {
  await client.query("SELECT id FROM households WHERE id=$1 FOR KEY SHARE",[input.householdId]);
  const members = (await client.query("SELECT id,user_id,dining_version,dining_shared,dining_preferences_json FROM household_members WHERE household_id=$1 ORDER BY id FOR SHARE",[input.householdId])).rows as Row[];
  const recipe = (await client.query("SELECT * FROM recipes WHERE id=$1 AND status='approved' AND deleted_at IS NULL AND COALESCE(quality_status,'trusted')<>'needs_review' FOR SHARE",[recipeId ?? null])).rows[0] as Row | undefined;
  return validateDiningPlan(input,userId,members,recipe);
}
