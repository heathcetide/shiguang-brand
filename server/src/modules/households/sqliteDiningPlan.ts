import type Database from "better-sqlite3";
import type { HouseholdDiningPlan } from "@dietdigidose/contracts";
import { validateDiningPlan } from "./diningPlanValidation.js";
import type { Row } from "./types.js";
export function validateSqliteDiningPlan(database: Database.Database,userId: number,recipeId: unknown,input: HouseholdDiningPlan) {
  if (!database.inTransaction) throw new Error("Dining validation requires a transaction");
  const members = database.prepare("SELECT id,user_id,dining_version,dining_shared,dining_preferences_json FROM household_members WHERE household_id=? ORDER BY id").all(input.householdId) as Row[];
  const recipe = database.prepare("SELECT * FROM recipes WHERE id=? AND status='approved' AND deleted_at IS NULL AND COALESCE(quality_status,'trusted')<>'needs_review'").get(recipeId ?? null) as Row | undefined;
  return validateDiningPlan(input,userId,members,recipe);
}
