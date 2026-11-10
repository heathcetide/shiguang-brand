import { db } from "../../storage/db.js";
import { buildAdminWorkerRunsRouter } from "./route.js";
import { SqliteWorkerRepository } from "./sqliteRepository.js";

const repository = new SqliteWorkerRepository(db);

export type { WorkerTaskContext, WorkerTaskName, WorkerTaskResult, WorkerTaskRunResult } from "./types.js";
export const createAdminWorkerRunsRouter = () => buildAdminWorkerRunsRouter(repository);
