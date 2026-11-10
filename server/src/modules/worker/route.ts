import { Router, type NextFunction, type Request, type Response } from "express";
import { sendError } from "../../utils/http.js";
import type { WorkerRepository } from "./repository.js";
import { WORKER_TASK_NAMES } from "./types.js";
import type { WorkerRunStatus, WorkerTaskName } from "./types.js";

const taskNames = new Set<WorkerTaskName>(WORKER_TASK_NAMES);
const statuses = new Set<WorkerRunStatus>(["running", "completed", "failed"]);

export function buildAdminWorkerRunsRouter(repository: WorkerRepository) {
  const router = Router();
  router.get("/worker-runs", (req: Request, res: Response, next: NextFunction) => {
    const rawTaskName = typeof req.query.task === "string" ? req.query.task.trim() : "";
    const rawStatus = typeof req.query.status === "string" ? req.query.status.trim() : "";
    if (rawTaskName && !taskNames.has(rawTaskName as WorkerTaskName)) {
      return sendError(res, 400, "后台任务类型无效", "INVALID_WORKER_TASK");
    }
    if (rawStatus && !statuses.has(rawStatus as WorkerRunStatus)) {
      return sendError(res, 400, "后台任务状态无效", "INVALID_WORKER_STATUS");
    }
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(10, Number(req.query.pageSize) || 20));
    void repository.listRuns({
      taskName: rawTaskName ? rawTaskName as WorkerTaskName : undefined,
      status: rawStatus ? rawStatus as WorkerRunStatus : undefined,
      page,
      pageSize,
    }).then((result) => res.json(result)).catch(next);
  });
  return router;
}
