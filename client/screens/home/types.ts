export interface Recipe {
  id: number;
  title: string;
  description: string;
  image_url: string;
  cook_time: number;
  difficulty: string;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  category: string;
  tags: string[];
  ingredients: Array<{ name?: string; amount?: string } | string>;
  quality_status?: "trusted" | "estimated" | "needs_review";
  nutrition_is_estimated?: boolean;
  nutrition_basis?: string;
}

export interface RankedRecipe extends Recipe {
  inventoryMatchNames: string[];
  expiringMatchCount: number;
}

export type { InventoryItem } from "@dietdigidose/contracts";

export interface DietRecord {
  id: number;
  meal_type: string;
  food_name: string;
  amount: string;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  recorded_at: string;
}

export interface Post {
  id: number;
  user_id: number;
  username: string;
  avatar_url: string;
  content: string;
  image_url: string | null;
  likes_count: number;
  created_at: string;
}

export interface HealthLog {
  recorded_date: string;
  weight?: number | null;
  body_fat?: number | null;
  water_ml?: number | null;
}

export interface RecommendationCard {
  recipeId?: number;
  title: string;
  tag: string;
  desc: string;
  calories: string;
  prompt: string;
}

export interface InventoryHighlight {
  eyebrow: string;
  title: string;
  description: string;
  icon: "carrot" | "boxes-stacked" | "basket-shopping" | "plus";
  tone: "amber" | "green";
  prompt?: string;
}
