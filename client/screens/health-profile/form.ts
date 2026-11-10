import { healthProfilePatchSchema, kitchenPreferencesSchema, type HealthProfileUpdate, type KitchenPreferences } from "@dietdigidose/contracts";
import type { AllergyEntry, HealthProfile } from "@/utils/healthProfile";

export type ProfileSection = "body" | "nutrition" | "safety" | "kitchen";
export const SECTION_TITLES: Record<ProfileSection, string> = { body: "身体资料", nutrition: "营养目标", safety: "饮食限制与健康资料", kitchen: "厨房与做饭习惯" };
export const EMPTY_FORM = {
  gender: "", age: "", height: "", weight: "", target_weight: "", health_goal: "", activity_level: "", dietary_preference: "",
  calories_kcal: "", protein_g: "", salt_g: "", sugar_g: "", water_ml: "", professional_advice: "",
  medications: "", medical_notes: "", disliked_foods: "", meal_time_minutes: "", budget_per_meal: "", servings: "",
  allergies: [] as AllergyEntry[], medical_conditions: [] as string[], dietary_restrictions: [] as string[],
  kitchen: {} as KitchenPreferences, tracking_enabled: false, safety_status: "unknown" as "unknown" | "none" | "provided",
};
export type ProfileForm = typeof EMPTY_FORM;
export type FormTextKey = { [K in keyof ProfileForm]: ProfileForm[K] extends string ? K : never }[keyof ProfileForm];
export type ProfileDraft = { version: number; initial: ProfileForm; form: ProfileForm } | null;
const text = (value: unknown) => value == null ? "" : String(value);

export function profileToForm(profile: HealthProfile): ProfileForm {
  const targets = profile.nutrition_targets || {}; const kitchen = profile.kitchen_constraints || {};
  return {
    ...EMPTY_FORM,
    gender: profile.gender === "male" ? "男" : profile.gender === "female" ? "女" : profile.gender === "other" ? "保密" : profile.gender || "",
    age: text(profile.age), height: text(profile.height), weight: text(profile.currentMeasurements?.weight?.value ?? profile.weight), target_weight: text(profile.target_weight),
    health_goal: profile.health_goal || "", activity_level: profile.activity_level || "", dietary_preference: profile.dietary_preference || "",
    allergies: profile.allergies || [], medications: profile.medications || "", medical_conditions: profile.medical_conditions || [], medical_notes: profile.medical_notes || "",
    dietary_restrictions: profile.dietary_restrictions || [], disliked_foods: profile.disliked_foods || "", kitchen,
    meal_time_minutes: text(kitchen.meal_time_minutes), budget_per_meal: text(kitchen.budget_per_meal), servings: text(kitchen.servings),
    calories_kcal: text(profile.calorieTarget?.value ?? targets.calories_kcal), protein_g: text(targets.protein_g), salt_g: text(targets.salt_g), sugar_g: text(targets.sugar_g), water_ml: text(targets.water_ml), professional_advice: targets.professional_advice || "",
    tracking_enabled: Boolean(profile.tracking_enabled), safety_status: profile.safety_status || "unknown",
  };
}

export function parseProfileDraft(value: unknown): ProfileDraft {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (!Number.isInteger(candidate.version) || Number(candidate.version) < 1) return null;
  const validForm = (form: unknown): form is ProfileForm => {
    if (!form || typeof form !== "object") return false;
    const values = form as Record<string, unknown>;
    return Object.entries(EMPTY_FORM).every(([key, initial]) => Array.isArray(initial) ? Array.isArray(values[key]) : typeof values[key] === typeof initial)
      && kitchenPreferencesSchema.safeParse(values.kitchen).success
      && healthProfilePatchSchema.shape.allergies.safeParse(values.allergies).success
      && [values.medical_conditions, values.dietary_restrictions].every(items => Array.isArray(items) && items.every(item => typeof item === "string"))
      && ["unknown", "none", "provided"].includes(String(values.safety_status));
  };
  return validForm(candidate.initial) && validForm(candidate.form) ? { version: Number(candidate.version), initial: candidate.initial, form: candidate.form } : null;
}

/** Only the open group and changed fields are submitted; untouched measurements never create new logs. */
export function profileUpdate(section: ProfileSection, draft: NonNullable<ProfileDraft>): HealthProfileUpdate | null {
  const { form, initial } = draft; const result: Record<string, unknown> = { version: draft.version };
  const changed = (key: keyof ProfileForm) => JSON.stringify(form[key]) !== JSON.stringify(initial[key]);
  const number = (key: FormTextKey) => String(form[key]).trim() ? Number(form[key]) : null;
  if (section === "body") {
    for (const key of ["age", "height", "weight", "target_weight"] as const) if (changed(key)) result[key] = number(key);
    for (const key of ["gender", "health_goal", "activity_level"] as const) if (changed(key)) result[key] = form[key] || null;
    if (changed("tracking_enabled")) result.tracking_enabled = form.tracking_enabled;
  }
  if (section === "nutrition") {
    const targets: Record<string, unknown> = {};
    for (const key of ["calories_kcal", "protein_g", "salt_g", "sugar_g", "water_ml"] as const) if (changed(key) || (key === "calories_kcal" && form[key].trim())) targets[key] = number(key);
    if (changed("professional_advice")) targets.professional_advice = form.professional_advice || null;
    if (Object.keys(targets).length) result.nutrition_targets = targets;
  }
  if (section === "safety") {
    for (const key of ["allergies", "medical_conditions", "dietary_restrictions", "safety_status"] as const) if (changed(key)) result[key] = form[key];
    for (const key of ["medications", "medical_notes", "disliked_foods", "dietary_preference"] as const) if (changed(key)) result[key] = form[key] || null;
  }
  if (section === "kitchen") {
    const kitchen: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(form.kitchen)) if (JSON.stringify(value) !== JSON.stringify(initial.kitchen[key as keyof KitchenPreferences])) kitchen[key] = value;
    for (const key of ["meal_time_minutes", "budget_per_meal", "servings"] as const) if (changed(key)) kitchen[key] = number(key);
    if (Object.keys(kitchen).length) result.kitchen_constraints = kitchen;
  }
  return Object.keys(result).length === 1 ? null : healthProfilePatchSchema.parse(result);
}
