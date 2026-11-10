import type Database from "better-sqlite3";
import type { AIRuntimeRepository } from "./repository.js";
import type { AIUsageWrite } from "./types.js";

export class SqliteAIRuntimeRepository implements AIRuntimeRepository {
  private readonly database: Database.Database;
  constructor(database: Database.Database) { this.database = database; }

  async settings(keys: string[]) {
    return this.readSettings(keys);
  }

  private readSettings(keys: string[]) {
    if (!keys.length) return {};
    const placeholders = keys.map(() => "?").join(",");
    const rows = this.database.prepare(`SELECT key, value FROM system_settings WHERE key IN (${placeholders})`)
      .all(...keys) as Array<{ key: string; value: string }>;
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
  }

  async saveSettings(entries: Array<{ key: string; value: string }>) {
    this.writeSettings(entries);
  }

  async compareAndSaveSetting(key: string, previous: string | null, value: string | null, expected: Record<string, string | null> = {}, entries: Array<{ key: string; value: string }> = []) {
    return this.writeSettings([...entries, ...(value === null ? [] : [{ key, value }])], { ...expected, [key]: previous });
  }

  private writeSettings(entries: Array<{ key: string; value: string }>, expected?: Record<string, string | null>) {
    const statement = this.database.prepare(`INSERT INTO system_settings (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`);
    // Acquire the write lock before reading the expected value. Legacy batch
    // writes and resource CAS share the same atomic repository write boundary.
    return this.database.transaction(() => {
      if (expected) {
        const current = this.readSettings(Object.keys(expected));
        if (Object.entries(expected).some(([key, value]) => (current[key] ?? null) !== value)) return false;
      }
      for (const entry of entries) statement.run(entry.key, entry.value);
      return true;
    }).immediate();
  }

  async recordUsage(input: AIUsageWrite) {
    this.database.prepare(`INSERT INTO ai_usage_logs (user_id, endpoint, model, prompt_tokens, completion_tokens, total_tokens,
      latency_ms, success, estimated_cost_usd, failure_reason, run_id, agent_name, phase) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(input.userId, input.endpoint, input.model, input.promptTokens, input.completionTokens, input.totalTokens,
        input.latencyMs, input.success ? 1 : 0, input.estimatedCostUsd, input.failureReason || null, input.runId || null,
        input.agentName?.slice(0, 80) || null, input.phase?.slice(0, 80) || null);
  }
}
