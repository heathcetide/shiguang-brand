import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAIPromptMessages, buildUserContext } from "../src/services/contextBuilder.js";
import { configureAiContextService } from "../src/modules/aiContext/runtime.js";
import { AiContextService } from "../src/modules/aiContext/service.js";
import { configureRecommendationsService } from "../src/modules/recommendations/runtime.js";
import type { RecommendationsService } from "../src/modules/recommendations/service.js";

// Run under TZ=UTC: business dates must not follow the host's calendar.
test("each turn captures one Shanghai clock across midnight, month/year boundaries and delayed rendering", async () => {
  const { configureAIRuntimeService } = await import('../src/modules/aiRuntime/runtime.js');
  const { AIRuntimeService } = await import('../src/modules/aiRuntime/service.js');
  configureAIRuntimeService(new AIRuntimeService({ settings: async () => ({}), saveSettings: async () => {}, compareAndSaveSetting: async () => false, recordUsage: async () => {} }, {}));
  const queriedDates: string[] = [];
  const recommendationDates: string[] = [];
  configureAiContextService(new AiContextService({ load: async (_userId, date) => {
    queriedDates.push(date);
    return { user: null, inventory: [], kitchenware: [], todayDiet: [], latestHealth: null, healthProfile: null, personaPrompt: "" };
  } }));
  configureRecommendationsService({ compute: async (_userId: number, _input: unknown, _override: unknown, date: string) => { recommendationDates.push(date); return { results: [] }; } } as unknown as RecommendationsService);
  const cases = [
    ["2026-10-22T15:59:59Z", "2026-10-22", "2026-10-22T23:59:59+08:00"],
    ["2026-10-22T16:00:00Z", "2026-10-23", "2026-10-23T00:00:00+08:00"],
    ["2026-10-31T16:00:00Z", "2026-11-01", "2026-11-01T00:00:00+08:00"],
    ["2026-12-31T16:00:00Z", "2027-01-01", "2027-01-01T00:00:00+08:00"],
  ];
  for (const [instant, date, time] of cases) {
    const context = await buildUserContext(1, new Date(instant));
    // Rendering later must not read a second clock.
    const runtime = JSON.parse(buildAIPromptMessages(context).at(-1)!.content.split("\n")[1]);
    assert.equal(queriedDates.at(-1), date);
    assert.equal(recommendationDates.at(-1), date);
    assert.equal(runtime.local_date, date);
    assert.equal(runtime.today_intake.date, date);
    assert.equal(runtime.current_time, time);
    assert.equal(runtime.time_zone, "Asia/Shanghai");
  }
  assert.equal(queriedDates.length, cases.length);
});
