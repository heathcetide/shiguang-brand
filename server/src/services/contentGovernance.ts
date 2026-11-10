import { createHash } from "node:crypto";
import { db } from "../storage/db.js";
import { normalizeContentTerm } from "../utils/contentNormalization.js";

export { normalizeContentTerm } from "../utils/contentNormalization.js";
export { validateIngredientQuality } from "../utils/ingredientQuality.js";
export type { IngredientQualityIssue } from "../utils/ingredientQuality.js";

function parseList(value: unknown) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function stringSet(value: unknown) {
  return new Set(parseList(value).flatMap((item) => {
    if (typeof item === "string") return normalizeContentTerm(item) ? [normalizeContentTerm(item)] : [];
    if (!item || typeof item !== "object") return [];
    const name = normalizeContentTerm(String((item as Record<string, unknown>).name || ""));
    return name ? [name] : [];
  }));
}

function jaccard(left: Set<string>, right: Set<string>) {
  if (!left.size && !right.size) return 1;
  const intersection = [...left].filter((value) => right.has(value)).length;
  return intersection / Math.max(1, new Set([...left, ...right]).size);
}

export function recipeContentFingerprint(input: { title: string; ingredients: unknown; steps: unknown }) {
  const payload = {
    title: normalizeContentTerm(input.title),
    ingredients: [...stringSet(input.ingredients)].sort(),
    steps: parseList(input.steps).map((step) => normalizeContentTerm(String(step))).filter(Boolean),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function recipeSimilarity(left: { title: string; ingredients: unknown; steps: unknown }, right: { title: string; ingredients: unknown; steps: unknown }) {
  const titleLeft = normalizeContentTerm(left.title);
  const titleRight = normalizeContentTerm(right.title);
  const titleScore = titleLeft === titleRight ? 1 : titleLeft.includes(titleRight) || titleRight.includes(titleLeft) ? 0.75 : 0;
  const ingredientScore = jaccard(stringSet(left.ingredients), stringSet(right.ingredients));
  const stepScore = jaccard(stringSet(left.steps), stringSet(right.steps));
  const score = Math.round((titleScore * 0.45 + ingredientScore * 0.4 + stepScore * 0.15) * 10_000) / 10_000;
  const reasons = [
    ...(titleScore >= 0.75 ? ["title"] : []),
    ...(ingredientScore >= 0.7 ? ["ingredients"] : []),
    ...(stepScore >= 0.7 ? ["steps"] : []),
  ];
  return { score, reasons };
}

export type RecipePublicationIssue =
  | "missing_title"
  | "missing_source_url"
  | "missing_license"
  | "missing_attribution"
  | "missing_serving_size"
  | "missing_time"
  | "missing_ingredients"
  | "missing_steps"
  | "missing_kitchenware_mapping";

export function validateRecipePublication(input: {
  title?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
  dataLicense?: string | null;
  sourceAttribution?: string | null;
  servingSize?: number | null;
  prepTime?: number | null;
  cookTime?: number | null;
  ingredients?: unknown;
  steps?: unknown;
  requiredKitchenware?: unknown;
}) {
  const issues = new Set<RecipePublicationIssue>();
  if (!input.title?.trim()) issues.add("missing_title");
  const imported = !["official", "user"].includes(String(input.source || ""));
  if (imported && !input.sourceUrl?.trim()) issues.add("missing_source_url");
  if (!input.dataLicense?.trim()) issues.add("missing_license");
  if (imported && !input.sourceAttribution?.trim()) issues.add("missing_attribution");
  if (!Number.isInteger(Number(input.servingSize)) || Number(input.servingSize) <= 0) issues.add("missing_serving_size");
  if (Number(input.prepTime || 0) + Number(input.cookTime || 0) <= 0) issues.add("missing_time");
  if (!parseList(input.ingredients).length) issues.add("missing_ingredients");
  if (parseList(input.steps).length < 2) issues.add("missing_steps");
  if (!parseList(input.requiredKitchenware).length) issues.add("missing_kitchenware_mapping");
  return [...issues];
}

export function findRecipeDuplicateCandidates(recipeId: number) {
  const recipe = db.prepare(`SELECT id, title, ingredients_json, steps_json FROM recipes WHERE id = ? AND deleted_at IS NULL`)
    .get(recipeId) as Record<string, unknown> | undefined;
  if (!recipe) return [];
  const candidates = db.prepare(`SELECT id, title, ingredients_json, steps_json FROM recipes WHERE id <> ? AND deleted_at IS NULL`)
    .all(recipeId) as Array<Record<string, unknown>>;
  return candidates.flatMap((candidate) => {
    const comparison = recipeSimilarity({
      title: String(recipe.title), ingredients: recipe.ingredients_json, steps: recipe.steps_json,
    }, {
      title: String(candidate.title), ingredients: candidate.ingredients_json, steps: candidate.steps_json,
    });
    if (comparison.score < 0.72) return [];
    const firstId = Math.min(recipeId, Number(candidate.id));
    const secondId = Math.max(recipeId, Number(candidate.id));
    db.prepare(`INSERT INTO recipe_duplicate_candidates
      (recipe_id, candidate_recipe_id, similarity, reasons_json)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(recipe_id, candidate_recipe_id) DO UPDATE SET similarity = excluded.similarity, reasons_json = excluded.reasons_json`)
      .run(firstId, secondId, comparison.score, JSON.stringify(comparison.reasons));
    return [{ recipeId: Number(candidate.id), ...comparison }];
  }).sort((left, right) => right.score - left.score);
}
