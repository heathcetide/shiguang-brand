export type IngredientQualityIssue =
  | "missing_source"
  | "missing_license"
  | "invalid_calories"
  | "invalid_macronutrient"
  | "implausible_macronutrient_total"
  | "invalid_edible_ratio"
  | "missing_source_version";

type IngredientNutrition = {
  calories100g: number | null;
  protein100g?: number | null;
  carbs100g?: number | null;
  fat100g?: number | null;
};

export function validateIngredientNutrition(input: IngredientNutrition) {
  const issues = new Set<IngredientQualityIssue>();
  if (input.calories100g !== null && (!Number.isFinite(input.calories100g) || input.calories100g < 0 || input.calories100g > 1_000)) issues.add("invalid_calories");
  const macros = [input.protein100g, input.carbs100g, input.fat100g].filter((value): value is number => value != null);
  if (macros.some((value) => !Number.isFinite(value) || value < 0 || value > 100)) issues.add("invalid_macronutrient");
  if (macros.reduce((sum, value) => sum + value, 0) > 105) issues.add("implausible_macronutrient_total");
  return [...issues];
}

/** Pure ingredient governance validation shared by driver-neutral services. */
export function validateIngredientQuality(input: IngredientNutrition & {
  edibleRatio?: number | null;
  source?: string | null;
  dataLicense?: string | null;
  sourceVersion?: string | null;
}) {
  const issues = new Set(validateIngredientNutrition(input));
  if (!input.source?.trim()) issues.add("missing_source");
  if (!input.dataLicense?.trim()) issues.add("missing_license");
  if (!input.sourceVersion?.trim()) issues.add("missing_source_version");
  const edibleRatio = Number(input.edibleRatio ?? 1);
  if (!Number.isFinite(edibleRatio) || edibleRatio <= 0 || edibleRatio > 1) issues.add("invalid_edible_ratio");
  return [...issues];
}
