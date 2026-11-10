import type { Pool, PoolClient } from "pg";
import type { AIRuntimeRepository } from "./repository.js";
import type { AIUsageWrite } from "./types.js";

export class PostgresAIRuntimeRepository implements AIRuntimeRepository {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }

  async settings(keys: string[]) {
    if (!keys.length) return {};
    const rows = (await this.pool.query("SELECT key, value FROM system_settings WHERE key = ANY($1::text[])", [keys])).rows;
    return Object.fromEntries(rows.map((row) => [String(row.key), String(row.value)]));
  }

  async saveSettings(entries: Array<{ key: string; value: string }>) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('ai-runtime-settings'))");
      for (const entry of entries) await this.upsert(client, entry);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async compareAndSaveSetting(key: string, previous: string | null, value: string | null, expected?: Record<string, string | null>, entries: Array<{ key: string; value: string }> = []) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('ai-runtime-settings'))");
      if (expected || value === null) {
        const snapshot = { ...expected, [key]: previous };
        const rows = (await client.query("SELECT key, value FROM system_settings WHERE key = ANY($1::text[])", [Object.keys(snapshot)])).rows;
        const current = Object.fromEntries(rows.map(row => [row.key, row.value]));
        if (Object.entries(snapshot).some(([key, value]) => (current[key] ?? null) !== value)) {
          await client.query("ROLLBACK"); return false;
        }
      }
      const result = value === null ? { rowCount: 1 } : previous === null
        ? await client.query("INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP) ON CONFLICT(key) DO NOTHING", [key, value])
        : await client.query("UPDATE system_settings SET value = $1, updated_at = CURRENT_TIMESTAMP WHERE key = $2 AND value = $3", [value, key, previous]);
      if (result.rowCount === 1) for (const entry of entries) await this.upsert(client, entry);
      await client.query("COMMIT");
      return result.rowCount === 1;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async recordUsage(input: AIUsageWrite) {
    await this.pool.query(`INSERT INTO ai_usage_logs (user_id, endpoint, model, prompt_tokens, completion_tokens, total_tokens,
      latency_ms, success, estimated_cost_usd, failure_reason, run_id, agent_name, phase)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [input.userId, input.endpoint, input.model, input.promptTokens, input.completionTokens, input.totalTokens,
      input.latencyMs, input.success, input.estimatedCostUsd, input.failureReason || null, input.runId || null,
      input.agentName?.slice(0, 80) || null, input.phase?.slice(0, 80) || null]);
  }

  private upsert(client: PoolClient, entry: { key: string; value: string }) {
    return client.query(`INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`, [entry.key, entry.value]);
  }
}
