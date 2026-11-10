import type Database from "better-sqlite3";
import type { CookingPlanDraft, PreparedMealAllocation } from "@dietdigidose/contracts";
import { allocationRows, formatAllocation, type Row } from "./model.js";
import { InventoryQuantityError } from "../../services/inventoryQuantity.js";
export class SqliteMealAllocationsRepository {
  private readonly database: Database.Database;
  constructor(database: Database.Database) { this.database = database; }
  list(userId: number, mealId?: string) {
    return (this.database.prepare(`SELECT a.* FROM prepared_meal_allocations a JOIN meal_plans p ON p.id=a.plan_id
      WHERE a.user_id=? AND p.user_id=a.user_id AND p.status='active' AND p.deleted_at IS NULL AND (? IS NULL OR a.prepared_meal_id=?)
      ORDER BY a.planned_date,a.meal_type,a.id`).all(userId, mealId ?? null, mealId ?? null) as Row[]).map(formatAllocation);
  }
  reserve(userId: number, planId: string, targets: CookingPlanDraft["meals"]) {
    const insert = this.database.prepare(`INSERT INTO prepared_meal_allocations
      (id,user_id,plan_id,target_meal_id,prepared_meal_id,servings,remaining_servings,planned_date,meal_type,status,version,source_json)
      VALUES(@id,@user_id,@plan_id,@target_meal_id,@prepared_meal_id,@servings,@remaining_servings,@planned_date,@meal_type,@status,@version,@source_json)`);
    for (const row of allocationRows(userId, planId, targets)) insert.run(row);
  }
  update(userId: number, next: PreparedMealAllocation) {
    const result = this.database.prepare(`UPDATE prepared_meal_allocations SET remaining_servings=?,planned_date=?,meal_type=?,status=?,version=version+1
      WHERE id=? AND user_id=? AND version=?`).run(next.remainingServings,next.plannedDate,next.mealType,next.status,next.id,userId,next.version-1);
    if (result.changes !== 1) throw new InventoryQuantityError("MEAL_ALLOCATION_VERSION_CONFLICT", "餐次安排已变化，请刷新后重试");
  }
  release(userId: number, planId: string) {
    this.database.prepare("UPDATE prepared_meal_allocations SET status='released',version=version+1 WHERE user_id=? AND plan_id=? AND status IN ('active','conflict')").run(userId,planId);
  }
}
