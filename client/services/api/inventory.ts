import { requestJson, type ApiFetch } from "./client";
import type {
  InventoryBulkIntakeInput,
  InventoryConsumptionInput,
  InventoryConsumptionPreviewInput,
  InventoryCreateInput,
  InventoryImportData,
  InventoryUpdateInput,
} from "@dietdigidose/contracts";

export type InventoryInput = InventoryCreateInput;
const loadInventoryContracts = () => import("@dietdigidose/contracts");

export const inventoryApi = {
  undoScan: async (apiFetch: ApiFetch, jobId: string) => requestJson(apiFetch,
    `/api/v1/inventory/scan-jobs/${encodeURIComponent(jobId)}/undo`, { method: "POST" },
    (await import("zod")).z.object({ undone: (await import("zod")).z.number().int().nonnegative(), repeated: (await import("zod")).z.boolean() })),
  acceptScan: async (apiFetch: ApiFetch, jobId: string) => {
    const { inventoryBulkIntakeResponseSchema } = await loadInventoryContracts();
    return requestJson(apiFetch, `/api/v1/inventory/scan-jobs/${encodeURIComponent(jobId)}/accept`, { method: "POST" },
      inventoryBulkIntakeResponseSchema.extend({ jobId: (await import("zod")).z.string(), savedSourceItemIds: (await import("zod")).z.array((await import("zod")).z.string()), undoneSourceItemIds: (await import("zod")).z.array((await import("zod")).z.string()) }));
  },
  evidence: async (apiFetch: ApiFetch, id: number) => {
    const { inventorySavedEvidenceSchema } = await loadInventoryContracts();
    return requestJson(apiFetch, `/api/v1/inventory/${id}/evidence`, { cache: "no-store" }, inventorySavedEvidenceSchema);
  },
  list: async (apiFetch: ApiFetch, fresh = false) => {
    const { inventoryListResponseSchema } = await loadInventoryContracts();
    return requestJson(apiFetch, "/api/v1/inventory", fresh ? { cache: "no-store" } : {}, inventoryListResponseSchema);
  },
  create: async (apiFetch: ApiFetch, input: InventoryInput) => {
    const { inventoryCreateSchema, inventoryItemSchema } = await loadInventoryContracts();
    return requestJson(apiFetch, "/api/v1/inventory", {
      method: "POST", body: JSON.stringify(inventoryCreateSchema.parse(input)),
    }, inventoryItemSchema);
  },
  importShoppingList: async (apiFetch: ApiFetch, idempotencyKey: string, items: InventoryInput[], shoppingItems?: InventoryImportData["shopping_items"]) => {
    const { inventoryImportResponseSchema, shoppingInventoryImportSchema } = await loadInventoryContracts();
    return requestJson(apiFetch, "/api/v1/inventory/import-shopping-list", {
      method: "POST",
      body: JSON.stringify(shoppingInventoryImportSchema.parse({ idempotency_key: idempotencyKey, items, shopping_items: shoppingItems })),
    }, inventoryImportResponseSchema);
  },
  bulkIntake: async (apiFetch: ApiFetch, input: InventoryBulkIntakeInput) => {
    const { inventoryBulkIntakeResponseSchema, inventoryBulkIntakeSchema } = await loadInventoryContracts();
    return requestJson(apiFetch, "/api/v1/inventory/bulk-intake", {
      method: "POST", body: JSON.stringify(inventoryBulkIntakeSchema.parse(input)),
    }, inventoryBulkIntakeResponseSchema);
  },
  update: async (apiFetch: ApiFetch, id: number, input: InventoryUpdateInput) => {
    const { inventoryItemSchema, inventoryUpdateSchema } = await loadInventoryContracts();
    return requestJson(apiFetch, `/api/v1/inventory/${id}`, {
      method: "PUT", body: JSON.stringify(inventoryUpdateSchema.parse(input)),
    }, inventoryItemSchema);
  },
  remove: async (apiFetch: ApiFetch, id: number) => {
    const { inventoryDeleteResponseSchema } = await loadInventoryContracts();
    return requestJson(apiFetch, `/api/v1/inventory/${id}`, { method: "DELETE" }, inventoryDeleteResponseSchema);
  },
  consumptionPreview: async (apiFetch: ApiFetch, items: InventoryConsumptionPreviewInput["items"]) => {
    const { inventoryConsumptionPreviewResponseSchema, inventoryConsumptionPreviewSchema } = await loadInventoryContracts();
    return requestJson(apiFetch, "/api/v1/inventory/consumption-preview", {
      method: "POST", body: JSON.stringify(inventoryConsumptionPreviewSchema.parse({ items })),
    }, inventoryConsumptionPreviewResponseSchema);
  },
  consume: async (apiFetch: ApiFetch, input: InventoryConsumptionInput) => {
    const { inventoryConsumptionResponseSchema, inventoryConsumptionSchema } = await loadInventoryContracts();
    return requestJson(apiFetch, "/api/v1/inventory/consume", {
      method: "POST", body: JSON.stringify(inventoryConsumptionSchema.parse(input)),
    }, inventoryConsumptionResponseSchema);
  },
  history: async (apiFetch: ApiFetch, id: number) => {
    const { inventoryHistoryResponseSchema } = await loadInventoryContracts();
    return requestJson(apiFetch, `/api/v1/inventory/${id}/history`, {}, inventoryHistoryResponseSchema);
  },
};

export const kitchenwareApi = {
  list: <T>(apiFetch: ApiFetch) => requestJson<T[]>(apiFetch, "/api/v1/kitchenware"),
  catalog: <T>(apiFetch: ApiFetch) => requestJson<T[]>(apiFetch, "/api/v1/kitchenware/catalog"),
  create: <T>(apiFetch: ApiFetch, input: unknown) => requestJson<T>(apiFetch, "/api/v1/kitchenware", { method: "POST", body: JSON.stringify(input) }),
  update: <T>(apiFetch: ApiFetch, id: number, input: unknown) => requestJson<T>(apiFetch, `/api/v1/kitchenware/${id}`, { method: "PUT", body: JSON.stringify(input) }),
  maintain: <T>(apiFetch: ApiFetch, id: number) => requestJson<T>(apiFetch, `/api/v1/kitchenware/${id}/maintain`, { method: "POST" }),
  remove: (apiFetch: ApiFetch, id: number) => requestJson<{ success: boolean }>(apiFetch, `/api/v1/kitchenware/${id}`, { method: "DELETE" }),
};
