export type Row = Record<string, unknown>;

export type AuditContext = {
  adminUserId: number;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type AdminAudit = AuditContext & {
  action: string;
  resourceType: "ingredients" | "custom_food";
  resourceId: number;
  summary: string;
  details?: Row;
};

export type IngredientInput = {
  name: string;
  normalizedName: string;
  category: string | null;
  calories100g: number | null;
  protein100g: number | null;
  carbs100g: number | null;
  fat100g: number | null;
  /** Completeness of calories, protein, carbs and fat; not source verification. */
  nutritionStatus: "unknown" | "incomplete" | "core_complete";
  source: string;
  aliases: Array<{ value: string; normalized: string }>;
  searchKeywords: string;
  preparationState: string;
  sourceVersion: string;
  dataLicense: string;
  edibleRatio: number;
};

export type IngredientUpdateInput = Pick<IngredientInput, "name" | "normalizedName"> &
  Partial<Omit<IngredientInput, "name" | "normalizedName" | "nutritionStatus">>;

export type IngredientQuery = {
  deleted: "active" | "deleted" | "all";
  search?: string;
  category?: string;
  source?: string;
  page: number;
  pageSize: number;
};

export type MergeResult = { kind: "merged"; source: string; target: string } | { kind: "missing" };
export type AliasResult = { kind: "added"; aliases: string[] } | { kind: "missing" };
export type ReviewResult = { kind: "reviewed"; name: string } | { kind: "missing" };
export type Coverage = { categories: Row[]; gaps: Row[]; anomalies: Row[] };
