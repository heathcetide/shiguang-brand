import { savedInventoryEvidence, editedInventoryEvidence, SAVED_EVIDENCE_LOG_LIMIT } from "./savedEvidence.js";
import { appendPostgresMaintenanceEvent } from "../planMaintenance/postgresEventWriter.js";
import { InventoryDomainError } from "./errors.js";
import { quantityEvidenceStatus, nextQuantityEvidence } from "./evidence.js";
import { savedIntakeItems } from "./intakeIdentity.js";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import {
  inventoryBulkIntakeResponseSchema,
  inventoryConsumptionResponseSchema,
  inventoryHistoryResponseSchema,
  inventoryImportResponseSchema,
  inventoryItemSchema,
  inventoryListResponseSchema,
} from "@dietdigidose/contracts";
import {
  calculateInventoryConsumption,
  InventoryQuantityError,
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

function formatInventoryItem(item: QueryResultRow) {
  return inventoryItemSchema.parse({
    ...item,
    is_available: Boolean(item.is_available),
    version: Number(item.version) || 1,
    quantity_value: item.quantity_value == null ? null : Number(item.quantity_value),
    package_size_value: item.package_size_value == null ? null : Number(item.package_size_value),
    updated_at: item.updated_at instanceof Date ? item.updated_at.toISOString() : item.updated_at,
  });
}

async function lockInventoryIdempotency(client: PoolClient, scope: string, userId: number, key: string) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`inventory:${scope}:${userId}:${key}`]);
}

/** Runs an inventory consumption inside an existing PostgreSQL transaction. */
export async function consumeInventoryWithPostgresClient(
  client: PoolClient,
  userId: number,
  input: InventoryConsumptionData,
  metadata: Record<string, unknown> = {},
) {
  await lockInventoryIdempotency(client, "consume", userId, input.idempotency_key);
  const existing = await client.query(`
    SELECT result_json FROM inventory_consumption_requests WHERE user_id = $1 AND idempotency_key = $2
  `, [userId, input.idempotency_key]);
  if (existing.rows[0]) return inventoryConsumptionResponseSchema.parse({ ...existing.rows[0].result_json, repeated: true });

  const changes = [];
  const items = [];
  for (const [index, consumption] of (input.items as InventoryConsumption[]).entries()) {
    const selected = await client.query(`
      SELECT inventory_items.*, (SELECT metadata_json FROM inventory_change_logs e
        WHERE e.inventory_item_id=inventory_items.id AND e.user_id=inventory_items.user_id
          AND e.metadata_json->'field_evidence'->>'quantity' IS NOT NULL ORDER BY e.id DESC LIMIT 1) AS quantity_evidence
      FROM inventory_items WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR UPDATE
    `, [consumption.item_id, userId]);
    const row = selected.rows[0];
    if (!row) throw new InventoryQuantityError("INVENTORY_CONFLICT", "库存食材不存在、已用完或不属于当前账号");
    const transition = calculateInventoryConsumption(row, consumption);
    const updated = await client.query(`
      UPDATE inventory_items SET quantity = $1, quantity_value = $2, is_available = $3,
        version = version + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $4 AND user_id = $5 AND version = $6 AND is_available = TRUE AND deleted_at IS NULL
      RETURNING *
    `, [transition.nextQuantity, transition.storedValue === null ? null : transition.remaining, transition.available, consumption.item_id, userId, consumption.version]);
    if (!updated.rows[0]) throw new InventoryQuantityError("INVENTORY_VERSION_CONFLICT", "库存已变化，请刷新后重试");
    await client.query(`
      INSERT INTO inventory_change_logs
        (user_id, inventory_item_id, action, source, quantity_before, quantity_after,
         quantity_unit, delta_value, idempotency_key, metadata_json)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
    `, [
      userId, consumption.item_id, consumption.mode === "all" ? "consume_all" : "consume_partial",
      input.source, transition.storedValue, transition.storedValue === null ? null : transition.remaining,
      transition.storedUnit, transition.amountUsed === null ? null : -transition.amountUsed,
      `${input.idempotency_key}:${consumption.item_id}:${index}`, JSON.stringify({ ...metadata, ...nextQuantityEvidence(row.quantity_evidence, consumption.version, consumption.version + 1, "preserve", transition.storedValue !== null && transition.storedUnit !== null) }),
    ]);
    await appendPostgresMaintenanceEvent(client,{ userId,kind: "inventory_changed",sourceId: `consume:${input.idempotency_key}:${consumption.item_id}:${index}`,
      subjectId: String(consumption.item_id),details: { version: consumption.version+1,mode: "consume" } });
    changes.push({
      item_id: consumption.item_id,
      quantity_before: transition.storedValue,
      quantity_after: transition.storedValue === null ? null : transition.remaining,
      quantity_unit: transition.storedUnit,
      consumed_value: transition.amountUsed,
      is_available: transition.available,
      version: consumption.version + 1,
    });
    items.push(formatInventoryItem(updated.rows[0]));
  }
  const response = inventoryConsumptionResponseSchema.parse({ changes, items, repeated: false });
  await client.query(`
    INSERT INTO inventory_consumption_requests (user_id, idempotency_key, result_json)
    VALUES ($1, $2, $3::jsonb)
  `, [userId, input.idempotency_key, JSON.stringify(response)]);
  return response;
}

export class PostgresInventoryRepository implements InventoryRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async recordFunnelEvent(eventName: string, actorHash: string) {
    await this.pool.query("INSERT INTO funnel_events (event_name,actor_hash) VALUES ($1,$2)", [eventName, actorHash]);
  }

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async lockIdempotency(client: PoolClient, scope: string, userId: number, key: string) {
    await lockInventoryIdempotency(client, scope, userId, key);
  }

  private async insertInventoryItem(
    client: PoolClient,
    userId: number,
    item: InventoryCreateData | InventoryBulkIntakeData["items"][number],
  ) {
    const result = await client.query(`
      INSERT INTO inventory_items (
        user_id, food_name, category, quantity, expiration_date, storage_location, image_url,
        is_available, quantity_value, quantity_unit, package_size_value, package_size_unit, batch_code
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, $8, $9, $10, $11, $12)
      RETURNING *
    `, [
      userId, item.food_name, item.category, item.quantity || "1份", item.expiration_date,
      item.storage_location || "冷藏", item.image_url || null, item.quantity_value ?? null,
      item.quantity_unit ?? null, item.package_size_value ?? null, item.package_size_unit ?? null,
      item.batch_code ?? null,
    ]);
    await appendPostgresMaintenanceEvent(client, { userId, kind: "inventory_created", sourceId: String(result.rows[0].id), subjectId: String(result.rows[0].id) });
    return formatInventoryItem(result.rows[0]!);
  }

  async list(userId: number) {
    const result = await this.pool.query(`
      SELECT * FROM inventory_items
      WHERE user_id = $1 AND deleted_at IS NULL
      ORDER BY CASE WHEN expiration_date = '' THEN 1 ELSE 0 END, expiration_date ASC
    `, [userId]);
    return inventoryListResponseSchema.parse(result.rows.map(formatInventoryItem));
  }

  async evidence(userId: number, itemId: number) {
    const result = await this.pool.query(`SELECT i.*, COALESCE((SELECT jsonb_agg(jsonb_build_object('action', e.action, 'metadata_json', e.metadata_json, 'quantity_after', e.quantity_after, 'quantity_unit', e.quantity_unit) ORDER BY e.id)
      FROM (SELECT action, metadata_json, quantity_after, quantity_unit, id FROM inventory_change_logs WHERE inventory_item_id=i.id AND user_id=i.user_id ORDER BY id DESC LIMIT $3) e), '[]'::jsonb) AS evidence_logs
      FROM inventory_items i WHERE i.id=$1 AND i.user_id=$2 AND i.deleted_at IS NULL`, [itemId, userId, SAVED_EVIDENCE_LOG_LIMIT]);
    const item = result.rows[0];
    return item ? { item_id: itemId, inventory_version: Number(item.version), field_evidence: savedInventoryEvidence(item, item.evidence_logs) } : null;
  }

  async findOwned(userId: number, itemId: number) {
    const result = await this.pool.query(`
      SELECT * FROM inventory_items
      WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
    `, [itemId, userId]);
    return result.rows[0] ? formatInventoryItem(result.rows[0]) : null;
  }

  async create(userId: number, input: InventoryCreateData) {
    return this.transaction(client => this.createWithClient(client, userId, input));
  }

  /** Uses the caller's transaction; does not commit or release its connection. */
  async createWithClient(client: PoolClient, userId: number, input: InventoryCreateData, source: "manual" | "ai" = "manual") {
    const item = await this.insertInventoryItem(client, userId, input);
    await client.query(`
      INSERT INTO inventory_change_logs
        (user_id, inventory_item_id, action, source, quantity_before, quantity_after, quantity_unit, delta_value, idempotency_key)
      VALUES ($1, $2, 'created', $6, NULL, $3, $4, $3, $5)
    `, [userId, item.id, item.quantity_value ?? null, item.quantity_unit ?? null, `create:${item.id}`, source]);
    return item;
  }

  async importShoppingList(userId: number, input: InventoryImportData) {
    return this.transaction(async (client) => {
      await this.lockIdempotency(client, "shopping", userId, input.idempotency_key);
      const existing = await client.query(`
        SELECT result_json FROM shopping_inventory_imports WHERE user_id = $1 AND idempotency_key = $2
      `, [userId, input.idempotency_key]);
      if (existing.rows[0]) return inventoryImportResponseSchema.parse({ items: existing.rows[0].result_json, repeated: true });
      // Consistent row order also protects overlapping batches using different keys.
      for (const item of [...(input.shopping_items || [])].sort((a, b) => a.id.localeCompare(b.id))) {
        const result = await client.query(`
          UPDATE shopping_list_items SET deleted_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP, version = version + 1
          WHERE id = $1 AND user_id = $2 AND version = $3 AND checked = TRUE AND deleted_at IS NULL
        `, [item.id, userId, item.version]);
        if (result.rowCount !== 1) {
          throw new InventoryDomainError("SHOPPING_ITEM_CONFLICT", "采购项已变更或已入库，请刷新清单后重试。");
        }
      }
      const items = [];
      for (const item of input.items) items.push(await this.createWithClient(client, userId, item));
      await client.query(`
        INSERT INTO shopping_inventory_imports (user_id, idempotency_key, result_json) VALUES ($1, $2, $3::jsonb)
      `, [userId, input.idempotency_key, JSON.stringify(items)]);
      return inventoryImportResponseSchema.parse({ items, repeated: false });
    });
  }

  async undoScan(userId: number, jobId: string) {
    return this.transaction(async client => {
      await this.lockIdempotency(client, "intake-source", userId, `image:${jobId}`);
      const saved = savedIntakeItems((await client.query(`SELECT confirmed_payload_json,result_json FROM inventory_intake_batches
        WHERE user_id=$1 AND source='image' AND source_reference=$2 ORDER BY created_at,id`, [userId,jobId])).rows);
      let undone = 0;
      for (const item of [...new Map([...saved.values()].map(item => [item.id,item])).values()].sort((a,b) => a.id-b.id)) {
        const key = `intake-undo:${jobId}:${item.id}`;
        if ((await client.query("SELECT id FROM inventory_change_logs WHERE user_id=$1 AND idempotency_key=$2", [userId,key])).rows[0]) continue;
        const current = (await client.query("SELECT version,deleted_at FROM inventory_items WHERE id=$1 AND user_id=$2 FOR UPDATE", [item.id,userId])).rows[0];
        if (!current || current.deleted_at || Number(current.version) !== item.version) throw new InventoryDomainError("INVENTORY_VERSION_CONFLICT", "部分食材已被消耗或修改，整批未撤销。请到库存查看当前数量后手动纠正。");
        await client.query("UPDATE inventory_items SET deleted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP,version=version+1 WHERE id=$1 AND user_id=$2", [item.id,userId]);
        await client.query(`INSERT INTO inventory_change_logs(user_id,inventory_item_id,action,source,quantity_before,quantity_after,quantity_unit,delta_value,idempotency_key,metadata_json)
          VALUES($1,$2,'removed','manual',$3,$3,$4,0,$5,$6::jsonb)`, [userId,item.id,item.quantity_value ?? null,item.quantity_unit ?? null,key,JSON.stringify({ intake_undo_job: jobId })]);
        await appendPostgresMaintenanceEvent(client, { userId,kind: "inventory_changed",sourceId: key,subjectId: String(item.id),details: { version: item.version+1,mode: "undo_intake" } });
        undone++;
      }
      return { undone, repeated: undone === 0 };
    });
  }

  async undoneScanItemIds(userId: number, jobId: string) {
    return (await this.pool.query("SELECT inventory_item_id FROM inventory_change_logs WHERE user_id=$1 AND metadata_json->>'intake_undo_job'=$2", [userId,jobId])).rows.map(row => Number(row.inventory_item_id));
  }

  async savedScanItems(userId: number, jobId: string) {
    return savedIntakeItems((await this.pool.query(`SELECT confirmed_payload_json,result_json FROM inventory_intake_batches
      WHERE user_id=$1 AND source='image' AND source_reference=$2 ORDER BY created_at,id`, [userId,jobId])).rows);
  }

  async bulkIntake(userId: number, input: InventoryBulkIntakeData, automaticRule?: string) {
    return this.transaction(async (client) => {
      if (automaticRule) await this.lockIdempotency(client, "automatic-intake-user", userId, String(userId));
      await this.lockIdempotency(client, "intake", userId, input.idempotency_key);
      const existing = await client.query(`
        SELECT result_json FROM inventory_intake_batches WHERE user_id = $1 AND idempotency_key = $2
      `, [userId, input.idempotency_key]);
      if (existing.rows[0]) return inventoryBulkIntakeResponseSchema.parse({ ...existing.rows[0].result_json, repeated: true });
      if (input.source_reference) await this.lockIdempotency(client, "intake-source", userId, `${input.source}:${input.source_reference}`);
      const previous = input.source_reference ? (await client.query(`SELECT confirmed_payload_json,result_json FROM inventory_intake_batches
        WHERE user_id=$1 AND source=$2 AND source_reference=$3 ORDER BY created_at,id`, [userId,input.source,input.source_reference])).rows : [];
      const saved = savedIntakeItems(previous);
      const ownedNames = automaticRule ? (await client.query("SELECT food_name FROM inventory_items WHERE user_id=$1 AND deleted_at IS NULL AND is_available=TRUE", [userId])).rows.map(row => String(row.food_name).trim().toLocaleLowerCase().replace(/\s+/g, "")) : [];
      const acceptedItems = automaticRule ? input.items.filter(item => (item.source_item_id && saved.has(item.source_item_id)) || !ownedNames.includes(item.food_name.trim().toLocaleLowerCase().replace(/\s+/g, ""))) : input.items;

      const items = [];
      let added = 0;
      for (const item of acceptedItems) {
        const existingItem = item.source_item_id ? saved.get(item.source_item_id) : undefined;
        if (existingItem) items.push(existingItem);
        else {
          added += 1;
          const created = await this.insertInventoryItem(client, userId, item);
          await client.query(`INSERT INTO inventory_change_logs
            (user_id,inventory_item_id,action,source,quantity_after,quantity_unit,delta_value,idempotency_key,metadata_json)
            VALUES($1,$2,'created',$3,$4,$5,$4,$6,$7::jsonb)`, [userId,created.id,
            input.source === "image" || input.source === "receipt" ? "ai" : "manual", created.quantity_value,created.quantity_unit,
            `intake:${created.id}`, JSON.stringify({ acceptance: automaticRule ? "automatic" : "manual", acceptance_rule: automaticRule ?? null, inventory_version: created.version, source: item.source, source_reference: input.source_reference ?? null,
              source_item_id: item.source_item_id ?? null, confidence: item.confidence ?? null, field_evidence: item.field_evidence ?? {} })]);
          items.push(created);
        }
      }
      const response = inventoryBulkIntakeResponseSchema.parse({ batch_id: randomUUID(), items, repeated: added === 0 });
      await client.query(`
        INSERT INTO inventory_intake_batches
          (id, user_id, idempotency_key, source, source_reference, confirmed_payload_json, result_json)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
      `, [
        response.batch_id, userId, input.idempotency_key, input.source, input.source_reference ?? null,
        JSON.stringify(acceptedItems.map(item => ({ ...item, acceptance: automaticRule ? "automatic" : "manual", acceptance_rule: automaticRule ?? null }))), JSON.stringify(response),
      ]);
      return response;
    });
  }

  async listPreviewCandidates(userId: number): Promise<InventoryPreviewCandidate[]> {
    const result = await this.pool.query(`
      SELECT id, food_name, quantity_value, quantity_unit, expiration_date, batch_code, version, (SELECT metadata_json FROM inventory_change_logs e WHERE e.inventory_item_id=inventory_items.id AND e.user_id=inventory_items.user_id AND e.metadata_json->'field_evidence'->>'quantity' IS NOT NULL ORDER BY e.id DESC LIMIT 1) AS quantity_evidence
      FROM inventory_items
      WHERE user_id = $1 AND is_available = TRUE AND deleted_at IS NULL
      ORDER BY CASE WHEN expiration_date = '' THEN 1 ELSE 0 END, expiration_date ASC, id ASC
    `, [userId]);
    return result.rows.map((row) => ({
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
    return this.transaction((client) => consumeInventoryWithPostgresClient(client, userId, input));
  }

  async history(userId: number, itemId: number) {
    const owned = await this.pool.query("SELECT id FROM inventory_items WHERE id = $1 AND user_id = $2", [itemId, userId]);
    if (!owned.rows[0]) return null;
    const result = await this.pool.query(`
      SELECT id, action, source, quantity_before, quantity_after, quantity_unit, delta_value,
        metadata_json AS metadata, created_at
      FROM inventory_change_logs
      WHERE user_id = $1 AND inventory_item_id = $2
      ORDER BY created_at DESC, id DESC
    `, [userId, itemId]);
    return inventoryHistoryResponseSchema.parse(result.rows.map((row) => ({
      ...row,
      id: Number(row.id),
      quantity_before: row.quantity_before == null ? null : Number(row.quantity_before),
      quantity_after: row.quantity_after == null ? null : Number(row.quantity_after),
      delta_value: row.delta_value == null ? null : Number(row.delta_value),
      metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {},
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    })));
  }

  async update(userId: number, itemId: number, expectedVersion: number, input: InventoryUpdatePersistence) {
    return this.transaction(client => this.updateWithClient(client, userId, itemId, expectedVersion, input));
  }

  /** Uses the caller's transaction; does not commit or release its connection. */
  async updateWithClient(client: PoolClient, userId: number, itemId: number, expectedVersion: number, input: InventoryUpdatePersistence, source: "manual" | "ai" = "manual") {
    const currentResult = await client.query(`
      SELECT inventory_items.*, (SELECT metadata_json FROM inventory_change_logs e
        WHERE e.inventory_item_id=inventory_items.id AND e.user_id=inventory_items.user_id
          AND e.metadata_json->'field_evidence'->>'quantity' IS NOT NULL ORDER BY e.id DESC LIMIT 1) AS quantity_evidence
      FROM inventory_items WHERE id = $1 AND user_id = $2 AND version = $3 AND deleted_at IS NULL FOR UPDATE
    `, [itemId, userId, expectedVersion]);
    const current = currentResult.rows[0];
    if (!current) return { kind: "conflict" } as const;
    const { patch } = input;
    const has = (key: keyof typeof patch) => Object.prototype.hasOwnProperty.call(patch, key);
    const updatedResult = await client.query(`
      UPDATE inventory_items SET
        food_name = COALESCE($1, food_name), category = COALESCE($2, category), quantity = COALESCE($3, quantity),
        expiration_date = COALESCE($4, expiration_date), storage_location = COALESCE($5, storage_location),
        image_url = COALESCE($6, image_url), is_available = COALESCE($7, is_available),
        quantity_value = $8, quantity_unit = $9, package_size_value = $10, package_size_unit = $11,
        batch_code = $12, version = version + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $13 AND user_id = $14 AND version = $15 AND deleted_at IS NULL RETURNING *
    `, [
      patch.food_name, patch.category, patch.quantity, patch.expiration_date, patch.storage_location,
      patch.image_url, patch.is_available, input.nextQuantityValue, input.nextQuantityUnit,
      has("package_size_value") ? patch.package_size_value : current.package_size_value,
      has("package_size_unit") ? patch.package_size_unit : current.package_size_unit,
      has("batch_code") ? patch.batch_code : current.batch_code, itemId, userId, expectedVersion,
    ]);
    if (!updatedResult.rows[0]) return { kind: "conflict" } as const;
    const updated = formatInventoryItem(updatedResult.rows[0]);
    const currentQuantity = current.quantity_value == null ? null : Number(current.quantity_value);
    {
      await client.query(`
        INSERT INTO inventory_change_logs
          (user_id, inventory_item_id, action, source, quantity_before, quantity_after, quantity_unit, delta_value, idempotency_key, metadata_json)
        VALUES ($1, $2, 'adjusted', $8, $3, $4, $5, $6, $7, $9::jsonb)
        ON CONFLICT (user_id, idempotency_key) DO NOTHING
      `, [
        userId, itemId, current.quantity_value, updated.quantity_value, updated.quantity_unit,
        current.quantity_value == null || updated.quantity_value == null ? null : Number(updated.quantity_value) - Number(current.quantity_value),
        `manual-update:${itemId}:${expectedVersion}`, source,
        JSON.stringify(editedInventoryEvidence(current, updated, (await client.query("SELECT action, metadata_json, quantity_after, quantity_unit FROM inventory_change_logs WHERE inventory_item_id=$1 AND user_id=$2 ORDER BY id DESC LIMIT $3", [itemId, userId, SAVED_EVIDENCE_LOG_LIMIT])).rows.reverse(), source, nextQuantityEvidence(current.quantity_evidence, expectedVersion, updated.version,
          currentQuantity !== updated.quantity_value || current.quantity_unit !== updated.quantity_unit
            ? source === "manual" ? "manual" : "unverified" : "preserve",
          updated.quantity_value != null && updated.quantity_unit != null))),
      ]);
    }
    await appendPostgresMaintenanceEvent(client, { userId,kind: "inventory_changed",sourceId: `update:${itemId}:${updated.version}`,subjectId: String(itemId),
        details: { version: updated.version,previousFoodName: String(current.food_name),mode: "update" } });
      return { kind: "updated", item: updated } as const;
  }

  async remove(userId: number, item: InventoryItem) {
    return this.transaction(async (client) => {
      const removed = await client.query(`
        UPDATE inventory_items SET deleted_at = CURRENT_TIMESTAMP, is_available = FALSE,
          version = version + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL RETURNING id
      `, [item.id, userId]);
      if (!removed.rows[0]) return { kind: "not_found" } as const;
      await client.query(`
        INSERT INTO inventory_change_logs
          (user_id, inventory_item_id, action, source, quantity_before, quantity_after, quantity_unit, delta_value, idempotency_key)
        VALUES ($1, $2, 'removed', 'manual', $3, $3, $4, 0, $5)
        ON CONFLICT (user_id, idempotency_key) DO NOTHING
      `, [userId, item.id, item.quantity_value ?? null, item.quantity_unit ?? null, `remove:${item.id}:${item.version}`]);
      await appendPostgresMaintenanceEvent(client, { userId,kind: "inventory_changed",sourceId: `remove:${item.id}`,subjectId: String(item.id),details: { mode: "remove" } });
      return { kind: "removed" } as const;
    });
  }
}
