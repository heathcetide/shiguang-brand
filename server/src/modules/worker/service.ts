import { randomUUID } from "node:crypto";
import { logger } from "../../utils/logger.js";
import type { WorkerRepository } from "./repository.js";
import type { WorkerTaskContext, WorkerTaskName, WorkerTaskResult, WorkerTaskRunResult } from "./types.js";

function positiveInteger(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function sanitizeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n]+/g, " ").slice(0, 1_000);
}

async function notifyWorkerFailure(payload: Record<string, unknown>) {
  const webhookUrl = process.env.ERROR_MONITOR_WEBHOOK_URL?.trim();
  if (!webhookUrl) return;
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "worker.task.failed", timestamp: new Date().toISOString(), ...payload }),
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) throw new Error(`monitor returned ${response.status}`);
  } catch (error) {
    logger.warn("error_monitor.delivery_failed", { source: "worker", message: sanitizeError(error) });
  }
}

export class WorkerRuntime {
  private readonly repository: WorkerRepository;

  constructor(repository: WorkerRepository) {
    this.repository = repository;
  }

  acquireLease(taskName: WorkerTaskName, workerId: string, leaseMs: number) {
    return this.repository.acquireLease(taskName, workerId, positiveInteger(leaseMs, 10 * 60_000));
  }

  releaseLease(taskName: WorkerTaskName, workerId: string) {
    return this.repository.releaseLease(taskName, workerId);
  }

  async run(options: {
    taskName: WorkerTaskName;
    workerId: string;
    leaseMs?: number;
    timeoutMs?: number;
    run: (context: WorkerTaskContext) => Promise<WorkerTaskResult>;
  }): Promise<WorkerTaskRunResult> {
    const leaseMs = positiveInteger(options.leaseMs ?? 0, 10 * 60_000);
    const timeoutMs = Math.min(leaseMs, positiveInteger(options.timeoutMs ?? 0, 5 * 60_000));
    const runId = randomUUID();
    // Each attempt gets a new owner, including retries in the same worker process.
    const leaseOwnerId = runId;
    if (!await this.repository.acquireLease(options.taskName, leaseOwnerId, leaseMs)) {
      logger.info("worker.task.skipped", { taskName: options.taskName, workerId: options.workerId, reason: "lease_held" });
      return { acquired: false };
    }

    const startedAt = Date.now();
    const deadline = performance.now() + timeoutMs;
    const controller = new AbortController();
    const assertActive = async () => {
      if (performance.now() >= deadline && !controller.signal.aborted) {
        controller.abort(new Error(`task exceeded ${timeoutMs}ms timeout`));
      }
      controller.signal.throwIfAborted();
      if (!await this.repository.ownsLease(options.taskName, leaseOwnerId)) {
        controller.abort(new Error("worker task lease lost or expired"));
      }
      controller.signal.throwIfAborted();
      if (performance.now() >= deadline) {
        controller.abort(new Error(`task exceeded ${timeoutMs}ms timeout`));
        controller.signal.throwIfAborted();
      }
    };
    const context: WorkerTaskContext = { runId, taskName: options.taskName, leaseOwnerId, signal: controller.signal, assertActive };
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await this.repository.createRun(runId, options.taskName, options.workerId);
      logger.info("worker.task.started", { taskName: options.taskName, workerId: options.workerId, runId });
      await assertActive();
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          const error = new Error(`task exceeded ${timeoutMs}ms timeout`);
          controller.abort(error);
          reject(error);
        }, Math.max(0, deadline - performance.now()));
      });
      const result = await Promise.race([options.run(context), timeoutPromise]);
      await assertActive();
      const durationMs = Date.now() - startedAt;
      const status = result.failed > 0 ? "failed" : "completed";
      const errorMessage = result.failed > 0 ? `${result.failed} item(s) failed` : null;
      if (!await this.repository.completeRun(runId, status, durationMs, result, errorMessage, leaseOwnerId)) {
        throw new Error("worker task lease lost or expired before recording result");
      }
      const payload = {
        taskName: options.taskName,
        workerId: options.workerId,
        runId,
        durationMs,
        processed: result.processed,
        succeeded: result.succeeded,
        failed: result.failed,
      };
      if (status === "failed") {
        logger.error("worker.task.failed", { ...payload, message: errorMessage });
        await notifyWorkerFailure({ ...payload, message: errorMessage });
      } else {
        logger.info("worker.task.completed", payload);
      }
      return { acquired: true, runId, status, result, ...(errorMessage ? { error: errorMessage } : {}) };
    } catch (error) {
      controller.abort(error);
      const durationMs = Date.now() - startedAt;
      const message = sanitizeError(error);
      await this.repository.failRun(runId, durationMs, message);
      const payload = { taskName: options.taskName, workerId: options.workerId, runId, durationMs, message };
      logger.error("worker.task.failed", payload);
      await notifyWorkerFailure(payload);
      return { acquired: true, runId, status: "failed", error: message };
    } finally {
      if (timeout) clearTimeout(timeout);
      controller.abort(new Error("worker task run finished"));
      await this.repository.releaseLease(options.taskName, leaseOwnerId);
    }
  }
}
