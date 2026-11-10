import type Database from "better-sqlite3";
import type { AiToolDataRepository } from "./repository.js";
import type { DietMealInput, RecipeSearchInput, Row } from "./types.js";

export class SqliteAiToolDataRepository implements AiToolDataRepository {
  private readonly database: Database.Database;
  constructor(database: Database.Database) { this.database = database; }

  async searchRecipes(input: RecipeSearchInput) {
    const clauses = ["status = 'approved'", "deleted_at IS NULL", "COALESCE(quality_status, 'trusted') <> 'needs_review'"];
    const params: Array<string | number> = [];
    for (const name of input.ingredientNames) { clauses.push("(title LIKE ? OR ingredients_json LIKE ?)"); params.push(`%${name}%`, `%${name}%`); }
    if (input.maxTimeMinutes !== undefined) { clauses.push("cook_time <= ?"); params.push(input.maxTimeMinutes); }
    if (input.maxCalories !== undefined) { clauses.push("calories <= ?"); params.push(input.maxCalories); }
    if (input.minProteinG !== undefined) { clauses.push("protein >= ?"); params.push(input.minProteinG); }
    return this.database.prepare(`SELECT id, title, cook_time, difficulty, calories, protein, carbs, fat, tags, ingredients_json
      FROM recipes WHERE ${clauses.join(" AND ")} ORDER BY id DESC LIMIT ?`).all(...params, input.limit) as Row[];
  }

  async lookupFoodNutrition(foodName: string) {
    return this.database.prepare(`SELECT name, brands, calories_100g, protein_100g, carbs_100g, fat_100g, source
      FROM ingredients_library WHERE deleted_at IS NULL AND name LIKE ?
      ORDER BY CASE WHEN name = ? THEN 0 ELSE 1 END LIMIT 3`).all(`%${foodName}%`, foodName) as Row[];
  }

  async recordDietMeal(input: DietMealInput) {
    const result = this.database.prepare(`INSERT INTO diet_records
      (user_id, meal_type, food_name, amount, calories, protein, carbs, fat, recorded_at, recorded_time)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(input.userId, input.mealType, input.foodName, input.amount,
      input.calories, input.protein, input.carbs, input.fat, input.recordedAt, input.recordedTime);
    return Number(result.lastInsertRowid);
  }
}
