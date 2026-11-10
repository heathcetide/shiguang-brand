export type Row = Record<string, unknown>;

export type KitchenwareInput = {
  attributes?: import("@dietdigidose/contracts").KitchenwareAttributes;
  name: string;
  category: string;
  status: string;
  note: string;
  imageUrl: string;
  purchaseDate: string;
};

export type StoredKitchenwareInput = KitchenwareInput & {
  originalName: string | null;
  catalogId: number | null;
};

export type ResolvedCatalog = {
  qualityStatus?: string;
  id: number;
  name: string;
  category: string;
  confidence: number;
  attributes: Row;
  capabilities: Array<{ code: string; name: string; safetyLevel: string; constraints: Row }>;
};

export type KitchenwareRequirement = {
  role: string;
  /** Non-null means this device (or a governed equivalent) is required. */
  catalogId: number | null;
  catalogName: string | null;
  /** Generic matching is allowed only when catalogId is null. */
  capabilityCode: string | null;
  confidence: number;
  notes: string;
};
