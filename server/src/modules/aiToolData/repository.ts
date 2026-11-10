import type { DietMealInput, RecipeSearchInput, Row } from "./types.js";

export interface AiToolDataRepository {
  searchRecipes(input: RecipeSearchInput): Promise<Row[]>;
  lookupFoodNutrition(foodName: string): Promise<Row[]>;
  recordDietMeal(input: DietMealInput): Promise<number>;
}
