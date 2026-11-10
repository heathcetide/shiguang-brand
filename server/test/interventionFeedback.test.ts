import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultInterventionPreferences, interventionFeedbackSchema } from "@dietdigidose/contracts";
import { decideInterventionFeedback, feedbackRequest, replayInterventionFeedback } from "../src/modules/interventions/feedback.js";
const id = "a".repeat(64),key = "11111111-1111-4111-8111-111111111111";
const settings = { ...defaultInterventionPreferences,enabled: true,expiry_rescue: true,dinner_window: true,version: 1 };
const request = { action: "snooze" as const,confirmed: true as const,idempotencyKey: key };
const row = { id,notification_id: 1,status: "inbox",kind: "expiry_rescue",expires_at: "2026-09-15T00:00:00Z",candidate_json: { localDate: "2026-09-12",actions: ["snooze","not_cooking_today","not_helpful"] } };

test("feedback requires explicit confirmation and respects card kind, availability and expiry", () => {
  assert.equal(interventionFeedbackSchema.safeParse({ ...request,confirmed: false }).success,false);
  assert.equal(interventionFeedbackSchema.safeParse({ ...request,userId: 2 }).success,false);
  const now = Date.parse("2026-09-12T10:00:00Z");
  assert.deepEqual(decideInterventionFeedback(null,settings,request,now),{ ok: false,status: 404,code: "INTERVENTION_NOT_FOUND" });
  assert.equal(decideInterventionFeedback({ ...row,status: "acted" },settings,request,now).ok,false);
  assert.equal(decideInterventionFeedback(row,settings,request,Date.parse(String(row.expires_at))).ok,false);
  assert.equal(decideInterventionFeedback(row,settings,{ ...request,action: "not_cooking_today" },now).ok,false);
});

test("snooze uses the next local quiet-period end, including DST", () => {
  const result = decideInterventionFeedback(row,settings,request,Date.parse("2026-09-12T10:00:00Z"));
  assert(result.ok);assert.equal(result.result.snoozedUntil,"2026-09-12T23:00:00.000Z");
  const dst = decideInterventionFeedback({ ...row,expires_at: "2027-03-20T00:00:00Z" },{ ...settings,time_zone: "America/New_York" },request,Date.parse("2027-03-13T22:00:00Z"));
  assert(dst.ok);assert.equal(dst.result.snoozedUntil,"2027-03-14T11:00:00.000Z");
});

test("midnight-crossing dinner opt-out applies to the target meal date", () => {
  const result = decideInterventionFeedback({ ...row,kind: "dinner_window",candidate_json: { ...row.candidate_json,localDate: "2026-09-13" } },settings,{ ...request,action: "not_cooking_today" },Date.parse("2026-09-12T15:45:00Z"));
  assert(result.ok);assert.equal(result.result.notCookingDate,"2026-09-13");
});

test("replay preserves the original acknowledgement and rejects key reuse", () => {
  const decision = decideInterventionFeedback(row,settings,request,Date.parse("2026-09-12T10:00:00Z"));
  assert(decision.ok);
  const saved = { request_json: JSON.stringify(feedbackRequest(id,request)),result_json: decision.result };
  const replay = replayInterventionFeedback(saved,id,request);
  assert(replay?.ok);assert.equal(replay.result.repeated,true);
  assert.equal(replayInterventionFeedback(saved,"b".repeat(64),request)?.ok,false);
  assert.equal(replayInterventionFeedback(saved,id,{ ...request,action: "not_helpful" })?.ok,false);
});

test("not-helpful acknowledgement does not imply disabling preferences or changing inventory", () => {
  const before = JSON.stringify({ row,settings });
  const result = decideInterventionFeedback(row,settings,{ ...request,action: "not_helpful" },Date.parse("2026-09-12T10:00:00Z"));
  assert(result.ok);
  assert.equal(result.result.action,"not_helpful");
  assert.equal(result.result.snoozedUntil,null);assert.equal(result.result.notCookingDate,null);
  assert.equal(JSON.stringify({ row,settings }),before);
});
