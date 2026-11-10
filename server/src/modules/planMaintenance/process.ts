import { maintenanceExplanations } from "./explanations.js";
import { evaluateMaintenanceJob } from "./evaluate.js";
import type { Row } from "../mealPlans/formatters.js";
import { batchLimit, type MaintenanceQueueRepository } from "./queue.js";
import type { WorkerTaskContext, WorkerTaskResult } from "../worker/types.js";

/** Bounded processing, with durable per-attempt fencing and conflict retries. */
export async function processMaintenanceJobs(repository: MaintenanceQueueRepository, context: WorkerTaskContext, limit = 10, now = () => new Date()): Promise<WorkerTaskResult> {
  let processed = 0; let succeeded = 0; let failed = 0;
  for (let index = 0; index < batchLimit(limit); index++) {
    await context.assertActive();
    const job = await repository.claim(now());
    if (!job) break;
    processed++;
    const started = performance.now();
    try {
      await context.assertActive();
      const evaluation = await evaluateMaintenanceJob(repository,job,now());
      await context.assertActive();
      if (!evaluation) { failed++; continue; }
      const previousNotes = Array.isArray((evaluation.result as Row | undefined)?.notes) ? (evaluation.result as Row).notes as string[] : [];
      const mergedNotes = [...new Set([...previousNotes, ...(evaluation.revalidations?.notes ?? [])])];
      const result = await repository.applyChanges(job,evaluation.replacements.changes,evaluation.snapshot,{
        ...evaluation.result,fromDate: evaluation.fromDate,evaluationDurationMs: Math.max(0,Math.round(performance.now()-started)),
        notes: mergedNotes.length ? mergedNotes : undefined,
        pendingRevalidations: evaluation.revalidations.evaluations.length ? evaluation.revalidations.evaluations : undefined,
        checks: maintenanceExplanations(job.userId,evaluation.snapshot,evaluation.result.assessments,evaluation.replacements.changes,[...evaluation.result.checks,...evaluation.replacements.checks,...evaluation.revalidations.checks]),
      });
      if (result.kind === "completed") succeeded++;
      else {
        failed++;
        if (result.kind === "input_conflict") await repository.fail(job,now(),"maintenance inputs changed; recompute required");
      }
    } catch (error) {
      // An aborted worker leaves the lease for recovery; it must not make late writes.
      if (context.signal.aborted) throw error;
      await context.assertActive();
      failed++;
      await repository.fail(job,now(),"maintenance evaluation or application failed");
    }
  }
  return { processed,succeeded,failed,details: { phase: "event_processing" } };
}
