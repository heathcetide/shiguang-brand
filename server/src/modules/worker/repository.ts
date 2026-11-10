import type { WorkerRunQuery, WorkerRunsPage, WorkerRunStatus, WorkerTaskName, WorkerTaskResult } from "./types.js";

/** Driver-neutral persistence port for worker leases, outcomes, and observability. */
export interface WorkerRepository {
  acquireLease(taskName: WorkerTaskName, workerId: string, leaseMs: number): Promise<boolean>;
  ownsLease(taskName: WorkerTaskName, ownerId: string): Promise<boolean>;
  releaseLease(taskName: WorkerTaskName, workerId: string): Promise<boolean>;
  createRun(runId: string, taskName: WorkerTaskName, workerId: string): Promise<void>;
  completeRun(
    runId: string,
    status: Exclude<WorkerRunStatus, "running">,
    durationMs: number,
    result: WorkerTaskResult,
    errorMessage: string | null,
    leaseOwnerId: string,
  ): Promise<boolean>;
  failRun(runId: string, durationMs: number, errorMessage: string): Promise<void>;
  listRuns(query: WorkerRunQuery): Promise<WorkerRunsPage>;
}
