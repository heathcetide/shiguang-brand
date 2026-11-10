export type InventoryOutcome = "cooked" | "used" | "discarded" | "expired" | "gifted" | "transferred" | "unknown";
export type InventoryScope = "personal" | "household";

export type InventoryOutcomeEvent = {
  id: string;
  traceType: "outcome" | "change_log";
  itemId: number;
  foodName: string;
  category: string;
  outcome: InventoryOutcome;
  source: string;
  quantityValue: number | null;
  quantityUnit: string | null;
  quantityText: string | null;
  expirationDate: string | null;
  occurredAt: string;
  version: number;
  corrected: boolean;
};

export type InventoryOutcomeCreateInput = {
  interventionId?: string;
  confirmed?: true;
  scope: InventoryScope;
  itemId: number;
  householdId?: number;
  itemVersion?: number;
  outcome: InventoryOutcome;
  source: string;
  idempotencyKey: string;
  occurredAt?: string;
  closeItem: boolean;
};

export type InventoryOutcomeUpdateInput = { version: number; outcome: InventoryOutcome };

export type CreateOutcomeResult =
  | { kind: "created"; event: InventoryOutcomeEvent }
  | { kind: "repeated"; event: InventoryOutcomeEvent }
  | { kind: "household_not_found" }
  | { kind: "inventory_not_found" }
  | { kind: "conflict" };

export type UpdateOutcomeResult =
  | { kind: "updated"; event: InventoryOutcomeEvent }
  | { kind: "not_found" }
  | { kind: "conflict" };

export type ActionableInventory = { category: string; count: number } | null;
