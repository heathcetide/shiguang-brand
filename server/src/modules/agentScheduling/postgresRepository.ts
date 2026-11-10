import type { Pool, PoolClient } from "pg";
import type { AgentSchedulingRepository } from "./repository.js";

export class PostgresAgentSchedulingRepository implements AgentSchedulingRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) { this.pool = pool; }

  async claimQueuedRuns(userId: number, maxRunning: number) {
    return this.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`agent-scheduling:${userId}`]);
      const running = await client.query(`SELECT COUNT(*)::integer AS count FROM agent_runs
        WHERE user_id=$1 AND status='running'`, [userId]);
      const slots = Math.max(0, maxRunning - Number(running.rows[0]?.count));
      if (!slots) return [];
      const queued = await client.query(`SELECT id FROM agent_runs WHERE user_id=$1 AND status='queued'
        ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT $2`, [userId, slots]);
      const ids = queued.rows.map((row) => String(row.id));
      if (!ids.length) return [];
      await client.query(`UPDATE agent_runs SET status='running',started_at=COALESCE(started_at,CURRENT_TIMESTAMP),
        updated_at=CURRENT_TIMESTAMP WHERE id=ANY($1::text[]) AND user_id=$2 AND status='queued'`, [ids, userId]);
      return ids;
    });
  }

  async expireAwaitingApproval(runId: string, userId: number) {
    const result = await this.pool.query(`UPDATE agent_actions SET status='expired',updated_at=CURRENT_TIMESTAMP
      WHERE run_id=$1 AND user_id=$2 AND status='awaiting_approval'`, [runId, userId]);
    return result.rowCount ?? 0;
  }

  async resetInterruptedRuns() {
    const result = await this.pool.query(`UPDATE agent_runs SET status='queued',updated_at=CURRENT_TIMESTAMP
      WHERE status='running'`);
    return result.rowCount ?? 0;
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
