export type HealthLogInput = {
  weight?: number | null;
  body_fat?: number | null;
  water_ml?: number | null;
  height_cm?: number | null;
  waist_cm?: number | null;
  hip_cm?: number | null;
  resting_heart_rate?: number | null;
  blood_pressure_systolic?: number | null;
  blood_pressure_diastolic?: number | null;
  blood_glucose_mmol?: number | null;
  cycle_status?: string | null;
  sleep_hours?: number | null;
  recorded_date?: string;
};

export type HealthProfileInput = {
  gender?: string | null;
  age?: number | null;
  height?: number | null;
  weight?: number | null;
  target_weight?: number | null;
  health_goal?: string;
  activity_level?: string;
  dietary_preference?: string;
  allergies?: unknown[];
  medications?: string;
  medical_conditions?: string[];
  medical_notes?: string;
  dietary_restrictions?: string[];
  disliked_foods?: string;
  kitchen_constraints?: Record<string, unknown>;
  nutrition_targets?: Record<string, unknown>;
  tracking_enabled?: boolean;
};

export type HealthProfilePatch = Omit<HealthProfileInput,
  "allergies" | "medical_conditions" | "dietary_restrictions" | "kitchen_constraints" | "nutrition_targets"
> & {
  allergies_json?: unknown[];
  medical_conditions_json?: string[];
  dietary_restrictions_json?: string[];
  kitchen_constraints_json?: Record<string, unknown>;
  nutrition_targets_json?: Record<string, unknown>;
};

export type HealthLogUpsertResult = {
  created: boolean;
  log: Record<string, unknown>;
};
