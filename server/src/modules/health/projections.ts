import type { CalorieTarget, CurrentMeasurements, MeasurementKey } from "@dietdigidose/contracts";

export const measurementKeys: MeasurementKey[] = ["weight", "body_fat", "water_ml", "height_cm", "waist_cm", "hip_cm", "resting_heart_rate", "blood_pressure_systolic", "blood_pressure_diastolic", "blood_glucose_mmol", "sleep_hours"];
export function jsonObject(value: unknown): Record<string, unknown> {
  if (typeof value === "string") { try { return jsonObject(JSON.parse(value)); } catch { return {}; } }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function calorieTarget(profile: Record<string, unknown> | null | undefined): CalorieTarget {
  const raw = jsonObject(profile?.nutrition_targets_json ?? profile?.nutrition_targets).calories_kcal;
  const value = raw == null || !Number.isFinite(Number(raw)) ? null : Number(raw);
  const source = value == null ? "unset" : profile?.nutrition_target_source === "user" ? "user" : "legacy_unconfirmed";
  return { value, source, referenceValue: 2000 };
}
export function currentMeasurements(logs: Record<string, unknown>[], profile?: Record<string, unknown> | null): CurrentMeasurements {
  const result: CurrentMeasurements = {};
  const date = (row: Record<string, unknown>) => row.recorded_date instanceof Date ? row.recorded_date.toISOString().slice(0, 10) : String(row.recorded_date ?? "").slice(0, 10);
  const sorted = [...logs].sort((a, b) => date(b).localeCompare(date(a)) || Number(b.id) - Number(a.id));
  for (const key of measurementKeys) {
    const log = sorted.find(row => row[key] != null && Number.isFinite(Number(row[key])));
    if (log) result[key] = { value: Number(log[key]), recordedDate: date(log) || null, source: "log" };
  }
  for (const [key, field] of [["weight", "weight"], ["height_cm", "height"]] as const) {
    if (!result[key] && profile?.[field] != null && Number.isFinite(Number(profile[field]))) result[key] = { value: Number(profile[field]), recordedDate: null, source: "legacy_profile" };
  }
  return result;
}
