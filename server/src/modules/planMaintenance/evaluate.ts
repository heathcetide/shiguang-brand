import { selectMaintenanceReplacements } from "./replacements.js";
import { snapshotKitchenware } from "./snapshotKitchenware.js";
import { maintenanceScope } from "./scope.js";
import { recalculateMaintenanceQuantities } from "./recalculate.js";
import { hasEffectiveMaintenanceEvents, revalidatePendingSuggestions } from "./pendingSuggestions.js";
import type { MaintenanceJob, MaintenanceQueueRepository } from "./queue.js";

/** The dependency graph and calculation must use the same captured facts. */
export async function evaluateMaintenanceJob(repository: MaintenanceQueueRepository, job: MaintenanceJob, fromDate: string | Date) {
  const snapshot = await repository.inputs(job,await repository.candidateRecipeIds());
  if (!snapshot) return null;
  const date = typeof fromDate === "string" ? fromDate : new Intl.DateTimeFormat("en-CA", { timeZone: String(snapshot.data.plan_maintenance_settings?.[0]?.time_zone || "Asia/Shanghai"),year: "numeric",month: "2-digit",day: "2-digit" }).format(fromDate);
  const dailyEnabled = Boolean(snapshot.data.plan_maintenance_settings?.[0]?.enabled);
  const scope = maintenanceScope({ dailyEnabled,userId: job.userId,fromDate: date,events: snapshot.data.maintenance_events,
    inventory: snapshot.data.inventory_items,prepared: snapshot.data.prepared_meals,
    plans: snapshot.data.meal_plans,items: snapshot.data.meal_plan_items });
  const kitchenware = snapshotKitchenware(snapshot);
  const compatibility = new Map(await Promise.all(snapshot.recipeIds.map(async id => [id,await kitchenware.evaluateRequirements(job.userId,id)] as const)));
  const revalidations = hasEffectiveMaintenanceEvents(snapshot.data.maintenance_events, dailyEnabled)
    ? revalidatePendingSuggestions(snapshot, job.userId, compatibility, date)
    : { evaluations: [], checks: [], notes: [] };
  return { snapshot,scope,fromDate: date,compatibility,replacements: selectMaintenanceReplacements(snapshot,scope,compatibility,date),result: recalculateMaintenanceQuantities(snapshot,scope,date),revalidations };
}
