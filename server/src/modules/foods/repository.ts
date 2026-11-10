import type { CustomFoodCreateData, FoodLibraryRecord } from "./types.js";

/** Driver-neutral food library persistence port. */
export interface FoodRepository {
  findByBarcode(barcode: string): Promise<FoodLibraryRecord | null>;
  searchTrusted(normalizedQuery: string, limit: number): Promise<FoodLibraryRecord[]>;
  recordSearchGap(normalizedQuery: string, sampleQuery: string): Promise<void>;
  createCustom(userId: number, input: CustomFoodCreateData): Promise<number>;
}
