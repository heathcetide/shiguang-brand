import type { HealthLogInput, HealthLogUpsertResult, HealthProfilePatch } from "./types.js";
import type { HealthProfileUpdate } from "@dietdigidose/contracts";

/** Driver-neutral persistence port for health logs and health profiles. */
export interface HealthRepository {
  latestLog(userId: number): Promise<Record<string, unknown> | null>;
  listLogs(userId: number, limit: number): Promise<Array<Record<string, unknown>>>;
  upsertLog(userId: number, recordedDate: string, input: HealthLogInput): Promise<HealthLogUpsertResult>;
  removeLog(userId: number, id: number): Promise<boolean>;
  getOrCreateProfile(userId: number): Promise<Record<string, unknown>>;
  upsertProfile(userId: number, input: HealthProfilePatch): Promise<Record<string, unknown>>;
  patchProfile(userId: number, input: HealthProfileUpdate): Promise<Record<string, unknown> | null>;
  measurementLogs(userId: number): Promise<Array<Record<string, unknown>>>;
}
