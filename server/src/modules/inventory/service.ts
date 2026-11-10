import { currentDateKey } from "../../utils/date.js";
import { getAgentRunRow, toAgentRunSummary } from "../../services/agent/repository.js";
import { classifyScanAcceptance } from "./scanAcceptance.js";
import {
  inventorySavedEvidenceSchema,
  inventoryBulkIntakeResponseSchema,
  inventoryConsumptionPreviewResponseSchema,
  inventoryConsumptionResponseSchema,
  inventoryDeleteResponseSchema,
  inventoryHistoryResponseSchema,
  inventoryImportResponseSchema,
  inventoryItemSchema,
  inventoryListResponseSchema,
  type InventoryUnit,
} from "@dietdigidose/contracts";
import {
  buildFefoConsumptionPreviewFromCandidates,
  InventoryQuantityError,
} from "../../services/inventoryQuantity.js";
import { recordFunnelEvent } from "../../services/funnelEvents.js";
import { InventoryDomainError, type InventoryDomainErrorCode } from "./errors.js";
import type { InventoryRepository } from "./repository.js";
import type {
  InventoryBulkIntakeData,
  InventoryConsumptionData,
  InventoryConsumptionPreviewData,
  InventoryCreateData,
  InventoryImportData,
  InventoryUpdateData,
} from "./types.js";

export class InventoryService {
  private readonly repository: InventoryRepository;

  constructor(repository: InventoryRepository) { this.repository = repository; }

  async reviewScan(userId: number, jobId: string) {
    const row = await getAgentRunRow(jobId, userId);
    if (!row || row.modality !== "inventory_scan") throw new InventoryDomainError("INVENTORY_NOT_FOUND", "识别任务不存在或无权访问");
    const run = toAgentRunSummary(row);
    if (run.status !== "completed") throw new InventoryDomainError("INVENTORY_CONFLICT", "识别尚未完成，请稍后重试");
    const vision = run.artifacts.find(artifact => artifact.type === "vision")?.data as { items?: unknown } | undefined;
    const inventory = await this.repository.list(userId);
    return { jobId, items: classifyScanAcceptance(jobId, vision?.items, inventory.filter(item => item.is_available).map(item => item.food_name)) };
  }

  async undoScan(userId: number, jobId: string) {
    await this.reviewScan(userId, jobId);
    return this.repository.undoScan(userId, jobId);
  }

  async acceptScan(userId: number, jobId: string) {
    const review = await this.reviewScan(userId, jobId);
    const candidates = review.items.filter(item => item.acceptance === "automatic");
    const response = await this.repository.bulkIntake(userId, {
      idempotency_key: `automatic-scan:${jobId}`, source: "image", source_reference: jobId,
      items: candidates.map(item => ({ food_name: item.foodName, category: "其他", quantity: item.quantity,
        expiration_date: "", storage_location: item.suggestedStorageLocation as "冷藏" | "冷冻" | "常温",
        confirmed: false, source: "image", source_item_id: item.sourceItemId, confidence: item.confidence,
        field_evidence: { ...item.fieldEvidence, expiration_date: { status: "unknown", source: "unknown" } },
      })),
    }, "inventory-scan-v1");
    const saved = await this.repository.savedScanItems(userId, jobId);
    const undone = new Set(await this.repository.undoneScanItemIds(userId, jobId));
    return { ...response, items: [...saved.values()].filter(item => !undone.has(item.id)), jobId, savedSourceItemIds: [...saved.keys()],
      undoneSourceItemIds: [...saved].filter(([,item]) => undone.has(item.id)).map(([sourceId]) => sourceId) };
  }

  async list(userId: number) {
    return inventoryListResponseSchema.parse(await this.repository.list(userId));
  }

  async create(userId: number, input: InventoryCreateData) {
    const item = inventoryItemSchema.parse(await this.repository.create(userId, input));
    await this.recordAdded(userId);
    return item;
  }

  async importShoppingList(userId: number, input: InventoryImportData) {
    const response = inventoryImportResponseSchema.parse(await this.repository.importShoppingList(userId, input));
    if (!response.repeated && response.items.length > 0) await this.recordAdded(userId);
    return response;
  }

  async bulkIntake(userId: number, input: InventoryBulkIntakeData) {
    const response = inventoryBulkIntakeResponseSchema.parse(await this.repository.bulkIntake(userId, input));
    if (!response.repeated && response.items.length > 0) await this.recordAdded(userId);
    return response;
  }

  async previewConsumption(userId: number, input: InventoryConsumptionPreviewData) {
    const candidates = await this.repository.listPreviewCandidates(userId);
    return inventoryConsumptionPreviewResponseSchema.parse({
      items: buildFefoConsumptionPreviewFromCandidates(candidates, input.items, currentDateKey()),
    });
  }

  async consume(userId: number, input: InventoryConsumptionData) {
    try {
      return inventoryConsumptionResponseSchema.parse(await this.repository.consume(userId, input));
    } catch (error) {
      if (error instanceof InventoryQuantityError) {
        throw new InventoryDomainError(error.code as InventoryDomainErrorCode, error.message);
      }
      throw error;
    }
  }

  async evidence(userId: number, itemId: number) {
    const result = await this.repository.evidence(userId, itemId);
    if (!result) throw new InventoryDomainError("INVENTORY_NOT_FOUND", "食材不存在或无权查看");
    return inventorySavedEvidenceSchema.parse(result);
  }

  async history(userId: number, itemId: number) {
    const history = await this.repository.history(userId, itemId);
    if (!history) throw new InventoryDomainError("INVENTORY_NOT_FOUND", "食材不存在或无权查看");
    return inventoryHistoryResponseSchema.parse(history);
  }

  async update(userId: number, itemId: number, patch: InventoryUpdateData) {
    const item = await this.repository.findOwned(userId, itemId);
    if (!item) throw new InventoryDomainError("INVENTORY_NOT_FOUND", "食材不存在或无权修改");

    const has = (key: keyof InventoryUpdateData) => Object.prototype.hasOwnProperty.call(patch, key);
    const nextQuantityValue = has("quantity_value") ? patch.quantity_value ?? null : item.quantity_value ?? null;
    const nextQuantityUnit = has("quantity_unit") ? patch.quantity_unit ?? null : item.quantity_unit ?? null;
    if ((nextQuantityValue == null) !== (nextQuantityUnit == null)) {
      throw new InventoryDomainError("INVALID_STRUCTURED_QUANTITY", "结构化数量和单位必须同时填写");
    }
    if (patch.version !== undefined && item.version !== patch.version) {
      throw new InventoryDomainError("INVENTORY_VERSION_CONFLICT", "库存已在其他设备更新，请刷新后重试");
    }

    const result = await this.repository.update(userId, itemId, item.version, {
      patch,
      nextQuantityValue,
      nextQuantityUnit: nextQuantityUnit as InventoryUnit | null,
    });
    if (result.kind === "conflict") {
      throw new InventoryDomainError("INVENTORY_VERSION_CONFLICT", "库存已变化，请刷新后重试");
    }
    return inventoryItemSchema.parse(result.item);
  }

  async remove(userId: number, itemId: number) {
    const item = await this.repository.findOwned(userId, itemId);
    if (!item) throw new InventoryDomainError("INVENTORY_NOT_FOUND", "未找到相关食材");
    const result = await this.repository.remove(userId, item);
    if (result.kind === "not_found") throw new InventoryDomainError("INVENTORY_NOT_FOUND", "未找到相关食材");
    return inventoryDeleteResponseSchema.parse({ message: "删除成功" });
  }

  private recordAdded(userId: number) {
    return recordFunnelEvent(userId, "inventory_added", (eventName, actorHash) => this.repository.recordFunnelEvent(eventName, actorHash));
  }
}
