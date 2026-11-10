import { randomUUID } from "node:crypto";
import type { AIWriteConfirmationsRepository } from "./repository.js";
import type { AIWriteAction, PreparedAIWrite } from "./types.js";
import { currentDateKey, currentTimeKey, dateKeyAfterDays } from "../../utils/date.js";

function numberOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function prepare(action: AIWriteAction, payload: Record<string, unknown>): PreparedAIWrite {
  if (action === "record_diet_meal") {
    const mealType = ["早餐", "午餐", "晚餐", "加餐"].includes(String(payload.mealType)) ? String(payload.mealType) : "午餐";
    const foodName = String(payload.foodName || "").trim();
    if (!foodName) throw new Error("缺少食物名称");
    const today = currentDateKey();
    const recordedAt = typeof payload.recordedAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(payload.recordedAt) ? payload.recordedAt : today;
    const recordedTime = typeof payload.recordedTime === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(payload.recordedTime)
      ? payload.recordedTime : recordedAt === today ? currentTimeKey() : null;
    return { kind: "diet", action, mealType, foodName, amount: String(payload.amount || "1份"), calories: numberOrNull(payload.calories),
      protein: numberOrNull(payload.protein), carbs: numberOrNull(payload.carbs), fat: numberOrNull(payload.fat), recordedAt, recordedTime,
      message: `已记录${mealType}：${foodName}` };
  }
  if (action === "add_inventory_item") {
    const name = String(payload.name || "").trim();
    if (!name) throw new Error("缺少食材名称");
    const location = ["冷藏", "冷冻", "常温"].includes(String(payload.location)) ? String(payload.location) : "冷藏";
    const days = Math.max(1, Math.min(Number(payload.expireDays) || 7, 365));
    return { kind: "inventory", action, name, category: String(payload.category || "其他"), location,
      quantity: String(payload.quantity || "1份"), expirationDate: dateKeyAfterDays(days), message: `已加入库存：${name}` };
  }
  if (action === "add_kitchenware_item") {
    const name = String(payload.name || "").trim();
    if (!name) throw new Error("缺少厨具名称");
    const category = ["小家电", "烹饪锅具", "刀具餐具", "烘焙工具", "其他"].includes(String(payload.category)) ? String(payload.category) : "其他";
    const status = ["常用", "良好", "需保养", "维修中", "闲置"].includes(String(payload.status)) ? String(payload.status) : "良好";
    return { kind: "kitchenware", action, name, category, status, note: String(payload.note || "").slice(0, 300) || null,
      message: `已加入厨具：${name}` };
  }
  if (action === "record_health_log") {
    const values = [numberOrNull(payload.weightKg), numberOrNull(payload.bodyFatPercentage), numberOrNull(payload.waterMl)] as const;
    if (values.every((value) => value === null)) throw new Error("缺少可记录的健康数据");
    return { kind: "health", action, weight: values[0], bodyFat: values[1], waterMl: values[2], recordedDate: currentDateKey(),
      message: "健康数据已更新" };
  }
  throw new Error("不支持的写入操作");
}

export class AIWriteConfirmationsService {
  private readonly repository: AIWriteConfirmationsRepository;
  constructor(repository: AIWriteConfirmationsRepository) { this.repository = repository; }

  async createPreview(input: { userId: number; action: AIWriteAction; payload: Record<string, unknown>;
    conversationId?: string; sourceMessageId?: string }) {
    const id = randomUUID();
    const created = await this.repository.createPreview({ id, ...input });
    return { confirmationId: id, action: input.action, payload: input.payload, expiresAt: created.expiresAt };
  }

  async commit(input: { userId: number; confirmationId: string; idempotencyKey: string }) {
    const confirmation = await this.repository.confirmation(input.confirmationId, input.userId);
    if (!confirmation) throw new Error("确认记录不存在或无权操作");
    if (confirmation.status === "committed") return confirmation.committedResult ?? {};
    if (confirmation.status !== "preview") throw new Error("该确认记录已失效");
    const outcome = await this.repository.commit({ id: confirmation.id, userId: input.userId, idempotencyKey: input.idempotencyKey,
      prepared: prepare(confirmation.action, confirmation.payload) });
    if (outcome.kind === "missing") throw new Error("确认记录不存在或无权操作");
    if (outcome.kind === "invalid") throw new Error("该确认记录已失效");
    if (outcome.kind === "expired") throw new Error("确认已过期，请重新发起操作");
    return outcome.result;
  }
}
