export type Row = Record<string, unknown>;

export type RecipeSearchInput = {
  ingredientNames: string[];
  maxTimeMinutes?: number;
  maxCalories?: number;
  minProteinG?: number;
  limit: number;
};

export type DietMealInput = {
  userId: number;
  mealType: string;
  foodName: string;
  amount: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  recordedAt: string;
  recordedTime: string;
};
