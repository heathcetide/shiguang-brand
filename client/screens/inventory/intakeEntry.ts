import { inventoryBulkIntakeSchema, inventoryFieldEvidenceSchema, type InventoryBulkIntakeData } from "@dietdigidose/contracts";
import { z } from "zod";
import { parseStructuredQuantity } from "@/utils/structuredQuantity";
import { parseDateKey } from "@/utils/date";
import type { DetectedFood, StorageLocation } from "./types";
import { inferIngredientDefaults, inferCategoryByName } from "@/utils/ingredientRules";

// Drafts retain structured provenance only, never free-text evidence notes.
const draftFieldEvidence = inventoryFieldEvidenceSchema.shape.food_name.unwrap().omit({ note: true });
const draftEvidenceSchema = z.object({
  food_name: draftFieldEvidence.optional(), quantity: draftFieldEvidence.optional(),
  storage_location: draftFieldEvidence.optional(), expiration_date: draftFieldEvidence.optional(),
}).strict();
export const intakeEntrySchema = z.object({
  foodName: z.string().max(100), quantity: z.string().max(40), category: z.string().max(40),
  storageLocation: z.enum(["冷藏", "冷冻", "常温"]), expirationDate: z.string().max(10), imageUrl: z.string(),
  fieldEvidence: draftEvidenceSchema.optional(),
});
export type IntakeEntry = z.infer<typeof intakeEntrySchema>;
export const blankIntakeEntry: IntakeEntry = { foodName: "", quantity: "", category: "其他", storageLocation: "冷藏", expirationDate: "", imageUrl: "" };
export const intakeDraftSchema = z.object({ entries: z.array(intakeEntrySchema).max(100), pending: inventoryBulkIntakeSchema.nullable() });
export type IntakeDraft = z.infer<typeof intakeDraftSchema>;

export function quantityFields(value: string) {
  const quantity = value.trim();
  // Approximate phrases must remain unknown to stock arithmetic.
  const parsed = /^\d+(?:\.\d+)?\s*(?:kg|千克|公斤|ml|毫升|[gl克升个枚只片份袋盒瓶罐])$/i.test(quantity) ? parseStructuredQuantity(quantity) : null;
  return { quantity: quantity || "数量未知", quantity_value: parsed?.amount ?? null, quantity_unit: parsed?.unit ?? null };
}

/** Record actual edits; untouched defaults and old drafts remain unattested. */
export function changeManualEntry(entry: IntakeEntry, fields: Partial<IntakeEntry>, source: "user" | "rule" = "user"): IntakeEntry {
  const fieldEvidence = { ...entry.fieldEvidence };
  const evidence = { status: source === "user" ? "known" as const : "estimated" as const, source };
  if (fields.foodName !== undefined) {
    delete fieldEvidence.food_name;
    if (fields.foodName.trim()) fieldEvidence.food_name = { status: "known", source: "user" };
  }
  if (fields.quantity !== undefined) {
    // Absence is operationally different from unknown/estimated quantity evidence.
    delete fieldEvidence.quantity;
    if (source === "user" && quantityFields(fields.quantity).quantity_value != null) fieldEvidence.quantity = evidence;
  }
  if (fields.storageLocation !== undefined) fieldEvidence.storage_location = evidence;
  if (fields.expirationDate !== undefined) {
    delete fieldEvidence.expiration_date;
    if (parseDateKey(fields.expirationDate.trim())) fieldEvidence.expiration_date = evidence;
  }
  return { ...entry, ...fields, fieldEvidence };
}

export function buildIntake(entries: IntakeEntry[], requestKey: string): InventoryBulkIntakeData {
  return inventoryBulkIntakeSchema.parse({ idempotency_key: requestKey, source: "manual", items: entries.map(entry => ({
    food_name: entry.foodName.trim(), category: entry.category || "其他", ...quantityFields(entry.quantity),
    expiration_date: entry.expirationDate.trim(), storage_location: entry.storageLocation,
    image_url: entry.imageUrl || null, confirmed: true, source: "manual",
    ...(entry.fieldEvidence ? { field_evidence: entry.fieldEvidence } : {}),
  })) });
}

/** Local, deliberately limited parsing; no guessed portions or expiry dates. */
export function summarizeInventoryText(text: string): IntakeEntry[] {
  const numberWords: Record<string, string> = { 一: "1", 二: "2", 两: "2", 三: "3", 四: "4", 五: "5", 六: "6", 七: "7", 八: "8", 九: "9", 十: "10", 半: "0.5" };
  return text.trim().replace(/^(?:我家里|家里|冰箱里|我)?(?:还有|有|剩下|剩|买了)\s*/, "").split(/[，,、；;\n和]|以及|还有/).map(part => part.trim().replace(/[。.!！]+$/, "")).filter(Boolean).slice(0, 100).map(part => {
    const normalized = part.replace(/(?<![一二两三四五六七八九十百])([一二两三四五六七八九十半])(?=\s*(?:公斤|千克|毫升|[克升个枚只份袋盒瓶罐]))/, (_, word: string) => numberWords[word]);
    const match = normalized.match(/\d+(?:\.\d+)?\s*(?:kg|公斤|千克|ml|毫升|[g克l升个枚只份袋盒瓶罐])/i);
    const candidateName = match ? `${normalized.slice(0, match.index)}${normalized.slice(match.index! + match[0].length)}`.trim() : part;
    const certain = match && !/[约多少]|大概|差不多|不到|至少|不确定/.test(part);
    const foodName = (certain ? candidateName : part).trim();
    return { ...blankIntakeEntry, foodName, category: inferCategoryByName(foodName), quantity: certain ? match[0] : "" };
  });
}

/** Confirmed review fields are persisted as one exact, replayable request. */
export function buildRecognitionIntake(foods: DetectedFood[], batchKey: string, source: "barcode" | "receipt" | "image", jobId: string | null): InventoryBulkIntakeData {
  const selected = foods.filter(item => item.selected);
  if (!selected.length) throw new Error("请至少选择一项需要入库的食材");
  if (selected.some(item => !item.foodName.trim() || !["冷藏", "冷冻", "常温"].includes(item.suggestedStorageLocation))) {
    throw new Error("请补全名称并选择存放位置；数量和到期日期可以留空");
  }
  return inventoryBulkIntakeSchema.parse({ idempotency_key: batchKey, source: jobId ? "image" : source, source_reference: jobId,
    items: selected.map(item => ({ food_name: item.foodName, category: inferIngredientDefaults(item.foodName, item.suggestedStorageLocation as StorageLocation).category,
      ...quantityFields(item.quantity), expiration_date: item.expirationDate || "", storage_location: item.suggestedStorageLocation,
      image_url: null, ...(jobId ? { source_item_id: item.id } : {}), field_evidence: item.fieldEvidence,
      confidence: item.confidence ?? null, confirmed: true, source: jobId ? "image" : item.source || source, barcode: item.barcode ?? null })) });
}
