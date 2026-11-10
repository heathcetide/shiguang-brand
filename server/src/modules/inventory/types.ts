import type {
  InventoryBulkIntakeData,
  InventoryBulkIntakeResponse,
  InventoryConsumptionData,
  InventoryConsumptionPreviewData,
  InventoryConsumptionPreviewResponse,
  InventoryConsumptionResponse,
  InventoryCreateData,
  InventoryHistoryItem,
  InventoryImportData,
  InventoryImportResponse,
  InventoryItem,
  InventoryUnit,
  InventoryUpdateData,
} from "@dietdigidose/contracts";

export type {
  InventoryBulkIntakeData,
  InventoryBulkIntakeResponse,
  InventoryConsumptionData,
  InventoryConsumptionPreviewData,
  InventoryConsumptionPreviewResponse,
  InventoryConsumptionResponse,
  InventoryCreateData,
  InventoryHistoryItem,
  InventoryImportData,
  InventoryImportResponse,
  InventoryItem,
  InventoryUnit,
  InventoryUpdateData,
};

export type InventoryPreviewCandidate = {
  quantity_evidence_status?: "known" | "estimated" | "unknown";
  id: number;
  food_name: string;
  quantity_value: number | null;
  quantity_unit: InventoryUnit | null;
  expiration_date: string;
  batch_code: string | null;
  version: number;
};

export type InventoryUpdatePersistence = {
  patch: InventoryUpdateData;
  nextQuantityValue: number | null;
  nextQuantityUnit: InventoryUnit | null;
};

export type InventoryUpdateResult =
  | { kind: "updated"; item: InventoryItem }
  | { kind: "conflict" };

export type InventoryRemoveResult =
  | { kind: "removed" }
  | { kind: "not_found" };
