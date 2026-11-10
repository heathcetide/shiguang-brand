import { InsightsError } from "./errors.js";
import type { InsightsRepository } from "./repository.js";
import type { InventoryOutcomeCreateInput, InventoryOutcomeEvent, InventoryOutcomeUpdateInput, InventoryScope } from "./types.js";

function dateWindow(dateKey: string, timezoneOffsetMinutes: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return null;
  const localMidnightUtc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) + timezoneOffsetMinutes * 60_000;
  if (!Number.isFinite(localMidnightUtc)) return null;
  return {
    start: new Date(localMidnightUtc).toISOString(),
    end: new Date(localMidnightUtc + 7 * 86_400_000).toISOString(),
    previousStart: new Date(localMidnightUtc - 7 * 86_400_000).toISOString(),
  };
}

function localDateAt(iso: string, offsetMinutes: number) {
  return new Date(Date.parse(iso) - offsetMinutes * 60_000).toISOString().slice(0, 10);
}

export function summarizeInventoryOutcomes(events: InventoryOutcomeEvent[], timezoneOffsetMinutes: number) {
  const used = events.filter((event) => event.outcome === "cooked" || event.outcome === "used");
  const wasted = events.filter((event) => event.outcome === "discarded" || event.outcome === "expired");
  const timely = used.filter((event) => {
    if (!event.expirationDate) return false;
    const occurred = localDateAt(event.occurredAt, timezoneOffsetMinutes);
    const days = (Date.parse(`${event.expirationDate}T00:00:00Z`) - Date.parse(`${occurred}T00:00:00Z`)) / 86_400_000;
    return days >= 0 && days <= 3;
  });
  const prompted = used.filter((event) => event.source === "reminder" || event.source === "recommendation");
  const quantityTotals = { used: {} as Record<string, number>, wasted: {} as Record<string, number> };
  for (const [group, rows] of [["used", used], ["wasted", wasted]] as const) {
    for (const event of rows) {
      if (event.quantityValue === null || !event.quantityUnit) continue;
      quantityTotals[group][event.quantityUnit] = Math.round(((quantityTotals[group][event.quantityUnit] || 0) + event.quantityValue) * 1000) / 1000;
    }
  }
  return {
    usedCount: used.length,
    wastedCount: wasted.length,
    unknownCount: events.filter((event) => event.outcome === "unknown").length,
    giftedOrTransferredCount: events.filter((event) => event.outcome === "gifted" || event.outcome === "transferred").length,
    timelyUsedCount: timely.length,
    promptedUseCount: prompted.length,
    quantityTotals,
  };
}

export class InsightsService {
  private readonly repository: InsightsRepository;

  constructor(repository: InsightsRepository) { this.repository = repository; }

  async createOutcome(userId: number, input: InventoryOutcomeCreateInput) {
    const result = await this.repository.createOutcome(userId, input);
    if (result.kind === "household_not_found") throw new InsightsError(404, "家庭库存不存在", "HOUSEHOLD_INVENTORY_NOT_FOUND");
    if (result.kind === "inventory_not_found") throw new InsightsError(404, "库存食材不存在", "INVENTORY_NOT_FOUND");
    if (result.kind === "conflict") throw new InsightsError(409, "库存已被更新，请刷新后重试", "INVENTORY_VERSION_CONFLICT");
    return { event: result.event, repeated: result.kind === "repeated" };
  }

  async updateOutcome(userId: number, eventId: string, input: InventoryOutcomeUpdateInput) {
    const result = await this.repository.updateOutcome(userId, eventId, input);
    if (result.kind === "not_found") throw new InsightsError(404, "结果记录不存在", "OUTCOME_NOT_FOUND");
    if (result.kind === "conflict") throw new InsightsError(409, "结果分类已更新，请刷新后重试", "OUTCOME_VERSION_CONFLICT");
    return result.event;
  }

  async weekly(userId: number, input: {
    weekStart: string;
    timezoneOffsetMinutes: number;
    scope: InventoryScope;
    householdId?: number;
  }) {
    const offset = Math.max(-840, Math.min(840, input.timezoneOffsetMinutes || 0));
    const window = dateWindow(input.weekStart, offset);
    if (!window) throw new InsightsError(400, "周起始日期格式无效", "INVALID_WEEK_START");
    const ownerId = input.scope === "personal" ? userId : Number(input.householdId);
    if (input.scope === "household" && (!Number.isInteger(ownerId) || !(await this.repository.isHouseholdMember(ownerId, userId)))) {
      throw new InsightsError(404, "家庭报告不存在", "HOUSEHOLD_REPORT_NOT_FOUND");
    }
    const [events, previousEvents, actionable] = await Promise.all([
      this.repository.listEvents(input.scope, ownerId, window.start, window.end),
      this.repository.listEvents(input.scope, ownerId, window.previousStart, window.start),
      this.repository.findActionable(input.scope, ownerId, input.weekStart),
    ]);
    const summary = summarizeInventoryOutcomes(events, offset);
    const previous = summarizeInventoryOutcomes(previousEvents, offset);
    const knownQuantityEvents = events.filter((event) => event.quantityValue !== null && event.quantityUnit);
    return {
      scope: input.scope,
      householdId: input.scope === "household" ? ownerId : null,
      weekStart: input.weekStart,
      weekEndExclusive: localDateAt(window.end, offset),
      summary,
      previousSummary: previous,
      trend: {
        usedDelta: summary.usedCount - previous.usedCount,
        wastedDelta: summary.wastedCount - previous.wastedCount,
        timelyUsedDelta: summary.timelyUsedCount - previous.timelyUsedCount,
      },
      events,
      advice: actionable ? `未来 3 天有 ${actionable.count} 项${actionable.category}库存到期，可优先安排相关餐次。` : "暂时没有需要立即处理的临期库存，保持按需采购即可。",
      dataQuality: events.length === 0 ? "empty" : knownQuantityEvents.length === events.length ? "structured" : "partial",
      money: null,
      moneyMessage: "未记录可靠单价，因此不展示节约或浪费金额。",
    };
  }
}
