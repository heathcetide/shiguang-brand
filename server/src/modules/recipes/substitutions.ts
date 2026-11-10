import type { CookingPlanDraft, RecipeSubstitution } from "@dietdigidose/contracts";
import { isDeepStrictEqual } from "node:util";
import { executionRecipeKey, reviewedExecution } from "./execution.js";
import { recipeDemands } from "../recommendations/quantities.js";
import { parseJson } from "../mealPlans/formatters.js";
import type { Row } from "./types.js";

const ingredients = (row: Row): Array<{ name: string; amount: string }> => {
  const raw = row.ingredients ?? parseJson(row.ingredients_json, []);
  return Array.isArray(raw) ? raw.map(item => ({ name: String(item?.name ?? "").trim(), amount: String(item?.amount ?? "").trim() })) : [];
};

/** A substitution is a reviewed complete recipe variant, never a text-only ingredient swap. */
export function substitutionMatches(source: Row, target: Row, rule: RecipeSubstitution) {
  const original = ingredients(source), variant = ingredients(target);
  const yieldSize = Number(source.serving_size);
  if (Number(source.id) === Number(target.id) || yieldSize !== Number(target.serving_size)
    || original.some(item => !item.name) || variant.some(item => !item.name) || !recipeDemands(original, yieldSize, yieldSize) || !recipeDemands(variant, yieldSize, yieldSize)
    || new Set(original.map(item => item.name)).size !== original.length || new Set(variant.map(item => item.name)).size !== variant.length
    || !original.some(item => item.name === rule.removedIngredient) || original.some(item => item.name === rule.replacementIngredient)
    || !variant.some(item => item.name === rule.replacementIngredient) || variant.some(item => item.name === rule.removedIngredient)) return false;
  const rest = (items: typeof original, removed: string) => JSON.stringify(items.filter(item => item.name !== removed).sort((a, b) => a.name.localeCompare(b.name)));
  return rest(original, rule.removedIngredient) === rest(variant, rule.replacementIngredient);
}

export function cookingEvidenceMatches(cooking: CookingPlanDraft["cooking"][number], source: Row | undefined, target: Row | undefined) {
  if (!target || target.status !== "approved" || target.quality_status !== "trusted" || target.deleted_at || Number(target.id) !== cooking.recipeId) return false;
  const currentIngredients = ingredients(target);
  if (currentIngredients.some(item => !item.name)) return false;
  const expected = recipeDemands(currentIngredients, Number(target.serving_size), cooking.servings);
  const sorted = (items: typeof cooking.demands) => [...items].sort((a, b) => a.food_name.localeCompare(b.food_name));
  // All executable demands come from the current recipe, even without optional substitution metadata.
  if (cooking.recipeYield !== Number(target.serving_size) || !expected || !isDeepStrictEqual(sorted(expected), sorted(cooking.demands))) return false;
  const evidence = cooking.substitution;
  if (!evidence) return true;
  if (!source || source.status !== "approved" || source.quality_status !== "trusted"
    || source.deleted_at || Number(source.id) !== evidence.sourceRecipeId
    || source.title !== evidence.sourceTitle || executionRecipeKey(source) !== evidence.sourceRecipeKey || executionRecipeKey(target) !== evidence.recipeKey
    || !reviewedExecution(target) || !substitutionMatches(source, target, evidence)) return false;
  const rule = reviewedExecution(source)?.profile.substitutions?.find(rule => rule.recipeId === cooking.recipeId);
  if (!rule || !Object.entries(rule).every(([key, value]) => evidence[key as keyof typeof evidence] === value)) return false;
  return true;
}
