import type { Row } from "./types.js";

export const PREFERENCE_EVIDENCE_VERSION = "internal-evidence-v1";
const horizonMs = 30 * 24 * 60 * 60 * 1000;
const timestamp = (value: unknown) => value instanceof Date ? value.getTime() : typeof value === "string" ? Date.parse(value.includes("T") ? value : `${value.replace(" ","T")}Z`) : NaN;
const metadata = (value: unknown): Row => {
  try { const parsed = typeof value === "string" ? JSON.parse(value) : value; return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Row : {}; }
  catch { return {}; }
};

type DislikeEvidence = { id: string; at: string; reason: string };
/** Ranking and explanations share the same eligibility, clock and event identity. */
function dislikeEvidence(events: Row[], now: number) {
  const evidence = new Map<number,Map<string,DislikeEvidence>>();
  for (const event of events) {
    const facts = metadata(event.metadata_json);
    const at = timestamp(event.created_at);
    if (event.event_type !== "skip" || facts.reason !== "dislike" || facts.scope !== "long_term" || facts.withdrawn === true || facts.learningPaused === true) continue;
    if (!Number.isFinite(at) || at > now || now-at > horizonMs) continue;
    const recipeId = Number(event.recipe_id);
    const identity = String(event.idempotency_key ?? event.id ?? "");
    if (!Number.isInteger(recipeId) || recipeId <= 0 || !identity) continue;
    const records = evidence.get(recipeId) ?? new Map<string,DislikeEvidence>();
    const next = { id: String(event.id ?? identity),at: new Date(at).toISOString(),reason: "明确长期不喜欢" };
    const previous = records.get(identity);
    // A duplicated input must not change the explanation based on read order.
    if (!previous || next.at < previous.at || (next.at === previous.at && next.id < previous.id)) records.set(identity,next);
    evidence.set(recipeId,records);
  }
  return new Map([...evidence].map(([recipeId,records]) => [recipeId,[...records.values()].sort((a,b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))]));
}
/** Old unlabelled skips and transient circumstances are not taste evidence. */
export function repeatedDislikeRecipeIds(events: Row[], now = Date.now()): number[] {
  return [...dislikeEvidence(events,now)].filter(([,records]) => records.length >= 3).map(([recipeId]) => recipeId).sort((a,b) => a-b);
}

export type LearningData = { settings: Row | null; events: Row[]; recipes: Row[] };
export function learningOverrides(settings: Row | null): Record<string,{ value: "neutral" | "dislike"; updatedAt: string; sourceActionId?: string }> {
  return metadata(settings?.overrides_json) as Record<string,{ value: "neutral" | "dislike"; updatedAt: string; sourceActionId?: string }>;
}
export function effectiveDislikeRecipeIds(data: LearningData, now = Date.now()): number[] {
  const ids = new Set(data.settings?.enabled === false || data.settings?.enabled === 0 ? [] : repeatedDislikeRecipeIds(data.events,now));
  for (const [key,override] of Object.entries(learningOverrides(data.settings))) {
    if (override.value === "dislike") ids.add(Number(key)); else ids.delete(Number(key));
  }
  return [...ids];
}
export function formatLearningState(data: LearningData, now = Date.now()): import("@dietdigidose/contracts").PreferenceLearningState {
  const overrides = learningOverrides(data.settings);
  const accepted = dislikeEvidence(data.events,now);
  return { version: Number(data.settings?.version ?? 1),enabled: data.settings?.enabled !== false && data.settings?.enabled !== 0,ruleVersion: PREFERENCE_EVIDENCE_VERSION,
    items: effectiveDislikeRecipeIds(data,now).map(recipeId => {
      const override = overrides[String(recipeId)];
      const evidence = accepted.get(recipeId) ?? [];
      return { recipeId,title: String(data.recipes.find(recipe => Number(recipe.id) === recipeId)?.title ?? "已不可用菜谱"),origin: override ? "explicit" as const : "inferred" as const,
        explanation: override ? "你明确设置为不喜欢" : "近30天至少三次明确长期不喜欢，仅降低排序，不排除菜谱",updatedAt: override?.updatedAt ?? evidence.map(item => item.at).sort().at(-1) ?? "",evidence: override ? override.sourceActionId ? [{ id: `preference-statement:${override.sourceActionId}`,at: override.updatedAt,reason: "已确认的长期菜谱口味设置" }] : [] : evidence };
    }) };
}
