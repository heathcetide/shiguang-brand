import { permanentRecipePreferencePayloadSchema, permanentPreferencePayloadSchema } from "./preferencePayload.js";
import { agentMealProduction, agentPreparedMealEvent } from "./mealPayload.js";
import { agentInventoryCreate, agentInventoryUpdate, agentInventoryConsumption, InventoryActionClarificationError } from "./inventoryPayload.js";
import { z } from "zod";
import type { AgentActionProposal, AgentActionType } from "./types.js";
import type { UserContext } from "../contextBuilder.js";

const lowRiskActions = new Set<AgentActionType>([
  "create_meal_plan",
  "update_meal_plan",
  "add_shopping_items",
  "update_shopping_item",
]);

const highRiskActions = new Set<AgentActionType>([
  "delete_meal_plan",
  "delete_shopping_item",
  "record_diet_meal",
  "add_inventory_item",
  "update_inventory_item",
  "consume_inventory_items",
  "produce_meal",
  "record_prepared_meal_event",
  "add_kitchenware_item",
  "submit_recipe",
  "update_kitchen_preferences", "update_recipe_preference", "record_health_log",
]);

export const agentActionProposalSchema = z.object({
  actionType: z.enum([
    "create_meal_plan", "update_meal_plan", "add_shopping_items", "update_shopping_item",
    "delete_meal_plan", "delete_shopping_item", "record_diet_meal", "add_inventory_item",
    "update_inventory_item", "consume_inventory_items", "produce_meal", "record_prepared_meal_event", "add_kitchenware_item", "submit_recipe",
    "update_kitchen_preferences", "update_recipe_preference", "record_health_log",
  ]),
  summary: z.string().trim().min(1).max(300),
  payload: z.record(z.string(), z.unknown()),
}).strict();

const requiredText = z.string().trim().min(1);
const optionalNonnegativeNumber = z.preprocess(
  (value) => value === "" || value === null || value === undefined ? undefined : Number(value),
  z.number().finite().nonnegative().optional(),
);

function normalizeMealType(value: unknown) {
  const mealType = typeof value === "string" ? value.trim() : "";
  return ({ breakfast: "早餐", lunch: "午餐", dinner: "晚餐", snack: "加餐" } as Record<string, string>)[mealType.toLocaleLowerCase()] || mealType || "午餐";
}

function normalizePayload(actionType: AgentActionType, raw: Record<string, unknown>) {
  if (actionType === "update_recipe_preference") return permanentRecipePreferencePayloadSchema.parse(raw);
  if (actionType === "update_kitchen_preferences") return permanentPreferencePayloadSchema.parse(raw);
  if (actionType === "produce_meal" || actionType === "record_prepared_meal_event") {
    try {
      if (actionType === "produce_meal") agentMealProduction(raw, "agent-production-validation");
      else agentPreparedMealEvent(raw, "agent-meal-event-validation");
      return raw;
    } catch { throw new InventoryActionClarificationError("请确认制作或待吃餐的对象、份量及实际食用日期；制作完成不会自动算作已吃。"); }
  }
  if (actionType === "record_diet_meal") {
    const rawDate = raw.recordedAt ?? raw.date;
    const recordedAt = typeof rawDate === "string" && !["today", "今天"].includes(rawDate.trim().toLocaleLowerCase())
      ? rawDate.trim()
      : undefined;
    return z.object({
      foodName: requiredText.max(120),
      mealType: requiredText.max(20),
      amount: requiredText.max(80),
      recordedAt: z.string().trim().min(1).max(30).optional(),
      recordedTime: z.string().trim().min(1).max(20).optional(),
      calories: optionalNonnegativeNumber,
      protein: optionalNonnegativeNumber,
      carbs: optionalNonnegativeNumber,
      fat: optionalNonnegativeNumber,
    }).parse({
      foodName: raw.foodName ?? raw.dishName ?? raw.name,
      mealType: normalizeMealType(raw.mealType),
      amount: raw.amount ?? raw.portion ?? "1 份",
      recordedAt,
      recordedTime: raw.recordedTime,
      calories: raw.calories,
      protein: raw.protein,
      carbs: raw.carbs,
      fat: raw.fat,
    });
  }

  if (["add_inventory_item", "update_inventory_item", "consume_inventory_items"].includes(actionType)) {
    try {
      if (actionType === "add_inventory_item") {
        const item = agentInventoryCreate(raw);
        return { ...raw, name: item.food_name, quantity: item.quantity, quantityValue: item.quantity_value,
          quantityUnit: item.quantity_unit, expirationDate: item.expiration_date };
      }
      if (actionType === "update_inventory_item") agentInventoryUpdate(raw);
      else agentInventoryConsumption(raw, "agent-policy-validation");
      return raw;
    } catch {
      throw new InventoryActionClarificationError(actionType === "consume_inventory_items"
        ? "请确认要使用或丢弃的库存批次、数量和单位；只有明确用完才会整项扣减。库存变化后需重新确认。"
        : "请补充要修改的库存批次及数量；库存变化后需重新确认。数量不确定时可以说明未知。");
    }
  }

  validateRequiredPayload(actionType, raw);
  return raw;
}

function validateRequiredPayload(actionType: AgentActionType, payload: Record<string, unknown>) {
  const idSchema = z.coerce.number().int().positive();
  switch (actionType) {
    case "create_meal_plan":
      z.object({ items: z.array(z.record(z.string(), z.unknown())).default([]) }).passthrough().parse(payload);
      break;
    case "update_meal_plan":
    case "delete_meal_plan":
      z.object({ planId: requiredText.max(120) }).passthrough().parse(payload);
      break;
    case "add_shopping_items":
      z.object({ items: z.array(z.object({ name: requiredText }).passthrough()).min(1) }).passthrough().parse(payload);
      break;
    case "update_shopping_item":
    case "delete_shopping_item":
      z.object({ itemId: requiredText.max(120) }).passthrough().parse(payload);
      break;
    case "update_inventory_item":
      z.object({ itemId: idSchema }).passthrough().parse(payload);
      break;
    case "consume_inventory_items":
      z.object({ itemIds: z.array(idSchema).min(1) }).passthrough().parse(payload);
      break;
    case "add_kitchenware_item":
      z.object({ name: requiredText }).passthrough().parse(payload);
      break;
    case "submit_recipe":
      z.object({ title: requiredText }).passthrough().parse(payload);
      break;
    case "record_health_log": {
      const parsed = z.object({
        weightKg: optionalNonnegativeNumber,
        bodyFatPercentage: optionalNonnegativeNumber,
        waterMl: optionalNonnegativeNumber,
      }).passthrough().parse(payload);
      if (parsed.weightKg === undefined && parsed.bodyFatPercentage === undefined && parsed.waterMl === undefined) {
        throw new Error("健康记录至少需要体重、体脂率或饮水量中的一项");
      }
      break;
    }
    default:
      break;
  }
}

export type AllergySafetyBlock = {
  allergyName: string;
  severe: boolean;
  reply: string;
};

const allergyAliases: Record<string, string[]> = {
  "花生": ["peanut", "groundnut", "落花生", "花生", "花生酱", "花生醬", "花生碎", "花身", "花牲", "花生将", "花生醬料"],
  "坚果": ["坚果", "堅果", "almond", "peanut", "花生", "花生酱", "花生醬", "花生碎", "花身", "花牲", "花生将", "腰果", "核桃", "杏仁", "榛子", "开心果", "開心果", "碧根果", "板栗", "夏威夷果"],
  "海鲜": ["海鲜", "海 marine", "海鮮", "虾", "蝦", "蟹", "贝", "貝", "牡蛎", "生蚝", "扇贝", "蛤蜊", "花甲", "鲍鱼", "海参", "海鱼", "三文鱼", "金枪鱼", "鳕鱼", "带鱼", "鱿鱼", "章鱼", "墨鱼", "鱼肉", "鱼片", "seafood", "shrimp", "prawn", "crab"],
  "乳制品": ["乳制品", "乳製品", "牛奶", "奶酪", "芝士", "酸奶", "奶油", "黄油", "牛油", "炼乳", "乳清", "奶粉", "干酪", "乳糖", "milk", "cheese", "butter", "buttermilk", "milkshake", "cheesecake", "cheeseburger", "buttercream", "butterfat", "cream", "whey", "casein", "caseinate"],
  "鸡蛋": ["鸡蛋", "雞蛋", "蛋清", "蛋黄", "蛋液", "蛋白", "全蛋", "蛋皮", "鸡蛋碎", "荷包蛋", "炒蛋", "煎蛋", "egg", "eggs"],
  "大豆": ["大豆", "黄豆", "黑豆", "豆浆", "豆腐", "豆皮", "豆干", "腐竹", "大豆油", "soy", "soybean", "tofu"],
  "小麦": ["小麦", "小麥", "面粉", "麵粉", "面条", "麵條", "面包", "麵包", "面筋", "麵筋", "麸质", "麦麸", "wheat", "flour", "gluten"],
};

function normalizedSafetyText(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, "");
}

function matchesAllergyTerm(lowerText: string, compactText: string, term: string): boolean {
  const normTerm = term.normalize("NFKC").toLocaleLowerCase().trim().replace(/\s+/g, " ");
  if (!normTerm) return false;
  if (/[^\x00-\x7F]/.test(normTerm)) {
    if (normTerm === "蛋白") {
      const sanitized = compactText.replace(/蛋白质|高蛋白(?!液)|植物蛋白|大豆(?:分离)?蛋白/g, " ");
      return sanitized.includes("蛋白");
    }
    return compactText.includes(normTerm.replace(/\s+/g, ""));
  }
  const escaped = normTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
  const leftBoundary = /^\w/.test(normTerm) ? "\\b" : "";
  const rightBoundary = /\w$/.test(normTerm) ? "s?\\b" : "";
  const regex = new RegExp(`${leftBoundary}${escaped}${rightBoundary}`, "i");
  if (normTerm === "egg" || normTerm === "eggs") {
    const sanitized = lowerText.replace(/\begg[\s_-]?plants?\b/gi, "");
    return regex.test(sanitized);
  }
  let matchingText = lowerText;
  if (normTerm === "milk") {
    matchingText = lowerText.replace(/\balmond[ \t-]+milks?\b/gi, " ");
  } else if (normTerm === "butter") {
    matchingText = lowerText.replace(/\b(?:peanut|cocoa)[ \t-]+butters?\b/gi, " ");
  } else if (normTerm === "cream") {
    matchingText = lowerText.replace(/\b(?:coconut[ \t-]+creams?|creams?[ \t-]+of[ \t-]+tartars?)\b/gi, " ");
  }
  return regex.test(matchingText);
}

function isSevere(value: string | undefined) {
  const severity = normalizedSafetyText(value || "");
  return ["severe", "high", "重度", "严重", "嚴重"].some((term) => severity.includes(term));
}

function allergyTerms(name: string) {
  const normalizedName = normalizedSafetyText(name);
  const aliases = Object.entries(allergyAliases).find(([key, values]) => [key, ...values].some((alias) => normalizedName === normalizedSafetyText(alias) || normalizedName.includes(normalizedSafetyText(key))))?.[1] || [];
  return [...new Set([name, ...aliases].map((item) => item.normalize("NFKC").toLocaleLowerCase().trim()).filter(Boolean))];
}

function allergySafetyReply(name: string, severe: boolean) {
  const severity = severe ? "严重" : "";
  return `你的健康档案已记录对“${name}”${severity}过敏，因此我不会生成、保存或采购任何可能含该过敏原的餐单或采购项，也不建议少量尝试。请同时核对加工食品标签，并留意共用刀具、砧板、容器和生产线带来的交叉污染风险。可改用已确认不过敏的替代食材（例如葵花籽酱）；如曾有严重反应，请遵循医生给出的应急方案。`;
}

export function findAllergyConflict(text: string, ctx: UserContext): AllergySafetyBlock | null {
  const lowerText = text.normalize("NFKC").toLocaleLowerCase();
  const compactText = lowerText.replace(/\s+/g, "");
  for (const allergy of ctx.healthProfile?.allergies || []) {
    const name = allergy.name.trim();
    if (!name || !allergyTerms(name).some((term) => matchesAllergyTerm(lowerText, compactText, term))) continue;
    const severe = isSevere(allergy.severity);
    return { allergyName: name, severe, reply: allergySafetyReply(name, severe) };
  }
  return null;
}

// This guard is only for proposed food candidates / write payloads, never the
// user's consultation text. Unknown compound ingredients require clarification.
export function findCandidateSafetyConflict(candidate: unknown, ctx: UserContext): AllergySafetyBlock | null {
  const rawStrings: string[] = [];
  const text = JSON.stringify(candidate, (key, value) => {
    if (key && Number.isNaN(Number(key))) {
      rawStrings.push(key);
    }
    if (typeof value === "string") {
      rawStrings.push(value);
    }
    return value;
  }) || "";
  for (const rawStr of rawStrings) {
    const conflict = findAllergyConflict(rawStr, ctx);
    if (conflict) return conflict;
  }
  const allergy = ctx.healthProfile?.allergies?.find((item) => item.name.trim());
  if (
    allergy &&
    (/(复合调味|混合调料|混合酱|沙茶酱|沙嗲酱|satay|秘制调料|特调酱|成分不明|配料不详|未知配料|未知成分|不明配料)/i.test(text) ||
      rawStrings.some((rawStr) =>
        /\b(?:unknown[ \t-]+ingredients?|ingredients?[ \t-]+unknown|ingredients?[ \t-]+list[ \t-]+unavailable|ingredients?[ \t-]+not[ \t-]+specified|unspecified[ \t-]+ingredients?)\b/i.test(
          rawStr.normalize("NFKC")
        )
      ))
  ) {
    return { allergyName: allergy.name, severe: isSevere(allergy.severity),
      reply: "这份候选包含成分尚未确认的复合食材，暂不推荐或保存。请补充完整配料标签及过敏原声明，确认符合你的过敏限制后再继续。" };
  }
  return null;
}

export class AgentSafetyConflictError extends Error {
  readonly block: AllergySafetyBlock;

  constructor(block: AllergySafetyBlock) {
    super(`操作包含已记录的过敏或不耐受食材：${block.allergyName}`);
    this.name = "AgentSafetyConflictError";
    this.block = block;
  }
}

export function normalizeActionProposal(value: unknown): AgentActionProposal {
  const parsed = agentActionProposalSchema.parse(value);
  return {
    ...parsed,
    payload: normalizePayload(parsed.actionType, parsed.payload),
    riskLevel: lowRiskActions.has(parsed.actionType) ? "low" : highRiskActions.has(parsed.actionType) ? "high" : "forbidden",
  };
}

export function validateAgentActions(actions: unknown[], ctx: UserContext): AgentActionProposal[] {
  const normalized = actions.slice(0, 150).map(normalizeActionProposal);
  for (const action of normalized) {
    // Freeze relative diet dates before approval; a delayed confirmation must not move "today".
    if (action.actionType === "record_diet_meal" && action.payload.recordedAt === undefined && ctx.clock) {
      action.payload.recordedAt = ctx.clock.local_date;
    }
    if (ctx.clock && action.actionType === "record_prepared_meal_event" && action.payload.type === "eat" && action.payload.recorded_at === undefined) {
      action.payload = { ...action.payload, recorded_at: ctx.clock.local_date };
    }
    if (ctx.clock && action.actionType === "produce_meal") {
      const production = action.payload.production as Record<string, unknown>;
      if (Number(production.eaten_servings) > 0 && production.eaten_at === undefined) {
        action.payload = { ...action.payload, production: { ...production, eaten_at: ctx.clock.local_date } };
      }
    }
    if (action.riskLevel === "forbidden") throw new Error(`禁止的 Agent 操作：${action.actionType}`);
    if (!["create_meal_plan", "update_meal_plan", "add_shopping_items", "update_shopping_item", "submit_recipe"].includes(action.actionType)) continue;
    const conflict = findCandidateSafetyConflict(action.payload, ctx);
    if (conflict) throw new AgentSafetyConflictError(conflict);
  }
  return normalized;
}

export function normalizePrivacyDisclosure(reply: string, actionCount: number, request: string) {
  const asksForNoBusinessWrite = /(不要保存|不要写入|不保存|只给建议|仅给建议)/.test(request);
  if (!asksForNoBusinessWrite || actionCount > 0) return reply;
  const cleaned = reply
    .replace(/(?:本次|此次)?(?:咨询|对话|请求)?(?:中)?[，,：:]?\s*(?:我|系统)?(?:不会|没有|未)(?:保存|存储|记录)(?:您|你)?的?任何个人数据[。！!]?/g, "")
    .trim();
  const disclosure = "本次未创建餐单、采购、库存、饮食或健康业务记录；本次对话与 Agent Run 仍会按隐私说明保存。";
  return cleaned ? `${cleaned}\n\n${disclosure}` : disclosure;
}

export function hasHighRiskActions(actions: AgentActionProposal[]) {
  return actions.some((action) => action.riskLevel === "high");
}
