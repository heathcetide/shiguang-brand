import { z } from "zod";
const fieldEvidence = z.object({
  status: z.enum(["known", "estimated", "unknown"]),
  source: z.enum(["user", "recognition", "barcode", "rule", "unknown"]),
  note: z.string().trim().max(200).optional(),
}).strict();
export const inventoryFieldEvidenceSchema = z.object({
  food_name: fieldEvidence.optional(), quantity: fieldEvidence.optional(),
  storage_location: fieldEvidence.optional(), expiration_date: fieldEvidence.optional(),
}).strict();
export type InventoryFieldEvidence = z.infer<typeof inventoryFieldEvidenceSchema>;
export { normalizeInventoryScanItems } from "./scanNormalization.ts";

/** Saved evidence is deliberately separate from inventory/offline list payloads. */
export const inventorySavedEvidenceSchema = z.object({
  item_id: z.number().int().positive(),
  inventory_version: z.number().int().positive(),
  field_evidence: inventoryFieldEvidenceSchema,
}).strict();
export type InventorySavedEvidence = z.infer<typeof inventorySavedEvidenceSchema>;
