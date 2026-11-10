import { z } from "zod";
import { kitchenPreferencesSchema } from "./mealPreferences.ts";

export const nutritionTargetsSchema = z.object({
  calories_kcal: z.number().finite().min(500).max(10_000).nullable().optional(),
  protein_g: z.number().finite().min(0).max(1000).nullable().optional(),
  salt_g: z.number().finite().min(0).max(100).nullable().optional(),
  sugar_g: z.number().finite().min(0).max(1000).nullable().optional(),
  water_ml: z.number().finite().min(0).max(20_000).nullable().optional(),
  professional_advice: z.string().trim().max(1000).nullable().optional(),
}).strict();

export const healthProfilePatchSchema = z.object({
  version: z.number().int().min(1),
  gender: z.enum(["男", "女", "保密", "male", "female", "other"]).nullable().optional(),
  age: z.number().int().min(12).max(120).nullable().optional(),
  height: z.number().finite().min(80).max(250).nullable().optional(),
  weight: z.number().finite().min(20).max(500).nullable().optional(),
  target_weight: z.number().finite().min(20).max(500).nullable().optional(),
  health_goal: z.enum(["lose_weight", "reduce_fat", "gain_muscle", "maintain", "healthy"]).nullable().optional(),
  activity_level: z.enum(["sedentary", "light", "moderate", "active", "very_active"]).nullable().optional(),
  dietary_preference: z.string().trim().max(200).nullable().optional(),
  allergies: z.array(z.object({ name: z.string().trim().min(1).max(80), type: z.enum(["allergy", "intolerance"]), severity: z.enum(["mild", "moderate", "severe"]) }).strict()).max(30).optional(),
  medications: z.string().trim().max(1000).nullable().optional(),
  medical_conditions: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  medical_notes: z.string().trim().max(1000).nullable().optional(),
  dietary_restrictions: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  disliked_foods: z.string().trim().max(1000).nullable().optional(),
  kitchen_constraints: kitchenPreferencesSchema.optional(),
  nutrition_targets: nutritionTargetsSchema.optional(),
  tracking_enabled: z.boolean().optional(),
  safety_status: z.enum(["unknown", "none", "provided"]).optional(),
}).strict().refine(value => Object.keys(value).some(key => key !== "version"), "至少提供一个需要更新的字段");

export type HealthProfileUpdate = z.infer<typeof healthProfilePatchSchema>;
export type CalorieTargetSource = "unset" | "user" | "legacy_unconfirmed";
export type CalorieTarget = { value: number | null; source: CalorieTargetSource; referenceValue: number };
export type CurrentMeasurement = { value: number; recordedDate: string | null; source: "log" | "legacy_profile" };
export type MeasurementKey = "weight" | "body_fat" | "water_ml" | "height_cm" | "waist_cm" | "hip_cm" | "resting_heart_rate" | "blood_pressure_systolic" | "blood_pressure_diastolic" | "blood_glucose_mmol" | "sleep_hours";
export type CurrentMeasurements = Partial<Record<MeasurementKey, CurrentMeasurement>>;
