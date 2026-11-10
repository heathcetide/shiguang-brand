import type { Pool, PoolClient } from "pg";
import type { CookingPlanDraft, PreparedMealAllocation } from "@dietdigidose/contracts";
import { allocationRows, formatAllocation } from "./model.js";
import { InventoryQuantityError } from "../../services/inventoryQuantity.js";
export class PostgresMealAllocationsRepository {
  private readonly client: Pool | PoolClient;
  constructor(client: Pool | PoolClient) { this.client = client; }
  async list(userId: number, mealId?: string) {
    return (await this.client.query(`SELECT a.* FROM prepared_meal_allocations a JOIN meal_plans p ON p.id=a.plan_id
      WHERE a.user_id=$1 AND p.user_id=a.user_id AND p.status='active' AND p.deleted_at IS NULL AND ($2::text IS NULL OR a.prepared_meal_id=$2)
      ORDER BY a.planned_date,a.meal_type,a.id`,[userId,mealId ?? null])).rows.map(formatAllocation);
  }
  async reserve(userId: number, planId: string, targets: CookingPlanDraft["meals"]) {
    for (const row of allocationRows(userId,planId,targets)) await this.client.query(`INSERT INTO prepared_meal_allocations
      (id,user_id,plan_id,target_meal_id,prepared_meal_id,servings,remaining_servings,planned_date,meal_type,status,version,source_json)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,Object.values(row));
  }
  async update(userId: number, next: PreparedMealAllocation) {
    const result = await this.client.query(`UPDATE prepared_meal_allocations SET remaining_servings=$1,planned_date=$2,meal_type=$3,status=$4,version=version+1
      WHERE id=$5 AND user_id=$6 AND version=$7`,[next.remainingServings,next.plannedDate,next.mealType,next.status,next.id,userId,next.version-1]);
    if (result.rowCount !== 1) throw new InventoryQuantityError("MEAL_ALLOCATION_VERSION_CONFLICT", "餐次安排已变化，请刷新后重试");
  }
  async release(userId: number, planId: string) {
    await this.client.query("UPDATE prepared_meal_allocations SET status='released',version=version+1 WHERE user_id=$1 AND plan_id=$2 AND status IN ('active','conflict')",[userId,planId]);
  }
}
