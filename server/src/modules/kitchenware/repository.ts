import type { Row, StoredKitchenwareInput } from "./types.js";

export interface KitchenwareRepository {
  listItems(userId: number): Promise<Row[]>;
  listCatalog(): Promise<Row[]>;
  listCapabilities(): Promise<Row[]>;
  capabilitiesForCatalog(catalogId: number): Promise<Row[]>;
  substitutionsForCatalog(catalogId: number): Promise<Row[]>;
  recipeAvailable(recipeId: number): Promise<boolean>;
  requirementsForRecipe(recipeId: number): Promise<Row[]>;
  ownedItems(userId: number): Promise<Row[]>;
  substitutionFor(sourceCatalogId: number, ownedCatalogIds: number[]): Promise<Row | null>;
  findOwnedItem(userId: number, id: number): Promise<Row | null>;
  createItem(userId: number, input: StoredKitchenwareInput): Promise<Row>;
  updateItem(userId: number, id: number, input: StoredKitchenwareInput): Promise<Row | null>;
  maintainItem(userId: number, id: number): Promise<Row | null>;
  removeItem(userId: number, id: number): Promise<boolean>;
  upsertMappingReview(input: {
    rawName: string;
    normalizedName: string;
    sourceType: string;
    sourceId: string | null;
    confidence: number;
    suggestedCatalogId: number | null;
  }): Promise<void>;
}
