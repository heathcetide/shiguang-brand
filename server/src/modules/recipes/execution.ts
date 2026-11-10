import { createHash } from "node:crypto";
import { reviewedRecipeExecutionSchema } from "@dietdigidose/contracts";
import { parseJson } from "../mealPlans/formatters.js";
import type { Row } from "./types.js";
const parseArray = (value: unknown) => { const parsed = parseJson<unknown>(value, []); return Array.isArray(parsed) ? parsed : []; };
const canonicalJson = (source: unknown) => JSON.stringify(source, (_key, value) => value && typeof value === "object" && !Array.isArray(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);

/** Covers quantities, yield and equipment as well as instruction text. */
export function executionRecipeKey(recipe: Row) {
  const source = { title: recipe.title, servingSize: recipe.serving_size ?? null,
    cooking: recipe.cook_time ?? null, preparation: recipe.prep_time ?? null,
    ingredients: parseArray(recipe.ingredients_json), steps: parseArray(recipe.steps_json),
    tools: parseArray(recipe.required_kitchenware_json), optionalTools: parseArray(recipe.optional_kitchenware_json) };
  return createHash("sha256").update(canonicalJson(source)).digest("hex");
}
export function executionReviewKey(recipe: Row) { return createHash("sha256").update(`${executionRecipeKey(recipe)}:${canonicalJson(parseJson(recipe.execution_json, null))}`).digest("hex"); }
export function reviewedExecution(recipe: Row) {
  const parsed = reviewedRecipeExecutionSchema.safeParse(parseJson(recipe.execution_json, null));
  return parsed.success && parsed.data.recipeKey === executionRecipeKey(recipe) ? parsed.data : null;
}
