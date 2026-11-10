import { PostgresMealAllocationsRepository } from "../mealAllocations/postgresRepository.js";
import type { Pool } from "pg";
import type { AiContextRepository } from "./repository.js";
import type { AiContextRows, Row } from "./types.js";
import { PostgresHealthRepository } from "../health/postgresRepository.js";

export class PostgresAiContextRepository implements AiContextRepository {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }

  async load(userId: number, date: string): Promise<AiContextRows> {
    const [user, inventory, preparedMeals, kitchenware, todayDiet, measurementLogs, healthProfile, setting] = await Promise.all([
      this.pool.query("SELECT username, daily_calories_target FROM users WHERE id = $1", [userId]),
      this.pool.query(`SELECT id, version, quantity_value, quantity_unit, batch_code, food_name, quantity, expiration_date, storage_location FROM inventory_items
        WHERE user_id = $1 AND is_available = TRUE AND deleted_at IS NULL ORDER BY CASE WHEN expiration_date = '' THEN 1 ELSE 0 END, expiration_date ASC LIMIT 15`, [userId]),
      this.pool.query("SELECT * FROM prepared_meals WHERE user_id=$1 AND remaining_servings>0 ORDER BY produced_at LIMIT 30", [userId]),
      this.pool.query(`SELECT name, category, status FROM kitchenware_items
        WHERE user_id = $1 AND deleted_at IS NULL AND status <> '维修中' ORDER BY updated_at DESC LIMIT 20`, [userId]),
      this.pool.query(`SELECT meal_type, food_name, calories, protein, carbs, fat FROM diet_records
        WHERE user_id = $1 AND recorded_at LIKE $2 ORDER BY id DESC`, [userId, `${date}%`]),
      new PostgresHealthRepository(this.pool).measurementLogs(userId),
      this.pool.query("SELECT * FROM user_health_profiles WHERE user_id = $1", [userId]),
      this.pool.query("SELECT value FROM system_settings WHERE key = 'AI_SYSTEM_PROMPT'"),
    ]);
    const allocations = await new PostgresMealAllocationsRepository(this.pool).list(userId);
    return {
      user: (user.rows[0] as Row | undefined) || null,
      inventory: inventory.rows as Row[], preparedMeals: preparedMeals.rows.map(row => ({ ...row, allocations: allocations.filter(item => item.preparedMealId === row.id) })), kitchenware: kitchenware.rows as Row[], todayDiet: todayDiet.rows as Row[],
      latestHealth: null, measurementLogs,
      healthProfile: (healthProfile.rows[0] as Row | undefined) || null,
      personaPrompt: String(setting.rows[0]?.value || ""),
    };
  }
}
