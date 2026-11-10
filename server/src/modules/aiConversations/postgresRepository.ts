import type { Pool, PoolClient } from "pg";
import type { AIConversationsRepository } from "./repository.js";
import type { LegacyInventoryScanJob, StoredChatTurn } from "./types.js";

type Row = Record<string, unknown>;

export class PostgresAIConversationsRepository implements AIConversationsRepository {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }

  async recordTurn(turn: StoredChatTurn) {
    return this.tx(async (client) => {
      await this.lockConversation(client, turn.userId, turn.sessionId);
      const deleted = (await client.query(`SELECT 1 FROM ai_chat_session_deletions
        WHERE user_id=$1 AND session_id=$2 AND deleted_at >= $3::timestamptz LIMIT 1`,
      [turn.userId, turn.sessionId, turn.requestedAt])).rows[0];
      if (deleted) return false;
      const insert = async (role: string, content: string, responseTime: number | null, status: string,
        payload: Record<string, unknown> | null, confirmationId: string | null, createdAt: string) => {
        await client.query(`INSERT INTO ai_chat_messages
          (user_id,session_id,role,content,response_time_ms,source,status,payload_json,confirmation_id,created_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::timestamptz)`,
        [turn.userId, turn.sessionId, role, content, responseTime, turn.source, status,
          payload ? JSON.stringify(payload) : null, confirmationId, createdAt]);
      };
      for (const content of turn.systemContents) await insert("system", content, null, "completed", null, null, turn.requestedAt);
      await insert("user", turn.userContent, null, "completed", null, null, turn.requestedAt);
      await insert("assistant", turn.assistantContent, turn.responseTimeMs, turn.status, turn.payload,
        turn.confirmationId, turn.respondedAt);
      return true;
    });
  }

  async deleteConversation(userId: number, sessionId: string) {
    return this.tx(async (client) => {
      await this.lockConversation(client, userId, sessionId);
      await client.query(`DELETE FROM agent_run_media WHERE user_id=$1 AND run_id IN
        (SELECT id FROM agent_runs WHERE user_id=$1 AND session_id=$2)`, [userId, sessionId]);
      const deleted = await client.query("DELETE FROM ai_chat_messages WHERE user_id=$1 AND session_id=$2", [userId, sessionId]);
      await client.query(`INSERT INTO ai_chat_session_deletions(user_id,session_id,deleted_at)
        VALUES($1,$2,CURRENT_TIMESTAMP) ON CONFLICT(user_id,session_id) DO UPDATE SET deleted_at=excluded.deleted_at`,
      [userId, sessionId]);
      return deleted.rowCount ?? 0;
    });
  }

  async legacyInventoryScanJob(id: string, userId: number): Promise<LegacyInventoryScanJob | null> {
    const row = (await this.pool.query(`SELECT id,status,result_json,error_message,created_at,updated_at
      FROM inventory_scan_jobs WHERE id=$1 AND user_id=$2`, [id, userId])).rows[0] as Row | undefined;
    if (!row) return null;
    return { id: String(row.id), status: String(row.status), result: row.result_json ?? undefined, errorMessage: row.error_message == null
      ? null : String(row.error_message), createdAt: this.iso(row.created_at), updatedAt: this.iso(row.updated_at) };
  }

  private lockConversation(client: PoolClient, userId: number, sessionId: string) {
    return client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`ai-conversation:${userId}:${sessionId}`]);
  }
  private iso(value: unknown) { return value instanceof Date ? value.toISOString() : String(value); }
  private async tx<T>(work: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try { await client.query("BEGIN"); const result = await work(client); await client.query("COMMIT"); return result; }
    catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
}
