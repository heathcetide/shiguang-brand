export type Row = Record<string, unknown>;

export type ShoppingCreateInput = {
  name: string;
  amount: string;
  category: string;
  storageLocation?: string;
  expirationDate?: string;
};

export type ShoppingUpdateInput = Partial<ShoppingCreateInput> & { version: number; checked?: boolean };
export type ShoppingIntakeInput = {
  idempotencyKey: string;
  items: Array<{ id: string; version: number; quantity: string; expirationDate: string; storageLocation: string }>;
};

export type InventoryCreateInput = {
  food_name: string;
  category?: string;
  quantity?: string;
  expiration_date: string;
  storage_location?: string;
  image_url?: string | null;
};

export type InventoryUpdateInput = Partial<InventoryCreateInput> & { version: number; is_available?: boolean };
export type IntakeResult = { batchId: string; inventoryIds: number[]; count: number; repeated: boolean };

export type JoinResult = { kind: "not_found" } | { kind: "existing" | "joined"; household: Row };
export type LeaveResult = { kind: "not_member" | "left" | "dissolved" }
  | { kind: "transferred"; newOwnerUserId: number };
export type TransferResult = { kind: "not_owner" } | { kind: "target_not_member" } | { kind: "version_conflict" }
  | { kind: "transferred"; version: number };
export type ShoppingCreateResult = { kind: "not_member" }
  | { kind: "created"; item: Row; active: Row[] };
export type ShoppingMutationResult = { kind: "not_member" } | { kind: "not_found" } | { kind: "version_conflict" }
  | { kind: "updated"; item: Row };
export type ShoppingDeleteResult = "not_member" | "not_found" | "version_conflict" | "deleted";
export type IntakeRepositoryResult = { kind: "not_member" } | { kind: "version_conflict" }
  | { kind: "created"; value: IntakeResult } | { kind: "repeated"; value: IntakeResult };
export type InventoryMutationResult = { kind: "version_conflict" } | { kind: "not_member" } | { kind: "not_found" }
  | { kind: "completed"; item: Row };
