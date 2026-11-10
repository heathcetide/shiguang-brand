import { inventoryFieldEvidenceSchema } from "./inventoryScan.ts";
import { z } from "zod";

const trimmedString = (min: number, max: number, label: string) =>
  z.string().trim().min(min, `${label}不能为空`).max(max, `${label}不能超过 ${max} 个字符`);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式必须为 YYYY-MM-DD").refine(
  (value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)),
  "日期无效",
);

export const inventoryUnits = ["g", "kg", "ml", "l", "piece", "serving", "bag", "box", "bottle", "can"] as const;
export const inventoryUnitSchema = z.enum(inventoryUnits);
export const inventoryStorageLocationSchema = z.enum(["冷藏", "冷冻", "常温"]);

const optionalImage = z.string().trim().max(4_000_000, "图片过大").nullable().optional();

const inventoryCreateObject = z.object({
  food_name: trimmedString(1, 100, "食材名称"),
  category: trimmedString(1, 40, "分类"),
  quantity: trimmedString(1, 40, "数量").default("1份"),
  // Empty explicitly means unknown; no synthetic expiry date is stored.
  expiration_date: z.union([isoDate, z.literal("")]),
  storage_location: inventoryStorageLocationSchema.default("冷藏"),
  image_url: optionalImage,
  quantity_value: z.number().finite().positive().max(1_000_000).nullable().optional(),
  quantity_unit: inventoryUnitSchema.nullable().optional(),
  package_size_value: z.number().finite().positive().max(1_000_000).nullable().optional(),
  package_size_unit: inventoryUnitSchema.nullable().optional(),
  batch_code: z.string().trim().max(80).nullable().optional(),
}).strict();

function validateQuantityPairs(
  value: {
    quantity_value?: number | null;
    quantity_unit?: z.infer<typeof inventoryUnitSchema> | null;
    package_size_value?: number | null;
    package_size_unit?: z.infer<typeof inventoryUnitSchema> | null;
  },
  context: z.RefinementCtx,
) {
  if ((value.quantity_value == null) !== (value.quantity_unit == null)) {
    context.addIssue({ code: "custom", path: ["quantity_unit"], message: "结构化数量和单位必须同时填写" });
  }
  if ((value.package_size_value == null) !== (value.package_size_unit == null)) {
    context.addIssue({ code: "custom", path: ["package_size_unit"], message: "包装规格数值和单位必须同时填写" });
  }
}

export const inventoryCreateSchema = inventoryCreateObject.superRefine(validateQuantityPairs);

export const inventoryUpdateSchema = inventoryCreateObject.partial().extend({
  quantity: trimmedString(1, 40, "数量").optional(),
  storage_location: inventoryStorageLocationSchema.optional(),
  is_available: z.boolean().optional(),
  version: z.number().int().positive().optional(),
}).strict()
  .refine((value) => Object.keys(value).length > 0, "至少提供一个需要更新的字段");

export const inventoryItemSchema = z.object({
  id: z.number().int().positive(),
  food_name: z.string(),
  category: z.string(),
  quantity: z.string(),
  // Empty explicitly means unknown; no synthetic expiry date is stored.
  expiration_date: z.union([isoDate, z.literal("")]),
  storage_location: inventoryStorageLocationSchema,
  image_url: z.string().nullable(),
  is_available: z.boolean(),
  quantity_value: z.number().nullable().optional(),
  quantity_unit: inventoryUnitSchema.nullable().optional(),
  package_size_value: z.number().nullable().optional(),
  package_size_unit: inventoryUnitSchema.nullable().optional(),
  batch_code: z.string().nullable().optional(),
  version: z.number().int().positive(),
  updated_at: z.string().optional(),
  scope: z.enum(["personal", "shared"]).optional(),
});

export const inventoryListResponseSchema = z.array(inventoryItemSchema);

export const inventoryConsumptionItemSchema = z.object({
  item_id: z.number().int().positive(),
  version: z.number().int().positive(),
  mode: z.enum(["amount", "all"]),
  amount_value: z.number().finite().positive().max(1_000_000).optional(),
  unit: inventoryUnitSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.mode === "amount" && (value.amount_value === undefined || value.unit === undefined)) {
    context.addIssue({ code: "custom", path: ["amount_value"], message: "部分扣减需要填写数量和单位" });
  }
});

export const inventoryConsumptionSchema = z.object({
  idempotency_key: z.string().trim().min(16).max(200),
  source: z.enum(["manual", "cooking", "ai"]).default("manual"),
  items: z.array(inventoryConsumptionItemSchema).min(1).max(100),
}).strict().superRefine((value, context) => {
  if (new Set(value.items.map((item) => item.item_id)).size !== value.items.length) {
    context.addIssue({ code: "custom", path: ["items"], message: "同一库存批次不能重复扣减" });
  }
});

export const inventoryConsumptionPreviewSchema = z.object({
  items: z.array(z.object({
    food_name: trimmedString(1, 100, "食材名称"),
    amount_value: z.number().finite().positive().max(1_000_000),
    unit: inventoryUnitSchema,
  }).strict()).min(1).max(100),
}).strict();

export const shoppingInventoryImportSchema = z.object({
  idempotency_key: z.string().trim().min(16, "幂等键格式无效").max(200, "幂等键过长"),
  items: z.array(inventoryCreateSchema).min(1, "至少选择一项食材").max(100),
  shopping_items: z.array(z.object({
    id: z.string().uuid(),
    version: z.number().int().positive(),
  }).strict()).min(1).max(100).optional(),
}).strict().superRefine((value, context) => {
  if (!value.shopping_items) return;
  if (value.shopping_items.length !== value.items.length) {
    context.addIssue({ code: "custom", path: ["shopping_items"], message: "采购项与入库食材数量必须一致" });
  }
  if (new Set(value.shopping_items.map((item) => item.id)).size !== value.shopping_items.length) {
    context.addIssue({ code: "custom", path: ["shopping_items"], message: "同一采购项不能重复入库" });
  }
});

const inventoryIntakeItemSchema = inventoryCreateObject.extend({
  field_evidence: inventoryFieldEvidenceSchema.optional(),
  source_item_id: z.string().trim().min(1).max(200).optional(),
  confidence: z.number().finite().min(0).max(1).nullable().optional(),
  confirmed: z.boolean(),
  source: z.enum(["barcode", "receipt", "image", "manual", "recent"]),
  barcode: z.string().trim().max(64).nullable().optional(),
}).strict().superRefine(validateQuantityPairs);

export const inventoryBulkIntakeSchema = z.object({
  idempotency_key: z.string().trim().min(16).max(200),
  source: z.enum(["barcode", "receipt", "image", "manual", "recent"]),
  source_reference: z.string().trim().max(200).nullable().optional(),
  items: z.array(inventoryIntakeItemSchema).min(1).max(100),
}).strict().superRefine((value, context) => {
  const identities = new Set<string>();
  value.items.forEach((item, index) => {
    if (item.source_item_id) {
      if (!value.source_reference || identities.has(item.source_item_id)) {
        context.addIssue({ code: "custom", path: ["items", index, "source_item_id"], message: "项目标识需要来源引用且同批不可重复" });
      }
      identities.add(item.source_item_id);
    }
    if (!item.confirmed) {
      context.addIssue({ code: "custom", path: ["items", index, "confirmed"], message: "每项都必须由用户确认后才能入库" });
    }
  });
});

export const inventoryImportResponseSchema = z.object({
  items: inventoryListResponseSchema,
  repeated: z.boolean(),
}).strict();

export const inventoryBulkIntakeResponseSchema = z.object({
  batch_id: z.string().uuid(),
  items: inventoryListResponseSchema,
  repeated: z.boolean(),
}).strict();

const inventoryPreviewDeductionSchema = z.object({
  item_id: z.number().int().positive(),
  version: z.number().int().positive(),
  food_name: z.string(),
  expiration_date: z.string(),
  batch_code: z.string().nullable(),
  mode: z.enum(["amount", "all"]),
  amount_value: z.number().nonnegative(),
  unit: inventoryUnitSchema,
}).strict();

export const inventoryConsumptionPreviewResponseSchema = z.object({
  items: z.array(z.object({
    food_name: z.string(),
    requested_value: z.number().nonnegative(),
    unit: inventoryUnitSchema,
    covered_value: z.number().nonnegative(),
    missing_value: z.number().nonnegative(),
    fully_covered: z.boolean(),
    name_available: z.boolean().optional(),
    quantity_status: z.enum(["sufficient", "insufficient", "unknown", "unavailable"]).optional(),
    deductions: z.array(inventoryPreviewDeductionSchema),
  }).strict()),
}).strict();

const inventoryConsumptionChangeSchema = z.object({
  item_id: z.number().int().positive(),
  quantity_before: z.number().nullable(),
  quantity_after: z.number().nullable(),
  quantity_unit: inventoryUnitSchema.nullable(),
  consumed_value: z.number().nullable(),
  is_available: z.boolean(),
  version: z.number().int().positive(),
}).strict();

export const inventoryConsumptionResponseSchema = z.object({
  changes: z.array(inventoryConsumptionChangeSchema),
  items: inventoryListResponseSchema,
  repeated: z.boolean(),
}).strict();

export const inventoryHistoryItemSchema = z.object({
  id: z.number().int().positive(),
  action: z.string(),
  source: z.string(),
  quantity_before: z.number().nullable(),
  quantity_after: z.number().nullable(),
  quantity_unit: inventoryUnitSchema.nullable(),
  delta_value: z.number().nullable(),
  created_at: z.string(),
  metadata: z.record(z.string(), z.unknown()),
}).strict();

export const inventoryHistoryResponseSchema = z.array(inventoryHistoryItemSchema);

export const inventoryDeleteResponseSchema = z.object({ message: z.string() }).strict();

export type InventoryUnit = z.infer<typeof inventoryUnitSchema>;
export type InventoryItem = z.infer<typeof inventoryItemSchema>;
export type InventoryCreateInput = z.input<typeof inventoryCreateSchema>;
export type InventoryUpdateInput = z.input<typeof inventoryUpdateSchema>;
export type InventoryBulkIntakeInput = z.input<typeof inventoryBulkIntakeSchema>;
export type InventoryConsumptionInput = z.input<typeof inventoryConsumptionSchema>;
export type InventoryConsumptionPreviewInput = z.input<typeof inventoryConsumptionPreviewSchema>;
export type InventoryCreateData = z.output<typeof inventoryCreateSchema>;
export type InventoryUpdateData = z.output<typeof inventoryUpdateSchema>;
export type InventoryBulkIntakeData = z.output<typeof inventoryBulkIntakeSchema>;
export type InventoryConsumptionData = z.output<typeof inventoryConsumptionSchema>;
export type InventoryConsumptionPreviewData = z.output<typeof inventoryConsumptionPreviewSchema>;
export type InventoryImportData = z.output<typeof shoppingInventoryImportSchema>;
export type InventoryImportResponse = z.infer<typeof inventoryImportResponseSchema>;
export type InventoryBulkIntakeResponse = z.infer<typeof inventoryBulkIntakeResponseSchema>;
export type InventoryConsumptionPreviewResponse = z.infer<typeof inventoryConsumptionPreviewResponseSchema>;
export type InventoryConsumptionResponse = z.infer<typeof inventoryConsumptionResponseSchema>;
export type InventoryHistoryItem = z.infer<typeof inventoryHistoryItemSchema>;
