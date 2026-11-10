import type Database from "better-sqlite3";
import type { AIWriteConfirmationsRepository } from "./repository.js";
import type { AIWriteAction, AIWriteConfirmation, PreparedAIWrite } from "./types.js";

type Row = Record<string, unknown>;

export class SqliteAIWriteConfirmationsRepository implements AIWriteConfirmationsRepository {
  private readonly database: Database.Database;
  constructor(database: Database.Database) { this.database = database; }

  async createPreview(input: { id: string; userId: number; action: AIWriteAction; payload: Record<string, unknown>;
    conversationId?: string; sourceMessageId?: string }) {
    return this.database.transaction(() => {
      this.database.prepare(`INSERT INTO ai_write_confirmations
        (id,user_id,conversation_id,source_message_id,action,payload_json,expires_at)
        VALUES(?,?,?,?,?,?,datetime('now','+15 minutes'))`).run(input.id, input.userId, input.conversationId ?? null,
        input.sourceMessageId ?? null, input.action, JSON.stringify(input.payload));
      this.audit(input.id, input.userId, input.action, "preview_created", { payload: input.payload });
      const row = this.database.prepare("SELECT expires_at FROM ai_write_confirmations WHERE id=?").get(input.id) as { expires_at: string };
      return { expiresAt: row.expires_at };
    })();
  }

  async confirmation(id: string, userId: number) {
    const row = this.database.prepare("SELECT * FROM ai_write_confirmations WHERE id=? AND user_id=?").get(id, userId) as Row | undefined;
    return row ? this.mapConfirmation(row) : null;
  }

  async commit(input: { id: string; userId: number; idempotencyKey: string; prepared: PreparedAIWrite }) {
    return this.database.transaction(() => {
      const row = this.database.prepare("SELECT * FROM ai_write_confirmations WHERE id=? AND user_id=?")
        .get(input.id, input.userId) as Row | undefined;
      if (!row) return { kind: "missing" as const };
      const confirmation = this.mapConfirmation(row);
      if (confirmation.status === "committed") return { kind: "repeated" as const, result: confirmation.committedResult ?? {} };
      if (confirmation.status !== "preview") return { kind: "invalid" as const };
      if (this.timestamp(confirmation.expiresAt) <= Date.now()) {
        this.database.prepare("UPDATE ai_write_confirmations SET status='expired',updated_at=CURRENT_TIMESTAMP WHERE id=?")
          .run(input.id);
        this.audit(input.id, input.userId, confirmation.action, "preview_expired");
        return { kind: "expired" as const };
      }
      const existing = this.database.prepare(`SELECT committed_result_json FROM ai_write_confirmations
        WHERE user_id=? AND idempotency_key=? AND status='committed'`).get(input.userId, input.idempotencyKey) as Row | undefined;
      if (existing) return { kind: "repeated" as const, result: this.object(existing.committed_result_json) };
      const result = this.execute(input.userId, input.prepared);
      this.database.prepare(`UPDATE ai_write_confirmations SET status='committed',idempotency_key=?,committed_result_json=?,
        committed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='preview'`)
        .run(input.idempotencyKey, JSON.stringify(result), input.id);
      this.audit(input.id, input.userId, confirmation.action, "committed", { result });
      return { kind: "committed" as const, result };
    })();
  }

  private execute(userId: number, write: PreparedAIWrite) {
    if (write.kind === "diet") {
      const result = this.database.prepare(`INSERT INTO diet_records
        (user_id,meal_type,food_name,amount,calories,protein,carbs,fat,recorded_at,recorded_time) VALUES(?,?,?,?,?,?,?,?,?,?)`)
        .run(userId, write.mealType, write.foodName, write.amount, write.calories, write.protein, write.carbs, write.fat,
          write.recordedAt, write.recordedTime);
      return { action: write.action, id: Number(result.lastInsertRowid), message: write.message };
    }
    if (write.kind === "inventory") {
      const result = this.database.prepare(`INSERT INTO inventory_items
        (user_id,food_name,category,storage_location,quantity,expiration_date) VALUES(?,?,?,?,?,?)`)
        .run(userId, write.name, write.category, write.location, write.quantity, write.expirationDate);
      return { action: write.action, id: Number(result.lastInsertRowid), message: write.message };
    }
    if (write.kind === "kitchenware") {
      const result = this.database.prepare("INSERT INTO kitchenware_items(user_id,name,category,status,note) VALUES(?,?,?,?,?)")
        .run(userId, write.name, write.category, write.status, write.note);
      return { action: write.action, id: Number(result.lastInsertRowid), message: write.message };
    }
    const existing = this.database.prepare("SELECT id FROM health_logs WHERE user_id=? AND recorded_date=?")
      .get(userId, write.recordedDate) as { id: number } | undefined;
    if (existing) this.database.prepare(`UPDATE health_logs SET weight=COALESCE(?,weight),body_fat=COALESCE(?,body_fat),
      water_ml=COALESCE(?,water_ml) WHERE id=?`).run(write.weight, write.bodyFat, write.waterMl, existing.id);
    else this.database.prepare("INSERT INTO health_logs(user_id,weight,body_fat,water_ml,recorded_date) VALUES(?,?,?,?,?)")
      .run(userId, write.weight, write.bodyFat, write.waterMl, write.recordedDate);
    return { action: write.action, message: write.message };
  }

  private audit(id: string, userId: number, action: AIWriteAction, event: string, details?: unknown) {
    this.database.prepare(`INSERT INTO ai_write_audit_logs(confirmation_id,user_id,action,event,details_json) VALUES(?,?,?,?,?)`)
      .run(id, userId, action, event, details === undefined ? null : JSON.stringify(details));
  }
  private object(value: unknown) {
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
    try { const parsed = JSON.parse(String(value || "{}")); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; }
    catch { return {}; }
  }
  private timestamp(value: string) { return Date.parse(value.includes("T") ? value : `${value.replace(" ", "T")}Z`); }
  private mapConfirmation(row: Row): AIWriteConfirmation {
    return { id: String(row.id), userId: Number(row.user_id), action: String(row.action) as AIWriteAction,
      payload: this.object(row.payload_json), status: String(row.status) as AIWriteConfirmation["status"],
      committedResult: row.committed_result_json == null ? null : this.object(row.committed_result_json), expiresAt: String(row.expires_at) };
  }
}
