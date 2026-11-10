import type { Pool, PoolClient } from "pg";
import type { AIWriteConfirmationsRepository } from "./repository.js";
import type { AIWriteAction, AIWriteConfirmation, PreparedAIWrite } from "./types.js";

type Row = Record<string, unknown>;

export class PostgresAIWriteConfirmationsRepository implements AIWriteConfirmationsRepository {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }

  async createPreview(input: { id: string; userId: number; action: AIWriteAction; payload: Record<string, unknown>;
    conversationId?: string; sourceMessageId?: string }) {
    return this.tx(async (client) => {
      const row = (await client.query(`INSERT INTO ai_write_confirmations
        (id,user_id,conversation_id,source_message_id,action,payload_json,expires_at)
        VALUES($1,$2,$3,$4,$5,$6::jsonb,CURRENT_TIMESTAMP+INTERVAL '15 minutes') RETURNING expires_at`,
      [input.id, input.userId, input.conversationId ?? null, input.sourceMessageId ?? null, input.action,
        JSON.stringify(input.payload)])).rows[0];
      await this.audit(client, input.id, input.userId, input.action, "preview_created", { payload: input.payload });
      return { expiresAt: this.iso(row.expires_at) };
    });
  }

  async confirmation(id: string, userId: number) {
    const row = (await this.pool.query("SELECT * FROM ai_write_confirmations WHERE id=$1 AND user_id=$2", [id, userId])).rows[0];
    return row ? this.mapConfirmation(row) : null;
  }

  async commit(input: { id: string; userId: number; idempotencyKey: string; prepared: PreparedAIWrite }) {
    return this.tx(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`ai-write:${input.userId}:${input.idempotencyKey}`]);
      const row = (await client.query("SELECT * FROM ai_write_confirmations WHERE id=$1 AND user_id=$2 FOR UPDATE",
        [input.id, input.userId])).rows[0];
      if (!row) return { kind: "missing" as const };
      const confirmation = this.mapConfirmation(row);
      if (confirmation.status === "committed") return { kind: "repeated" as const, result: confirmation.committedResult ?? {} };
      if (confirmation.status !== "preview") return { kind: "invalid" as const };
      if (Date.parse(confirmation.expiresAt) <= Date.now()) {
        await client.query("UPDATE ai_write_confirmations SET status='expired',updated_at=CURRENT_TIMESTAMP WHERE id=$1", [input.id]);
        await this.audit(client, input.id, input.userId, confirmation.action, "preview_expired");
        return { kind: "expired" as const };
      }
      const existing = (await client.query(`SELECT committed_result_json FROM ai_write_confirmations
        WHERE user_id=$1 AND idempotency_key=$2 AND status='committed'`, [input.userId, input.idempotencyKey])).rows[0];
      if (existing) return { kind: "repeated" as const, result: this.object(existing.committed_result_json) };
      const result = await this.execute(client, input.userId, input.prepared);
      await client.query(`UPDATE ai_write_confirmations SET status='committed',idempotency_key=$1,committed_result_json=$2::jsonb,
        committed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$3 AND status='preview'`,
      [input.idempotencyKey, JSON.stringify(result), input.id]);
      await this.audit(client, input.id, input.userId, confirmation.action, "committed", { result });
      return { kind: "committed" as const, result };
    });
  }

  private async execute(client: PoolClient, userId: number, write: PreparedAIWrite) {
    if (write.kind === "diet") {
      const row = (await client.query(`INSERT INTO diet_records
        (user_id,meal_type,food_name,amount,calories,protein,carbs,fat,recorded_at,recorded_time)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, [userId, write.mealType, write.foodName, write.amount,
        write.calories, write.protein, write.carbs, write.fat, write.recordedAt, write.recordedTime])).rows[0];
      return { action: write.action, id: Number(row.id), message: write.message };
    }
    if (write.kind === "inventory") {
      const row = (await client.query(`INSERT INTO inventory_items
        (user_id,food_name,category,storage_location,quantity,expiration_date) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
      [userId, write.name, write.category, write.location, write.quantity, write.expirationDate])).rows[0];
      return { action: write.action, id: Number(row.id), message: write.message };
    }
    if (write.kind === "kitchenware") {
      const row = (await client.query(`INSERT INTO kitchenware_items(user_id,name,category,status,note)
        VALUES($1,$2,$3,$4,$5) RETURNING id`, [userId, write.name, write.category, write.status, write.note])).rows[0];
      return { action: write.action, id: Number(row.id), message: write.message };
    }
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`ai-health:${userId}:${write.recordedDate}`]);
    const existing = (await client.query("SELECT id FROM health_logs WHERE user_id=$1 AND recorded_date=$2 FOR UPDATE",
      [userId, write.recordedDate])).rows[0];
    if (existing) await client.query(`UPDATE health_logs SET weight=COALESCE($1,weight),body_fat=COALESCE($2,body_fat),
      water_ml=COALESCE($3,water_ml) WHERE id=$4`, [write.weight, write.bodyFat, write.waterMl, existing.id]);
    else await client.query("INSERT INTO health_logs(user_id,weight,body_fat,water_ml,recorded_date) VALUES($1,$2,$3,$4,$5)",
      [userId, write.weight, write.bodyFat, write.waterMl, write.recordedDate]);
    return { action: write.action, message: write.message };
  }

  private async audit(client: PoolClient, id: string, userId: number, action: AIWriteAction, event: string, details?: unknown) {
    await client.query(`INSERT INTO ai_write_audit_logs(confirmation_id,user_id,action,event,details_json)
      VALUES($1,$2,$3,$4,$5::jsonb)`, [id, userId, action, event, details === undefined ? null : JSON.stringify(details)]);
  }
  private object(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
  private iso(value: unknown) { return value instanceof Date ? value.toISOString() : String(value); }
  private mapConfirmation(row: Row): AIWriteConfirmation {
    return { id: String(row.id), userId: Number(row.user_id), action: String(row.action) as AIWriteAction,
      payload: this.object(row.payload_json), status: String(row.status) as AIWriteConfirmation["status"],
      committedResult: row.committed_result_json == null ? null : this.object(row.committed_result_json), expiresAt: this.iso(row.expires_at) };
  }
  private async tx<T>(work: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try { await client.query("BEGIN"); const result = await work(client); await client.query("COMMIT"); return result; }
    catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
}
