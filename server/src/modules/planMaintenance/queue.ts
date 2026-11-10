import type { MaintenanceInputSnapshot } from "./inputSnapshot.js";
import type { MaintenanceScope } from "./scope.js";
import type { MealPlanItemUpdateInput } from "../mealPlans/types.js";
import type { PendingSuggestionEvaluation } from "./pendingSuggestions.js";
export const MAINTENANCE_RULE_VERSION = "maintenance-2026-09-12.1";
export const MAINTENANCE_MAX_ATTEMPTS = 3;
export type MaintenanceJob = { id: string; userId: number; attempt: number; leaseToken: string; eventIds: string[] };
export interface MaintenanceQueueRepository {
  /** Assign committed events after the debounce window. Assignment is not completion. */
  publishResults(limit?: number): Promise<number>;
  enqueueDaily(now: Date, limit?: number): Promise<number>;
  enqueueEvents(now: Date, limit?: number): Promise<number>;
  /** Claim one user at a time; a fresh token fences every attempt, including recovery. */
  claim(now: Date, leaseMs?: number): Promise<MaintenanceJob | null>;
  candidateRecipeIds(): Promise<number[]>;
  scope(job: MaintenanceJob, fromDate: string): Promise<MaintenanceScope | null>;
  inputs(job: MaintenanceJob, recipeIds?: number[]): Promise<MaintenanceInputSnapshot | null>;
  applyChanges(job: MaintenanceJob, changes: MaintenanceChange[], expected: Pick<MaintenanceInputSnapshot,"fingerprint" | "recipeIds">, diagnostics?: MaintenanceDiagnostics): Promise<MaintenanceApplication>;
  fail(job: MaintenanceJob, now: Date, error: string): Promise<boolean>;
}
export function batchLimit(value = 200) { return Math.max(1, Math.min(1000, Math.trunc(value) || 200)); }
export function leaseDuration(value = 300_000) { return Math.max(1000, Math.min(600_000, Math.trunc(value) || 300_000)); }
export function retryAt(now: Date, attempt: number) { return new Date(now.getTime() + 30_000 * 2 ** (attempt - 1)).toISOString(); }

export type MaintenanceChange = { planVersion: number; planId: string; itemId: string; input: MealPlanItemUpdateInput; reason: string };
export type MaintenanceApplication = { kind: "completed"; changes: Record<string, unknown>[] } | { kind: "lease_lost" | "input_conflict" };
export class MaintenanceApplyConflict extends Error {
  readonly kind: "lease_lost" | "input_conflict";
  constructor(kind: "lease_lost" | "input_conflict") { super(kind); this.kind = kind; }
}

export type MaintenanceDiagnostics = { evaluationDurationMs?: number; notes?: string[]; ruleVersion: string; inputFingerprint: string; fromDate: string; modelCalls: number; cost: number; assessments: unknown[]; checks: string[]; pendingRevalidations?: PendingSuggestionEvaluation[] };
