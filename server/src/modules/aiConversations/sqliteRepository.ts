import type Database from "better-sqlite3";
import type { AIConversationsRepository } from "./repository.js";
import type { LegacyInventoryScanJob, StoredChatTurn } from "./types.js";

type ScanRow = {
  id: string;
  status: string;
  result_json: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

export class SqliteAIConversationsRepository implements AIConversationsRepository {
  private readonly database: Database.Database;
  constructor(database: Database.Database) { this.database = database; }

  async recordTurn(turn: StoredChatTurn) {
    return this.database.transaction(() => {
      const requestedAt = this.storedDateTime(turn.requestedAt);
      const deletedAfterRequest = this.database.prepare(`SELECT 1 FROM ai_chat_session_deletions
        WHERE user_id=? AND session_id=? AND deleted_at>=? LIMIT 1`).get(turn.userId, turn.sessionId, requestedAt);
      if (deletedAfterRequest) return false;
      const insert = this.database.prepare(`INSERT INTO ai_chat_messages
        (user_id,session_id,role,content,response_time_ms,source,status,payload_json,confirmation_id,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)`);
      for (const content of turn.systemContents) {
        insert.run(turn.userId, turn.sessionId, "system", content, null, turn.source, "completed", null, null, requestedAt);
      }
      insert.run(turn.userId, turn.sessionId, "user", turn.userContent, null, turn.source, "completed", null, null, requestedAt);
      insert.run(turn.userId, turn.sessionId, "assistant", turn.assistantContent, turn.responseTimeMs, turn.source,
        turn.status, turn.payload ? JSON.stringify(turn.payload) : null, turn.confirmationId, this.storedDateTime(turn.respondedAt));
      return true;
    })();
  }

  async deleteConversation(userId: number, sessionId: string) {
    return this.database.transaction(() => {
      this.database.prepare(`DELETE FROM agent_run_media WHERE user_id=? AND run_id IN
        (SELECT id FROM agent_runs WHERE user_id=? AND session_id=?)`).run(userId, userId, sessionId);
      const deleted = this.database.prepare("DELETE FROM ai_chat_messages WHERE user_id=? AND session_id=?")
        .run(userId, sessionId).changes;
      this.database.prepare(`INSERT INTO ai_chat_session_deletions(user_id,session_id,deleted_at)
        VALUES(?,?,strftime('%Y-%m-%d %H:%M:%f','now'))
        ON CONFLICT(user_id,session_id) DO UPDATE SET deleted_at=excluded.deleted_at`).run(userId, sessionId);
      return deleted;
    })();
  }

  async legacyInventoryScanJob(id: string, userId: number): Promise<LegacyInventoryScanJob | null> {
    const row = this.database.prepare(`SELECT id,status,result_json,error_message,created_at,updated_at
      FROM inventory_scan_jobs WHERE id=? AND user_id=?`).get(id, userId) as ScanRow | undefined;
    if (!row) return null;
    return { id: row.id, status: row.status, result: this.json(row.result_json), errorMessage: row.error_message,
      createdAt: row.created_at, updatedAt: row.updated_at };
  }

  private storedDateTime(value: string) { return value.slice(0, 23).replace("T", " "); }
  private json(value: string | null) {
    if (value === null) return undefined;
    try { return JSON.parse(value) as unknown; } catch { return undefined; }
  }
}
