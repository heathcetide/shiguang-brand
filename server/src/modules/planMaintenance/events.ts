/** Minimal dependency facts; workers reload current quantities. Renames retain the old food name to find prior dependencies. */
export type MaintenanceEvent = {
  userId: number;
  kind: "inventory_created" | "inventory_changed" | "cooking_completion" | "production" | "eat" | "discard" | "reschedule" | "intake_correction";
  sourceId: string;
  subjectId: string;
  details?: { version?: number; planItemId?: string | null; inventoryItemIds?: number[]; mode?: string; previousFoodName?: string };
};
