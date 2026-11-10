import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { InventoryItem } from "@dietdigidose/contracts";
import { InventoryDomainError } from "../src/modules/inventory/errors.js";
import type { InventoryRepository } from "../src/modules/inventory/repository.js";
import { InventoryService } from "../src/modules/inventory/service.js";

const item: InventoryItem = {
  id: 1,
  food_name: "番茄",
  category: "蔬菜",
  quantity: "2g",
  expiration_date: "2030-09-05",
  storage_location: "冷藏",
  image_url: null,
  is_available: true,
  quantity_value: 2,
  quantity_unit: "g",
  package_size_value: null,
  package_size_unit: null,
  batch_code: null,
  version: 1,
};

function fakeRepository(overrides: Partial<InventoryRepository> = {}): InventoryRepository {
  return {
    recordFunnelEvent: async () => undefined,
    evidence: async () => null,
    list: async () => [item],
    findOwned: async () => item,
    create: async () => item,
    importShoppingList: async () => ({ items: [item], repeated: false }),
    undoScan: async () => ({ undone: 0, repeated: true }),
    undoneScanItemIds: async () => [],
    savedScanItems: async () => new Map(),
    bulkIntake: async () => ({ batch_id: "11111111-1111-4111-8111-111111111111", items: [item], repeated: false }),
    listPreviewCandidates: async () => [{
      id: item.id,
      food_name: item.food_name,
      quantity_value: item.quantity_value ?? null,
      quantity_unit: item.quantity_unit ?? null,
      expiration_date: item.expiration_date,
      batch_code: item.batch_code ?? null,
      version: item.version,
    }],
    consume: async () => ({ changes: [], items: [item], repeated: false }),
    history: async () => [],
    update: async () => ({ kind: "updated", item: { ...item, version: 2 } }),
    remove: async () => ({ kind: "removed" }),
    ...overrides,
  };
}

describe("inventory module service", () => {
  test("runs business behavior against a replacement repository", async () => {
    const events: number[] = [];
    const service = new InventoryService(fakeRepository({ recordFunnelEvent: async () => { events.push(42); } }));

    assert.deepEqual(await service.list(42), [item]);
    assert.equal((await service.create(42, {
      food_name: "番茄",
      category: "蔬菜",
      quantity: "2g",
      expiration_date: "2030-09-05",
      storage_location: "冷藏",
    })).id, 1);
    assert.deepEqual(events, [42]);
  });

  test("keeps structured quantity rules in the service boundary", async () => {
    let updateCalls = 0;
    const service = new InventoryService(fakeRepository({
      update: async () => {
        updateCalls += 1;
        return { kind: "updated", item };
      },
    }));

    await assert.rejects(
      () => service.update(42, 1, { quantity_value: null }),
      (error: unknown) => error instanceof InventoryDomainError && error.code === "INVALID_STRUCTURED_QUANTITY",
    );
    assert.equal(updateCalls, 0);
  });

  test("maps optimistic concurrency independently of the database driver", async () => {
    const service = new InventoryService(fakeRepository({
      update: async () => ({ kind: "conflict" }),
    }));

    await assert.rejects(
      () => service.update(42, 1, { storage_location: "冷冻", version: 1 }),
      (error: unknown) => error instanceof InventoryDomainError && error.code === "INVENTORY_VERSION_CONFLICT",
    );
  });

  test("does not duplicate funnel events for idempotent imports", async () => {
    let events = 0;
    const service = new InventoryService(fakeRepository({
      importShoppingList: async () => ({ items: [item], repeated: true }),
      recordFunnelEvent: async () => { events += 1; },
    }));

    const response = await service.importShoppingList(42, {
      idempotency_key: "shopping-import-key-0001",
      items: [{
        food_name: "番茄",
        category: "蔬菜",
        quantity: "2g",
        expiration_date: "2030-09-05",
        storage_location: "冷藏",
      }],
    });
    assert.equal(response.repeated, true);
    assert.equal(events, 0);
  });

  test("keeps FEFO preview logic testable without SQLite", async () => {
    const service = new InventoryService(fakeRepository());
    const preview = await service.previewConsumption(42, {
      items: [{ food_name: "番茄", amount_value: 1, unit: "g" }],
    });
    assert.equal(preview.items[0].fully_covered, true);
    assert.equal(preview.items[0].deductions[0].item_id, 1);
  });
});

test("one FEFO preview shares inventory across requests and normalizes mixed-unit deductions", async () => {
  const { buildFefoConsumptionPreviewFromCandidates } = await import("../src/services/inventoryQuantity.js");
  const eggs = { id: 1, food_name: "鸡蛋", quantity_value: 3, quantity_unit: "piece", expiration_date: "2026-09-20", batch_code: "batch-a", version: 1 };
  const request = { food_name: "鸡蛋", amount_value: 2, unit: "piece" as const };
  const preview = buildFefoConsumptionPreviewFromCandidates([eggs], [request, request]);
  assert.deepEqual(preview.map(item => item.covered_value), [2, 1]);
  assert.deepEqual(preview.map(item => item.fully_covered), [true, false]);
  assert.equal(preview[1].missing_value, 1);
  assert.equal(eggs.quantity_value, 3);
  const flour = { ...eggs, food_name: "面粉", quantity_value: 1000, quantity_unit: "g" };
  const mixed = buildFefoConsumptionPreviewFromCandidates([flour], [
    { food_name: "面粉", amount_value: 0.2, unit: "kg" }, { food_name: "面粉", amount_value: 300, unit: "g" },
  ]);
  assert.deepEqual(mixed.flatMap(item => item.deductions).map(item => [item.amount_value,item.unit]), [[200,"g"],[300,"g"]]);
  assert.deepEqual(mixed.map(item => item.fully_covered), [true,true]);
});

test("preview distinguishes matching names with unknown quantities from known shortages", async () => {
  const { buildFefoConsumptionPreviewFromCandidates } = await import("../src/services/inventoryQuantity.js");
  const batch = { id: 1, food_name: "大米", quantity_value: null, quantity_unit: null, expiration_date: "2026-09-20", batch_code: "rice", version: 1 };
  const request = [{ food_name: "大米", amount_value: 500, unit: "g" as const }];
  const preview = (items: Array<typeof batch | (Omit<typeof batch, "quantity_value" | "quantity_unit"> & { quantity_value: number; quantity_unit: string })>) => buildFefoConsumptionPreviewFromCandidates(items, request)[0];
  assert.equal(preview([batch]).quantity_status, "unknown");
  assert.equal(preview([batch]).name_available, true);
  assert.equal(preview([batch]).fully_covered, false);
  assert.equal(preview([{ ...batch, quantity_value: 1, quantity_unit: "bag" }]).quantity_status, "unknown");
  assert.equal(preview([{ ...batch, quantity_value: 300, quantity_unit: "g" }]).quantity_status, "insufficient");
  assert.equal(preview([{ ...batch, quantity_value: 600, quantity_unit: "g" }]).quantity_status, "sufficient");
  assert.equal(preview([]).quantity_status, "unavailable");
});

test("cooking preview excludes expired stock but keeps today and unknown dates distinct", async () => {
  const { buildFefoConsumptionPreviewFromCandidates } = await import("../src/services/inventoryQuantity.js");
  const base = { id: 1, food_name: "米", quantity_value: 500, quantity_unit: "g", batch_code: null, version: 1 };
  const items = [{ food_name: "米", amount_value: 100, unit: "g" as const }];
  assert.equal(buildFefoConsumptionPreviewFromCandidates([{ ...base, expiration_date: "2026-09-08" }], items, "2026-09-09")[0].quantity_status, "unavailable");
  assert.equal(buildFefoConsumptionPreviewFromCandidates([{ ...base, expiration_date: "2026-09-09" }], items, "2026-09-09")[0].fully_covered, true);
  const unknown = buildFefoConsumptionPreviewFromCandidates([{ ...base, expiration_date: "" }], items, "2026-09-09")[0];
  assert.equal(unknown.deductions[0].expiration_date, "");
});

test("decimal consumption preserves small amounts and rejects actual shortages", async () => {
  const { calculateInventoryConsumption: consume, InventoryQuantityError } = await import("../src/services/inventoryQuantity.js");
  const state = { ...item, quantity: "1kg", quantity_value: 1, quantity_unit: "kg" };
  for (const [amount, remaining] of [[0.2, 0.9998], [0.5, 0.9995], [1.5, 0.9985]]) {
    const result = consume(state, { item_id: 1, version: 1, mode: "amount", amount_value: amount, unit: "g" });
    assert.equal(result.remaining, remaining);
    assert.equal(result.nextQuantity, remaining + "kg");
    assert.equal(result.amountUsed, amount / 1000);
  }
  let current = { ...state, quantity_value: 0.3 };
  for (const amount of [0.1, 0.2]) current = { ...current, quantity_value: consume(current,
    { item_id: 1, version: 1, mode: "amount", amount_value: amount, unit: "kg" }).remaining };
  assert.equal(current.quantity_value, 0);
  assert.throws(() => consume(state, { item_id: 1, version: 1, mode: "amount", amount_value: 1e-20, unit: "kg" }),
    (error: unknown) => error instanceof InventoryQuantityError && error.code === "QUANTITY_PRECISION_REQUIRED");
  assert.throws(() => consume(state, { item_id: 1, version: 1, mode: "amount", amount_value: 1.0000000000000002, unit: "kg" }), /不足/);
  assert.throws(() => consume(state, { item_id: 1, version: 2, mode: "amount", amount_value: 0.2, unit: "g" }), /刷新/);
});

test("decimal FEFO has no tolerance that certifies empty stock and conserves multi-request batches", async () => {
  const { buildFefoConsumptionPreviewFromCandidates: preview } = await import("../src/services/inventoryQuantity.js");
  const state = { ...item, batch_code: null, quantity_value: 0.0005, quantity_unit: "kg" };
  const demands = [0.2, 0.2, 0.2].map(amount_value => ({ food_name: item.food_name, amount_value, unit: "g" as const }));
  const rows = preview([state], demands);
  assert.deepEqual(rows.map(row => row.covered_value), [0.2, 0.2, 0.1]);
  assert.deepEqual(rows.map(row => row.deductions[0]?.amount_value), [0.0002, 0.0002, 0.0001]);
  assert.deepEqual(rows.map(row => row.fully_covered), [true, true, false]);
  assert.equal(preview([], [{ food_name: item.food_name, amount_value: 0.0001, unit: "kg" }])[0].quantity_status, "unavailable");
  const tiny = { food_name: item.food_name, amount_value: 1e-20, unit: "kg" as const };
  const result = preview([{ ...state, quantity_value: 1 }], [tiny])[0];
  assert.equal(result.quantity_status, "unknown");
  assert.equal(result.covered_value, 0);
  assert.equal(result.missing_value, tiny.amount_value);
  assert.deepEqual(result.deductions, []);
  // A later, small batch can satisfy a request that cannot be deducted from a large batch.
  assert.equal(preview([{ ...state, quantity_value: 1 }, { ...state, id: 2, quantity_value: 1e-20 }], [tiny])[0].fully_covered, true);
  // An unrepresentable partial response rolls back its temporary allocations.
  const uncertain = preview([{ ...state, quantity_value: 1e-20 }], [
    { food_name: item.food_name, amount_value: 1, unit: "kg" }, tiny,
  ]);
  assert.equal(uncertain[0].quantity_status, "unknown");
  assert.equal(uncertain[1].fully_covered, true);
});

test("planning ledger retains micro amounts across separate meals", async () => {
  const { createPlanningBudget } = await import("../src/modules/recommendations/planningBudget.js");
  const budget = createPlanningBudget([{ ...item, quantity_value: 0.0000005, quantity_unit: "kg" }]);
  const demand = [{ food_name: item.food_name, amount_value: 0.0002, unit: "g" as const }];
  assert.equal(budget.consume(demand, "2030-09-01", "first")[0].fully_covered, true);
  assert.equal(budget.stock[0].quantity_value, 0.0000003);
  assert.equal(budget.consume(demand, "2030-09-01", "second")[0].fully_covered, true);
  assert.equal(budget.consume(demand, "2030-09-01", "third")[0].covered_value, 0.0001);
  assert.equal(budget.stock[0].quantity_value, 0);
});

test("household production uses the same exact transition and precision failure", async () => {
  const { consumeProductionItem } = await import("../src/modules/households/production.js");
  const stock = { ...item, quantity: "1kg" };
  assert.equal(consumeProductionItem(stock, { itemId: 1, version: 1, amount: 0.2, unit: "g" }).remaining, 0.9998);
  assert.throws(() => consumeProductionItem(stock, { itemId: 1, version: 1, amount: 1e-20, unit: "kg" }),
    (error: unknown) => (error as { code: string }).code === "QUANTITY_PRECISION_REQUIRED");
});

test("SQLite persists exact inventory deltas and rolls back precision failures atomically", async (t) => {
  const { default: Database } = await import("better-sqlite3");
  const { SqliteInventoryRepository } = await import("../src/modules/inventory/sqliteRepository.js");
  const { verifyInventoryPrecision } = await import("./helpers/inventoryPrecision.js");
  const db = new Database(":memory:");
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE plan_maintenance_events(id TEXT PRIMARY KEY,user_id INTEGER,event_type TEXT,source_id TEXT,subject_id TEXT,
      details_json TEXT,UNIQUE(user_id,event_type,source_id));
    CREATE TABLE inventory_items(id INTEGER PRIMARY KEY,user_id INTEGER,food_name TEXT,category TEXT,quantity TEXT,
      expiration_date TEXT,storage_location TEXT,image_url TEXT,is_available INTEGER DEFAULT 1,
      quantity_value REAL,quantity_unit TEXT,package_size_value REAL,package_size_unit TEXT,batch_code TEXT,
      version INTEGER DEFAULT 1,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,deleted_at TEXT);
    CREATE TABLE inventory_change_logs(id INTEGER PRIMARY KEY,user_id INTEGER,inventory_item_id INTEGER,
      action TEXT,source TEXT,quantity_before REAL,quantity_after REAL,quantity_unit TEXT,delta_value REAL,
      idempotency_key TEXT,metadata_json TEXT DEFAULT '{}',created_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(user_id,idempotency_key));
    CREATE TABLE inventory_consumption_requests(user_id INTEGER,idempotency_key TEXT,result_json TEXT,UNIQUE(user_id,idempotency_key));
  `);
  await verifyInventoryPrecision(new SqliteInventoryRepository(db), 42,
    async (sql, args = []) => db.prepare(sql).all(...args) as Record<string, unknown>[]);
});

test("recipe portions reach the inventory ledger without binary scaling noise", async () => {
  const { recipeDemands } = await import("../src/modules/recommendations/quantities.js");
  const { createPlanningBudget } = await import("../src/modules/recommendations/planningBudget.js");
  for (const [amount, yieldSize, portions, expected] of [
    ["0.1g", 1, 3, 0.3], ["0.6g", 3, 1, 0.2], ["0.1g", 2, 1.5, 0.075],
  ] as const) {
    const demands = recipeDemands([{ name: item.food_name, amount }], yieldSize, portions);
    assert.equal(demands?.[0].amount_value, expected);
    const budget = createPlanningBudget([{ ...item, quantity_value: expected, quantity_unit: "g" }]);
    const preview = budget.consume(demands!, "2030-09-01", "scaled-meal")[0];
    assert.equal(preview.fully_covered, true);
    assert.equal(preview.missing_value, 0);
    assert.equal(budget.stock[0].quantity_value, 0);
  }
  assert.equal(recipeDemands([{ name: item.food_name, amount: "1g" }], 3, 1), null);
  const unknown = createPlanningBudget([{ ...item, quantity_value: 1, quantity_unit: "g" }]);
  // The callers already treat an unrepresentable demand as a review requirement.
  unknown.markUnknownCommitment();
  assert.equal(unknown.consume([{ food_name: item.food_name, amount_value: 0.1, unit: "g" }], "2030-09-01", "review")[0].quantity_status, "unknown");
});
