import type {
  AdminAudit, AliasResult, Coverage, IngredientInput, IngredientUpdateInput, IngredientQuery, MergeResult, ReviewResult, Row,
} from "./types.js";

export interface AdminFoodAssetsRepository {
  listIngredients(input: IngredientQuery): Promise<{ items: Row[]; total: number }>;
  createIngredient(input: IngredientInput, audit: AdminAudit): Promise<number>;
  updateIngredient(id: number, input: IngredientUpdateInput, audit: AdminAudit): Promise<boolean>;
  removeIngredient(id: number, audit: AdminAudit): Promise<boolean>;
  addAlias(id: number, alias: string, normalized: string, audit: AdminAudit): Promise<AliasResult>;
  mergeIngredient(sourceId: number, targetId: number, audit: AdminAudit): Promise<MergeResult>;
  coverage(): Promise<Coverage>;
  pendingCustomFoods(): Promise<Row[]>;
  approveCustomFood(id: number, audit: AdminAudit): Promise<ReviewResult>;
  rejectCustomFood(id: number, audit: AdminAudit): Promise<ReviewResult>;
}
