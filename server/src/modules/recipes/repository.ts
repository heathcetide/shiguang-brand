import type {
  PublicRecipePage, PublicRecipeQuery, RecipeLibrarySummary, RecipeSubmissionWrite, Row,
} from "./types.js";

export interface RecipesRepository {
  listPublic(input: PublicRecipeQuery): Promise<PublicRecipePage>;
  librarySummary(userId?: number): Promise<RecipeLibrarySummary>;
  listMine(userId: number): Promise<Row[]>;
  listFavorites(userId: number): Promise<Row[]>;
  favoriteCount(userId: number): Promise<number>;
  requirementsForRecipes(recipeIds: number[]): Promise<Row[]>;
  createSubmission(input: RecipeSubmissionWrite): Promise<number>;
  findSubmission(userId: number, recipeId: number): Promise<Row | null>;
  updateSubmission(recipeId: number, input: RecipeSubmissionWrite): Promise<boolean>;
  withdrawSubmission(userId: number, recipeId: number): Promise<boolean>;
  isFavorite(userId: number, recipeId: number): Promise<boolean>;
  addFavorite(userId: number, recipeId: number): Promise<boolean>;
  removeFavorite(userId: number, recipeId: number): Promise<void>;
  findPublic(recipeId: number): Promise<Row | null>;
}
