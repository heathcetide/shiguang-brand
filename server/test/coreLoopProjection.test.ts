import assert from "node:assert/strict";
import { test } from "node:test";
import { projectCoreLoops, type CoreLoopDataset } from "../src/modules/adminConsole/coreLoopProjection.js";
import { evaluateCoreLoop, summarizeCoreLoopWeek } from "../src/modules/adminConsole/coreLoopMetric.js";
function dataset(): CoreLoopDataset {
  return { settings: {},legacy: [],shared: [],productions: [{ id: "meal",user_id: 1,kind: "real",recipe_id: 7,idempotency_key: "make",produced_at: new Date("2026-09-12T00:00:01Z"),
    result_json: { health_data: "must-not-copy",metric_environment: "staging",selection_evidence: { version: 1,requestId: "request",recipeId: 7,selectedAt: "2026-09-12T00:00:00Z",inventory: { version: 1,allocations: [{ itemId: 11 }] } },
      inventory_consumption_changes: [{ item_id: 11,quantity_before: 0.5,quantity_after: 0.4,consumed_value: 0.10000000000000003 }] } }],
    logs: [{ user_id: 1,inventory_item_id: 11,action: "created",source: "manual",created_at: "2026-09-11 23:59:00" },
      { user_id: 1,inventory_item_id: 11,action: "consume_partial",source: "cooking",idempotency_key: "cooking:make:11:0",quantity_before: "0.5",quantity_after: "0.4",delta_value: "-0.1" }],
    intakes: [{ prepared_meal_id: "meal",user_id: 1,servings: 1,created_at: "2026-09-12 00:00:02",diet_record_id: 4,record_exists: true,corrected: false }] };
}
test("projection normalizes driver times and decimals and retains only minimal linked evidence", () => {
  const facts = projectCoreLoops(dataset());
  assert.equal(evaluateCoreLoop(facts[0],"staging").reason,"included");
  assert.equal(facts[0].actorKey,"user:1");
  assert(!JSON.stringify(facts).includes("must-not-copy"));
});
test("unrelated logs, account mismatches and corrected intake never complete the chain", () => {
  const wrongKey = dataset(); wrongKey.logs[1].idempotency_key = "cooking:other:11:0";
  assert.equal(evaluateCoreLoop(projectCoreLoops(wrongKey)[0],"staging").reason,"deduction_evidence_missing");
  const wrongUser = dataset(); wrongUser.logs[1].user_id = 2;
  assert.equal(evaluateCoreLoop(projectCoreLoops(wrongUser)[0],"staging").reason,"deduction_evidence_missing");
  const corrected = dataset(); corrected.intakes[0].corrected = true;
  assert.equal(evaluateCoreLoop(projectCoreLoops(corrected)[0],"staging").reason,"no_surviving_intake");
});
test("only persisted manual acceptance confirms assisted intake; automatic and legacy AI remain unknown", () => {
  for (const [source,acceptance,expected] of [
    ["ai","manual","included"], ["manual","manual","included"],
    ["ai","automatic","stock_evidence_missing"], ["manual","automatic","stock_evidence_missing"],
    ["ai",null,"stock_evidence_missing"], ["ai","unrecognized","stock_evidence_missing"],
  ] as const) {
    const input = dataset(); Object.assign(input.logs[0],{ source,acceptance });
    assert.equal(evaluateCoreLoop(projectCoreLoops(input)[0],"staging").reason,expected,`${source}/${acceptance}`);
  }
});
test("split household intakes retain all evidence but count one unresolved production", () => {
  const input = dataset(); input.productions = []; input.intakes = []; input.logs = [];
  const shared = { id: "batch",created_by_user_id: 1,kind: "real",produced_at: "2026-09-11 10:00:00",servings: 1 };
  input.shared = [
    { ...shared,diet_record_id: 21,intake_at: "2026-09-11 12:00:00" },
    { ...shared,diet_record_id: 22,intake_at: "2026-09-12 12:00:00" },
  ];
  const facts = projectCoreLoops(input);
  assert.equal(facts.length,1);
  assert.deepEqual(facts[0].intake.map(item => item.recordId),["21","22"]);
  const summary = summarizeCoreLoopWeek(facts,{ date: "2026-09-12",targetEnvironment: "staging",coverageStart: "2026-09-01T00:00:00Z",now: "2026-09-13T00:00:00Z" });
  assert.equal(summary.unknown,1);
  assert.equal(summary.verifiedLoops,0);
  assert.equal(summary.users,null);
  input.shared.push({ ...shared,id: "another-batch",diet_record_id: 23,intake_at: "2026-09-12 13:00:00" });
  assert.equal(projectCoreLoops(input).length,2);
});

test("verified household dining core loop credits producing cook who eats without inflating other members", () => {
  const input = dataset(); input.productions = []; input.intakes = []; input.logs = [];
  const shared = {
    id: "household-batch-1",
    household_id: 1,
    created_by_user_id: 1,
    kind: "real",
    recipe_id: 7,
    metric_environment: "staging",
    produced_at: "2026-09-12 10:00:00",
    selection_evidence: {
      version: 1,
      requestId: "req-1",
      recipeId: 7,
      selectedAt: "2026-09-12 09:00:00",
      inventory: { version: 1, allocations: [{ itemId: 11 }] },
    },
    stock: [{ itemId: 11, confirmedAt: "2026-09-11 08:00:00", confirmed: true, scope: "household", ownerKey: "household:1" }],
    deductions: [{ itemId: 11, before: 5, after: 3, amount: 2, verified: true }],
    servings: 1,
  };
  input.shared = [
    // Cook eats
    { ...shared, diet_record_id: 101, diner_user_id: 1, intake_at: "2026-09-12 12:00:00" },
    // Family member 2 eats
    { ...shared, diet_record_id: 102, diner_user_id: 2, intake_at: "2026-09-12 12:30:00" },
  ];
  const facts = projectCoreLoops(input);
  assert.equal(facts.length, 1);
  assert.equal(facts[0].actorKey, "user:1");
  assert.equal(facts[0].producerKey, "user:1");
  assert.equal(facts[0].householdKey, "household:1");
  assert.equal(evaluateCoreLoop(facts[0], "staging").reason, "included");

  const summary = summarizeCoreLoopWeek(facts, {
    date: "2026-09-12",
    targetEnvironment: "staging",
    coverageStart: "2026-09-01T00:00:00Z",
    now: "2026-09-20T00:00:00Z",
  });
  assert.equal(summary.status, "complete");
  assert.equal(summary.verifiedUsers, 1);
  assert.equal(summary.verifiedLoops, 1);
  assert.equal(summary.users, 1);
  assert.equal(summary.unknown, 0);
});

test("household meal eaten only by non-cook does not count as a loop or unresolved unknown", () => {
  const input = dataset(); input.productions = []; input.intakes = []; input.logs = [];
  const shared = {
    id: "household-batch-2",
    household_id: 1,
    created_by_user_id: 1,
    kind: "real",
    recipe_id: 7,
    metric_environment: "staging",
    produced_at: "2026-09-12 10:00:00",
    selection_evidence: {
      version: 1,
      requestId: "req-1",
      recipeId: 7,
      selectedAt: "2026-09-12 09:00:00",
      inventory: { version: 1, allocations: [{ itemId: 11 }] },
    },
    stock: [{ itemId: 11, confirmedAt: "2026-09-11 08:00:00", confirmed: true, scope: "household", ownerKey: "household:1" }],
    deductions: [{ itemId: 11, before: 5, after: 3, amount: 2, verified: true }],
    servings: 1,
  };
  input.shared = [
    // Only non-cook (user 2) eats
    { ...shared, diet_record_id: 103, diner_user_id: 2, intake_at: "2026-09-12 12:00:00" },
  ];
  const facts = projectCoreLoops(input);
  assert.equal(facts.length, 1);
  assert.equal(evaluateCoreLoop(facts[0], "staging").reason, "no_surviving_intake");

  const summary = summarizeCoreLoopWeek(facts, {
    date: "2026-09-12",
    targetEnvironment: "staging",
    coverageStart: "2026-09-01T00:00:00Z",
    now: "2026-09-20T00:00:00Z",
  });
  assert.equal(summary.status, "complete");
  assert.equal(summary.verifiedUsers, 0);
  assert.equal(summary.verifiedLoops, 0);
  assert.equal(summary.unknown, 0);
});

test("cook eating with unconfirmed stock or unverified deductions marks week partial", () => {
  const input = dataset(); input.productions = []; input.intakes = []; input.logs = [];
  const shared = {
    id: "household-batch-3",
    household_id: 1,
    created_by_user_id: 1,
    kind: "real",
    recipe_id: 7,
    metric_environment: "staging",
    produced_at: "2026-09-12 10:00:00",
    selection_evidence: {
      version: 1,
      requestId: "req-1",
      recipeId: 7,
      selectedAt: "2026-09-12 09:00:00",
      inventory: { version: 1, allocations: [{ itemId: 11 }] },
    },
    // Stock is NOT confirmed
    stock: [{ itemId: 11, confirmedAt: "2026-09-11 08:00:00", confirmed: false, scope: "household", ownerKey: "household:1" }],
    deductions: [{ itemId: 11, before: 5, after: 3, amount: 2, verified: false }],
    servings: 1,
  };
  input.shared = [
    { ...shared, diet_record_id: 104, diner_user_id: 1, intake_at: "2026-09-12 12:00:00" },
  ];
  const facts = projectCoreLoops(input);
  assert.equal(evaluateCoreLoop(facts[0], "staging").reason, "stock_evidence_missing");

  const summary = summarizeCoreLoopWeek(facts, {
    date: "2026-09-12",
    targetEnvironment: "staging",
    coverageStart: "2026-09-01T00:00:00Z",
    now: "2026-09-13T00:00:00Z",
  });
  assert.equal(summary.status, "partial");
  assert.equal(summary.unknown, 1);
  assert.equal(summary.users, null);
  assert.equal(summary.verifiedLoops, 0);
});

test("cook intake correction moves or drops household dining completion", () => {
  const input = dataset(); input.productions = []; input.intakes = []; input.logs = [];
  const shared = {
    id: "household-batch-4",
    household_id: 1,
    created_by_user_id: 1,
    kind: "real",
    recipe_id: 7,
    metric_environment: "staging",
    produced_at: "2026-09-12 10:00:00",
    selection_evidence: {
      version: 1,
      requestId: "req-1",
      recipeId: 7,
      selectedAt: "2026-09-12 09:00:00",
      inventory: { version: 1, allocations: [{ itemId: 11 }] },
    },
    stock: [{ itemId: 11, confirmedAt: "2026-09-11 08:00:00", confirmed: true, scope: "household", ownerKey: "household:1" }],
    deductions: [{ itemId: 11, before: 5, after: 3, amount: 2, verified: true }],
    servings: 1,
  };
  input.shared = [
    // Cook's intake is corrected
    { ...shared, diet_record_id: 105, diner_user_id: 1, intake_at: "2026-09-12 12:00:00", corrected: true },
  ];
  const facts = projectCoreLoops(input);
  assert.equal(evaluateCoreLoop(facts[0], "staging").reason, "no_surviving_intake");
});

for (const format of ["sqlite", "postgres"] as const) {
  test(`household meal batches (${format}): without selection evidence evaluates to selection_missing and marks week partial`, () => {
    const input = dataset();
    input.productions = [];
    input.intakes = [];
    input.logs = [];
    input.settings = { environment: "staging", enabled: 1 };

    const reqObj = {
      idempotencyKey: `idem-batch-${format}`,
      membershipId: 10,
      foodName: "番茄炒蛋",
      producedServings: 2,
      inventory: [{ itemId: 42, version: 1, amount: 3, unit: "piece" }],
    };
    const invObj = [
      { itemId: 42, version: 1, foodName: "鸡蛋", before: "10个", after: "7个", amount: 3, unit: "piece" },
    ];

    input.shared = [{
      id: `batch-persisted-${format}`,
      household_id: 2,
      created_by_user_id: 5,
      idempotency_key: `idem-batch-${format}`,
      kind: "real",
      recipe_id: 18,
      produced_at: "2026-09-12 10:00:00",
      diet_record_id: 201,
      diner_user_id: 5,
      servings: 2,
      intake_at: "2026-09-12 12:00:00",
      request_json: format === "sqlite" ? JSON.stringify(reqObj) : reqObj,
      inventory_json: format === "sqlite" ? JSON.stringify(invObj) : invObj,
      dining_json: null,
    }];

    const facts = projectCoreLoops(input);
    assert.equal(facts.length, 1);
    const fact = facts[0];
    assert.equal(fact.productionId, `household:batch-persisted-${format}`);
    assert.equal(fact.actorKey, "user:5");
    assert.equal(fact.producerKey, "user:5");
    assert.equal(fact.householdKey, "household:2");
    assert.equal(fact.environment, "staging");
    assert.equal(fact.recipeId, 18);

    assert.equal(fact.deductions.length, 1);
    assert.equal(fact.deductions[0].itemId, 42);
    assert.equal(fact.deductions[0].before, 10);
    assert.equal(fact.deductions[0].after, 7);
    assert.equal(fact.deductions[0].amount, 3);
    assert.equal(fact.deductions[0].verified, true);

    assert.equal(fact.selection, null);
    assert.deepEqual(fact.stock, []);
    assert.equal(evaluateCoreLoop(fact, "staging").reason, "selection_missing");

    const summary = summarizeCoreLoopWeek(facts, {
      date: "2026-09-12",
      targetEnvironment: "staging",
      coverageStart: "2026-09-01T00:00:00Z",
      now: "2026-09-20T00:00:00Z",
    });
    assert.equal(summary.status, "partial");
    assert.equal(summary.verifiedLoops, 0);
    assert.equal(summary.verifiedUsers, 0);
    assert.equal(summary.unknown, 1);
    assert.equal(summary.users, null);
    assert.equal(summary.loops, null);
  });

  test(`household meal batches (${format}): selectedAt equal to produced_at with missing stock evaluates to stock_evidence_missing and marks week partial`, () => {
    const input = dataset();
    input.productions = [];
    input.intakes = [];
    input.logs = [];
    input.settings = { environment: "staging", enabled: 1 };

    const invObj = [
      { itemId: 42, version: 1, foodName: "鸡蛋", before: "10个", after: "7个", amount: 3, unit: "piece" },
    ];
    const reqObj = {
      idempotencyKey: `idem-stock-missing-${format}`,
      membershipId: 10,
      foodName: "番茄炒蛋",
      producedServings: 2,
      inventory: [{ itemId: 42, version: 1, amount: 3, unit: "piece" }],
    };

    input.shared = [{
      id: `batch-stock-missing-${format}`,
      household_id: 2,
      created_by_user_id: 5,
      idempotency_key: `idem-stock-missing-${format}`,
      kind: "real",
      recipe_id: 18,
      produced_at: "2026-09-12 10:00:00",
      selection_evidence: {
        version: 1,
        requestId: `req-exact-second-${format}`,
        recipeId: 18,
        selectedAt: "2026-09-12 10:00:00",
        inventory: { version: 1, allocations: [{ itemId: 42 }] },
      },
      diet_record_id: 202,
      diner_user_id: 5,
      servings: 2,
      intake_at: "2026-09-12 12:00:00",
      request_json: format === "sqlite" ? JSON.stringify(reqObj) : reqObj,
      inventory_json: format === "sqlite" ? JSON.stringify(invObj) : invObj,
      dining_json: null,
    }];

    const facts = projectCoreLoops(input);
    assert.equal(facts.length, 1);
    const fact = facts[0];

    assert.ok(fact.selection);
    assert.equal(fact.selection?.requestId, `req-exact-second-${format}`);
    assert.deepEqual(fact.stock, []);
    assert.equal(evaluateCoreLoop(fact, "staging").reason, "stock_evidence_missing");

    const summary = summarizeCoreLoopWeek(facts, {
      date: "2026-09-12",
      targetEnvironment: "staging",
      coverageStart: "2026-09-01T00:00:00Z",
      now: "2026-09-20T00:00:00Z",
    });
    assert.equal(summary.status, "partial");
    assert.equal(summary.verifiedLoops, 0);
    assert.equal(summary.unknown, 1);
  });
}

test("household meal batches: corrupted or missing inventory_json and request_json retain conservative unknown evaluation and mark week partial", () => {
  const corruptedCases = [
    { label: "sqlite corrupted inventory_json string", inventory_json: "{not-valid-json", request_json: "{}" },
    { label: "sqlite corrupted request_json string", inventory_json: "[]", request_json: "{corrupted" },
    { label: "null inventory and request", inventory_json: null, request_json: null },
    { label: "empty string inventory and request", inventory_json: "", request_json: "" },
    { label: "postgres non-array inventory_json", inventory_json: { invalid: true }, request_json: {} },
    { label: "corrupted dining_json with valid deductions", inventory_json: JSON.stringify([{ itemId: 42, version: 1, foodName: "鸡蛋", before: "10个", after: "7个", amount: 3, unit: "piece" }]), request_json: "{}", dining_json: "{corrupted" },
  ];

  for (const c of corruptedCases) {
    const input = dataset();
    input.productions = [];
    input.intakes = [];
    input.logs = [];
    input.settings = { environment: "staging", enabled: 1 };

    input.shared = [{
      id: `batch-corrupted-${c.label.replace(/\s+/g, "-")}`,
      household_id: 2,
      created_by_user_id: 5,
      idempotency_key: `idem-${c.label.replace(/\s+/g, "-")}`,
      kind: "real",
      recipe_id: 18,
      produced_at: "2026-09-12 10:00:00",
      diet_record_id: 301,
      diner_user_id: 5,
      servings: 1,
      intake_at: "2026-09-12 12:00:00",
      request_json: c.request_json,
      inventory_json: c.inventory_json,
      dining_json: c.dining_json ?? null,
    }];

    const facts = projectCoreLoops(input);
    assert.equal(facts.length, 1);
    const fact = facts[0];
    const evalResult = evaluateCoreLoop(fact, "staging");
    assert.equal(fact.selection, null, `${c.label}: selection must be null`);
    assert.deepEqual(fact.stock, [], `${c.label}: stock must be empty`);
    assert.equal(evalResult.reason, "selection_missing", `${c.label}: reason must be selection_missing`);

    const summary = summarizeCoreLoopWeek(facts, {
      date: "2026-09-12",
      targetEnvironment: "staging",
      coverageStart: "2026-09-01T00:00:00Z",
      now: "2026-09-20T00:00:00Z",
    });
    assert.equal(summary.status, "partial", `${c.label}: week status must be partial`);
    assert.equal(summary.verifiedLoops, 0, `${c.label}: verifiedLoops must be 0`);
    assert.equal(summary.unknown, 1, `${c.label}: unknown must be 1`);
  }
});

function householdBatchRow(id: string, inventory: unknown, extra: {
  recipeId?: number;
  foodName?: string;
  producedAt?: string;
  intakeAt?: string;
  dietRecordId?: number;
} = {}) {
  const recipeId = extra.recipeId ?? 18;
  const foodName = extra.foodName ?? "家常菜";
  const producedAt = extra.producedAt ?? "2026-09-12 10:00:00";
  const intakeAt = extra.intakeAt ?? "2026-09-12 12:00:00";
  const dietRecordId = extra.dietRecordId ?? 201;
  const items = Array.isArray(inventory)
    ? inventory
    : (typeof inventory === "string" ? JSON.parse(inventory) : []);
  const reqInventory = items.map((item: any) => ({
    itemId: Number(item.itemId ?? item.item_id),
    version: Number(item.version ?? 1),
    amount: Number(item.amount),
    unit: item.unit,
  }));
  return {
    id,
    household_id: 2,
    created_by_user_id: 5,
    idempotency_key: `idem-${id}`,
    kind: "real",
    recipe_id: recipeId,
    produced_at: producedAt,
    diet_record_id: dietRecordId,
    diner_user_id: 5,
    servings: 2,
    intake_at: intakeAt,
    request_json: JSON.stringify({
      idempotencyKey: `idem-${id}`,
      membershipId: 10,
      foodName,
      producedServings: 2,
      inventory: reqInventory,
    }),
    inventory_json: inventory,
    dining_json: null,
    // Explicit test-layer evidence so deduction quantity/unit parsing tests can verify the full chain
    selection_evidence: {
      version: 1,
      requestId: `req-${id}`,
      recipeId,
      selectedAt: "2026-09-12 09:00:00",
      inventory: { version: 1, allocations: reqInventory.map((i: any) => ({ itemId: i.itemId })) },
    },
    stock: reqInventory.map((i: any) => ({
      itemId: i.itemId,
      confirmedAt: "2026-09-11 08:00:00",
      confirmed: true,
      scope: "household",
      ownerKey: "household:2",
    })),
  };
}

test("household inventory deductions parse display quantity strings with units and allow continuing deductions", () => {
  const input = dataset();
  input.productions = [];
  input.intakes = [];
  input.logs = [];
  input.settings = { environment: "staging", enabled: 1 };

  const cases = [
    // 10个 -> 7个 (SQLite JSON string)
    {
      id: "batch-piece-10-to-7",
      inventory: JSON.stringify([{ itemId: 42, version: 1, foodName: "鸡蛋", before: "10个", after: "7个", amount: 3, unit: "piece" }]),
      dietRecordId: 211,
      expected: { before: 10, after: 7, amount: 3 },
    },
    // 7个 -> 4个 (PostgreSQL parsed array continuation)
    {
      id: "batch-piece-7-to-4",
      inventory: [{ itemId: 42, version: 2, foodName: "鸡蛋", before: "7个", after: "4个", amount: 3, unit: "piece" }],
      dietRecordId: 212,
      expected: { before: 7, after: 4, amount: 3 },
    },
    // Used up: 3个 -> 0个 (SQLite JSON string)
    {
      id: "batch-piece-3-to-0",
      inventory: JSON.stringify([{ itemId: 42, version: 3, foodName: "鸡蛋", before: "3个", after: "0个", amount: 3, unit: "piece" }]),
      dietRecordId: 213,
      expected: { before: 3, after: 0, amount: 3 },
    },
    // Weight conversion: 1kg -> 0.7kg with amount: 300, unit: "g"
    {
      id: "batch-weight-kg-to-g",
      inventory: JSON.stringify([{ itemId: 43, version: 1, foodName: "牛肉", before: "1kg", after: "0.7kg", amount: 300, unit: "g" }]),
      dietRecordId: 214,
      expected: { before: 1, after: 0.7, amount: 0.3 },
    },
    // Volume: 1000ml -> 750ml, amount: 250, unit: "ml"
    {
      id: "batch-volume-ml",
      inventory: JSON.stringify([{ itemId: 44, version: 1, foodName: "牛奶", before: "1000ml", after: "750ml", amount: 250, unit: "ml" }]),
      dietRecordId: 215,
      expected: { before: 1000, after: 750, amount: 250 },
    },
    // Packaging: 5盒 -> 3盒, amount: 2, unit: "box" (PostgreSQL parsed array)
    {
      id: "batch-pkg-box",
      inventory: [{ itemId: 45, version: 1, foodName: "豆腐", before: "5盒", after: "3盒", amount: 2, unit: "box" }],
      dietRecordId: 216,
      expected: { before: 5, after: 3, amount: 2 },
    },
    // Pure numeric format compatibility: 10 -> 8, amount: 2
    {
      id: "batch-numeric-compat",
      inventory: JSON.stringify([{ itemId: 46, version: 1, foodName: "大米", before: 10, after: 8, amount: 2 }]),
      dietRecordId: 217,
      expected: { before: 10, after: 8, amount: 2 },
    },
    // Strict numeric text compatibility: "10" -> "7", amount: 3
    {
      id: "batch-strict-numeric-string",
      inventory: JSON.stringify([{ itemId: 47, version: 1, foodName: "大米", before: "10", after: "7", amount: 3 }]),
      dietRecordId: 218,
      expected: { before: 10, after: 7, amount: 3 },
    },
  ];

  input.shared = cases.map(c => householdBatchRow(c.id, c.inventory, { dietRecordId: c.dietRecordId }));
  const facts = projectCoreLoops(input);
  assert.equal(facts.length, cases.length);

  for (let i = 0; i < cases.length; i++) {
    const fact = facts[i];
    const exp = cases[i].expected;
    assert.equal(fact.deductions.length, 1, `case ${cases[i].id} deductions length`);
    assert.equal(fact.deductions[0].before, exp.before, `case ${cases[i].id} before`);
    assert.equal(fact.deductions[0].after, exp.after, `case ${cases[i].id} after`);
    assert.equal(fact.deductions[0].amount, exp.amount, `case ${cases[i].id} amount`);
    assert.equal(fact.deductions[0].verified, true, `case ${cases[i].id} verified`);
    assert.equal(evaluateCoreLoop(fact, "staging").reason, "included", `case ${cases[i].id} evaluation reason`);
  }

  const summary = summarizeCoreLoopWeek(facts, {
    date: "2026-09-12",
    targetEnvironment: "staging",
    coverageStart: "2026-09-01T00:00:00Z",
    now: "2026-09-20T00:00:00Z",
  });
  assert.equal(summary.status, "complete");
  assert.equal(summary.verifiedLoops, cases.length);
  assert.equal(summary.unknown, 0);
});

test("household inventory deductions reject invalid quantity strings and invalid units without verifying deduction evidence", () => {
  const input = dataset();
  input.productions = [];
  input.intakes = [];
  input.logs = [];
  input.settings = { environment: "staging", enabled: 1 };

  const negativeCases = [
    // Explicit verified: false
    {
      id: "neg-explicit-unverified",
      inventory: JSON.stringify([{ itemId: 50, version: 1, foodName: "鸡蛋", before: "10个", after: "7个", amount: 3, unit: "piece", verified: false }]),
    },
    // Missing unit
    {
      id: "neg-missing-unit",
      inventory: JSON.stringify([{ itemId: 51, version: 1, foodName: "鸡蛋", before: "10个", after: "7个", amount: 3 }]),
    },
    // Corrupted / unknown unit
    {
      id: "neg-unknown-unit",
      inventory: JSON.stringify([{ itemId: 52, version: 1, foodName: "鸡蛋", before: "10个", after: "7个", amount: 3, unit: "unknown" }]),
    },
    // Incompatible units: 1kg vs ml
    {
      id: "neg-incompatible-units",
      inventory: JSON.stringify([{ itemId: 53, version: 1, foodName: "牛肉", before: "1kg", after: "0.7kg", amount: 300, unit: "ml" }]),
    },
    // Amount mismatch with difference: 10 - 3 != 5
    {
      id: "neg-amount-mismatch",
      inventory: JSON.stringify([{ itemId: 54, version: 1, foodName: "鸡蛋", before: "10个", after: "5个", amount: 3, unit: "piece" }]),
    },
    // Invalid quantity string
    {
      id: "neg-invalid-string",
      inventory: JSON.stringify([{ itemId: 55, version: 1, foodName: "鸡蛋", before: "invalid", after: "7个", amount: 3, unit: "piece" }]),
    },
    // Boolean amount coerced rejection (amount: true)
    {
      id: "neg-boolean-amount",
      inventory: JSON.stringify([{ itemId: 56, version: 1, foodName: "鸡蛋", before: "10个", after: "9个", amount: true, unit: "piece" }]),
    },
    // Array amount coerced rejection (amount: [3])
    {
      id: "neg-array-amount",
      inventory: JSON.stringify([{ itemId: 57, version: 1, foodName: "鸡蛋", before: "10个", after: "7个", amount: [3], unit: "piece" }]),
    },
    // Pure numeric missing amount (must NOT manufacture amount = b - a)
    {
      id: "neg-numeric-missing-amount",
      inventory: JSON.stringify([{ itemId: 58, version: 1, foodName: "大米", before: 10, after: 7 }]),
    },
    // Strict numeric string missing amount
    {
      id: "neg-numeric-string-missing-amount",
      inventory: JSON.stringify([{ itemId: 59, version: 1, foodName: "大米", before: "10", after: "7" }]),
    },
    // Mixed loose non-numeric string rejection
    {
      id: "neg-loose-prefix",
      inventory: JSON.stringify([{ itemId: 60, version: 1, foodName: "鸡蛋", before: "10个", after: "7", amount: 3 }]),
    },
    // Array before/after coerced rejection (e.g. ["10个"] / ["7个"])
    {
      id: "neg-array-before-after",
      inventory: JSON.stringify([{ itemId: 61, version: 1, foodName: "鸡蛋", before: ["10个"], after: ["7个"], amount: 3, unit: "piece" }]),
    },
    // Numeric negative inventory rejection (after < 0)
    {
      id: "neg-numeric-negative-inventory",
      inventory: JSON.stringify([{ itemId: 62, version: 1, foodName: "大米", before: 2, after: -1, amount: 3 }]),
    },
  ];

  for (const c of negativeCases) {
    input.shared = [householdBatchRow(c.id, c.inventory)];
    const facts = projectCoreLoops(input);
    assert.equal(facts.length, 1);
    const fact = facts[0];
    assert.equal(fact.deductions[0].verified, false, `negative case ${c.id} must not be verified`);
    assert.equal(evaluateCoreLoop(fact, "staging").reason, "deduction_evidence_missing", `negative case ${c.id} reason`);
  }
});
