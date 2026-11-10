export type RecipeQualityStatus = "trusted" | "estimated" | "needs_review";
export type NutritionBasis = "source" | "ingredient_estimate" | "category_fallback";

export type RecipeQualityIssue =
  | "category_nutrition_fallback"
  | "implausible_cook_time"
  | "instruction_as_ingredient"
  | "truncated_ingredient"
  | "insufficient_structure";

export type RecipeQualityInput = {
  source: string;
  cookTime: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  ingredients: Array<{ name?: string; amount?: string } | string>;
  steps?: unknown[];
  nutritionBasis?: NutritionBasis;
};

export type RecipeQualityAssessment = {
  qualityStatus: RecipeQualityStatus;
  nutritionBasis: NutritionBasis;
  issues: RecipeQualityIssue[];
};

const TRUSTED_SOURCES = new Set(["official", "usda_based", "user"]);
const IMPORTED_SOURCES = new Set(["wikibooks_zh", "howtocook"]);

const FALLBACK_NUTRITION = [
  { calories: 520, protein: 32.5, carbs: 45.5, fat: 23.1 },
  { calories: 300, protein: 16.5, carbs: 32.3, fat: 11.7 },
  { calories: 360, protein: 14.4, carbs: 46.8, fat: 12.8 },
  { calories: 420, protein: 16.8, carbs: 54.6, fat: 14.9 },
];

function nearlyEqual(left: number, right: number) {
  return Math.abs(left - right) < 0.05;
}

export function isCategoryFallbackNutrition(
  nutrition: Pick<RecipeQualityInput, "calories" | "protein" | "carbs" | "fat">,
) {
  return FALLBACK_NUTRITION.some((fallback) =>
    nearlyEqual(nutrition.calories, fallback.calories)
    && nearlyEqual(nutrition.protein, fallback.protein)
    && nearlyEqual(nutrition.carbs, fallback.carbs)
    && nearlyEqual(nutrition.fat, fallback.fat)
  );
}

function ingredientName(value: RecipeQualityInput["ingredients"][number]) {
  return typeof value === "string" ? value.trim() : String(value?.name || "").trim();
}

export function findRecipeQualityIssues(input: RecipeQualityInput): RecipeQualityIssue[] {
  const issues = new Set<RecipeQualityIssue>();
  const names = input.ingredients.map(ingredientName).filter(Boolean);
  const nutritionBasis = input.nutritionBasis
    || (isCategoryFallbackNutrition(input) ? "category_fallback" : "ingredient_estimate");

  if (nutritionBasis === "category_fallback") issues.add("category_nutrition_fallback");
  if (!Number.isFinite(input.cookTime) || input.cookTime < 5 || input.cookTime > 480) {
    issues.add("implausible_cook_time");
  }
  if (names.some((name) => /^(?:接着|然后|随后|煎的时候|将.+(?:放入|倒入|切成)|把.+(?:放入|倒入|切成)|放入|加入|搅拌|翻动|和面|煮至|切成|洗净)/.test(name))) {
    issues.add("instruction_as_ingredient");
  }
  if (names.some((name) => /(?:以及|或者|然后|接着|再|并|与|和)$/.test(name) || /[，,：:]$/.test(name))) {
    issues.add("truncated_ingredient");
  }
  if (names.length < 2 || (input.steps && input.steps.length < 2)) issues.add("insufficient_structure");
  return [...issues];
}

export function assessRecipeQuality(input: RecipeQualityInput): RecipeQualityAssessment {
  if (TRUSTED_SOURCES.has(input.source)) {
    return { qualityStatus: "trusted", nutritionBasis: "source", issues: [] };
  }

  const nutritionBasis = input.nutritionBasis
    || (isCategoryFallbackNutrition(input) ? "category_fallback" : "ingredient_estimate");
  const issues = findRecipeQualityIssues({ ...input, nutritionBasis });
  return {
    qualityStatus: issues.length || !IMPORTED_SOURCES.has(input.source) ? "needs_review" : "estimated",
    nutritionBasis,
    issues,
  };
}
