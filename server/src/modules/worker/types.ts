export const WORKER_TASK_NAMES = ["intervention-delivery", "notifications", "media-cleanup", "plan-maintenance-dispatch", "plan-maintenance-process", "intervention-scan"] as const;
export type WorkerTaskName = typeof WORKER_TASK_NAMES[number];
export function defaultWorkerInterval(tasks: readonly WorkerTaskName[]) {
  return tasks.some(task => task === "intervention-scan" || task === "intervention-delivery") ? 60_000 : 3_600_000;
}
export type WorkerRunStatus = "running" | "completed" | "failed";

export type WorkerTaskResult = {
  processed: number;
  succeeded: number;
  failed: number;
  details?: Record<string, unknown>;
};

export type WorkerTaskRunResult = {
  acquired: boolean;
  runId?: string;
  status?: "completed" | "failed";
  result?: WorkerTaskResult;
  error?: string;
};

export type WorkerRunQuery = {
  taskName?: WorkerTaskName;
  status?: WorkerRunStatus;
  page: number;
  pageSize: number;
};

export type WorkerRunsPage = {
  items: Array<Record<string, unknown>>;
  leases: Array<Record<string, unknown>>;
  total: number;
  page: number;
  pageSize: number;
};

/** Cancellation is cooperative. Business writes must also fence the lease in their transaction. */
export type WorkerTaskContext = {
  runId: string;
  taskName: WorkerTaskName;
  leaseOwnerId: string;
  signal: AbortSignal;
  /** Checks current ownership; does not replace an atomic fence on business writes. */
  assertActive: () => Promise<void>;
};
