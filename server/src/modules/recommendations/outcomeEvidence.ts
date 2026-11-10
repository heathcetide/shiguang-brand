import type { Row } from "./types.js";
import type { PreferenceOutcome } from "@dietdigidose/contracts";
const iso = (value: unknown) => value instanceof Date ? value.toISOString() : String(value).includes("T") ? String(value) : `${String(value).replace(" ","T")}Z`;

/** These are observations, not guesses about taste or why a meal was left over. */
export function formatOutcomeEvidence(production: Row[], events: Row[], inventory: Row[] = [], changes: Row[] = [], statements: Row[] = []): PreferenceOutcome[] {
  const facts = new Map<string,PreferenceOutcome>();
  for (const row of production) {
    const id = `production:${row.id}`;
    const remaining = row.remaining_servings == null ? null : Number(row.remaining_servings);
    const remainingFact = remaining !== null && Number.isFinite(remaining) && remaining >= 0 && row.updated_at != null
      ? { remainingServings: remaining,observedAt: iso(row.updated_at) } : {};
    facts.set(id,{ id,recipeId: row.recipe_id == null ? null : Number(row.recipe_id),title: String(row.food_name),kind: "production",...remainingFact,at: iso(row.produced_at),servings: Number(row.produced_servings),valid: true,explanation: row.reported_cooking_minutes == null ? "已制作，不等于已食用；实际用时未采集" : `已制作；用户报告实际用时 ${Number(row.reported_cooking_minutes)} 分钟，不是菜谱估时` });
  }
  for (const row of events) {
    if (row.event_type !== "eat" && row.event_type !== "discard") continue;
    const id = `prepared-event:${row.id}`;
    const corrected = row.correction_mode != null;
    const missingIntake = row.event_type === "eat" && row.diet_record_id == null;
    facts.set(id,{ id,recipeId: row.recipe_id == null ? null : Number(row.recipe_id),title: String(row.food_name),kind: row.event_type,
      at: iso(row.created_at),servings: Number(row.servings),valid: !corrected && !missingIntake,
      explanation: corrected ? row.correction_mode === "undo_eating" ? "食用已撤销，不再作为学习证据" : "摄入记录已删除，不再作为学习证据" : missingIntake ? "缺少关联摄入记录，不作为学习证据" : row.event_type === "discard" ? "已丢弃；原因未知，不能据此推断不喜欢或份量过大" : "实际食用已确认；单次食用不等于长期喜欢",
      ...(corrected ? { correctionId: String(row.correction_id),correctedAt: iso(row.corrected_at) } : {}),
    });
  }
  const json = (value: unknown): Row => { try { return (typeof value === "string" ? JSON.parse(value) : value) as Row ?? {}; } catch { return {}; } };
  for (const row of inventory) {
    const metadata = json(row.metadata_json);
    const automatic = metadata.acceptance === "automatic";
    const withdrawn = row.undo_id != null || row.deleted_at != null;
    const id = `inventory-confirmation:${row.id}`;
    facts.set(id,{ id,recipeId: null,title: String(row.food_name),kind: "inventory",at: iso(row.created_at),valid: !withdrawn,
      ...(row.quantity_after == null ? {} : { quantity: Number(row.quantity_after),unit: String(row.quantity_unit ?? "") }),
      explanation: withdrawn ? "此库存录入已撤销或删除，不作为偏好证据" : automatic ? "按明确识别规则自动入库；不代表用户明确表达喜欢" : "用户确认的库存事实；买过或拍过不等于喜欢" });
  }
  for (const row of changes) {
    const after = json(row.after_json);
    const id = `meal-plan-change:${row.id}`;
    facts.set(id,{ id,recipeId: Number(after.recipeId) || null,title: String(after.title ?? "餐次调整"),kind: "plan_change",at: iso(row.applied_at ?? row.created_at),valid: row.status === "applied",
      explanation: row.status === "reverted" ? "餐次变更已恢复，不再作为换菜证据" : "餐次调整已应用；原因未明确分类，不据此推断喜欢或厌恶" });
  }
  const labels: Record<string,string> = { avoid_spicy: "不吃辣",servings: "常用份量",meal_time_minutes: "制作时间上限",budget_per_meal: "每餐预算",cooking_level: "烹饪熟练度",eating_out_frequency: "外食频率",usual_meals: "常用餐次",eating_location: "用餐地点",carry_meals: "携带餐食",refrigeration_available: "冷藏条件",reheating_available: "复热条件" };
  for (const row of statements) {
    const result = json(row.result_json);
    if (result.scope !== "persistent" || !["executed","undone"].includes(String(row.status))) continue;
    const after = json(result.kitchenPreferences); const before = json(row.before_json); const current = json(row.current_preferences);
    const keys = Object.keys(after).filter(key => labels[key] && JSON.stringify(after[key]) !== JSON.stringify(before[key]));
    if (!keys.length) continue;
    const valid = row.status === "executed" && keys.every(key => JSON.stringify(after[key]) === JSON.stringify(current[key]));
    const id = `preference-statement:${row.id}`;
    facts.set(id,{ id,recipeId: null,title: "对话中的长期备餐设置",kind: "preference_statement",at: iso(row.executed_at ?? row.created_at),valid,
      explanation: `${keys.map(key => labels[key]).join("、")}：${valid ? "已执行并与当前档案一致" : "已撤销或被后续设置更改，不再当作当前偏好"}` });
  }
  return [...facts.values()].sort((a,b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
}
