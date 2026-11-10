import { savedInventoryEvidence, editedInventoryEvidence, SAVED_EVIDENCE_LOG_LIMIT } from "./savedEvidence.js";
import { appendSqliteMaintenanceEvent } from "../planMaintenance/sqliteEventWriter.js";
import { InventoryDomainError } from "./errors.js";
import { quantityEvidenceStatus, nextQuantityEvidence } from "./evidence.js";
import { savedIntakeItems } from "./intakeIdentity.js";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  inventoryBulkIntakeResponseSchema,
  inventoryConsumptionResponseSchema,
  inventoryHistoryResponseSchema,
  inventoryImportResponseSchema,
  inventoryItemSchema,
  inventoryListResponseSchema,
} from "@dietdigidose/contracts";
import {
  applyInventoryConsumptions,
  type InventoryConsumption,
} from "../../services/inventoryQuantity.js";
import type { InventoryRepository } from "./repository.js";
import type {
  InventoryBulkIntakeData,
  InventoryConsumptionData,
  InventoryCreateData,
  InventoryImportData,
  InventoryItem,
  InventoryPreviewCandidate,
  InventoryUpdatePersistence,
} from "./types.js";

function formatInventoryItem(item: Record<string, unknown>) {
  return inventoryItemSchema.parse({
    ...item,
    is_available: Boolean(item.is_available),
    version: Number(item.version) || 1,
  });
}

export class SqliteInventoryRepository implements InventoryRepository {
  private readonly database: Database.Database;

  constructor(database: Database.Database) {
    this.database = database;
  }

  /** Keep ownership checks shared; history and post-consumption reads also include tombstones. */
  private findOwnedRow(userId: number, itemId: number, options: { includeDeleted?: boolean } = {}) {
    return this.database.prepare(`
      SELECT * FROM inventory_items
      WHERE id = ? AND user_id = ? AND (? = 1 OR deleted_at IS NULL)
    `).get(itemId, userId, options.includeDeleted ? 1 : 0) as Record<string, unknown> | undefined;
  }

  /** Evidence replay uses the same bounded, oldest-first window for reads and edits. */
  private evidenceHistory(userId: number, itemId: number) {
    return this.database.prepare(`
      SELECT action, metadata_json, quantity_after, quantity_unit FROM inventory_change_logs
      WHERE inventory_item_id = ? AND user_id = ? ORDER BY id DESC LIMIT ?
    `).all(itemId, userId, SAVED_EVIDENCE_LOG_LIMIT).reverse() as Array<Record<string, unknown>>;
  }

  async recordFunnelEvent(eventName: string, actorHash: string) {
    this.database.prepare("INSERT INTO funnel_events (event_name,actor_hash) VALUES (?,?)").run(eventName, actorHash);
  }

  private insertInventoryItem(userId: number, item: InventoryCreateData | InventoryBulkIntakeData["items"][number]) {
    const row = this.database.prepare(`
      INSERT INTO inventory_items (
        user_id, food_name, category, quantity, expiration_date, storage_location, image_url,
        is_available, quantity_value, quantity_unit, package_size_value, package_size_unit, batch_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?) RETURNING *
    `).get(
      userId, item.food_name, item.category, item.quantity || "1份", item.expiration_date,
      item.storage_location || "冷藏", item.image_url || null,
      item.quantity_value ?? null, item.quantity_unit ?? null,
      item.package_size_value ?? null, item.package_size_unit ?? null, item.batch_code ?? null,
    ) as Record<string, unknown>;
    appendSqliteMaintenanceEvent(this.database, { userId, kind: "inventory_created", sourceId: String(row.id), subjectId: String(row.id) });
    return row;
  }

  async list(userId: number) {
    const rows = this.database.prepare(`
      SELECT * FROM inventory_items
      WHERE user_id = ? AND deleted_at IS NULL
      ORDER BY CASE WHEN expiration_date = '' THEN 1 ELSE 0 END, expiration_date ASC
    `).all(userId) as Array<Record<string, unknown>>;
    return inventoryListResponseSchema.parse(rows.map(formatInventoryItem));
  }

  async evidence(userId: number, itemId: number) {
    return this.database.transaction(() => {
      const item = this.findOwnedRow(userId, itemId);
      if (!item) return null;
      const logs = this.evidenceHistory(userId, itemId);
      return { item_id: itemId, inventory_version: Number(item.version), field_evidence: savedInventoryEvidence(item, logs) };
    })();
  }

  async findOwned(userId: number, itemId: number) {
    const row = this.findOwnedRow(userId, itemId);
    return row ? formatInventoryItem(row) : null;
  }

  async create(userId: number, input: InventoryCreateData) {
    return this.createInTransaction(userId, input);
  }

  /** Synchronous entry point for an enclosing business transaction. */
  createInTransaction(userId: number, input: InventoryCreateData, source: "manual" | "ai" = "manual") {
    return this.database.transaction(() => {
      const newItem = this.insertInventoryItem(userId, input);
      this.database.prepare(`
        INSERT INTO inventory_change_logs
          (user_id, inventory_item_id, action, source, quantity_before, quantity_after, quantity_unit, delta_value, idempotency_key)
        VALUES (?, ?, 'created', ?, NULL, ?, ?, ?, ?)
      `).run(
        userId, newItem.id, source, newItem.quantity_value ?? null, newItem.quantity_unit ?? null,
        newItem.quantity_value ?? null, `create:${newItem.id}`,
      );
      return formatInventoryItem(newItem);
    })();
  }

  async importShoppingList(userId: number, input: InventoryImportData) {
    return this.database.transaction(() => {
      const existing = this.database.prepare(`
        SELECT result_json FROM shopping_inventory_imports WHERE user_id = ? AND idempotency_key = ?
      `).get(userId, input.idempotency_key) as { result_json: string } | undefined;
      if (existing) {
        return inventoryImportResponseSchema.parse({ items: JSON.parse(existing.result_json), repeated: true });
      }

      // Claim the purchased rows inside the inventory transaction. A new request
      // key after an app restart must not import the same shopping rows again.
      for (const item of input.shopping_items || []) {
        const result = this.database.prepare(`
          UPDATE shopping_list_items SET deleted_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP, version = version + 1
          WHERE id = ? AND user_id = ? AND version = ? AND checked = 1 AND deleted_at IS NULL
        `).run(item.id, userId, item.version);
        if (result.changes !== 1) {
          throw new InventoryDomainError("SHOPPING_ITEM_CONFLICT", "采购项已变更或已入库，请刷新清单后重试。");
        }
      }
      const items = input.items.map((item) => this.createInTransaction(userId, item));
      this.database.prepare(`
        INSERT INTO shopping_inventory_imports (user_id, idempotency_key, result_json) VALUES (?, ?, ?)
      `).run(userId, input.idempotency_key, JSON.stringify(items));
      return inventoryImportResponseSchema.parse({ items, repeated: false });
    })();
  }

  async undoScan(userId: number, jobId: string) {
    return this.database.transaction(() => {
      const saved = savedIntakeItems(this.database.prepare(`SELECT confirmed_payload_json,result_json FROM inventory_intake_batches
        WHERE user_id=? AND source='image' AND source_reference=? ORDER BY created_at,id`).all(userId,jobId) as Array<{ confirmed_payload_json: unknown; result_json: unknown }>);
      let undone = 0;
      for (const item of new Map([...saved.values()].map(item => [item.id,item])).values()) {
        const key = `intake-undo:${jobId}:${item.id}`;
        if (this.database.prepare("SELECT id FROM inventory_change_logs WHERE user_id=? AND idempotency_key=?").get(userId,key)) continue;
        const current = this.database.prepare("SELECT version,deleted_at FROM inventory_items WHERE id=? AND user_id=?").get(item.id,userId) as { version: number; deleted_at: string | null } | undefined;
        if (!current || current.deleted_at || current.version !== item.version) throw new InventoryDomainError("INVENTORY_VERSION_CONFLICT", "部分食材已被消耗或修改，整批未撤销。请到库存查看当前数量后手动纠正。");
        this.database.prepare("UPDATE inventory_items SET deleted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP,version=version+1 WHERE id=? AND user_id=?").run(item.id,userId);
        this.database.prepare(`INSERT INTO inventory_change_logs(user_id,inventory_item_id,action,source,quantity_before,quantity_after,quantity_unit,delta_value,idempotency_key,metadata_json)
          VALUES(?,?,'removed','manual',?,?,?,?,?,?)`).run(userId,item.id,item.quantity_value ?? null,item.quantity_value ?? null,item.quantity_unit ?? null,0,key,JSON.stringify({ intake_undo_job: jobId }));
        appendSqliteMaintenanceEvent(this.database, { userId,kind: "inventory_changed",sourceId: key,subjectId: String(item.id),details: { version: item.version+1,mode: "undo_intake" } });
        undone++;
      }
      return { undone, repeated: undone === 0 };
    })();
  }

  async undoneScanItemIds(userId: number, jobId: string) {
    return (this.database.prepare("SELECT inventory_item_id FROM inventory_change_logs WHERE user_id=? AND json_extract(metadata_json,'$.intake_undo_job')=?").all(userId,jobId) as Array<{ inventory_item_id: number }>).map(row => row.inventory_item_id);
  }

  async savedScanItems(userId: number, jobId: string) {
    return savedIntakeItems(this.database.prepare(`SELECT confirmed_payload_json,result_json FROM inventory_intake_batches
      WHERE user_id=? AND source='image' AND source_reference=? ORDER BY created_at,id`).all(userId,jobId) as Array<{ confirmed_payload_json: unknown; result_json: unknown }>);
  }

  async bulkIntake(userId: number, input: InventoryBulkIntakeData, automaticRule?: string) {
    return this.database.transaction(() => {
      const existing = this.database.prepare(`
        SELECT result_json FROM inventory_intake_batches
        WHERE user_id = ? AND idempotency_key = ?
      `).get(userId, input.idempotency_key) as { result_json: string } | undefined;
      if (existing) {
        return inventoryBulkIntakeResponseSchema.parse({
          ...(JSON.parse(existing.result_json) as Record<string, unknown>),
          repeated: true,
        });
      }

      const previous = input.source_reference ? (this.database.prepare(`SELECT confirmed_payload_json,result_json FROM inventory_intake_batches
        WHERE user_id=? AND source=? AND source_reference=? ORDER BY created_at,id`).all(userId,input.source,input.source_reference) as Array<{ confirmed_payload_json: unknown; result_json: unknown }>) : [];
      const saved = savedIntakeItems(previous);
      const ownedNames = automaticRule ? (this.database.prepare("SELECT food_name FROM inventory_items WHERE user_id=? AND deleted_at IS NULL AND is_available=1").all(userId) as Array<{ food_name: string }>).map(row => row.food_name.trim().toLocaleLowerCase().replace(/\s+/g, "")) : [];
      const acceptedItems = automaticRule ? input.items.filter(item => (item.source_item_id && saved.has(item.source_item_id)) || !ownedNames.includes(item.food_name.trim().toLocaleLowerCase().replace(/\s+/g, ""))) : input.items;

      let added = 0;
      const items = acceptedItems.map(item => {
        const existingItem = item.source_item_id ? saved.get(item.source_item_id) : undefined;
        if (existingItem) return existingItem;
        added += 1;
        const created = formatInventoryItem(this.insertInventoryItem(userId, item));
        this.database.prepare(`INSERT INTO inventory_change_logs
          (user_id,inventory_item_id,action,source,quantity_after,quantity_unit,delta_value,idempotency_key,metadata_json)
          VALUES(?,?,'created',?,?,?,?,?,?)`).run(userId, created.id, input.source === "image" || input.source === "receipt" ? "ai" : "manual",
          created.quantity_value, created.quantity_unit, created.quantity_value, `intake:${created.id}`,
          JSON.stringify({ acceptance: automaticRule ? "automatic" : "manual", acceptance_rule: automaticRule ?? null, inventory_version: created.version, source: item.source, source_reference: input.source_reference ?? null,
            source_item_id: item.source_item_id ?? null, confidence: item.confidence ?? null, field_evidence: item.field_evidence ?? {} }));
        return created;
      });
      const result = inventoryBulkIntakeResponseSchema.parse({ batch_id: randomUUID(), items, repeated: added === 0 });
      this.database.prepare(`
        INSERT INTO inventory_intake_batches
          (id, user_id, idempotency_key, source, source_reference, confirmed_payload_json, result_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        result.batch_id, userId, input.idempotency_key, input.source,
        input.source_reference ?? null, JSON.stringify(acceptedItems.map(item => ({ ...item, acceptance: automaticRule ? "automatic" : "manual", acceptance_rule: automaticRule ?? null }))), JSON.stringify(result),
      );
      return result;
    })();
  }

  async listPreviewCandidates(userId: number): Promise<InventoryPreviewCandidate[]> {
    const rows = this.database.prepare(`
      SELECT id, food_name, quantity_value, quantity_unit, expiration_date, batch_code, version, (SELECT metadata_json FROM inventory_change_logs e WHERE e.inventory_item_id=inventory_items.id AND e.user_id=inventory_items.user_id AND json_extract(e.metadata_json,'$.field_evidence.quantity.status') IS NOT NULL ORDER BY e.id DESC LIMIT 1) AS quantity_evidence
      FROM inventory_items
      WHERE user_id = ? AND is_available = 1 AND deleted_at IS NULL
      ORDER BY CASE WHEN expiration_date = '' THEN 1 ELSE 0 END, expiration_date ASC, id ASC
    `).all(userId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: Number(row.id),
      food_name: String(row.food_name),
      quantity_value: row.quantity_value == null ? null : Number(row.quantity_value),
      quantity_unit: row.quantity_unit as InventoryPreviewCandidate["quantity_unit"],
      expiration_date: String(row.expiration_date),
      batch_code: row.batch_code == null ? null : String(row.batch_code),
      version: Number(row.version),
      quantity_evidence_status: quantityEvidenceStatus(row.quantity_evidence, row.version),
    }));
  }

  async consume(userId: number, input: InventoryConsumptionData) {
    return this.consumeInTransaction(userId, input);
  }

  /** Synchronous entry point for an enclosing business transaction. */
  consumeInTransaction(userId: number, input: InventoryConsumptionData, metadata: Record<string, unknown> = {}) {
    return this.database.transaction(() => {
      const existing = this.database.prepare(`
        SELECT result_json FROM inventory_consumption_requests
        WHERE user_id = ? AND idempotency_key = ?
      `).get(userId, input.idempotency_key) as { result_json: string } | undefined;
      if (existing) {
        return inventoryConsumptionResponseSchema.parse({
          ...(JSON.parse(existing.result_json) as Record<string, unknown>),
          repeated: true,
        });
      }

      const changes = applyInventoryConsumptions(this.database, userId, input.items as InventoryConsumption[], {
        idempotencyKey: input.idempotency_key,
        source: input.source,
        metadata,
      });
      const items = input.items.map((item) => formatInventoryItem(
        this.findOwnedRow(userId, item.item_id, { includeDeleted: true }) as Record<string, unknown>,
      ));
      const response = inventoryConsumptionResponseSchema.parse({ changes, items, repeated: false });
      this.database.prepare(`
        INSERT INTO inventory_consumption_requests (user_id, idempotency_key, result_json)
        VALUES (?, ?, ?)
      `).run(userId, input.idempotency_key, JSON.stringify(response));
      return response;
    })();
  }

  async history(userId: number, itemId: number) {
    const owned = this.findOwnedRow(userId, itemId, { includeDeleted: true });
    if (!owned) return null;
    const rows = this.database.prepare(`
      SELECT id, action, source, quantity_before, quantity_after, quantity_unit, delta_value, metadata_json, created_at
      FROM inventory_change_logs
      WHERE user_id = ? AND inventory_item_id = ?
      ORDER BY created_at DESC, id DESC
    `).all(userId, itemId) as Array<Record<string, unknown>>;
    return inventoryHistoryResponseSchema.parse(rows.map((row) => {
      const { metadata_json: metadataJson, ...historyItem } = row;
      return {
        ...historyItem,
        metadata: typeof metadataJson === "string" ? JSON.parse(metadataJson) : {},
      };
    }));
  }

  async update(userId: number, itemId: number, expectedVersion: number, input: InventoryUpdatePersistence) {
    return this.updateInTransaction(userId, itemId, expectedVersion, input);
  }

  /** Synchronous entry point for an enclosing business transaction. */
  updateInTransaction(userId: number, itemId: number, expectedVersion: number, input: InventoryUpdatePersistence, source: "manual" | "ai" = "manual") {
    return this.database.transaction(() => {
      const current = this.database.prepare(`
        SELECT inventory_items.*, (SELECT metadata_json FROM inventory_change_logs e
          WHERE e.inventory_item_id=inventory_items.id AND e.user_id=inventory_items.user_id
          AND json_extract(e.metadata_json,'$.field_evidence.quantity.status') IS NOT NULL ORDER BY e.id DESC LIMIT 1) AS quantity_evidence
        FROM inventory_items WHERE id = ? AND user_id = ? AND version = ? AND deleted_at IS NULL
      `).get(itemId, userId, expectedVersion) as Record<string, unknown> | undefined;
      if (!current) return { kind: "conflict" } as const;

      const { patch } = input;
      const has = (key: keyof typeof patch) => Object.prototype.hasOwnProperty.call(patch, key);
      const result = this.database.prepare(`
        UPDATE inventory_items
        SET food_name = COALESCE(?, food_name),
            category = COALESCE(?, category),
            quantity = COALESCE(?, quantity),
            expiration_date = COALESCE(?, expiration_date),
            storage_location = COALESCE(?, storage_location),
            image_url = COALESCE(?, image_url),
            is_available = COALESCE(?, is_available),
            quantity_value = ?, quantity_unit = ?, package_size_value = ?, package_size_unit = ?, batch_code = ?,
            version = version + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ? AND version = ? AND deleted_at IS NULL
      `).run(
        patch.food_name,
        patch.category,
        patch.quantity,
        patch.expiration_date,
        patch.storage_location,
        patch.image_url,
        patch.is_available !== undefined ? (patch.is_available ? 1 : 0) : null,
        input.nextQuantityValue,
        input.nextQuantityUnit,
        has("package_size_value") ? patch.package_size_value : current.package_size_value,
        has("package_size_unit") ? patch.package_size_unit : current.package_size_unit,
        has("batch_code") ? patch.batch_code : current.batch_code,
        itemId,
        userId,
        expectedVersion,
      );
      if (result.changes !== 1) return { kind: "conflict" } as const;

      const updatedRow = this.database.prepare("SELECT * FROM inventory_items WHERE id = ?").get(itemId) as Record<string, unknown>;
      const updated = formatInventoryItem(updatedRow);
      const currentAvailable = Boolean(current.is_available);
      {
        this.database.prepare(`
          INSERT OR IGNORE INTO inventory_change_logs
            (user_id, inventory_item_id, action, source, quantity_before, quantity_after, quantity_unit, delta_value, idempotency_key, metadata_json)
          VALUES (?, ?, 'adjusted', ?, ?, ?, ?, ?, ?, ?)
        `).run(
          userId, itemId, source, current.quantity_value, updated.quantity_value, updated.quantity_unit,
          current.quantity_value == null || updated.quantity_value == null
            ? null
            : Number(updated.quantity_value) - Number(current.quantity_value),
          `manual-update:${itemId}:${expectedVersion}`,
          JSON.stringify(editedInventoryEvidence(current, updated, this.evidenceHistory(userId, itemId), source, nextQuantityEvidence(current.quantity_evidence, expectedVersion, updated.version,
            current.quantity_value !== updated.quantity_value || current.quantity_unit !== updated.quantity_unit
              ? source === "manual" ? "manual" : "unverified" : "preserve",
            updated.quantity_value != null && updated.quantity_unit != null))),
        );
      }
      appendSqliteMaintenanceEvent(this.database, { userId,kind: "inventory_changed",sourceId: `update:${itemId}:${updated.version}`,subjectId: String(itemId),
        details: { version: updated.version,previousFoodName: String(current.food_name),mode: "update" } });
      return { kind: "updated", item: updated } as const;
    })();
  }

  async remove(userId: number, item: InventoryItem) {
    return this.database.transaction(() => {
      const result = this.database.prepare(`
        UPDATE inventory_items SET deleted_at = CURRENT_TIMESTAMP, is_available = 0,
          version = version + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL
      `).run(item.id, userId);
      if (result.changes === 0) return { kind: "not_found" } as const;

      this.database.prepare(`
        INSERT OR IGNORE INTO inventory_change_logs
          (user_id, inventory_item_id, action, source, quantity_before, quantity_after, quantity_unit, delta_value, idempotency_key)
        VALUES (?, ?, 'removed', 'manual', ?, ?, ?, 0, ?)
      `).run(
        userId, item.id, item.quantity_value ?? null, item.quantity_value ?? null,
        item.quantity_unit ?? null, `remove:${item.id}:${item.version}`,
      );
      appendSqliteMaintenanceEvent(this.database, { userId,kind: "inventory_changed",sourceId: `remove:${item.id}`,subjectId: String(item.id),details: { mode: "remove" } });
      return { kind: "removed" } as const;
    })();
  }
}
