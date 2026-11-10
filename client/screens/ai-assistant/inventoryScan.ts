import { normalizeDetectedFoods } from "@/screens/inventory/scan";
import type { InventoryScanFood } from "./types";

export { inferFoodCategory as inferInventoryCategory } from "@/screens/inventory/scan";

export const normalizeInventoryScanFoods = (items: unknown, jobId: string): InventoryScanFood[] =>
  normalizeDetectedFoods(items, jobId).map(item => ({ ...item,
    suggestedStorageLocation: item.suggestedStorageLocation as InventoryScanFood["suggestedStorageLocation"],
  }));
