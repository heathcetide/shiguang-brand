import { validateIngredientNutrition } from "../../utils/ingredientQuality.js";
import { AdminFoodAssetsError } from "./errors.js";
import type { IngredientInput, IngredientUpdateInput, Row } from "./types.js";

/** Called after reading the current row inside the repository transaction. */
export function mergeIngredientUpdate(current: Row, patch: IngredientUpdateInput) {
  const existingNumber = (key: string) => current[key] == null ? null : Number(current[key]);
  const nutrition = {
    calories100g: patch.calories100g === undefined ? existingNumber("calories_100g") : patch.calories100g,
    protein100g: patch.protein100g === undefined ? existingNumber("protein_100g") : patch.protein100g,
    carbs100g: patch.carbs100g === undefined ? existingNumber("carbs_100g") : patch.carbs100g,
    fat100g: patch.fat100g === undefined ? existingNumber("fat_100g") : patch.fat100g,
  };
  const issues = validateIngredientNutrition(nutrition);
  if (issues.length) throw new AdminFoodAssetsError(400, "食材质量校验未通过", { issues });
  const values = Object.values(nutrition);
  const nutritionStatus: IngredientInput["nutritionStatus"] = values.every((value) => value === null) ? "unknown"
    : values.every((value) => value !== null) ? "core_complete" : "incomplete";
  const sourceChanged = patch.source !== undefined && patch.source !== current.source;
  return { ...patch, ...nutrition, nutritionStatus, sourceChanged,
    sourceVersion: patch.sourceVersion ?? (sourceChanged || current.source_version == null ? null : String(current.source_version)),
    dataLicense: patch.dataLicense ?? (sourceChanged || current.data_license == null ? null : String(current.data_license)),
    category: patch.category === undefined ? current.category == null ? null : String(current.category) : patch.category };
}
