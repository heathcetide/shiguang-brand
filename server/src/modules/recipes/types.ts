import type { IngredientGroup } from "../../utils/ingredientGroups.js";

export type Row = Record<string, unknown>;

export type NutritionItem = {
  key: string;
  label: string;
  value: number;
  unit: string;
};

export type RecipeInput = {
  title: string;
  description: string;
  imageUrl: string;
  cookTime: number;
  difficulty: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  nutrition: NutritionItem[];
  category: string;
  tags: string[];
  steps: string[];
  ingredients: Array<{ name: string; amount: string; group: IngredientGroup }>;
  servingSize: number;
  prepTime: number | null;
  cuisine: string | null;
  mealTypes: string[];
  requiredKitchenware: string[];
  optionalKitchenware: string[];
};

export type RecipeRequirementWrite = {
  rawName: string;
  normalizedName: string;
  role: "required" | "optional";
  catalogId: number | null;
  confidence: number;
};

export type RecipeSubmissionWrite = {
  recipe: RecipeInput;
  authorUserId: number;
  canonicalKey: string;
  sourceContentHash: string;
  requirements: RecipeRequirementWrite[];
};

export type PublicRecipeQuery = {
  userId?: number;
  scope?: string;
  category?: string;
  search?: string;
  maxCookTime: number | null;
  cursorId: number | null;
  limit: number;
};

export type PublicRecipePage = {
  rows: Row[];
  total: number;
};

export type RecipeLibrarySummary = {
  official: number;
  community: number;
  personal: number;
  favorites: number;
};
