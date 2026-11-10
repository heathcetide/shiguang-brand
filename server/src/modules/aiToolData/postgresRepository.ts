import type { Pool } from "pg";
import type { AiToolDataRepository } from "./repository.js";
import type { DietMealInput, RecipeSearchInput, Row } from "./types.js";

export class PostgresAiToolDataRepository implements AiToolDataRepository {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }

  async searchRecipes(input: RecipeSearchInput) {
    const clauses = ["status = 'approved'", "deleted_at IS NULL", "COALESCE(quality_status, 'trusted') <> 'needs_review'"];
    const params: Array<string | number> = [];
    const parameter = (value: string | number) => { params.push(value); return `$${params.length}`; };
    for (const name of input.ingredientNames) {
      const term = parameter(`%${name}%`);
      clauses.push(`(title ILIKE ${term} OR ingredients_json::text ILIKE ${term})`);
    }
    if (input.maxTimeMinutes !== undefined) clauses.push(`cook_time <= ${parameter(input.maxTimeMinutes)}`);
    if (input.maxCalories !== undefined) clauses.push(`calories <= ${parameter(input.maxCalories)}`);
    if (input.minProteinG !== undefined) clauses.push(`protein >= ${parameter(input.minProteinG)}`);
    const limit = parameter(input.limit);
    return (await this.pool.query(`SELECT id, title, cook_time, difficulty, calories, protein, carbs, fat, tags, ingredients_json
      FROM recipes WHERE ${clauses.join(" AND ")} ORDER BY id DESC LIMIT ${limit}`, params)).rows as Row[];
  }

  async lookupFoodNutrition(foodName: string) {
    return (await this.pool.query(`SELECT name, brands, calories_100g, protein_100g, carbs_100g, fat_100g, source
      FROM ingredients_library WHERE deleted_at IS NULL AND name ILIKE $1
      ORDER BY CASE WHEN name = $2 THEN 0 ELSE 1 END, id LIMIT 3`, [`%${foodName}%`, foodName])).rows as Row[];
  }

  async recordDietMeal(input: DietMealInput) {
    const result = await this.pool.query(`INSERT INTO diet_records
      (user_id, meal_type, food_name, amount, calories, protein, carbs, fat, recorded_at, recorded_time)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`, [input.userId, input.mealType,
      input.foodName, input.amount, input.calories, input.protein, input.carbs, input.fat, input.recordedAt, input.recordedTime]);
    return Number(result.rows[0].id);
  }
}
