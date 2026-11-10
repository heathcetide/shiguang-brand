export type Row = Record<string, unknown>;

export type AdminRecipeQuery = {
  deleted: "active" | "deleted" | "all";
  source?: "official" | "user";
  reviewStatus?: "pending" | "approved" | "rejected";
  qualityStatus?: "trusted" | "estimated" | "needs_review";
  category?: string;
  search?: string;
  cursorId: number | null;
  limit: number | null;
};

export type AdminRecipeSummary = {
  total: number;
  platform: number;
  user: number;
  pending: number;
  needs_review: number;
};

export type RequirementWrite = {
  rawName: string;
  normalizedName: string;
  catalogId: number | null;
  capabilityCode: string | null;
  role: "required" | "optional";
  confidence: number;
};

export type DuplicateWrite = {
  candidateRecipeId: number;
  similarity: number;
  reasons: string[];
};

export type AdminRecipeWrite = {
  title: string;
  description: string;
  imageUrl: string | null;
  cookTime: number;
  difficulty: string;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  category: string;
  tags: unknown[];
  steps: unknown[];
  ingredients: unknown[];
  canonicalKey: string;
  sourceContentHash: string | null;
  servingSize: number | null;
  prepTime: number | null;
  cuisine: string | null;
  mealTypes: unknown[];
  requiredKitchenware: unknown[];
  optionalKitchenware: unknown[];
  sourceUrl: string | null;
  dataLicense: string | null;
  sourceRevision: string | null;
  sourceAttribution: string | null;
  requirements: RequirementWrite[];
  duplicates: DuplicateWrite[];
};

export type AuditContext = {
  adminUserId: number;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type AdminAudit = AuditContext & {
  action: string;
  resourceId: number;
  summary: string;
  details?: Record<string, unknown>;
};

export type CoverageData = {
  byCategory: Row[];
  byDifficulty: Row[];
  byTime: Row[];
  sources: Row[];
  qualityFailures: Row[];
  duplicates: Row[];
  baselines: Row[];
};
