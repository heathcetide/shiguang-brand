import type { Pool } from "pg";
import type { WorkerRepository } from "./repository.js";
import type { WorkerRunQuery, WorkerTaskName, WorkerTaskResult } from "./types.js";

export class PostgresWorkerRepository implements WorkerRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async acquireLease(taskName: WorkerTaskName, workerId: string, leaseMs: number) {
    const result = await this.pool.query(`
      INSERT INTO worker_task_leases (task_name, owner_id, lease_expires_at)
      VALUES ($1, $2, CURRENT_TIMESTAMP + ($3::double precision * INTERVAL '1 millisecond'))
      ON CONFLICT(task_name) DO UPDATE SET
        owner_id = EXCLUDED.owner_id,
        lease_expires_at = EXCLUDED.lease_expires_at,
        updated_at = CURRENT_TIMESTAMP
      WHERE worker_task_leases.lease_expires_at <= CURRENT_TIMESTAMP
      RETURNING task_name
    `, [taskName, workerId, leaseMs]);
    return result.rowCount === 1;
  }

  async ownsLease(taskName: WorkerTaskName, ownerId: string) {
    const result = await this.pool.query(`
      SELECT 1 FROM worker_task_leases
      WHERE task_name = $1 AND owner_id = $2 AND lease_expires_at > CURRENT_TIMESTAMP
    `, [taskName, ownerId]);
    return result.rowCount === 1;
  }

  async releaseLease(taskName: WorkerTaskName, workerId: string) {
    const result = await this.pool.query(`
      DELETE FROM worker_task_leases WHERE task_name = $1 AND owner_id = $2
    `, [taskName, workerId]);
    return result.rowCount === 1;
  }

  async createRun(runId: string, taskName: WorkerTaskName, workerId: string) {
    await this.pool.query(`
      INSERT INTO worker_task_runs (id, task_name, worker_id, status)
      VALUES ($1, $2, $3, 'running')
    `, [runId, taskName, workerId]);
  }

  async completeRun(runId: string, status: "completed" | "failed", durationMs: number, result: WorkerTaskResult, errorMessage: string | null, leaseOwnerId: string) {
    const updated = await this.pool.query(`
      UPDATE worker_task_runs SET status = $1, finished_at = CURRENT_TIMESTAMP,
        duration_ms = $2, processed_count = $3, succeeded_count = $4, failed_count = $5,
        result_json = $6::jsonb, error_message = $7 WHERE id = $8 AND status = 'running'
        AND EXISTS (SELECT 1 FROM worker_task_leases
          WHERE task_name = worker_task_runs.task_name AND owner_id = $9 AND lease_expires_at > CURRENT_TIMESTAMP)
    `, [
      status,
      durationMs,
      result.processed,
      result.succeeded,
      result.failed,
      JSON.stringify(result.details ?? {}),
      errorMessage,
      runId,
      leaseOwnerId,
    ]);
    return updated.rowCount === 1;
  }

  async failRun(runId: string, durationMs: number, errorMessage: string) {
    await this.pool.query(`
      UPDATE worker_task_runs SET status = 'failed', finished_at = CURRENT_TIMESTAMP,
        duration_ms = $1, failed_count = 1, error_message = $2 WHERE id = $3
    `, [durationMs, errorMessage, runId]);
  }

  async listRuns(query: WorkerRunQuery) {
    const clauses: string[] = [];
    const values: Array<string | number> = [];
    if (query.taskName) { values.push(query.taskName); clauses.push(`task_name = $${values.length}`); }
    if (query.status) { values.push(query.status); clauses.push(`status = $${values.length}`); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const count = await this.pool.query(`SELECT COUNT(*)::integer AS count FROM worker_task_runs ${where}`, values);
    values.push(query.pageSize, (query.page - 1) * query.pageSize);
    const rows = await this.pool.query(`
      SELECT id, task_name AS "taskName", worker_id AS "workerId", status,
        started_at AS "startedAt", finished_at AS "finishedAt", duration_ms AS "durationMs",
        processed_count AS processed, succeeded_count AS succeeded, failed_count AS failed,
        result_json AS result, error_message AS "errorMessage"
      FROM worker_task_runs ${where}
      ORDER BY started_at DESC, id DESC LIMIT $${values.length - 1} OFFSET $${values.length}
    `, values);
    const leases = await this.pool.query(`
      SELECT task_name AS "taskName", owner_id AS "ownerId",
        lease_expires_at AS "leaseExpiresAt", updated_at AS "updatedAt"
      FROM worker_task_leases ORDER BY task_name
    `);
    return {
      items: rows.rows,
      leases: leases.rows,
      total: Number(count.rows[0]?.count ?? 0),
      page: query.page,
      pageSize: query.pageSize,
    };
  }
}
