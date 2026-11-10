import { activeMealChangePatchSchema } from "@dietdigidose/contracts";
import { evaluateActiveReplacement } from "../mealPlans/activeReplacement.js";
import { type Row } from "../mealPlans/formatters.js";
import type { MealPlanItemUpdateInput } from "../mealPlans/types.js";
import type { MaintenanceInputSnapshot } from "./inputSnapshot.js";

export type PendingSuggestionOutcome = "stale" | "protected" | "blocked" | "needs_review" | "checked";

export type PendingSuggestionEvaluation = {
  changeId: string;
  itemId: string;
  itemVersion: number;
  beforeVersion: number;
  checkedDate: string;
  inputFingerprint: string;
  outcome: PendingSuggestionOutcome;
  checks: string[];
};

export type PendingSuggestionsResult = {
  evaluations: PendingSuggestionEvaluation[];
  checks: string[];
  notes: string[];
};

export function hasEffectiveMaintenanceEvents(events: Row[] | undefined, dailyEnabled: boolean): boolean {
  const recognizedBusinessEvents = new Set([
    "inventory_created", "inventory_changed", "cooking_completion",
    "production", "eat", "discard", "reschedule", "intake_correction",
  ]);
  return (events ?? []).some(event => {
    const kind = String(event.event_type);
    if (kind === "daily_check") return dailyEnabled;
    return recognizedBusinessEvents.has(kind);
  });
}

export function revalidatePendingSuggestions(
  snapshot: MaintenanceInputSnapshot,
  userId: number,
  compatibility: Map<number, { requirements: Row[]; blocking: Row[] }>,
  checkedDate: string,
): PendingSuggestionsResult {
  const evaluations: PendingSuggestionEvaluation[] = [];
  const checks: string[] = [];
  const notes: string[] = [];
  const owned = (row: Row) => Number(row.user_id) === userId;

  const pendingChanges = (snapshot.data.meal_plan_changes ?? []).filter(
    row => owned(row) && row.status === "pending",
  );

  for (const change of pendingChanges) {
    const changeId = String(change.id);
    const itemId = String(change.item_id);
    const planId = String(change.plan_id);

    const plan = (snapshot.data.meal_plans ?? []).find(
      p => String(p.id) === planId && owned(p) && p.status === "active" && !p.deleted_at,
    );
    if (!plan) continue;

    const item = (snapshot.data.meal_plan_items ?? []).find(
      i => String(i.id) === itemId && String(i.plan_id) === planId && owned(i) && !i.deleted_at,
    );
    if (!item) continue;

    if (String(item.planned_date) < checkedDate) continue;

    const originalRecipe = (snapshot.data.recipes ?? []).find(r => Number(r.id) === Number(item.recipe_id));
    const originalTitle = String(item.title || originalRecipe?.title || "原餐次");
    const mealLabel = `${String(item.planned_date)} ${String(item.meal_type)}「${originalTitle}」`;

    const itemVersion = Number(item.version);
    const beforeVersion = Number(change.before_version);

    let rawAfter: unknown;
    try {
      rawAfter = typeof change.after_json === "string" ? JSON.parse(change.after_json) : change.after_json;
    } catch {
      rawAfter = null;
    }

    if (!rawAfter || typeof rawAfter !== "object" || Array.isArray(rawAfter)) {
      const reason = "建议变更数据无效或损坏，需人工核对";
      evaluations.push({
        changeId, itemId, itemVersion, beforeVersion, checkedDate,
        inputFingerprint: snapshot.fingerprint,
        outcome: "needs_review",
        checks: [reason],
      });
      checks.push(`${mealLabel}换菜建议数据无效，需人工核对`);
      continue;
    }

    const { title: _ignoredTitle, validationFingerprint: _ignoredFingerprint, ...patchPayload } = rawAfter as Record<string, unknown>;
    const parsedPatch = activeMealChangePatchSchema.safeParse(patchPayload);
    if (!parsedPatch.success) {
      const reason = "建议变更格式不符合规范，需人工核对";
      evaluations.push({
        changeId, itemId, itemVersion, beforeVersion, checkedDate,
        inputFingerprint: snapshot.fingerprint,
        outcome: "needs_review",
        checks: [reason],
      });
      checks.push(`${mealLabel}换菜建议格式不符合规范，需人工核对`);
      continue;
    }
    const patch = parsedPatch.data;

    // 正常非换菜 patch 可跳过
    if (patch.recipeId == null || (item.recipe_id != null && Number(item.recipe_id) === patch.recipeId)) {
      continue;
    }

    const proposedRecipe = (snapshot.data.recipes ?? []).find(r => Number(r.id) === patch.recipeId);
    const proposedTitle = String(proposedRecipe?.title || (rawAfter as Row).title || "替代菜谱");

    if (itemVersion !== beforeVersion || patch.version !== beforeVersion) {
      const reason = `餐次版本已变化（建议基于版本 ${beforeVersion}，当前版本 ${itemVersion}）`;
      evaluations.push({
        changeId, itemId, itemVersion, beforeVersion, checkedDate,
        inputFingerprint: snapshot.fingerprint,
        outcome: "stale",
        checks: [reason],
      });
      checks.push(`${mealLabel}换菜建议已过期：${reason}`);
      continue;
    }

    const protectedReasons: string[] = [];
    if (item.status !== "planned") {
      protectedReasons.push(`餐次当前状态为 ${String(item.status)}，换菜建议保持保护`);
    }
    if (item.confirmed_at != null) {
      protectedReasons.push("餐次已确认，换菜建议保持待确认保护");
    }

    let isDining = false;
    if (item.dining_json != null) {
      if (typeof item.dining_json === "string") {
        const trimmed = item.dining_json.trim();
        if (trimmed !== "" && trimmed !== "null") {
          try {
            const parsed = JSON.parse(trimmed);
            if (parsed != null) isDining = true;
          } catch {
            isDining = true; // malformed 非空 JSON 必须 fail-closed 受保护
          }
        }
      } else if (typeof item.dining_json === "object") {
        isDining = true;
      } else {
        // 非 null 的非 string 原始标量也视为 invalid/protected
        isDining = true;
      }
    }
    if (patch.dining != null) isDining = true;

    if (item.household_id != null || item.household_meal_id != null || isDining) {
      protectedReasons.push("共餐或家庭餐次需由成员共同核对，换菜建议保持保护");
    }

    const isPurchased = (snapshot.data.shopping_list_items ?? []).some(
      row => owned(row) && !row.deleted_at && String(row.client_id).startsWith(`meal-plan:${itemId}:`)
        && (Boolean(row.checked) || row.inventory_item_id != null),
    );
    if (isPurchased) {
      protectedReasons.push("餐次关联原料已采购或已入库，换菜建议保持待确认保护");
    }

    const isQueuedOrStarted = (snapshot.data.cooking_queue_items ?? []).some(
      row => owned(row) && !row.deleted_at
        && (String(row.source_plan_item_id) === itemId || (item.queue_item_id != null && String(row.id) === String(item.queue_item_id)))
        && String(row.status) !== "cancelled",
    );
    if (isQueuedOrStarted) {
      protectedReasons.push("餐次已进入制作队列或已制作，换菜建议保持保护");
    }

    if (protectedReasons.length > 0) {
      evaluations.push({
        changeId, itemId, itemVersion, beforeVersion, checkedDate,
        inputFingerprint: snapshot.fingerprint,
        outcome: "protected",
        checks: protectedReasons,
      });
      checks.push(`${mealLabel}换菜建议受保护：${protectedReasons.join("；")}`);
      continue;
    }

    // 只映射实际 compatibility.entries()，不合成缺失项
    const evalData = {
      ...snapshot.data,
      recipe_compatibility: [...compatibility.entries()].map(([recipe_id, value]) => ({
        recipe_id,
        requirements: value.requirements,
        blocking: value.blocking,
      })),
    };
    const input: MealPlanItemUpdateInput = {
      ...patch,
      version: beforeVersion,
    };
    const planItems = (snapshot.data.meal_plan_items ?? []).filter(
      row => String(row.plan_id) === planId && owned(row) && !row.deleted_at,
    );
    let result: ReturnType<typeof evaluateActiveReplacement>;
    try {
      result = evaluateActiveReplacement({
        userId,
        plan,
        items: planItems,
        input,
        itemId,
        data: evalData,
        today: checkedDate,
      });
    } catch {
      const reason = "当前餐单执行依据不完整，无法完成本次检查";
      evaluations.push({
        changeId, itemId, itemVersion, beforeVersion, checkedDate,
        inputFingerprint: snapshot.fingerprint,
        outcome: "needs_review",
        checks: [reason],
      });
      checks.push(`${mealLabel}建议替换为「${proposedTitle}」需重新核对：${reason}`);
      continue;
    }

    const blockedChecks = result.checks.filter(c => c.severity === "blocked");
    const pendingChecks = result.checks.filter(c => c.severity === "pending");

    if (blockedChecks.length > 0) {
      const msgs = blockedChecks.map(c => c.message);
      evaluations.push({
        changeId, itemId, itemVersion, beforeVersion, checkedDate,
        inputFingerprint: snapshot.fingerprint,
        outcome: "blocked",
        checks: msgs,
      });
      checks.push(`${mealLabel}建议替换为「${proposedTitle}」需重新核对：${msgs.join("；")}`);
    } else if (pendingChecks.length > 0) {
      const msgs = pendingChecks.map(c => c.message);
      evaluations.push({
        changeId, itemId, itemVersion, beforeVersion, checkedDate,
        inputFingerprint: snapshot.fingerprint,
        outcome: "needs_review",
        checks: msgs,
      });
      checks.push(`${mealLabel}建议替换为「${proposedTitle}」有待核对条件：${msgs.join("；")}`);
    } else {
      evaluations.push({
        changeId, itemId, itemVersion, beforeVersion, checkedDate,
        inputFingerprint: snapshot.fingerprint,
        outcome: "checked",
        checks: ["本次快照检查通过，仍待确认，接受时须重新预览"],
      });
      notes.push(`${mealLabel}建议替换为「${proposedTitle}」：本次快照检查通过，仍待确认，接受时须重新预览`);
    }
  }

  return { evaluations, checks, notes };
}
