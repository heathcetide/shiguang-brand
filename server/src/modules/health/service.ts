import { currentDateKey } from "../../utils/date.js";
import type { HealthRepository } from "./repository.js";
import type { HealthLogInput, HealthProfileInput, HealthProfilePatch } from "./types.js";
import { healthProfilePatchSchema, type HealthProfileUpdate } from "@dietdigidose/contracts";
import { calorieTarget, currentMeasurements } from "./projections.js";

function parseJson(value: unknown, fallback: unknown) {
  if (value !== null && typeof value === "object") return value;
  if (typeof value !== "string") return fallback;
  try { return JSON.parse(value) as unknown; } catch { return fallback; }
}

function serializeProfile(profile: Record<string, unknown>) {
  const {
    allergies_json: allergiesJson,
    medical_conditions_json: conditionsJson,
    dietary_restrictions_json: restrictionsJson,
    kitchen_constraints_json: kitchenJson,
    nutrition_targets_json: targetsJson,
    ...fields
  } = profile;
  return {
    ...fields,
    allergies: parseJson(allergiesJson, []),
    medical_conditions: parseJson(conditionsJson, []),
    dietary_restrictions: parseJson(restrictionsJson, []),
    kitchen_constraints: parseJson(kitchenJson, {}),
    nutrition_targets: parseJson(targetsJson, {}),
    version: Number(profile.profile_version || 1),
    calorieTarget: calorieTarget(profile),
    safety_status: profile.safety_status || "unknown",
    tracking_enabled: Boolean(profile.tracking_enabled),
  };
}

export class HealthService {
  private readonly repository: HealthRepository;

  constructor(repository: HealthRepository) {
    this.repository = repository;
  }

  latestLog(userId: number) {
    return this.repository.latestLog(userId);
  }

  listLogs(userId: number) {
    return this.repository.listLogs(userId, 30);
  }

  upsertLog(userId: number, input: HealthLogInput) {
    return this.repository.upsertLog(userId, input.recorded_date || currentDateKey(), input);
  }

  removeLog(userId: number, id: number) {
    return this.repository.removeLog(userId, id);
  }

  async getProfile(userId: number) {
    return this.projectProfile(userId, await this.repository.getOrCreateProfile(userId));
  }

  private async projectProfile(userId: number, profile: Record<string, unknown>) {
    return { ...serializeProfile(profile), currentMeasurements: currentMeasurements(await this.repository.measurementLogs(userId), profile) };
  }

  async currentMeasurements(userId: number) {
    const [profile, logs] = await Promise.all([this.repository.getOrCreateProfile(userId), this.repository.measurementLogs(userId)]);
    return currentMeasurements(logs, profile);
  }

  async patchProfile(userId: number, input: HealthProfileUpdate) {
    const profile = await this.repository.patchProfile(userId, healthProfilePatchSchema.parse(input));
    return profile ? { updated: true as const, profile: await this.projectProfile(userId, profile) } : { updated: false as const, profile: await this.getProfile(userId) };
  }

  async upsertProfile(userId: number, input: HealthProfileInput) {
    const patch: HealthProfilePatch = {
      gender: input.gender,
      age: input.age,
      height: input.height,
      weight: input.weight,
      target_weight: input.target_weight,
      health_goal: input.health_goal,
      activity_level: input.activity_level,
      dietary_preference: input.dietary_preference,
      allergies_json: input.allergies,
      medications: input.medications,
      medical_conditions_json: input.medical_conditions,
      medical_notes: input.medical_notes,
      dietary_restrictions_json: input.dietary_restrictions,
      disliked_foods: input.disliked_foods,
      kitchen_constraints_json: input.kitchen_constraints,
      nutrition_targets_json: input.nutrition_targets,
      tracking_enabled: input.tracking_enabled,
    };
    return this.projectProfile(userId, await this.repository.upsertProfile(userId, patch));
  }
}
