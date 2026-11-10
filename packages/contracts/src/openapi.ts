import { inventorySavedEvidenceSchema } from "./inventoryScan.ts";
import { z } from "zod";
import { apiErrorSchema } from "./common.ts";
import {
  inventoryBulkIntakeResponseSchema,
  inventoryBulkIntakeSchema,
  inventoryConsumptionPreviewResponseSchema,
  inventoryConsumptionPreviewSchema,
  inventoryConsumptionResponseSchema,
  inventoryConsumptionSchema,
  inventoryCreateSchema,
  inventoryDeleteResponseSchema,
  inventoryHistoryResponseSchema,
  inventoryImportResponseSchema,
  inventoryItemSchema,
  inventoryListResponseSchema,
  inventoryUpdateSchema,
  shoppingInventoryImportSchema,
} from "./inventory.ts";

const schemas = {
  ApiError: apiErrorSchema,
  InventoryItem: inventoryItemSchema,
  InventoryListResponse: inventoryListResponseSchema,
  InventoryCreateRequest: inventoryCreateSchema,
  InventoryUpdateRequest: inventoryUpdateSchema,
  InventoryImportRequest: shoppingInventoryImportSchema,
  InventoryImportResponse: inventoryImportResponseSchema,
  InventoryBulkIntakeRequest: inventoryBulkIntakeSchema,
  InventoryBulkIntakeResponse: inventoryBulkIntakeResponseSchema,
  InventoryConsumptionPreviewRequest: inventoryConsumptionPreviewSchema,
  InventoryConsumptionPreviewResponse: inventoryConsumptionPreviewResponseSchema,
  InventoryConsumptionRequest: inventoryConsumptionSchema,
  InventoryConsumptionResponse: inventoryConsumptionResponseSchema,
  InventoryHistoryResponse: inventoryHistoryResponseSchema,
  InventorySavedEvidence: inventorySavedEvidenceSchema,
  InventoryDeleteResponse: inventoryDeleteResponseSchema,
};

const ref = (name: keyof typeof schemas) => ({ $ref: `#/components/schemas/${name}` });
const jsonContent = (name: keyof typeof schemas) => ({ "application/json": { schema: ref(name) } });
const requestBody = (name: keyof typeof schemas) => ({ required: true, content: jsonContent(name) });
const response = (description: string, name: keyof typeof schemas) => ({ description, content: jsonContent(name) });
const errors = {
  "400": response("Invalid request", "ApiError"),
  "401": response("Authentication required", "ApiError"),
  "409": response("Version or inventory conflict", "ApiError"),
};

export function createInventoryOpenApiDocument() {
  return {
    openapi: "3.1.0",
    info: {
      title: "DietDigiDose Inventory API",
      version: "1.0.0",
      description: "Versioned pilot contract for the personal inventory vertical.",
    },
    security: [{ bearerAuth: [] }],
    paths: {
      "/api/v1/inventory": {
        get: { operationId: "listInventory", responses: { "200": response("Inventory items", "InventoryListResponse"), "401": errors["401"] } },
        post: { operationId: "createInventoryItem", requestBody: requestBody("InventoryCreateRequest"), responses: { "201": response("Created inventory item", "InventoryItem"), ...errors } },
      },
      "/api/v1/inventory/{id}": {
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer", minimum: 1 } }],
        put: { operationId: "updateInventoryItem", requestBody: requestBody("InventoryUpdateRequest"), responses: { "200": response("Updated inventory item", "InventoryItem"), ...errors, "404": response("Inventory item not found", "ApiError") } },
        delete: { operationId: "deleteInventoryItem", responses: { "200": response("Deleted inventory item", "InventoryDeleteResponse"), "401": errors["401"], "404": response("Inventory item not found", "ApiError") } },
      },
      "/api/v1/inventory/import-shopping-list": {
        post: { operationId: "importShoppingListInventory", requestBody: requestBody("InventoryImportRequest"), responses: { "200": response("Repeated import", "InventoryImportResponse"), "201": response("Imported inventory", "InventoryImportResponse"), ...errors } },
      },
      "/api/v1/inventory/bulk-intake": {
        post: { operationId: "bulkIntakeInventory", requestBody: requestBody("InventoryBulkIntakeRequest"), responses: { "200": response("Repeated intake", "InventoryBulkIntakeResponse"), "201": response("Created intake", "InventoryBulkIntakeResponse"), ...errors } },
      },
      "/api/v1/inventory/consumption-preview": {
        post: { operationId: "previewInventoryConsumption", requestBody: requestBody("InventoryConsumptionPreviewRequest"), responses: { "200": response("FEFO consumption preview", "InventoryConsumptionPreviewResponse"), ...errors } },
      },
      "/api/v1/inventory/consume": {
        post: { operationId: "consumeInventory", requestBody: requestBody("InventoryConsumptionRequest"), responses: { "200": response("Repeated consumption", "InventoryConsumptionResponse"), "201": response("Applied consumption", "InventoryConsumptionResponse"), ...errors } },
      },
      "/api/v1/inventory/{id}/evidence": {
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer", minimum: 1 } }],
        get: { operationId: "getInventoryEvidence", responses: { "200": response("Saved field evidence", "InventorySavedEvidence"), "401": errors["401"], "404": response("Inventory item not found", "ApiError") } },
      },
      "/api/v1/inventory/{id}/history": {
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer", minimum: 1 } }],
        get: { operationId: "getInventoryHistory", responses: { "200": response("Inventory change history", "InventoryHistoryResponse"), "401": errors["401"], "404": response("Inventory item not found", "ApiError") } },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
      schemas: Object.fromEntries(Object.entries(schemas).map(([name, schema]) => [
        name,
        z.toJSONSchema(schema, { target: "draft-2020-12", unrepresentable: "any" }),
      ])),
    },
  };
}
