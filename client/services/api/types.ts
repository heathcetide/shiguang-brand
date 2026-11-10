export type { InventoryItem } from "@dietdigidose/contracts";

export type DietRecord = {
  id: number;
  prepared_meal_id?: string | null;
  household_meal_id?: string | null;
  meal_type: string;
  food_name: string;
  amount: string;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  recorded_at: string;
  recorded_time?: string | null;
  image_url: string | null;
};

export type HealthLog = {
  id: number;
  weight: number | null;
  body_fat: number | null;
  water_ml: number | null;
  height_cm?: number | null;
  waist_cm?: number | null;
  hip_cm?: number | null;
  resting_heart_rate?: number | null;
  blood_pressure_systolic?: number | null;
  blood_pressure_diastolic?: number | null;
  blood_glucose_mmol?: number | null;
  cycle_status?: string | null;
  sleep_hours?: number | null;
  recorded_date: string;
};

export type Recipe = {
  id: number;
  title: string;
  description: string;
  image_url: string | null;
  cook_time: number;
  difficulty: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  category: string;
  tags: string[];
  steps: string[];
  ingredients: Array<{ name: string; amount: string; group?: string }>;
  status?: "pending" | "approved" | "rejected";
  quality_status: "trusted" | "estimated" | "needs_review";
  nutrition_basis: "source" | "ingredient_estimate" | "category_fallback";
  nutrition_is_estimated: boolean;
};

export type CommunityPost = {
  id: number;
  user_id: number;
  username: string;
  avatar_url?: string | null;
  content: string;
  image_url: string | null;
  image_urls?: string[];
  likes_count: number;
  created_at: string;
  category?: string;
  is_liked?: boolean;
  is_bookmarked?: boolean;
  linked_recipe?: import("@/components/LinkedRecipeCard").LinkedRecipeSummary | null;
  linked_recipe_unavailable?: boolean;
};
