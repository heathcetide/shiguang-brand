export type Row = Record<string, unknown>;

export type RecommendationInput = {
  surface: "home" | "inventory" | "ai" | "meal_plan";
  category?: string;
  search?: string;
  maxCookTime?: number;
  matchStatus?: "all" | "full" | "missing_few" | "expiring";
  mealType?: "breakfast" | "lunch" | "dinner" | "snack";
  pageSize: number;
  cursor?: string;
};

export type RecommendationEventInput = {
  requestId?: string;
  recipeId: number;
  eventType: string;
  scoringVersion: string;
  surface: string;
  metadata?: Row;
  idempotencyKey: string;
};

export type RecommendationDataset = {
  profile: {
    allergies: Row[];
    restrictions: string[];
    disliked: string[];
    kitchen: Row;
    nutrition: Row;
    updatedAt: string | null;
  };
  inventory: Row[];
  kitchenware: Row[];
  recipes: Row[];
  favoriteIds: number[];
  recentIds: number[];
  skippedIds: number[];
  explicitDislikedIds?: number[];
  diet: { calories: number; protein: number };
  dailyCaloriesTarget: number;
  requirements: Map<number, Array<Row & { role: string }>>;
  compatibility: Map<number, { requirements: Row[]; blocking: Row[] }>;
};
