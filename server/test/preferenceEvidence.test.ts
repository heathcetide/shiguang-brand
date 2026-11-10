import assert from "node:assert/strict";
import { test } from "node:test";
import { effectiveDislikeRecipeIds, repeatedDislikeRecipeIds } from "../src/modules/recommendations/preferenceEvidence.js";
const now = Date.parse("2026-09-12T12:00:00Z");
const event = (id: string,reason = "dislike",scope = "long_term") => ({ id,recipe_id: 1,event_type: "skip",metadata_json: { reason,scope },idempotency_key: id,created_at: "2026-09-12 10:00:00" });
test("requires three distinct recent long-term dislike signals", () => {
  assert.deepEqual(repeatedDislikeRecipeIds([event("a")],now),[]);
  assert.deepEqual(repeatedDislikeRecipeIds([event("a"),event("a"),event("a")],now),[]);
  assert.deepEqual(repeatedDislikeRecipeIds([event("a"),event("b"),event("c")],now),[1]);
});
test("no time, excess portions, session choices and unlabeled history do not imply dislike", () => {
  for (const reason of ["no_time","too_much","", "dislike"]) {
    const events = ["a","b","c"].map(id => event(id,reason,reason === "dislike" ? "session" : "long_term"));
    assert.deepEqual(repeatedDislikeRecipeIds(events,now),[]);
  }
});
test("expired, withdrawn, future and malformed evidence cannot strengthen a preference", () => {
  const base = [event("a"),event("b")];
  for (const invalid of [{ ...event("c"),created_at: "2026-08-01 10:00:00" },{ ...event("c"),created_at: "2099-09-12" },{ ...event("c"),metadata_json: { reason: "dislike",scope: "long_term",withdrawn: true } },{ ...event("c"),metadata_json: "not json" }]) {
    assert.deepEqual(repeatedDislikeRecipeIds([...base,invalid],now),[]);
  }
  assert.deepEqual(repeatedDislikeRecipeIds([...base,{ ...event("c"),created_at: new Date("2026-09-12T10:00:00Z"),metadata_json: JSON.stringify(event("c").metadata_json) }],now),[1]);
});

test("explanations contain exactly the distinct evidence accepted by ranking",async () => {
  const { formatLearningState } = await import("../src/modules/recommendations/preferenceEvidence.js");
  const events = [event("a"),event("b"),event("c"),event("a"),
    { ...event("view"),event_type: "view" },event("session","dislike","session"),event("busy","no_time"),event("large","too_much"),
    { ...event("paused"),metadata_json: { ...event("paused").metadata_json,learningPaused: true } },
    { ...event("withdrawn"),metadata_json: { ...event("withdrawn").metadata_json,withdrawn: true } }];
  const data = { settings: null,events,recipes: [{ id: 1,title: "菜谱" }] };
  const state = formatLearningState(data,now);
  assert.deepEqual(state.items.map(item => item.recipeId),repeatedDislikeRecipeIds(events,now));
  assert.deepEqual(state.items[0]?.evidence.map(item => item.id),["a","b","c"]);
  assert.deepEqual(formatLearningState({ ...data,events: [...events].reverse() },now),state);
  assert.deepEqual(formatLearningState({ ...data,events: events.filter(item => item.id!=="c") },now).items,[]);
  assert.deepEqual(formatLearningState(data,now+31*24*60*60*1000).items,[]);
  assert.deepEqual(formatLearningState({ ...data,settings: { enabled: false } },now).items,[]);
  assert.deepEqual(formatLearningState({ ...data,settings: { overrides_json: { 1: { value: "neutral",updatedAt: "today" } } } },now).items,[]);
});

test("effectiveDislikeRecipeIds integrates inferred signals, user neutral tombstones, explicit dislikes and paused state", () => {
  const events = [event("a"), event("b"), event("c")];
  const baseData = { settings: null, events, recipes: [{ id: 1, title: "菜谱1" }] };

  // 1. Inferred dislike from 3 long-term events
  assert.deepEqual(effectiveDislikeRecipeIds(baseData, now), [1]);

  // 2. User sets neutral: overrides inferred dislike and prevents regeneration from same events
  const neutralData = {
    ...baseData,
    settings: { enabled: true, overrides_json: { 1: { value: "neutral" as const, updatedAt: "2026-09-12T11:00:00Z" } } },
  };
  assert.deepEqual(effectiveDislikeRecipeIds(neutralData, now), []);

  // 3. User explicitly sets another recipe as dislike without any skip events
  const explicitData = {
    ...baseData,
    settings: { enabled: true, overrides_json: { 2: { value: "dislike" as const, updatedAt: "2026-09-12T11:00:00Z" } } },
  };
  assert.deepEqual(effectiveDislikeRecipeIds(explicitData, now).sort((a, b) => a - b), [1, 2]);

  // 4. Pausing learning removes inferred dislikes, but retains explicit dislike overrides
  const pausedWithExplicit = {
    ...baseData,
    settings: { enabled: false, overrides_json: { 2: { value: "dislike" as const, updatedAt: "2026-09-12T11:00:00Z" } } },
  };
  assert.deepEqual(effectiveDislikeRecipeIds(pausedWithExplicit, now), [2]);

  // 5. When enabled is numeric 0 (SQLite style), it also pauses inferred dislikes
  const pausedSqlite = {
    ...baseData,
    settings: { enabled: 0, overrides_json: {} },
  };
  assert.deepEqual(effectiveDislikeRecipeIds(pausedSqlite, now), []);
});
