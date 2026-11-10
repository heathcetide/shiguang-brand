import type Database from "better-sqlite3";
import type { WorkerRepository } from "./repository.js";
import type { WorkerRunQuery, WorkerTaskName, WorkerTaskResult } from "./types.js";

function parsedResult(value: unknown) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") return {};
  try { return JSON.parse(value) as unknown; } catch { return {}; }
}

export class SqliteWorkerRepository implements WorkerRepository {
  private readonly database: Database.Database;

  constructor(database: Database.Database) {
    this.database = database;
  }

  async acquireLease(taskName: WorkerTaskName, workerId: string, leaseMs: number) {
    const leaseSeconds = Math.ceil(leaseMs / 1_000);
    const result = this.database.prepare(`
      INSERT INTO worker_task_leases (task_name, owner_id, lease_expires_at)
      VALUES (?, ?, datetime('now', ?))
      ON CONFLICT(task_name) DO UPDATE SET
        owner_id = excluded.owner_id,
        lease_expires_at = excluded.lease_expires_at,
        updated_at = CURRENT_TIMESTAMP
      WHERE worker_task_leases.lease_expires_at <= CURRENT_TIMESTAMP
    `).run(taskName, workerId, `+${leaseSeconds} seconds`);
    return result.changes > 0;
  }

  async ownsLease(taskName: WorkerTaskName, ownerId: string) {
    return Boolean(this.database.prepare(`
      SELECT 1 FROM worker_task_leases
      WHERE task_name = ? AND owner_id = ? AND lease_expires_at > CURRENT_TIMESTAMP
    `).get(taskName, ownerId));
  }

  async releaseLease(taskName: WorkerTaskName, workerId: string) {
    return this.database.prepare("DELETE FROM worker_task_leases WHERE task_name = ? AND owner_id = ?")
      .run(taskName, workerId).changes > 0;
  }

  async createRun(runId: string, taskName: WorkerTaskName, workerId: string) {
    this.database.prepare(`
      INSERT INTO worker_task_runs (id, task_name, worker_id, status)
      VALUES (?, ?, ?, 'running')
    `).run(runId, taskName, workerId);
  }

  async completeRun(runId: string, status: "completed" | "failed", durationMs: number, result: WorkerTaskResult, errorMessage: string | null, leaseOwnerId: string) {
    const updated = this.database.prepare(`
      UPDATE worker_task_runs SET status = ?, finished_at = CURRENT_TIMESTAMP,
        duration_ms = ?, processed_count = ?, succeeded_count = ?, failed_count = ?, result_json = ?,
        error_message = ? WHERE id = ? AND status = 'running'
        AND EXISTS (SELECT 1 FROM worker_task_leases
          WHERE task_name = worker_task_runs.task_name AND owner_id = ? AND lease_expires_at > CURRENT_TIMESTAMP)
    `).run(
      status,
      durationMs,
      result.processed,
      result.succeeded,
      result.failed,
      JSON.stringify(result.details ?? {}),
      errorMessage,
      runId,
      leaseOwnerId,
    );
    return updated.changes === 1;
  }

  async failRun(runId: string, durationMs: number, errorMessage: string) {
    this.database.prepare(`
      UPDATE worker_task_runs SET status = 'failed', finished_at = CURRENT_TIMESTAMP,
        duration_ms = ?, failed_count = 1, error_message = ? WHERE id = ?
    `).run(durationMs, errorMessage, runId);
  }

  async listRuns(query: WorkerRunQuery) {
    const filters: string[] = [];
    const params: string[] = [];
    if (query.taskName) { filters.push("task_name = ?"); params.push(query.taskName); }
    if (query.status) { filters.push("status = ?"); params.push(query.status); }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const total = (this.database.prepare(`SELECT COUNT(*) AS count FROM worker_task_runs ${where}`)
      .get(...params) as { count: number }).count;
    const rows = this.database.prepare(`
      SELECT id, task_name AS taskName, worker_id AS workerId, status,
        started_at AS startedAt, finished_at AS finishedAt, duration_ms AS durationMs,
        processed_count AS processed, succeeded_count AS succeeded, failed_count AS failed,
        result_json AS resultJson, error_message AS errorMessage
      FROM worker_task_runs ${where}
      ORDER BY started_at DESC, id DESC LIMIT ? OFFSET ?
    `).all(...params, query.pageSize, (query.page - 1) * query.pageSize) as Array<Record<string, unknown>>;
    const leases = this.database.prepare(`
      SELECT task_name AS taskName, owner_id AS ownerId,
        lease_expires_at AS leaseExpiresAt, updated_at AS updatedAt
      FROM worker_task_leases ORDER BY task_name
    `).all() as Array<Record<string, unknown>>;
    return {
      items: rows.map(({ resultJson, ...item }) => ({ ...item, result: parsedResult(resultJson) })),
      leases,
      total: Number(total),
      page: query.page,
      pageSize: query.pageSize,
    };
  }
}
