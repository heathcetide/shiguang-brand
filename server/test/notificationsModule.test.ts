import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { NotificationsRepository } from "../src/modules/notifications/repository.js";
import { createNotificationsService, DEFAULT_NOTIFICATION_PREFERENCES } from "../src/modules/notifications/service.js";

function repository(overrides: Partial<NotificationsRepository> = {}): NotificationsRepository {
  return {
    feedbackIntervention: async () => ({ ok: false,status: 404,code: "INTERVENTION_NOT_FOUND" }),activeInterventionSnooze: async () => null,
    interventionCard: async () => null,
    interventionScanCursor: async () => 0,advanceInterventionScan: async () => true,
    interventionScanUsers: async () => [],interventionQueue: async () => [],
    pendingInterventionUsers: async () => [],
    claimIntervention: async () => null,finishIntervention: async () => false,
    reserveIntervention: async () => ({}),
    interventionPreferences: async () => null, saveInterventionPreferences: async () => null,
    preferences: async () => null,
    savePreferences: async () => {},
    saveDevice: async () => {},
    ensureRoutineNotification: async () => {},
    unreadCount: async () => 0,
    history: async () => [],
    readAll: async () => 0,
    read: async () => false,
    action: async () => false,
    localEvent: async () => 1,
    adminData: async () => ({ activeDevices: 0, enabledUsers: 0, campaigns: [], automatic: [], eventCounts: {} }),
    beginCampaign: async () => ({ campaignId: 1, recipientCount: 0, devices: [] }),
    finishCampaign: async () => {},
    failCampaign: async () => {},
    recordPushTickets: async () => {},
    pendingReceipts: async () => [],
    applyReceipts: async () => {},
    prepareExpiring: async () => [],
    markExpiringDeliveries: async () => {},
    ...overrides,
  };
}

describe("notifications module", () => {
  test("keeps default preferences and pagination database-neutral", async () => {
    const service = createNotificationsService(repository({ history: async () => [
      { id: 8, isRead: false }, { id: 7, isRead: true }, { id: 6, isRead: false },
    ] }));
    assert.deepEqual(await service.preferences(42), DEFAULT_NOTIFICATION_PREFERENCES);
    assert.deepEqual(await service.history(42, "all", null, 2), {
      items: [{ id: 8, isRead: false }, { id: 7, isRead: true }], nextCursor: 7, hasMore: true,
    });
  });

  test("materializes due routines only after preferences exist", async () => {
    const ensured: string[] = [];
    const service = createNotificationsService(repository({
      preferences: async () => ({ ...DEFAULT_NOTIFICATION_PREFERENCES, breakfast_time: "00:00", lunch_time: "00:00",
        dinner_time: "00:00", water_start_time: "00:00", water_end_time: "00:00", quiet_start_time: "00:00", quiet_end_time: "00:00" }),
      ensureRoutineNotification: async (input) => { ensured.push(`${input.kind}:${input.key}`); },
      unreadCount: async () => 4,
    }));
    assert.equal(await service.unreadCount(42), 4);
    assert.deepEqual(ensured, ["meal:breakfast", "meal:lunch", "meal:dinner", "water:daily"]);
  });

  test("records Expo submissions and receipt outcomes through the repository", async () => {
    const recorded: unknown[] = []; const applied: unknown[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => new Response(JSON.stringify({ data:
      String(input).includes("getReceipts") ? { "ticket-1": { status: "ok" } } : [{ id: "ticket-1", status: "ok" }] }),
    { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
    try {
      const service = createNotificationsService(repository({
        recordPushTickets: async (entries) => { recorded.push(...entries); },
        pendingReceipts: async () => [{ ticketId: "ticket-1", userId: 42, notificationId: 7, token: "ExpoPushToken[test]" }],
        applyReceipts: async (entries) => { applied.push(...entries); },
      }));
      const tickets = await service.sendExpoPush([{ to: "ExpoPushToken[test]", title: "标题", body: "内容", data: { type: "system" } }]);
      assert.equal(tickets[0]?.id, "ticket-1");
      assert.equal(recorded.length, 1);
      assert.deepEqual(await service.checkExpoPushReceipts(), { checked: 1 });
      assert.equal(applied.length, 1);
    } finally { globalThis.fetch = originalFetch; }
  });

  test("finishes inbox-only expiry and zero-device campaigns without network calls", async () => {
    const marked: unknown[] = []; const finished: unknown[] = [];
    const service = createNotificationsService(repository({
      prepareExpiring: async () => [{ userId: 42, notificationId: 7, inventoryItemId: 9, title: "临期", body: "处理", tokens: [] }],
      markExpiringDeliveries: async (_date, entries) => { marked.push(...entries); },
      beginCampaign: async () => ({ campaignId: 3, recipientCount: 2, devices: [] }),
      finishCampaign: async (...args) => { finished.push(args); },
    }));
    assert.deepEqual(await service.sendExpiringInventoryNotifications(), { recipients: 1, messages: 0, failedRecipients: 0 });
    assert.deepEqual(marked, [{ userId: 42, status: "inbox_only" }]);
    assert.deepEqual(await service.sendCampaign(1, "维护", "已完成"), { id: 3, recipients: 2, success: 0, failure: 0 });
    assert.equal(finished.length, 1);
  });
});

test("intervention sender preserves priority, archives ambiguous delivery, and fences network calls", async () => {
  const originalFetch = globalThis.fetch;
  const originalFlag = process.env.PROACTIVE_INTERVENTIONS_ENABLED;
  const controller = new AbortController();
  const context = { runId: "run",taskName: "notifications" as const,leaseOwnerId: "owner",signal: controller.signal,assertActive: async () => {} };
  const claim = { id: "candidate",owner: "owner",userId: 42,title: "提醒",body: "查看建议",notificationId: 9,priority: "normal" as const,tokens: ["ExpoPushToken[test]"] };
  const outcomes: string[] = [];
  const requests: Array<Record<string,unknown>> = [];
  let response: unknown = [{ status: "ok",id: "ticket" }];
  let crash = false;
  globalThis.fetch = (async (_input: unknown,init: RequestInit) => {
    requests.push(...JSON.parse(String(init.body)));
    if (crash) throw new Error("connection lost after submission");
    return new Response(JSON.stringify({ data: response }),{ status: 200 });
  }) as typeof fetch;
  process.env.PROACTIVE_INTERVENTIONS_ENABLED = "1";
  try {
    const service = createNotificationsService(repository({
      pendingInterventionUsers: async () => [42],claimIntervention: async (_user,_now,_owner,enabled) => enabled ? claim : null,
      finishIntervention: async (_id,_owner,_now,outcome) => { outcomes.push(outcome);return true; },
    }));
    assert.deepEqual(await service.sendInterventions(context),{ processed: 1,accepted: 1,failed: 0,uncertain: 0 });
    assert.equal(requests[0]!.priority,"normal");
    assert.deepEqual(requests[0]!.data,{ type: "proactive_intervention",interventionId: "candidate",notificationId: 9 });
    response = [{ status: "error",details: { error: "DeviceNotRegistered" } }];
    assert.equal((await service.sendInterventions(context)).failed,1);
    response = [];
    assert.equal((await service.sendInterventions(context)).uncertain,1);
    crash = true;
    assert.equal((await service.sendInterventions(context)).uncertain,1);
    assert.deepEqual(outcomes,["accepted","failed","uncertain","uncertain"]);
    process.env.PROACTIVE_INTERVENTIONS_ENABLED = "0";
    assert.equal((await service.sendInterventions(context)).processed,0);
    assert.equal(requests.length,4);
    process.env.PROACTIVE_INTERVENTIONS_ENABLED = "1";
    let checks = 0;
    await assert.rejects(service.sendInterventions({ ...context,assertActive: async () => { if (++checks>=3) throw new Error("lease lost"); } }),/lease lost/);
    assert.equal(requests.length,4);
    assert.equal(outcomes.at(-1),"uncertain");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalFlag===undefined) delete process.env.PROACTIVE_INTERVENTIONS_ENABLED;
    else process.env.PROACTIVE_INTERVENTIONS_ENABLED = originalFlag;
  }
});

test("opportunity scan pages consented users and derives stable candidates from server snapshots", async () => {
  const { defaultInterventionPreferences } = await import("@dietdigidose/contracts");
  const originalFlag = process.env.PROACTIVE_INTERVENTIONS_ENABLED;
  const originalNow = Date.now;
  Date.now = () => Date.parse("2026-09-12T09:30:00Z");
  process.env.PROACTIVE_INTERVENTIONS_ENABLED = "1";
  const reserved: import("../src/modules/interventions/reservation.js").InterventionReservation[] = [];
  const context = { runId: "scan",taskName: "notifications" as const,leaseOwnerId: "owner",signal: new AbortController().signal,assertActive: async () => {} };
  try {
    const service = createNotificationsService(repository({
      interventionScanUsers: async after => after===0 ? [42,43] : [],
      interventionPreferences: async () => ({ ...defaultInterventionPreferences,enabled: true,expiry_rescue: true,dinner_window: true,version: 1 }),
      reserveIntervention: async input => { reserved.push(input);return {}; },
    }),{ interventionSnapshot: async userId => {
      if (userId===43) throw new Error("snapshot unavailable");
      return { dates: ["2026-09-12","2026-09-13"],items: [],plans: [],inventory: [{ id: 9,userId,expirationDate: "2026-09-13",available: true,deleted: false,remaining: 2 }],
        recommendations: [{ recipeId: 1,quality: 0.9,hardConstraintsPassed: true,inventoryIds: [9] }] };
    } });
    assert.deepEqual(await service.scanInterventions(context),{ scanned: 1,candidates: 2,failed: 1 });
    assert.deepEqual(reserved.map(row => row.candidate.kind),["expiry_rescue","dinner_window"]);
    assert(reserved.every(row => row.candidate.userId===42 && row.candidate.dataObservedAt===Date.now()));
    await service.scanInterventions(context);
    assert.equal(reserved[0].candidate.sourceKey,reserved[2].candidate.sourceKey);
    process.env.PROACTIVE_INTERVENTIONS_ENABLED = "0";
    assert.deepEqual(await service.scanInterventions(context),{ scanned: 0,candidates: 0,failed: 0 });
    assert.equal(reserved.length,4);
  } finally {
    Date.now = originalNow;
    if (originalFlag===undefined) delete process.env.PROACTIVE_INTERVENTIONS_ENABLED;else process.env.PROACTIVE_INTERVENTIONS_ENABLED = originalFlag;
  }
});

test("scan checkpoints resume after restart, bound each batch, and refuse lost ownership", async () => {
  const { defaultInterventionPreferences } = await import("@dietdigidose/contracts");
  const flag = process.env.PROACTIVE_INTERVENTIONS_ENABLED;
  process.env.PROACTIVE_INTERVENTIONS_ENABLED = "1";
  let cursor = 0,owner = "one";
  const scanned: number[] = [];
  const repo = repository({
    interventionScanCursor: async () => cursor,
    advanceInterventionScan: async (expected,next,currentOwner) => {
      if (expected!==cursor || currentOwner!==owner) return false;
      cursor = next;return true;
    },
    interventionScanUsers: async (after,limit) => Array.from({ length: 30 },(_,index) => index+1).filter(id => id>after).slice(0,limit),
    interventionPreferences: async () => ({ ...defaultInterventionPreferences,enabled: true,expiry_rescue: true,version: 1 }),
  });
  const engine = { interventionSnapshot: async (id: number) => {
    scanned.push(id);return { dates: [],items: [],plans: [],inventory: [],recommendations: [] };
  } };
  const context = { runId: "scan",taskName: "intervention-scan" as const,leaseOwnerId: owner,signal: new AbortController().signal,assertActive: async () => {} };
  try {
    assert.equal((await createNotificationsService(repo,engine).scanInterventions(context)).scanned,25);
    assert.equal(cursor,25);
    owner = "two";
    await assert.rejects(createNotificationsService(repo,engine).scanInterventions(context),/checkpoint lease or cursor changed/);
    assert.equal(cursor,25);
    scanned.length = 0;
    assert.equal((await createNotificationsService(repo,engine).scanInterventions({ ...context,leaseOwnerId: owner })).scanned,5);
    assert.deepEqual(scanned,[26,27,28,29,30]);
    assert.equal(cursor,0,"completed sweep wraps to include newly opted-in accounts");
  } finally {
    if (flag===undefined) delete process.env.PROACTIVE_INTERVENTIONS_ENABLED;else process.env.PROACTIVE_INTERVENTIONS_ENABLED = flag;
  }
});

test("a timed-out account advances the cursor without allowing a late snapshot to create candidates", async () => {
  const { scanInterventions } = await import("../src/modules/interventions/scan.js");
  const { defaultInterventionPreferences } = await import("@dietdigidose/contracts");
  const originalFlag = process.env.PROACTIVE_INTERVENTIONS_ENABLED;
  process.env.PROACTIVE_INTERVENTIONS_ENABLED = "1";
  let cursor = 0,writes = 0;
  let release!: (value: Awaited<ReturnType<import("../src/modules/recommendations/service.js").RecommendationsService["interventionSnapshot"]>>) => void;
  const pending = new Promise<Awaited<ReturnType<import("../src/modules/recommendations/service.js").RecommendationsService["interventionSnapshot"]>>>(resolve => { release = resolve; });
  const repo = repository({ interventionScanCursor: async () => cursor,advanceInterventionScan: async (_old,next) => { cursor=next;return true; },
    interventionScanUsers: async after => [1,2].filter(id => id>after),
    interventionPreferences: async () => ({ ...defaultInterventionPreferences,enabled: true,expiry_rescue: true,version: 1 }),
    reserveIntervention: async () => { writes+=1;return {}; },
  });
  const empty = { dates: [],items: [],plans: [],inventory: [],recommendations: [] };
  const engine = { interventionSnapshot: async (id: number) => id===1 ? pending : empty };
  const context = { runId: "slow",taskName: "intervention-scan" as const,leaseOwnerId: "owner",signal: new AbortController().signal,assertActive: async () => {} };
  try {
    assert.deepEqual(await scanInterventions(repo,engine,context,5),{ scanned: 0,candidates: 0,failed: 1 });
    assert.equal(cursor,1);
    assert.deepEqual(await scanInterventions(repo,engine,context,100),{ scanned: 1,candidates: 0,failed: 0 });
    const { interventionDates } = await import("../src/modules/interventions/snapshot.js");
    const dates = interventionDates(Date.now(),"Asia/Shanghai");
    release({ ...empty,dates,inventory: [{ id: 9,userId: 1,expirationDate: dates[1],available: true,deleted: false,remaining: 2 }],
      recommendations: [{ recipeId: 1,quality: 0.9,hardConstraintsPassed: true,inventoryIds: [9] }] });
    await pending;
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(writes,0);
  } finally {
    release(empty);
    if (originalFlag===undefined) delete process.env.PROACTIVE_INTERVENTIONS_ENABLED;else process.env.PROACTIVE_INTERVENTIONS_ENABLED = originalFlag;
  }
});

test("worker cancellation interrupts account reads without advancing the scan cursor", async () => {
  const { scanInterventions } = await import("../src/modules/interventions/scan.js");
  const flag = process.env.PROACTIVE_INTERVENTIONS_ENABLED;
  process.env.PROACTIVE_INTERVENTIONS_ENABLED = "1";
  const controller = new AbortController();
  let checkpoints = 0,compute = 0,release!: (row: null) => void;
  const pending = new Promise<null>(resolve => { release=resolve; });
  const context = { runId: "cancel",taskName: "intervention-scan" as const,leaseOwnerId: "owner",signal: controller.signal,assertActive: async () => { controller.signal.throwIfAborted(); } };
  const service = createNotificationsService(repository({ interventionScanUsers: async () => [1],interventionPreferences: async () => { controller.abort(new Error("worker stopped"));return pending; },
    advanceInterventionScan: async () => { checkpoints+=1;return true; },
  }),{ interventionSnapshot: async () => { compute+=1;return { dates: [],items: [],plans: [],inventory: [],recommendations: [] }; } });
  try {
    await assert.rejects(service.scanInterventions(context),/worker stopped/);
    release(null);await pending;
    assert.equal(checkpoints,0);assert.equal(compute,0);
  } finally {
    release(null);
    if (flag===undefined) delete process.env.PROACTIVE_INTERVENTIONS_ENABLED;else process.env.PROACTIVE_INTERVENTIONS_ENABLED = flag;
  }
});

test("intervention cards expose explicit fields and expire actions without changing stored evidence", async () => {
  const { interventionCard } = await import("../src/modules/interventions/card.js");
  const now = Date.parse("2026-09-12T09:00:00Z");
  const candidate = { title: "提醒",body: "查看建议",whyNow: "有临期食材",expiresLabel: "今晚前",localDate: "2026-09-12",inventoryIds: [1],recipeIds: [2],actions: ["plan_recipe"],secret: "internal" };
  const row = { id: "a".repeat(64),notification_id: 7,kind: "expiry_rescue",status: "inbox",expires_at: "2026-09-12 10:00:00",candidate_json: JSON.stringify(candidate),policy_version: "v1",decision_reason: "eligible",policy_input_json: { tokens: ["secret"] } };
  const card = interventionCard(row,now);
  assert.equal(card.whyNow,candidate.whyNow);assert.equal(card.expiresAt,"2026-09-12T10:00:00.000Z");
  assert(!JSON.stringify(card).includes("secret"));assert.deepEqual(card.actions,["plan_recipe"]);
  assert.deepEqual(interventionCard({ ...row,candidate_json: candidate,expires_at: new Date("2026-09-12T10:00:00Z") },now),card);
  const expired = interventionCard(row,now+3_600_000);
  assert.equal(expired.status,"expired");assert.deepEqual(expired.actions,[]);assert.equal(row.status,"inbox");
});
