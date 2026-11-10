import type { PreparedMeal } from "@dietdigidose/contracts";
export type Row = Record<string, unknown>;

export interface AiContextRows {
  user: Row | null;
  inventory: Row[];
  preparedMeals?: Row[];
  kitchenware: Row[];
  todayDiet: Row[];
  latestHealth: Row | null;
  measurementLogs?: Row[];
  healthProfile: Row | null;
  personaPrompt: string;
}

export interface AiContextSnapshot {
  preparedMeals?: PreparedMeal[];
  username: string;
  dailyCaloriesTarget: number;
  calorieTarget?: import("@dietdigidose/contracts").CalorieTarget;
  currentMeasurements?: import("@dietdigidose/contracts").CurrentMeasurements;
  inventory: Array<{ id?: number; version?: number; quantity_value?: number | null; quantity_unit?: string | null; batch_code?: string | null; food_name: string; quantity: string; expiration_date: string; storage_location: string }>;
  kitchenware: Array<{ name: string; category: string; status: string }>;
  todayDiet: Array<{ meal_type: string; food_name: string; calories: number; protein: number; carbs: number; fat: number }>;
  latestHealth?: { weight?: number; body_fat?: number; water_ml?: number };
  healthProfile?: {
    age?: number | null;
    dietary_preference?: string;
    allergies: Array<{ name: string; type: string; severity: string }>;
    medications?: string;
    medical_conditions: string[];
    medical_notes?: string;
    dietary_restrictions: string[];
    disliked_foods?: string;
    kitchen_constraints: Record<string, unknown>;
    nutrition_targets: Record<string, unknown>;
  };
  personaPrompt: string;
}
