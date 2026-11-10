export type AllergySeverity = "mild" | "moderate" | "severe";
export type AllergyType = "allergy" | "intolerance";

export type AllergyEntry = {
  name: string;
  type: AllergyType;
  severity: AllergySeverity;
};

export type KitchenConstraints = import("@dietdigidose/contracts").KitchenPreferences;

export type NutritionTargets = {
  calories_kcal?: number | null;
  protein_g?: number | null;
  salt_g?: number | null;
  sugar_g?: number | null;
  water_ml?: number | null;
  professional_advice?: string;
};

export type HealthProfile = {
  id?: number;
  updated_at?: string;
  version?: number;
  nutrition_target_source?: import("@dietdigidose/contracts").CalorieTargetSource;
  nutrition_target_version?: number | null;
  calorieTarget?: import("@dietdigidose/contracts").CalorieTarget;
  currentMeasurements?: import("@dietdigidose/contracts").CurrentMeasurements;
  safety_status?: "unknown" | "none" | "provided";
  gender?: string | null;
  age?: number | null;
  height?: number | null;
  weight?: number | null;
  target_weight?: number | null;
  health_goal?: string;
  activity_level?: string;
  dietary_preference?: string;
  allergies?: AllergyEntry[];
  medications?: string;
  medical_conditions?: string[];
  medical_notes?: string;
  dietary_restrictions?: string[];
  disliked_foods?: string;
  kitchen_constraints?: KitchenConstraints;
  nutrition_targets?: NutritionTargets;
  tracking_enabled?: boolean;
};

export const ALLERGY_LABELS: Record<AllergySeverity, string> = {
  mild: "轻度",
  moderate: "中度",
  severe: "重度",
};

const ALLERGEN_ALIASES: Record<string, string[]> = {
  坚果: ["坚果", "花生", "核桃", "腰果", "杏仁", "榛子", "开心果", "松子"],
  海鲜: ["海鲜", "虾", "蟹", "贝", "蛤", "牡蛎", "鱿鱼", "章鱼", "鱼露"],
  乳制品: ["牛奶", "奶油", "黄油", "芝士", "奶酪", "酸奶", "乳清", "炼乳", "乳制品"],
  乳糖: ["牛奶", "奶油", "酸奶", "乳糖", "炼乳", "乳清", "乳制品"],
  麸质: ["小麦", "面粉", "面包", "面条", "面筋", "麸质", "酱油", "生抽", "老抽", "大麦", "黑麦"],
  鸡蛋: ["鸡蛋", "蛋黄", "蛋白", "蛋液", "蛋清"],
  大豆: ["大豆", "黄豆", "豆浆", "豆腐", "豆皮", "腐竹", "酱油", "味噌"],
};

export function findRecipeAllergyRisks(
  ingredientNames: string[],
  allergies: AllergyEntry[] = [],
) {
  const normalizedIngredients = ingredientNames.map((name) => name.toLowerCase());
  return allergies.filter((allergy) => {
    const aliases = ALLERGEN_ALIASES[allergy.name] || [allergy.name];
    return aliases.some((alias) => normalizedIngredients.some((ingredient) => ingredient.includes(alias.toLowerCase())));
  });
}

export function hasSafetyProfile(profile: HealthProfile | null | undefined) {
  return Boolean(
    profile?.allergies?.length
      || profile?.medications?.trim()
      || profile?.medical_conditions?.length
      || profile?.dietary_restrictions?.length,
  );
}

export function safetySummary(profile: HealthProfile | null | undefined) {
  if (!profile) return [];
  const summaries: string[] = [];
  if (profile.allergies?.length) {
    summaries.push(`过敏/不耐受：${profile.allergies.map((item) => `${item.name}（${ALLERGY_LABELS[item.severity]}）`).join("、")}`);
  }
  if (profile.medical_conditions?.length) summaries.push(`健康状态：${profile.medical_conditions.join("、")}`);
  if (profile.dietary_restrictions?.length) summaries.push(`饮食限制：${profile.dietary_restrictions.join("、")}`);
  if (profile.medications?.trim()) summaries.push("已记录用药/补充剂时段");
  return summaries;
}
