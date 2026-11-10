import type Database from "better-sqlite3";
import type { AgentSchedulingRepository } from "./repository.js";

export class SqliteAgentSchedulingRepository implements AgentSchedulingRepository {
  private readonly database: Database.Database;

  constructor(database: Database.Database) { this.database = database; }

  async claimQueuedRuns(userId: number, maxRunning: number) {
    return this.database.transaction(() => {
      const running = this.database.prepare(`SELECT COUNT(*) AS count FROM agent_runs
        WHERE user_id = ? AND status = 'running'`).get(userId) as { count: number };
      const slots = Math.max(0, maxRunning - Number(running.count));
      if (!slots) return [];
      const queued = this.database.prepare(`SELECT id FROM agent_runs
        WHERE user_id = ? AND status = 'queued' ORDER BY created_at, id LIMIT ?`)
        .all(userId, slots) as Array<{ id: string }>;
      const claim = this.database.prepare(`UPDATE agent_runs SET status = 'running',
        started_at = COALESCE(started_at, strftime('%Y-%m-%d %H:%M:%f', 'now')),
        updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND status = 'queued'`);
      return queued.flatMap(({ id }) => claim.run(id, userId).changes ? [id] : []);
    })();
  }

  async expireAwaitingApproval(runId: string, userId: number) {
    return this.database.prepare(`UPDATE agent_actions SET status = 'expired', updated_at = CURRENT_TIMESTAMP
      WHERE run_id = ? AND user_id = ? AND status = 'awaiting_approval'`).run(runId, userId).changes;
  }

  async resetInterruptedRuns() {
    return this.database.prepare(`UPDATE agent_runs SET status = 'queued', updated_at = CURRENT_TIMESTAMP
      WHERE status = 'running'`).run().changes;
  }
}
