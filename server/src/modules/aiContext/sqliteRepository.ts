import { SqliteMealAllocationsRepository } from "../mealAllocations/sqliteRepository.js";
import type Database from "better-sqlite3";
import type { AiContextRepository } from "./repository.js";
import type { AiContextRows, Row } from "./types.js";
import { SqliteHealthRepository } from "../health/sqliteRepository.js";

export class SqliteAiContextRepository implements AiContextRepository {
  private readonly database: Database.Database;
  constructor(database: Database.Database) { this.database = database; }

  async load(userId: number, date: string): Promise<AiContextRows> {
    const user = this.database.prepare("SELECT username, daily_calories_target FROM users WHERE id = ?").get(userId) as Row | undefined;
    const inventory = this.database.prepare(`SELECT id, version, quantity_value, quantity_unit, batch_code, food_name, quantity, expiration_date, storage_location FROM inventory_items
      WHERE user_id = ? AND is_available = 1 AND deleted_at IS NULL ORDER BY CASE WHEN expiration_date = '' THEN 1 ELSE 0 END, expiration_date ASC LIMIT 15`).all(userId) as Row[];
    const preparedMeals = this.database.prepare("SELECT * FROM prepared_meals WHERE user_id=? AND remaining_servings>0 ORDER BY produced_at LIMIT 30").all(userId) as Row[];
    const kitchenware = this.database.prepare(`SELECT name, category, status FROM kitchenware_items
      WHERE user_id = ? AND deleted_at IS NULL AND status <> '维修中' ORDER BY updated_at DESC LIMIT 20`).all(userId) as Row[];
    const todayDiet = this.database.prepare(`SELECT meal_type, food_name, calories, protein, carbs, fat FROM diet_records
      WHERE user_id = ? AND recorded_at LIKE ? ORDER BY id DESC`).all(userId, `${date}%`) as Row[];
    const measurementLogs = await new SqliteHealthRepository(this.database).measurementLogs(userId);
    const healthProfile = this.database.prepare("SELECT * FROM user_health_profiles WHERE user_id = ?").get(userId) as Row | undefined;
    const setting = this.database.prepare("SELECT value FROM system_settings WHERE key = 'AI_SYSTEM_PROMPT'").get() as { value: string } | undefined;
    const allocations = new SqliteMealAllocationsRepository(this.database).list(userId);
    return { user: user || null, inventory, preparedMeals: preparedMeals.map(row => ({ ...row, allocations: allocations.filter(item => item.preparedMealId === row.id) })), kitchenware, todayDiet, latestHealth: null, measurementLogs,
      healthProfile: healthProfile || null, personaPrompt: setting?.value || "" };
  }
}
