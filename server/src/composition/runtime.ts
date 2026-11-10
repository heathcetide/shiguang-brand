import type { ApplicationRuntime, DatabaseDriver, WorkerRuntimeBundle } from "./types.js";

export function databaseDriver(env: NodeJS.ProcessEnv = process.env): DatabaseDriver {
  const value = (env.DATABASE_DRIVER || "sqlite").trim().toLowerCase();
  if (value === "sqlite" || value === "postgresql") return value;
  throw new Error("DATABASE_DRIVER must be either sqlite or postgresql");
}

export async function initializeApplicationRuntime(): Promise<ApplicationRuntime> {
  if (databaseDriver() === "postgresql") {
    return (await import("./postgresRuntime.js")).initializePostgresApplication();
  }
  return (await import("./sqliteRuntime.js")).initializeSqliteApplication();
}

export async function initializeWorkerRuntime(): Promise<WorkerRuntimeBundle> {
  if (databaseDriver() === "postgresql") {
    return (await import("./postgresRuntime.js")).initializePostgresWorker();
  }
  return (await import("./sqliteRuntime.js")).initializeSqliteWorker();
}
