import type { HealthProfileUpdate } from "@dietdigidose/contracts";
import { jsonObject } from "./projections.js";

export class HealthProfileError extends Error {
  readonly statusCode: number;
  readonly code: string;
  constructor(statusCode: number, message: string, code: string) { super(message); this.statusCode = statusCode; this.code = code; }
}
const jsonFields: Record<string, string> = { allergies: "allergies_json", medical_conditions: "medical_conditions_json", dietary_restrictions: "dietary_restrictions_json", kitchen_constraints: "kitchen_constraints_json", nutrition_targets: "nutrition_targets_json" };
function list(value: unknown): unknown[] { if (typeof value === "string") { try { return list(JSON.parse(value)); } catch { return []; } } return Array.isArray(value) ? value : []; }
export function prepareProfilePatch(existing: Record<string, unknown>, input: HealthProfileUpdate) {
  const values: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === "version" || value === undefined) continue;
    const column = jsonFields[key] ?? key;
    values[column] = key === "kitchen_constraints" || key === "nutrition_targets" ? { ...jsonObject(existing[column]), ...value as Record<string, unknown> } : value;
  }
  const allergies = list(values.allergies_json ?? existing.allergies_json);
  const restrictions = list(values.dietary_restrictions_json ?? existing.dietary_restrictions_json);
  if (input.safety_status === "none" && (allergies.length || restrictions.length)) throw new HealthProfileError(400, "请先明确清空过敏和饮食限制，再选择确认没有", "SAFETY_STATUS_CONFLICT");
  if (allergies.length || restrictions.length) values.safety_status = "provided";
  if (input.nutrition_targets && Object.prototype.hasOwnProperty.call(input.nutrition_targets, "calories_kcal")) {
    values.nutrition_target_source = input.nutrition_targets.calories_kcal == null ? "unset" : "user";
    values.nutrition_target_version = input.nutrition_targets.calories_kcal == null ? null : input.version + 1;
  }
  return values;
}
export function legacySafetyStatus(profile: Record<string, unknown>): "provided" | "unknown" | "none" {
  return list(profile.allergies_json).length || list(profile.dietary_restrictions_json).length || list(profile.medical_conditions_json).length || String(profile.medications || "").trim() ? "provided" : profile.safety_status === "none" ? "none" : "unknown";
}
