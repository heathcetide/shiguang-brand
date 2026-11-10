import { interventionOutcomeRequest, validateInterventionOutcome } from "./intervention.js";
import { appendSqliteMaintenanceEvent } from "../planMaintenance/sqliteEventWriter.js";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { formatChangeEvent, formatOutcomeEvent } from "./formatters.js";
import type { InsightsRepository } from "./repository.js";
import type { InventoryOutcomeCreateInput, InventoryOutcomeUpdateInput, InventoryScope } from "./types.js";

type Row = Record<string, unknown>;
const VERSION_CONFLICT = "INSIGHTS_VERSION_CONFLICT";

export class SqliteInsightsRepository implements InsightsRepository {
  private readonly database: Database.Database;

  constructor(database: Database.Database) { this.database = database; }

  async isHouseholdMember(householdId: number, userId: number) {
    return Boolean(this.database.prepare("SELECT id FROM household_members WHERE household_id = ? AND user_id = ?").get(householdId, userId));
  }

  async createOutcome(userId: number, input: InventoryOutcomeCreateInput) {
    try {
      return this.database.transaction(() => {
      const householdId = input.householdId;
      if (input.scope === "household" && !this.database.prepare(
        "SELECT id FROM household_members WHERE household_id = ? AND user_id = ?",
      ).get(householdId, userId)) return { kind: "household_not_found" as const };
      const existing = input.scope === "personal"
        ? this.database.prepare("SELECT * FROM inventory_outcome_events WHERE user_id = ? AND idempotency_key = ?").get(userId, input.idempotencyKey) as Row | undefined
        : this.database.prepare("SELECT * FROM inventory_outcome_events WHERE household_id = ? AND idempotency_key = ?").get(householdId, input.idempotencyKey) as Row | undefined;
      const interventionRequest = interventionOutcomeRequest(input);
      if (interventionRequest) {
        const previous = this.database.prepare("SELECT request_json FROM proactive_intervention_actions WHERE user_id=? AND idempotency_key=?").get(userId,input.idempotencyKey) as Row | undefined;
        const intervention = this.database.prepare("SELECT * FROM proactive_interventions WHERE user_id=? AND id=?").get(userId,input.interventionId) as Row | undefined;
        validateInterventionOutcome(input,intervention ?? null,previous ?? null,Boolean(existing),Date.now());
      }
      if (existing) return { kind: "repeated" as const, event: formatOutcomeEvent(existing) };
      const item = input.scope === "personal"
        ? this.database.prepare("SELECT * FROM inventory_items WHERE id = ? AND user_id = ?").get(input.itemId, userId) as Row | undefined
        : this.database.prepare("SELECT * FROM household_inventory_items WHERE id = ? AND household_id = ?").get(input.itemId, householdId) as Row | undefined;
      if (!item || (interventionRequest && (item.deleted_at || !item.is_available))) return { kind: "inventory_not_found" as const };
      if (input.itemVersion && Number(item.version || 1) !== input.itemVersion) return { kind: "conflict" as const };
      const id = randomUUID();
      this.database.prepare(`INSERT INTO inventory_outcome_events
        (id, scope, user_id, household_id, inventory_item_id, household_inventory_item_id,
         outcome, source, quantity_value, quantity_unit, quantity_text, idempotency_key, occurred_at,
         created_by_user_id, updated_by_user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?, ?)`).run(
        id, input.scope, input.scope === "personal" ? userId : null, householdId ?? null,
        input.scope === "personal" ? input.itemId : null, input.scope === "household" ? input.itemId : null,
        input.outcome, input.source, item.quantity_value ?? null, item.quantity_unit ?? null,
        item.quantity ?? null, input.idempotencyKey, input.occurredAt ?? null, userId, userId,
      );
      if (input.closeItem) {
        const closed = input.scope === "personal"
          ? this.database.prepare(`UPDATE inventory_items SET is_available = 0, version = version + 1,
              updated_at = CURRENT_TIMESTAMP, deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND version = ?`)
            .run(input.itemId, userId, Number(item.version || 1))
          : this.database.prepare(`UPDATE household_inventory_items SET is_available = 0, version = version + 1,
              updated_at = CURRENT_TIMESTAMP WHERE id = ? AND household_id = ? AND version = ?`)
            .run(input.itemId, householdId, Number(item.version || 1));
        if (closed.changes !== 1) throw new Error(VERSION_CONFLICT);
      }
      if (interventionRequest) {
        const at = new Date().toISOString();
        this.database.prepare("INSERT INTO proactive_intervention_outcomes(id,intervention_id,user_id,outcome_type,source_type,source_id,occurred_at) VALUES(?,?,?,?,?,?,?)").run(randomUUID(),input.interventionId,userId,input.outcome === "used" ? "inventory_used" : "inventory_discarded","inventory_outcome",id,at);
        this.database.prepare("INSERT INTO proactive_intervention_actions(id,intervention_id,user_id,idempotency_key,action,request_json,result_json,created_at) VALUES(?,?,?,?,?,?,?,?)").run(randomUUID(),input.interventionId,userId,input.idempotencyKey,interventionRequest.action,JSON.stringify(interventionRequest),JSON.stringify({ eventId: id }),at);
        this.database.prepare("UPDATE proactive_interventions SET status='acted',delivery_state=CASE WHEN delivery_state='pending' THEN 'cancelled' ELSE delivery_state END,updated_at=? WHERE user_id=? AND id=?").run(at,userId,input.interventionId);
        this.database.prepare("UPDATE user_notification_inbox SET action_status='completed',is_read=1,read_at=?,updated_at=? WHERE user_id=? AND id=(SELECT notification_id FROM proactive_interventions WHERE user_id=? AND id=?)").run(at,at,userId,userId,input.interventionId);
        appendSqliteMaintenanceEvent(this.database, { userId, kind: "inventory_changed", sourceId: `outcome:${id}`, subjectId: String(input.itemId), details: { mode: input.outcome } });
      }
      const event = this.database.prepare("SELECT * FROM inventory_outcome_events WHERE id = ?").get(id) as Row;
      return { kind: "created" as const, event: formatOutcomeEvent({ ...event, food_name: item.food_name, category: item.category, expiration_date: item.expiration_date }) };
      })();
    } catch (error) {
      if (error instanceof Error && error.message === VERSION_CONFLICT) return { kind: "conflict" as const };
      throw error;
    }
  }

  async updateOutcome(userId: number, eventId: string, input: InventoryOutcomeUpdateInput) {
    return this.database.transaction(() => {
      const event = this.database.prepare("SELECT * FROM inventory_outcome_events WHERE id = ?").get(eventId) as Row | undefined;
      if (!event) return { kind: "not_found" as const };
      const allowed = event.scope === "personal"
        ? Number(event.user_id) === userId
        : Boolean(this.database.prepare("SELECT id FROM household_members WHERE household_id = ? AND user_id = ?").get(event.household_id, userId));
      if (!allowed) return { kind: "not_found" as const };
      const changed = this.database.prepare(`UPDATE inventory_outcome_events SET outcome = ?, updated_by_user_id = ?,
        version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND version = ?`)
        .run(input.outcome, userId, eventId, input.version);
      if (changed.changes !== 1) return { kind: "conflict" as const };
      if (event.scope === "personal") {
        const outcomeType = input.outcome === "discarded" ? "inventory_discarded" : ["used","cooked"].includes(input.outcome) ? "inventory_used" : null;
        this.database.prepare("DELETE FROM proactive_intervention_outcomes WHERE user_id=? AND source_type='inventory_outcome' AND source_id=?").run(userId,eventId);
        if (outcomeType) this.database.prepare(`INSERT INTO proactive_intervention_outcomes(id,intervention_id,user_id,outcome_type,source_type,source_id,occurred_at)
          SELECT ?,intervention_id,user_id,?,'inventory_outcome',?,? FROM proactive_intervention_actions WHERE user_id=? AND json_extract(result_json,'$.eventId')=?`)
          .run(randomUUID(),outcomeType,eventId,event.occurred_at,userId,eventId);
      }
      const itemTable = event.scope === "personal" ? "inventory_items" : "household_inventory_items";
      const itemColumn = event.scope === "personal" ? "inventory_item_id" : "household_inventory_item_id";
      const row = this.database.prepare(`SELECT e.*, i.food_name, i.category, i.expiration_date FROM inventory_outcome_events e
        JOIN ${itemTable} i ON i.id = e.${itemColumn} WHERE e.id = ?`).get(eventId) as Row;
      return { kind: "updated" as const, event: formatOutcomeEvent(row) };
    })();
  }

  async listEvents(scope: InventoryScope, ownerId: number, from: string, to: string) {
    if (scope === "household") {
      return (this.database.prepare(`SELECT e.*, i.food_name, i.category, i.expiration_date
        FROM inventory_outcome_events e JOIN household_inventory_items i ON i.id = e.household_inventory_item_id
        WHERE e.scope = 'household' AND e.household_id = ? AND datetime(e.occurred_at) >= datetime(?) AND datetime(e.occurred_at) < datetime(?)`)
        .all(ownerId, from, to) as Row[]).map(formatOutcomeEvent);
    }
    const explicit = (this.database.prepare(`SELECT e.*, i.food_name, i.category, i.expiration_date
      FROM inventory_outcome_events e JOIN inventory_items i ON i.id = e.inventory_item_id
      WHERE e.scope = 'personal' AND e.user_id = ? AND datetime(e.occurred_at) >= datetime(?) AND datetime(e.occurred_at) < datetime(?)`)
      .all(ownerId, from, to) as Row[]).map(formatOutcomeEvent);
    const changes = (this.database.prepare(`SELECT l.*, i.food_name, i.category, i.expiration_date
      FROM inventory_change_logs l JOIN inventory_items i ON i.id = l.inventory_item_id
      WHERE l.user_id = ? AND l.action IN ('consume_all', 'consume_partial')
        AND datetime(l.created_at) >= datetime(?) AND datetime(l.created_at) < datetime(?)`)
      .all(ownerId, from, to) as Row[]).map(formatChangeEvent);
    return [...explicit, ...changes];
  }

  async findActionable(scope: InventoryScope, ownerId: number, weekStart: string) {
    const row = scope === "personal"
      ? this.database.prepare(`SELECT category, COUNT(*) AS count FROM inventory_items
          WHERE user_id = ? AND is_available = 1 AND deleted_at IS NULL
            AND expiration_date >= ? AND expiration_date <= date(?, '+3 day')
          GROUP BY category ORDER BY count DESC LIMIT 1`).get(ownerId, weekStart, weekStart) as Row | undefined
      : this.database.prepare(`SELECT category, COUNT(*) AS count FROM household_inventory_items
          WHERE household_id = ? AND is_available = 1
            AND expiration_date >= ? AND expiration_date <= date(?, '+3 day')
          GROUP BY category ORDER BY count DESC LIMIT 1`).get(ownerId, weekStart, weekStart) as Row | undefined;
    return row ? { category: String(row.category), count: Number(row.count) } : null;
  }
}
