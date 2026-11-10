import { requestJson, type ApiFetch } from "./client";

export type InventoryOutcome = "cooked" | "used" | "discarded" | "expired" | "gifted" | "transferred" | "unknown";

export interface InventoryOutcomeEvent {
  id: string;
  traceType: "outcome" | "change_log";
  itemId: number;
  foodName: string;
  category: string;
  outcome: InventoryOutcome;
  source: string;
  quantityValue: number | null;
  quantityUnit: string | null;
  quantityText: string | null;
  expirationDate: string | null;
  occurredAt: string;
  version: number;
  corrected: boolean;
}

export interface InventoryWeeklyReport {
  scope: "personal" | "household";
  householdId: number | null;
  weekStart: string;
  weekEndExclusive: string;
  summary: {
    usedCount: number;
    wastedCount: number;
    unknownCount: number;
    giftedOrTransferredCount: number;
    timelyUsedCount: number;
    promptedUseCount: number;
    quantityTotals: { used: Record<string, number>; wasted: Record<string, number> };
  };
  previousSummary: InventoryWeeklyReport["summary"];
  trend: { usedDelta: number; wastedDelta: number; timelyUsedDelta: number };
  events: InventoryOutcomeEvent[];
  advice: string;
  dataQuality: "empty" | "partial" | "structured";
  money: null;
  moneyMessage: string;
}

export const insightsApi = {
  weekly: (apiFetch: ApiFetch, input: { weekStart: string; scope: "personal" | "household"; householdId?: number }) => {
    const params = new URLSearchParams({
      weekStart: input.weekStart,
      scope: input.scope,
      timezoneOffsetMinutes: String(new Date().getTimezoneOffset()),
    });
    if (input.householdId) params.set("householdId", String(input.householdId));
    return requestJson<InventoryWeeklyReport>(apiFetch, `/api/v1/insights/inventory-outcomes/weekly?${params.toString()}`);
  },
  recordOutcome: (apiFetch: ApiFetch, input: unknown) =>
    requestJson<{ event: InventoryOutcomeEvent; repeated: boolean }>(apiFetch, "/api/v1/insights/inventory-outcomes", {
      method: "POST", body: JSON.stringify(input),
    }),
  correctOutcome: (apiFetch: ApiFetch, eventId: string, version: number, outcome: InventoryOutcome) =>
    requestJson<InventoryOutcomeEvent>(apiFetch, `/api/v1/insights/inventory-outcomes/${encodeURIComponent(eventId)}`, {
      method: "PATCH", body: JSON.stringify({ version, outcome }),
    }),
};
