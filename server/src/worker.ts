import { processMaintenanceJobs } from "./modules/planMaintenance/process.js";
import { WORKER_TASK_NAMES, defaultWorkerInterval } from "./modules/worker/types.js";
import type { WorkerTaskContext } from "./modules/worker/types.js";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { initializeWorkerRuntime } from "./composition/runtime.js";
import type { WorkerRuntimeBundle } from "./composition/types.js";
import { checkExpoPushReceipts, sendExpiringInventoryNotifications, sendInterventions, scanInterventions } from "./services/notifications.js";
import type { WorkerTaskName, WorkerTaskRunResult } from "./modules/worker/types.js";
import { logger } from "./utils/logger.js";

const supportedTasks: readonly WorkerTaskName[] = WORKER_TASK_NAMES;

function numberFromEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function selectedTasks() {
  const taskArgument = process.argv.find((argument) => argument.startsWith("--task="))?.slice("--task=".length);
  const configured = taskArgument || process.env.WORKER_TASKS || supportedTasks.join(",");
  const tasks = configured.split(",").map((task) => task.trim()).filter(Boolean);
  for (const task of tasks) {
    if (!supportedTasks.includes(task as WorkerTaskName)) {
      throw new Error(`Unsupported worker task: ${task}. Expected ${supportedTasks.join(", ")}`);
    }
  }
  if (!tasks.length) throw new Error("WORKER_TASKS must select at least one task");
  return [...new Set(tasks)] as WorkerTaskName[];
}

export async function runWorkerCycle(workerId: string, runtime: WorkerRuntimeBundle, tasks = selectedTasks()) {
  const leaseMs = numberFromEnv("WORKER_LEASE_MS", 10 * 60_000);
  const timeoutMs = numberFromEnv("WORKER_TASK_TIMEOUT_MS", 5 * 60_000);
  const results: WorkerTaskRunResult[] = [];
  for (const taskName of tasks) {
    const run = taskName === "notifications"
      ? async (context: WorkerTaskContext) => {
          await context.assertActive();
          const receipts = await checkExpoPushReceipts();
          const notifications = await sendExpiringInventoryNotifications();
          return {
            processed: receipts.checked + notifications.recipients,
            succeeded: receipts.checked + notifications.recipients - notifications.failedRecipients,
            failed: notifications.failedRecipients,
            details: {
              receiptsChecked: receipts.checked,
              pushRecipients: notifications.recipients,
              pushMessages: notifications.messages,
              failedRecipients: notifications.failedRecipients,
            },
          };
        }
      : taskName === "intervention-scan"
      ? async (context: WorkerTaskContext) => {
          const scan = await scanInterventions(context);
          return { processed: scan.scanned + scan.failed,succeeded: scan.scanned,failed: scan.failed,details: scan };
        }
      : taskName === "intervention-delivery"
      ? async (context: WorkerTaskContext) => {
          const delivery = await sendInterventions(context);
          return { processed: delivery.processed,succeeded: delivery.accepted,failed: delivery.failed + delivery.uncertain,details: delivery };
        }
      : taskName === "plan-maintenance-dispatch"
      ? async () => {
          const daily = await runtime.maintenanceQueue.enqueueDaily(new Date(),numberFromEnv("PLAN_MAINTENANCE_EVENT_BATCH_SIZE",200));
          const enqueued = await runtime.maintenanceQueue.enqueueEvents(new Date(),numberFromEnv("PLAN_MAINTENANCE_EVENT_BATCH_SIZE",200));
          return { processed: enqueued, succeeded: enqueued, failed: 0, details: { phase: "event_dispatch", eventsEnqueued: enqueued, dailyChecksCreated: daily } };
        }
      : taskName === "plan-maintenance-process"
      ? async (context: WorkerTaskContext) => {
          const result = await processMaintenanceJobs(runtime.maintenanceQueue,context,numberFromEnv("PLAN_MAINTENANCE_JOB_BATCH_SIZE",10));
          await context.assertActive();
          const reportsPublished = await runtime.maintenanceQueue.publishResults(numberFromEnv("PLAN_MAINTENANCE_EVENT_BATCH_SIZE",200));
          return { ...result,details: { ...result.details,reportsPublished } };
        }
      : async () => {
          const cleanup = await runtime.mediaCleanup.processPending(numberFromEnv("MEDIA_CLEANUP_BATCH_SIZE", 25));
          return {
            processed: cleanup.checked,
            succeeded: cleanup.completed,
            failed: cleanup.failed,
            details: cleanup,
          };
        };
    const runManagedWorkerTask = runtime.worker.run.bind(runtime.worker);
    results.push(await runManagedWorkerTask({ taskName, workerId, leaseMs, timeoutMs, run }));
  }
  return results;
}

async function main() {
  const runtime = await initializeWorkerRuntime();
  try {
    const workerId = `${os.hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
    const once = process.argv.includes("--once");
    const intervalMs = numberFromEnv("WORKER_INTERVAL_MS", defaultWorkerInterval(selectedTasks()));
    let stopping = false;
    let running = false;

    const stop = (signal: string) => {
      stopping = true;
      logger.info("worker.stopping", { workerId, signal });
    };
    process.on("SIGINT", () => stop("SIGINT"));
    process.on("SIGTERM", () => stop("SIGTERM"));

    logger.info("worker.started", { workerId, tasks: selectedTasks(), once, intervalMs });
    do {
      if (!running) {
        running = true;
        try {
          await runWorkerCycle(workerId, runtime);
        } finally {
          running = false;
        }
      }
      if (once || stopping) break;
      await new Promise<void>((resolve) => {
        const cleanup = () => {
          process.off("SIGINT", finish);
          process.off("SIGTERM", finish);
        };
        const finish = () => {
          clearTimeout(timer);
          cleanup();
          resolve();
        };
        const timer = setTimeout(() => {
          cleanup();
          resolve();
        }, intervalMs);
        process.once("SIGINT", finish);
        process.once("SIGTERM", finish);
      });
    } while (!stopping);
    logger.info("worker.stopped", { workerId });
  } finally {
    await runtime.close();
  }
}

const isEntryPoint = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]!).href;
if (isEntryPoint) {
  main().catch((error) => {
    logger.error("worker.crashed", { message: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  });
}
