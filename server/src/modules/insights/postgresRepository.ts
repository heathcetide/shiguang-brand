import { interventionOutcomeRequest, validateInterventionOutcome } from "./intervention.js";
import { appendPostgresMaintenanceEvent } from "../planMaintenance/postgresEventWriter.js";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { formatChangeEvent, formatOutcomeEvent } from "./formatters.js";
import type { InsightsRepository } from "./repository.js";
import type { InventoryOutcomeCreateInput, InventoryOutcomeUpdateInput, InventoryScope } from "./types.js";

const VERSION_CONFLICT = "INSIGHTS_VERSION_CONFLICT";

export class PostgresInsightsRepository implements InsightsRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) { this.pool = pool; }

  async isHouseholdMember(householdId: number, userId: number) {
    return Boolean((await this.pool.query(
      "SELECT id FROM household_members WHERE household_id = $1 AND user_id = $2",
      [householdId, userId],
    )).rows[0]);
  }

  async createOutcome(userId: number, input: InventoryOutcomeCreateInput) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const interventionRequest = interventionOutcomeRequest(input);
      if (interventionRequest) await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
      const ownerId = input.scope === "personal" ? userId : Number(input.householdId);
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`insights:outcome:${input.scope}:${ownerId}:${input.idempotencyKey}`]);
      if (input.scope === "household" && !(await client.query(
        "SELECT id FROM household_members WHERE household_id = $1 AND user_id = $2",
        [ownerId, userId],
      )).rows[0]) {
        await client.query("COMMIT");
        return { kind: "household_not_found" as const };
      }
      const existing = input.scope === "personal"
        ? await client.query("SELECT * FROM inventory_outcome_events WHERE user_id = $1 AND idempotency_key = $2", [userId, input.idempotencyKey])
        : await client.query("SELECT * FROM inventory_outcome_events WHERE household_id = $1 AND idempotency_key = $2", [ownerId, input.idempotencyKey]);
      if (interventionRequest) {
        const previous = (await client.query("SELECT request_json FROM proactive_intervention_actions WHERE user_id=$1 AND idempotency_key=$2",[userId,input.idempotencyKey])).rows[0];
        const intervention = (await client.query("SELECT * FROM proactive_interventions WHERE user_id=$1 AND id=$2 FOR UPDATE",[userId,input.interventionId])).rows[0];
        validateInterventionOutcome(input,intervention ?? null,previous ?? null,Boolean(existing.rows[0]),Date.now());
      }
      if (existing.rows[0]) {
        await client.query("COMMIT");
        return { kind: "repeated" as const, event: formatOutcomeEvent(existing.rows[0]) };
      }
      const selected = input.scope === "personal"
        ? await client.query("SELECT * FROM inventory_items WHERE id = $1 AND user_id = $2 FOR UPDATE", [input.itemId, userId])
        : await client.query("SELECT * FROM household_inventory_items WHERE id = $1 AND household_id = $2 FOR UPDATE", [input.itemId, ownerId]);
      const item = selected.rows[0];
      if (!item || (interventionRequest && (item.deleted_at || !item.is_available))) {
        await client.query("COMMIT");
        return { kind: "inventory_not_found" as const };
      }
      if (input.itemVersion && Number(item.version || 1) !== input.itemVersion) {
        await client.query("COMMIT");
        return { kind: "conflict" as const };
      }
      const id = randomUUID();
      const inserted = await client.query(`INSERT INTO inventory_outcome_events
        (id, scope, user_id, household_id, inventory_item_id, household_inventory_item_id,
         outcome, source, quantity_value, quantity_unit, quantity_text, idempotency_key, occurred_at,
         created_by_user_id, updated_by_user_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
          COALESCE($13::timestamptz, CURRENT_TIMESTAMP), $14, $15) RETURNING *`, [
        id, input.scope, input.scope === "personal" ? userId : null, input.scope === "household" ? ownerId : null,
        input.scope === "personal" ? input.itemId : null, input.scope === "household" ? input.itemId : null,
        input.outcome, input.source, item.quantity_value ?? null, item.quantity_unit ?? null,
        item.quantity ?? null, input.idempotencyKey, input.occurredAt ?? null, userId, userId,
      ]);
      if (input.closeItem) {
        const closed = input.scope === "personal"
          ? await client.query(`UPDATE inventory_items SET is_available = FALSE, version = version + 1,
              updated_at = CURRENT_TIMESTAMP, deleted_at = CURRENT_TIMESTAMP
              WHERE id = $1 AND user_id = $2 AND version = $3`, [input.itemId, userId, Number(item.version || 1)])
          : await client.query(`UPDATE household_inventory_items SET is_available = FALSE, version = version + 1,
              updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND household_id = $2 AND version = $3`,
            [input.itemId, ownerId, Number(item.version || 1)]);
        if (closed.rowCount !== 1) throw new Error(VERSION_CONFLICT);
      }
      if (interventionRequest) {
        const at = new Date().toISOString();
        await client.query("INSERT INTO proactive_intervention_outcomes(id,intervention_id,user_id,outcome_type,source_type,source_id,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7)",[randomUUID(),input.interventionId,userId,input.outcome === "used" ? "inventory_used" : "inventory_discarded","inventory_outcome",id,at]);
        await client.query("INSERT INTO proactive_intervention_actions(id,intervention_id,user_id,idempotency_key,action,request_json,result_json,created_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)",[randomUUID(),input.interventionId,userId,input.idempotencyKey,interventionRequest.action,JSON.stringify(interventionRequest),JSON.stringify({ eventId: id }),at]);
        await client.query("UPDATE proactive_interventions SET status='acted',delivery_state=CASE WHEN delivery_state='pending' THEN 'cancelled' ELSE delivery_state END,updated_at=$1 WHERE user_id=$2 AND id=$3",[at,userId,input.interventionId]);
        await client.query("UPDATE user_notification_inbox SET action_status='completed',is_read=TRUE,read_at=$1,updated_at=$1 WHERE user_id=$2 AND id=(SELECT notification_id FROM proactive_interventions WHERE user_id=$2 AND id=$3)",[at,userId,input.interventionId]);
        await appendPostgresMaintenanceEvent(client, { userId, kind: "inventory_changed", sourceId: `outcome:${id}`, subjectId: String(input.itemId), details: { mode: input.outcome } });
      }
      const event = formatOutcomeEvent({
        ...inserted.rows[0],
        food_name: item.food_name,
        category: item.category,
        expiration_date: item.expiration_date,
      });
      await client.query("COMMIT");
      return { kind: "created" as const, event };
    } catch (error) {
      await client.query("ROLLBACK");
      if (error instanceof Error && error.message === VERSION_CONFLICT) return { kind: "conflict" as const };
      throw error;
    } finally {
      client.release();
    }
  }

  async updateOutcome(userId: number, eventId: string, input: InventoryOutcomeUpdateInput) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const event = (await client.query("SELECT * FROM inventory_outcome_events WHERE id = $1", [eventId])).rows[0];
      if (!event) {
        await client.query("COMMIT");
        return { kind: "not_found" as const };
      }
      const allowed = event.scope === "personal"
        ? Number(event.user_id) === userId
        : Boolean((await client.query("SELECT id FROM household_members WHERE household_id = $1 AND user_id = $2", [event.household_id, userId])).rows[0]);
      if (!allowed) {
        await client.query("COMMIT");
        return { kind: "not_found" as const };
      }
      const changed = await client.query(`UPDATE inventory_outcome_events SET outcome = $1, updated_by_user_id = $2,
        version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $3 AND version = $4 RETURNING *`,
      [input.outcome, userId, eventId, input.version]);
      if (!changed.rows[0]) {
        await client.query("COMMIT");
        return { kind: "conflict" as const };
      }
      if (event.scope === "personal") {
        const outcomeType = input.outcome === "discarded" ? "inventory_discarded" : ["used","cooked"].includes(input.outcome) ? "inventory_used" : null;
        await client.query("DELETE FROM proactive_intervention_outcomes WHERE user_id=$1 AND source_type='inventory_outcome' AND source_id=$2",[userId,eventId]);
        if (outcomeType) await client.query(`INSERT INTO proactive_intervention_outcomes(id,intervention_id,user_id,outcome_type,source_type,source_id,occurred_at)
          SELECT $1,intervention_id,user_id,$2,'inventory_outcome',$3,$4 FROM proactive_intervention_actions WHERE user_id=$5 AND result_json->>'eventId'=$3`,[randomUUID(),outcomeType,eventId,event.occurred_at,userId]);
      }
      const row = await this.joinedEvent(client, changed.rows[0]);
      await client.query("COMMIT");
      return { kind: "updated" as const, event: formatOutcomeEvent(row) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listEvents(scope: InventoryScope, ownerId: number, from: string, to: string) {
    if (scope === "household") {
      const result = await this.pool.query(`SELECT e.*, i.food_name, i.category, i.expiration_date
        FROM inventory_outcome_events e JOIN household_inventory_items i ON i.id = e.household_inventory_item_id
        WHERE e.scope = 'household' AND e.household_id = $1 AND e.occurred_at >= $2::timestamptz AND e.occurred_at < $3::timestamptz`,
      [ownerId, from, to]);
      return result.rows.map(formatOutcomeEvent);
    }
    const [explicit, changes] = await Promise.all([
      this.pool.query(`SELECT e.*, i.food_name, i.category, i.expiration_date
        FROM inventory_outcome_events e JOIN inventory_items i ON i.id = e.inventory_item_id
        WHERE e.scope = 'personal' AND e.user_id = $1 AND e.occurred_at >= $2::timestamptz AND e.occurred_at < $3::timestamptz`,
      [ownerId, from, to]),
      this.pool.query(`SELECT l.*, i.food_name, i.category, i.expiration_date
        FROM inventory_change_logs l JOIN inventory_items i ON i.id = l.inventory_item_id
        WHERE l.user_id = $1 AND l.action IN ('consume_all', 'consume_partial')
          AND l.created_at >= $2::timestamptz AND l.created_at < $3::timestamptz`, [ownerId, from, to]),
    ]);
    return [...explicit.rows.map(formatOutcomeEvent), ...changes.rows.map(formatChangeEvent)];
  }

  async findActionable(scope: InventoryScope, ownerId: number, weekStart: string) {
    const result = scope === "personal"
      ? await this.pool.query(`SELECT category, COUNT(*)::integer AS count FROM inventory_items
          WHERE user_id = $1 AND is_available = TRUE AND deleted_at IS NULL
            AND expiration_date >= $2 AND expiration_date <= (($2::date + INTERVAL '3 days')::date)::text
          GROUP BY category ORDER BY count DESC LIMIT 1`, [ownerId, weekStart])
      : await this.pool.query(`SELECT category, COUNT(*)::integer AS count FROM household_inventory_items
          WHERE household_id = $1 AND is_available = TRUE
            AND expiration_date >= $2 AND expiration_date <= (($2::date + INTERVAL '3 days')::date)::text
          GROUP BY category ORDER BY count DESC LIMIT 1`, [ownerId, weekStart]);
    return result.rows[0] ? { category: String(result.rows[0].category), count: Number(result.rows[0].count) } : null;
  }

  private async joinedEvent(client: PoolClient, event: QueryResultRow) {
    const itemTable = event.scope === "personal" ? "inventory_items" : "household_inventory_items";
    const itemColumn = event.scope === "personal" ? "inventory_item_id" : "household_inventory_item_id";
    return (await client.query(`SELECT e.*, i.food_name, i.category, i.expiration_date FROM inventory_outcome_events e
      JOIN ${itemTable} i ON i.id = e.${itemColumn} WHERE e.id = $1`, [event.id])).rows[0]!;
  }
}
