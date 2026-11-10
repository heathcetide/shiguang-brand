import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { CookingQueueRepository } from "../src/modules/cookingQueue/repository.js";
import { CookingQueueService, formatQueueItem } from "../src/modules/cookingQueue/service.js";
import type { QueueRow } from "../src/modules/cookingQueue/types.js";
import Database from "better-sqlite3";
import { SqliteCookingQueueRepository } from "../src/modules/cookingQueue/sqliteRepository.js";
import { mealChangeDecision } from "../src/modules/mealPlans/changePolicy.js";

function cancellationFixture() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE cooking_queue_items(id TEXT PRIMARY KEY, user_id INTEGER, recipe_id INTEGER, status TEXT,
      version INTEGER, deleted_at TEXT, updated_at TEXT, meal_type TEXT, planned_at TEXT,
      prepared_ingredients_json TEXT, shopping_list_synced_at TEXT, completed_at TEXT);
    CREATE TABLE meal_plan_items(id TEXT PRIMARY KEY, user_id INTEGER, queue_item_id TEXT, status TEXT,
      version INTEGER, deleted_at TEXT, updated_at TEXT, confirmed_at TEXT);
    CREATE TABLE recipes(id INTEGER, title TEXT, image_url TEXT, cook_time INTEGER, calories INTEGER,
      difficulty TEXT, ingredients_json TEXT, deleted_at TEXT, status TEXT);
  `);
  for (const [id, userId, status] of [["a", 1, "waiting"], ["b", 1, "cooking"], ["done", 1, "completed"], ["other", 2, "waiting"]] as const) {
    db.prepare("INSERT INTO cooking_queue_items(id,user_id,status,version) VALUES(?,?,?,1)").run(id, userId, status);
    db.prepare("INSERT INTO meal_plan_items(id,user_id,queue_item_id,status,version) VALUES(?,?,?,?,2)")
      .run(id, userId, id, status === "completed" ? "completed" : "queued");
  }
  return { db, repository: new SqliteCookingQueueRepository(db) };
}

test("cancelling a queue item unlocks only its linked meal and advances its version", async () => {
  const { db, repository } = cancellationFixture();
  try {
    assert.equal(await repository.cancel("a", 2), false);
    assert.equal(await repository.cancel("a", 1), true);
    const meal = db.prepare("SELECT * FROM meal_plan_items WHERE id='a'").get() as Record<string, unknown>;
    assert.equal(meal.status, "planned");
    assert.equal(meal.queue_item_id, null);
    assert.equal(meal.version, 3);
    assert.equal(mealChangeDecision(meal, undefined, []), "apply");
    assert.equal(await repository.cancel("a", 1), false);
    assert.equal((db.prepare("SELECT version FROM meal_plan_items WHERE id='a'").get() as { version: number }).version, 3);
    assert.equal((db.prepare("SELECT status FROM meal_plan_items WHERE id='b'").get() as { status: string }).status, "queued");
  } finally { db.close(); }
});

test("clearing a queue preserves completed meals and other accounts", async () => {
  const { db, repository } = cancellationFixture();
  try {
    assert.equal(await repository.cancelAll(1), 2);
    assert.deepEqual(db.prepare("SELECT id,status,queue_item_id FROM meal_plan_items ORDER BY id").all(), [
      { id: "a", status: "planned", queue_item_id: null }, { id: "b", status: "planned", queue_item_id: null },
      { id: "done", status: "completed", queue_item_id: "done" }, { id: "other", status: "queued", queue_item_id: "other" },
    ]);
  } finally { db.close(); }
});

test("PATCH cancellation honors optimistic versions before releasing a meal", async () => {
  const { db, repository } = cancellationFixture();
  const patch = { status: "cancelled" as const, mealType: null, plannedAt: null, preparedIngredients: [], shoppingListSyncedAt: null, completedAt: null };
  try {
    assert.equal(await repository.update("a", 1, 9, patch), null);
    assert.equal((db.prepare("SELECT status FROM meal_plan_items WHERE id='a'").get() as { status: string }).status, "queued");
    assert.equal((await repository.update("a", 1, 1, patch))?.status, "cancelled");
    assert.equal((db.prepare("SELECT status FROM meal_plan_items WHERE id='a'").get() as { status: string }).status, "planned");
  } finally { db.close(); }
});

test("meal update failure rolls queue cancellation back", async () => {
  const { db, repository } = cancellationFixture();
  try {
    db.exec("CREATE TRIGGER fail_meal_update BEFORE UPDATE ON meal_plan_items BEGIN SELECT RAISE(ABORT, 'write failed'); END");
    await assert.rejects(repository.cancelAll(1), /write failed/);
    assert.deepEqual(db.prepare("SELECT status,version FROM cooking_queue_items WHERE id='a'").get(), { status: "waiting", version: 1 });
  } finally { db.close(); }
});

const row: QueueRow = {
  id: "11111111-1111-4111-8111-111111111111", recipe_id: 1, position: 0, status: "waiting",
  version: 1, recipe_snapshot_json: { title: "番茄炒蛋", ingredients: ["番茄"] },
  prepared_ingredients_json: [], created_at: "2026-09-01", updated_at: "2026-09-01",
};

function fakeRepository(overrides: Partial<CookingQueueRepository> = {}): CookingQueueRepository {
  return {
    recommendationRequest: async () => null,
    list: async () => [row], findOwned: async () => row,
    findApprovedRecipe: async () => ({ id: 1, title: "番茄炒蛋", image_url: null, cook_time: 10, calories: 200, difficulty: "简单", ingredients_json: ["番茄"] }),
    enqueue: async () => ({ kind: "created", row }), update: async () => ({ ...row, version: 2 }),
    reorder: async () => [row], transition: async (_id, _user, _version, status) => ({ ...row, status, version: 2 }),
    cancel: async () => true, cancelAll: async () => 1, ...overrides,
  };
}

describe("cooking queue module", () => {
  test("formats SQLite text JSON and PostgreSQL JSONB identically", () => {
    assert.deepEqual(formatQueueItem(row).ingredients, ["番茄"]);
    assert.equal(formatQueueItem({ ...row, recipe_snapshot_json: JSON.stringify({ title: "番茄炒蛋", ingredients: ["番茄"] }) }).title, "番茄炒蛋");
  });

  test("rejects invalid state transitions before persistence", async () => {
    const service = new CookingQueueService(fakeRepository({ findOwned: async () => ({ ...row, status: "completed" }) }));
    await assert.rejects(() => service.start(String(row.id), 1, 1), (error: any) => error.code === "COOKING_QUEUE_INVALID_TRANSITION");
  });

  test("maps atomic repository capacity results to a stable conflict", async () => {
    const service = new CookingQueueService(fakeRepository({ enqueue: async () => ({ kind: "full" }) }));
    await assert.rejects(() => service.create(1, { recipeId: 1 }), (error: any) => error.code === "COOKING_QUEUE_FULL");
  });
});

test("queue selection snapshots belong to the user and recipe and cannot be taken from a client payload", async () => {
  const inventory = { version: 1, scope: "personal", allocations: [{ itemId: 4, itemVersion: 2, amount: 3, unit: "g" }] };
  let snapshot: Record<string, unknown> | undefined;
  const service = new CookingQueueService(fakeRepository({
    recommendationRequest: async (userId, requestId) => userId === 7 && requestId === "request" ? { scoring_version: "v1", results_json: JSON.stringify([{ recipeId: 1, features: { inventoryEvidence: inventory } }]) } : null,
    enqueue: async input => { snapshot = input.snapshot; return { kind: "created", row }; },
  }));
  await service.create(7, { recipeId: 1, recommendationRequestId: "request" });
  assert.equal(typeof (snapshot?.selectionEvidence as Record<string, unknown>).selectedAt, "string");
  assert.deepEqual({ ...(snapshot?.selectionEvidence as Record<string, unknown>), selectedAt: undefined }, { selectedAt: undefined, version: 1, requestId: "request", recipeId: 1, scoringVersion: "v1", inventory });
  await assert.rejects(service.create(8, { recipeId: 1, recommendationRequestId: "request" }), /推荐来源/);
  await assert.rejects(service.create(7, { recipeId: 2, recommendationRequestId: "request" }), /推荐来源/);
  await service.create(7, { recipeId: 1 });
  assert.equal(snapshot?.selectionEvidence, null);
});

test("shared queues cannot complete through POST or PATCH before production is saved", async () => {
  let writes = 0;
  for (const snapshot of [{ productionPlanItems: [{ id: "first" }, { id: "second" }] }, JSON.stringify({ productionPlanItems: [{ id: "first" }, { id: "second" }] })]) {
    const current = { ...row, status: "cooking", recipe_snapshot_json: snapshot };
    const service = new CookingQueueService(fakeRepository({
      findOwned: async () => current,
      transition: async () => { writes++; return { ...current, status: "completed" }; },
      update: async () => { writes++; return { ...current, status: "completed" }; },
    }));
    await assert.rejects(service.complete(String(row.id), 1, 1), { code: "COOKING_QUEUE_INVALID_TRANSITION" });
    await assert.rejects(service.update(String(row.id), 1, { version: 1, status: "completed" }), { code: "COOKING_QUEUE_INVALID_TRANSITION" });
    current.status = "completed";
    assert.equal((await service.complete(String(row.id), 1, 1)).status, "completed", "committed production remains replayable");
  }
  assert.equal(writes, 0);
});


test("queue time preserves unknown and explicit zero without reviving a superseded snapshot", () => {
  for (const value of [null, undefined, "", " ", -1, "invalid", Infinity, false, true, [], {}]) {
    assert.equal(formatQueueItem({ current_cook_time: value, recipe_snapshot_json: { cookTime: 10 } }).cookTime, null);
  }
  for (const value of [0, "0", 10, "10"]) assert.equal(formatQueueItem({ current_cook_time: value }).cookTime, Number(value));
  assert.equal(formatQueueItem({ recipe_snapshot_json: { cookTime: 8 } }).cookTime, 8);
  assert.equal(formatQueueItem({ recipe_snapshot_json: {} }).cookTime, null);
});
