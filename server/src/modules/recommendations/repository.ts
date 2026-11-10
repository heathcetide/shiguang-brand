import type { RecommendationEventInput, Row } from "./types.js";

export type RecipeQuery = { category?: string; search?: string; timeBudget: number | null };
export type RecommendationRequestWrite = {
  id: string;
  userId: number;
  surface: string;
  scoringVersion: string;
  candidateVersion: string;
  inputHash: string;
  inputSnapshot: Row;
  results: Row[];
  dataUpdatedAt: string | null;
};

export interface RecommendationsRepository {
  preferenceOutcomes(userId: number): Promise<{ production: Row[]; events: Row[]; inventory?: Row[]; changes?: Row[]; statements?: Row[] }>;
  learningData(userId: number): Promise<import("./preferenceEvidence.js").LearningData>;
  updateLearning(userId: number,input: import("@dietdigidose/contracts").PreferenceLearningUpdate): Promise<boolean>;
  /** Includes items from startDate onward and all active plans (including overdue prepared reservations). */
  planningState(userId: number, startDate: string, endDate: string): Promise<{ items: Row[]; plans: Row[]; shopping: Row[] }>;
  preparedMeals(userId: number): Promise<Row[]>;
  profile(userId: number): Promise<Row | null>;
  inventory(userId: number): Promise<Row[]>;
  kitchenware(userId: number): Promise<Row[]>;
  recipes(query: RecipeQuery): Promise<Row[]>;
  favoriteRecipeIds(userId: number): Promise<number[]>;
  recentRecipeIds(userId: number): Promise<number[]>;
  skippedRecipeIds(userId: number): Promise<number[]>;
  dietTotals(userId: number, date: string): Promise<{ calories: number; protein: number }>;
  dailyCaloriesTarget(userId: number): Promise<number>;
  findRequest(userId: number, requestId: string): Promise<Row | null>;
  createRequest(input: RecommendationRequestWrite): Promise<void>;
  findEvent(userId: number, idempotencyKey: string): Promise<Row | null>;
  recipeAvailable(recipeId: number): Promise<boolean>;
  /** Reads immutable provenance even after pagination expiry. */
  requestEvidence(userId: number, requestId: string): Promise<Row | null>;
  createEvent(id: string, userId: number, input: RecommendationEventInput): Promise<{ id: string; repeated: boolean }>;
}
