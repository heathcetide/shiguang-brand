import { createHash } from "node:crypto";
import { recipeDemands } from "../recommendations/quantities.js";
import { allergyTerms, parseArray } from "../recommendations/scoring.js";
import type { Row } from "./types.js";

/** Detect known conflicts; absence of a text match is never a safety certification. */
export function checkDiningRecipe(recipe: Row, participants: Array<{ membershipId: number; allergies: string[]; restrictions: string[] }>, totalServings?: number) {
  const ingredients = parseArray(recipe.ingredients_json).flatMap(value => {
    if (typeof value === "string") return [value];
    if (value && typeof value === "object" && typeof (value as Row).name === "string") return [String((value as Row).name)];
    return [];
  });
  const text = [recipe.title,recipe.description,...ingredients].join("、").toLocaleLowerCase().replace(/\s/g, "");
  const conflicts: Array<{ membershipId: number; constraint: string; kind: "allergy" | "restriction" }> = [];
  for (const participant of participants) {
    for (const constraint of participant.allergies) {
      if (allergyTerms(constraint).some(term => text.includes(term))) conflicts.push({ membershipId: participant.membershipId,constraint,kind: "allergy" });
    }
    for (const constraint of participant.restrictions) {
      const normalized = constraint.toLocaleLowerCase().replace(/\s/g, "");
      const explicit = /^(?:不吃|忌食|忌口|避免|禁食)(.+)$/.exec(normalized)?.[1];
      const matched = (/素食|纯素/.test(normalized) && /猪|牛|羊|鸡|鸭|鱼|虾|蟹|肉|蛋|奶/.test(text))
        || (/清真/.test(normalized) && /猪|料酒|酒精/.test(text))
        || (explicit && explicit.split(/[、,，]/).some(term => term && allergyTerms(term).some(alias => text.includes(alias))));
      if (matched) conflicts.push({ membershipId: participant.membershipId,constraint,kind: "restriction" });
    }
  }
  const rawIngredients = parseArray(recipe.ingredients_json);
  const measured = rawIngredients.flatMap(value => {
    if (!value || typeof value !== "object") return [];
    const item = value as Row;
    return typeof item.name === "string" && item.name.trim() && typeof item.amount === "string"
      ? [{ name: item.name.trim(),amount: item.amount.trim() }] : [];
  });
  const yieldSize = Number(recipe.serving_size);
  const rawDemands = totalServings && Number.isFinite(yieldSize) && yieldSize > 0 && measured.length === rawIngredients.length
    ? recipeDemands(measured,yieldSize,totalServings) : null;
  const demands = rawDemands?.map(item => ({ ...item,amount_value: Math.round(item.amount_value * 1_000_000) / 1_000_000 }));
  const known = demands && demands.length > 0 && demands.every(item => Number.isFinite(item.amount_value) && item.amount_value > 0 && item.amount_value <= 1_000_000_000);
  const materials = known ? { status: "known" as const,recipeYield: yieldSize,demands }
    : { status: "unknown" as const,recipeYield: Number.isFinite(yieldSize) && yieldSize > 0 ? yieldSize : null,demands: [] };
  return {
    materials,
    fingerprint: createHash("sha256").update(JSON.stringify({ id: Number(recipe.id),title: recipe.title,description: recipe.description ?? null,ingredients: rawIngredients,servings: Number(recipe.serving_size) })).digest("hex"),
    recipeId: Number(recipe.id),title: String(recipe.title),status: conflicts.length ? "blocked" as const : "needs_review" as const,conflicts,
    checks: [
      ...(!known ? ["原料总用量未能完整换算，请核对菜谱份数与每项配料数量"] : ["原料为共餐总需求，尚未扣除可用库存或已有预留"]),
      ...(!ingredients.length ? ["菜谱缺少可识别的配料，无法核对完整忌口"] : []),
      "逐人核对全部已共享限制、复合调料与实际制作条件；文本未匹配不代表符合忌口",
    ],
  };
}
