import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { InsightsError } from "../src/modules/insights/errors.js";
import type { InsightsRepository } from "../src/modules/insights/repository.js";
import { InsightsService, summarizeInventoryOutcomes } from "../src/modules/insights/service.js";
import type { InventoryOutcomeEvent } from "../src/modules/insights/types.js";

const event: InventoryOutcomeEvent = {
  id: "11111111-1111-4111-8111-111111111111",
  traceType: "outcome",
  itemId: 1,
  foodName: "菠菜",
  category: "蔬菜",
  outcome: "used",
  source: "reminder",
  quantityValue: 500,
  quantityUnit: "g",
  quantityText: "500g",
  expirationDate: "2030-01-10",
  occurredAt: "2030-01-08T10:00:00.000Z",
  version: 1,
  corrected: false,
};

function fakeRepository(overrides: Partial<InsightsRepository> = {}): InsightsRepository {
  return {
    createOutcome: async () => ({ kind: "created", event }),
    updateOutcome: async () => ({ kind: "updated", event: { ...event, outcome: "gifted", version: 2, corrected: true } }),
    isHouseholdMember: async () => true,
    listEvents: async () => [],
    findActionable: async () => null,
    ...overrides,
  };
}

describe("insights module", () => {
  test("keeps weekly timezone and quantity summaries independent of the database driver", () => {
    const summary = summarizeInventoryOutcomes([event, { ...event, id: "2", outcome: "discarded", source: "manual", quantityValue: 0.5, quantityUnit: "kg" }], -480);
    assert.equal(summary.usedCount, 1);
    assert.equal(summary.wastedCount, 1);
    assert.equal(summary.timelyUsedCount, 1);
    assert.equal(summary.promptedUseCount, 1);
    assert.deepEqual(summary.quantityTotals, { used: { g: 500 }, wasted: { kg: 0.5 } });
  });

  test("maps repository outcomes to stable domain errors", async () => {
    const service = new InsightsService(fakeRepository({ createOutcome: async () => ({ kind: "conflict" }) }));
    await assert.rejects(
      () => service.createOutcome(7, {
        scope: "personal", itemId: 1, itemVersion: 1, outcome: "used", source: "manual",
        idempotencyKey: "insights-module-test-0001", closeItem: true,
      }),
      (error: unknown) => error instanceof InsightsError && error.code === "INVENTORY_VERSION_CONFLICT",
    );
  });

  test("isolates household reports before loading events", async () => {
    let listCalls = 0;
    const service = new InsightsService(fakeRepository({
      isHouseholdMember: async () => false,
      listEvents: async () => { listCalls += 1; return []; },
    }));
    await assert.rejects(
      () => service.weekly(7, { weekStart: "2030-01-07", timezoneOffsetMinutes: 0, scope: "household", householdId: 9 }),
      (error: unknown) => error instanceof InsightsError && error.code === "HOUSEHOLD_REPORT_NOT_FOUND",
    );
    assert.equal(listCalls, 0);
  });
});
