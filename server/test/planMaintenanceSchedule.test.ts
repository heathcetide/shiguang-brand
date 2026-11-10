import assert from "node:assert/strict";
import { test } from "node:test";
import { dailyCheckOccurrence, nextDailyCheck } from "../src/modules/planMaintenance/schedule.js";

const shanghai = { timeZone: "Asia/Shanghai", localTime: "08:15" };

test("daily checks use the selected local clock and retain a due occurrence across restart", () => {
  const before = nextDailyCheck(new Date("2026-09-11T23:00:00Z"), shanghai);
  assert.deepEqual(before, { localDate: "2026-09-12", scheduledAt: "2026-09-12T00:15:00.000Z" });
  assert.deepEqual(nextDailyCheck(new Date("2026-09-12T05:00:00Z"), shanghai), before);
  assert.deepEqual(nextDailyCheck(new Date("2026-09-12T05:00:00Z"), shanghai, "2026-09-12"),
    { localDate: "2026-09-13", scheduledAt: "2026-09-13T00:15:00.000Z" });
});

test("days missed while stopped coalesce into the current local day", () => {
  assert.deepEqual(nextDailyCheck(new Date("2026-09-15T04:00:00Z"), shanghai, "2026-09-10"),
    { localDate: "2026-09-15", scheduledAt: "2026-09-15T00:15:00.000Z" });
});

test("spring gaps use the first available minute and autumn repeated hours use the first occurrence", () => {
  const zone = "America/New_York";
  assert.deepEqual(dailyCheckOccurrence("2026-03-08", { timeZone: zone, localTime: "02:30" }),
    { localDate: "2026-03-08", scheduledAt: "2026-03-08T07:00:00.000Z" });
  assert.deepEqual(dailyCheckOccurrence("2026-11-01", { timeZone: zone, localTime: "01:30" }),
    { localDate: "2026-11-01", scheduledAt: "2026-11-01T05:30:00.000Z" });
  assert.equal(nextDailyCheck(new Date("2026-11-01T06:20:00Z"), { timeZone: zone, localTime: "01:30" }, "2026-11-01").localDate,
    "2026-11-02");
});

test("non-hour offsets, half-hour DST and skipped calendar days remain deterministic", () => {
  assert.equal(dailyCheckOccurrence("2026-09-12", { timeZone: "Asia/Kathmandu", localTime: "08:15" })?.scheduledAt,
    "2026-09-12T02:30:00.000Z");
  assert.equal(dailyCheckOccurrence("2026-10-04", { timeZone: "Australia/Lord_Howe", localTime: "02:15" })?.scheduledAt,
    "2026-10-03T15:30:00.000Z");
  assert.equal(dailyCheckOccurrence("2011-12-30", { timeZone: "Pacific/Apia", localTime: "08:15" }), null);
});

test("timezone edits cannot repeat a completed date when the user's clock moves backwards", () => {
  const result = nextDailyCheck(new Date("2026-09-12T01:00:00Z"), { timeZone: "America/Los_Angeles", localTime: "08:15" }, "2026-09-12");
  assert.deepEqual(result, { localDate: "2026-09-13", scheduledAt: "2026-09-13T15:15:00.000Z" });
});

test("invalid settings are rejected instead of silently selecting a user's time", () => {
  for (const localTime of ["", "24:00", "8:15", "08:60"]) {
    assert.throws(() => nextDailyCheck(new Date(), { ...shanghai, localTime }));
  }
  for (const timeZone of ["", "not/a-zone"]) assert.throws(() => nextDailyCheck(new Date(), { ...shanghai, timeZone }));
  assert.throws(() => dailyCheckOccurrence("2026-02-30", shanghai));
  assert.throws(() => nextDailyCheck(new Date("invalid"), shanghai));
});
