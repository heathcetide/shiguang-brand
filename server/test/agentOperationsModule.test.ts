import { dateKeyAfterDays } from "../src/utils/date.js";
import { InventoryService } from "../src/modules/inventory/service.js";
import { SqliteInventoryRepository } from "../src/modules/inventory/sqliteRepository.js";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import Database from "better-sqlite3";
import type { AgentOperationsRepository } from "../src/modules/agentOperations/repository.js";
import { AgentOperationsService } from "../src/modules/agentOperations/service.js";
import { SqliteAgentOperationsRepository } from "../src/modules/agentOperations/sqliteRepository.js";

describe("Agent operations module", () => {
  test("delegates execution and undo through a database-neutral service", async () => {
    const calls: string[] = [];
    const repository: AgentOperationsRepository = {
      executeActions: async (userId, runId) => { calls.push(`execute:${userId}:${runId}`); return [{ actionId: "a", result: { ok: true } }]; },
      undoActions: async (userId, runId) => { calls.push(`undo:${userId}:${runId}`); return { undone: 1 }; },
    };
    const service = new AgentOperationsService(repository);
    assert.deepEqual(await service.executeActions(42, "run-1", []), [{ actionId: "a", result: { ok: true } }]);
    assert.deepEqual(await service.undoActions(42, "run-1"), { undone: 1 });
    assert.deepEqual(calls, ["execute:42:run-1", "undo:42:run-1"]);
  });

  test("SQLite executes idempotently, rolls back failed bundles, and safely undoes writes", async () => {
    const database = new Database(":memory:");
    try {
      database.exec(`CREATE TABLE agent_runs (id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,status TEXT NOT NULL);
        CREATE TABLE agent_actions (
          id TEXT PRIMARY KEY,run_id TEXT NOT NULL,user_id INTEGER NOT NULL,action_type TEXT NOT NULL,status TEXT NOT NULL,
          before_json TEXT,result_json TEXT,executed_at TEXT,undone_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE shopping_list_items (
          id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,client_id TEXT,name TEXT NOT NULL,amount TEXT NOT NULL DEFAULT '适量',
          category TEXT NOT NULL DEFAULT '其他',checked INTEGER NOT NULL DEFAULT 0,purchase_date TEXT,storage_location TEXT,
          source_run_id TEXT,version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,deleted_at TEXT
        );
        CREATE TABLE meal_plans (
          id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,title TEXT NOT NULL,start_date TEXT NOT NULL,end_date TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',constraints_json TEXT NOT NULL DEFAULT '{}',created_by_run_id TEXT,
          version INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,deleted_at TEXT
        )`);
      database.prepare("INSERT INTO agent_runs(id,user_id,status) VALUES('run-ok',42,'running'),('run-fail',42,'running'),('run-cancelled',42,'cancelled')").run();
      database.prepare(`INSERT INTO agent_actions(id,run_id,user_id,action_type,status) VALUES
        ('action-ok','run-ok',42,'add_shopping_items','proposed'),
        ('action-first','run-fail',42,'add_shopping_items','proposed'),
        ('action-fail','run-fail',42,'update_shopping_item','proposed'),
        ('action-cancelled','run-cancelled',42,'add_shopping_items','proposed'),
        ('action-locked','run-ok',42,'add_shopping_items','undone')`).run();
      const repository = new SqliteAgentOperationsRepository(database);
      const add = { id: "action-ok", actionType: "add_shopping_items" as const, riskLevel: "low" as const,
        summary: "加入采购", payload: { items: [{ name: "番茄", amount: "2个" }] } };
      const first = await repository.executeActions(42, "run-ok", [add]);
      const repeated = await repository.executeActions(42, "run-ok", [add]);
      assert.deepEqual(repeated, first);
      assert.equal((database.prepare("SELECT COUNT(*) AS count FROM shopping_list_items WHERE name='番茄'").get() as { count: number }).count, 1);

      await assert.rejects(() => repository.executeActions(42, "run-fail", [
        { id: "action-first", actionType: "add_shopping_items", riskLevel: "low", summary: "加入采购", payload: { items: [{ name: "应回滚" }] } },
        { id: "action-fail", actionType: "update_shopping_item", riskLevel: "low", summary: "更新不存在项", payload: { itemId: "missing" } },
      ]), /不存在或无权修改/);
      assert.equal((database.prepare("SELECT COUNT(*) AS count FROM shopping_list_items WHERE name='应回滚'").get() as { count: number }).count, 0);
      assert.deepEqual(database.prepare("SELECT status FROM agent_actions WHERE run_id='run-fail' ORDER BY id").all(),
        [{ status: "failed" }, { status: "failed" }]);

      await assert.rejects(() => repository.executeActions(42, "run-cancelled", [
        { ...add, id: "action-cancelled", payload: { items: [{ name: "取消后写入" }] } },
      ]), /已取消|不再允许/);
      assert.equal((database.prepare("SELECT COUNT(*) AS count FROM shopping_list_items WHERE name='取消后写入'").get() as { count: number }).count, 0);
      await assert.rejects(() => repository.executeActions(42, "run-ok", [
        { ...add, id: "action-locked", payload: { items: [{ name: "已撤销后写入" }] } },
      ]), /状态不允许/);
      assert.equal((database.prepare("SELECT status FROM agent_actions WHERE id='action-locked'").get() as { status: string }).status, "undone");

      assert.deepEqual(await repository.undoActions(42, "run-ok"), { undone: 1 });
      assert.deepEqual(database.prepare("SELECT deleted_at IS NOT NULL AS deleted,version FROM shopping_list_items WHERE name='番茄'").get(),
        { deleted: 1, version: 2 });
      assert.equal((database.prepare("SELECT status FROM agent_actions WHERE id='action-ok'").get() as { status: string }).status, "undone");
    } finally {
      database.close();
    }
  });
});

test("Agent inventory uses quantity transactions, versions, history and rollback", async (t) => {
  const db = new Database(":memory:");
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE agent_runs(id TEXT PRIMARY KEY,user_id INTEGER,status TEXT);
    CREATE TABLE agent_actions(id TEXT PRIMARY KEY,run_id TEXT,user_id INTEGER,action_type TEXT,status TEXT,
      before_json TEXT,result_json TEXT,executed_at TEXT,undone_at TEXT,updated_at TEXT);
    CREATE TABLE plan_maintenance_events(id TEXT PRIMARY KEY,user_id INTEGER,event_type TEXT,source_id TEXT,subject_id TEXT,
      details_json TEXT,UNIQUE(user_id,event_type,source_id));
    CREATE TABLE inventory_items(id INTEGER PRIMARY KEY,user_id INTEGER,food_name TEXT,category TEXT,quantity TEXT,
      expiration_date TEXT,storage_location TEXT,image_url TEXT,is_available INTEGER DEFAULT 1,
      quantity_value REAL,quantity_unit TEXT,package_size_value REAL,package_size_unit TEXT,batch_code TEXT,
      version INTEGER DEFAULT 1,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,deleted_at TEXT);
    CREATE TABLE inventory_change_logs(id INTEGER PRIMARY KEY,user_id INTEGER,inventory_item_id INTEGER,
      action TEXT,source TEXT,quantity_before REAL,quantity_after REAL,quantity_unit TEXT,delta_value REAL,
      idempotency_key TEXT,metadata_json TEXT DEFAULT '{}',created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id,idempotency_key));
    CREATE TABLE inventory_consumption_requests(user_id INTEGER,idempotency_key TEXT,result_json TEXT,
      UNIQUE(user_id,idempotency_key));
    INSERT INTO agent_runs VALUES('inventory-run',42,'running');
  `);
  const repo = new SqliteAgentOperationsRepository(db);
  let sequence = 0;
  function proposal(actionType: "add_inventory_item" | "update_inventory_item" | "consume_inventory_items", payload: Record<string, unknown>) {
    const id = `inventory-action-${++sequence}`;
    db.prepare("INSERT INTO agent_actions(id,run_id,user_id,action_type,status) VALUES(?,'inventory-run',42,?,'proposed')").run(id, actionType);
    return { id, actionType, payload, riskLevel: "high" as const, summary: "库存操作" };
  }
  const run = (actions: ReturnType<typeof proposal>[]) => repo.executeActions(42, "inventory-run", actions);
  const row = () => db.prepare("SELECT quantity,quantity_value,quantity_unit,is_available,version FROM inventory_items WHERE id=1").get();
  await run([proposal("add_inventory_item", { name: "鸡蛋", quantity: "十枚", expirationDate: dateKeyAfterDays(30) })]);
  assert.deepEqual(row(), { quantity: "10个", quantity_value: 10, quantity_unit: "piece", is_available: 1, version: 1 });
  const eventCount = () => (db.prepare("SELECT COUNT(*) n FROM plan_maintenance_events").get() as { n: number }).n;
  assert.equal(eventCount(), 1);
  await assert.rejects(() => run([
    proposal("add_inventory_item", { name: "应回滚的入库", quantity: "1个", expirationDate: dateKeyAfterDays(30) }),
    proposal("update_inventory_item", { itemId: 999, version: 1, quantity: "5个" }),
  ]));
  assert.equal(eventCount(), 1);
  const consume = proposal("consume_inventory_items", { items: [{ itemId: 1, version: 1, mode: "amount", amountValue: 2, unit: "piece" }] });
  const result = await run([consume]);
  assert.deepEqual(await run([consume]), result);
  assert.deepEqual(row(), { quantity: "8个", quantity_value: 8, quantity_unit: "piece", is_available: 1, version: 2 });
  const discard = proposal("consume_inventory_items", { reason: "discarded", items: [{ itemId: 1, version: 2, mode: "amount", amountValue: 2, unit: "piece" }] });
  await run([discard]);
  const history = db.prepare("SELECT source,metadata_json FROM inventory_change_logs WHERE action='consume_partial' ORDER BY id").all() as Array<{ source: string; metadata_json: string }>;
  assert.equal(history.length, 2);
  assert.equal(history[1].source, "ai");
  assert.equal(JSON.parse(history[1].metadata_json).reason, "discarded");
  await assert.rejects(() => run([proposal("consume_inventory_items", { itemIds: [1] })]), /确认/);
  for (const item of [
    { itemId: 1, version: 2, mode: "amount", amountValue: 1, unit: "piece" },
    { itemId: 1, version: 3, mode: "amount", amountValue: 1, unit: "g" },
    { itemId: 1, version: 3, mode: "amount", amountValue: 7, unit: "piece" },
    { itemId: 999, version: 1, mode: "all" },
  ]) await assert.rejects(() => run([proposal("consume_inventory_items", { items: [item] })]));
  await assert.rejects(() => run([
    proposal("consume_inventory_items", { items: [{ itemId: 1, version: 3, mode: "amount", amountValue: 1, unit: "piece" }] }),
    proposal("update_inventory_item", { itemId: 999, version: 1, quantity: "5个" }),
  ]));
  assert.deepEqual(row(), { quantity: "6个", quantity_value: 6, quantity_unit: "piece", is_available: 1, version: 3 });
  assert.equal((db.prepare("SELECT COUNT(*) n FROM inventory_consumption_requests").get() as { n: number }).n, 2);
  await run([proposal("update_inventory_item", { itemId: 1, version: 3, quantity: "半袋" })]);
  assert.deepEqual(row(), { quantity: "0.5袋", quantity_value: 0.5, quantity_unit: "bag", is_available: 1, version: 4 });
  const inventoryService = new InventoryService(new SqliteInventoryRepository(db));
  const preview = await inventoryService.previewConsumption(42, { items: [{ food_name: "鸡蛋", amount_value: 1, unit: "bag" }] });
  assert.equal(preview.items[0].covered_value, 0.5);
  assert.equal(preview.items[0].fully_covered, false);
  assert.equal(preview.items[0].deductions[0].version, 4);
  await run([proposal("update_inventory_item", { itemId: 1, version: 4, quantity: "数量未知" })]);
  assert.deepEqual(row(), { quantity: "数量未知", quantity_value: null, quantity_unit: null, is_available: 1, version: 5 });
  await assert.rejects(() => run([proposal("consume_inventory_items", { items: [{ itemId: 1, version: 5, mode: "amount", amountValue: 1, unit: "piece" }] })]), /结构化数量/);
  await run([proposal("consume_inventory_items", { items: [{ itemId: 1, version: 5, mode: "all" }] })]);
  assert.deepEqual(row(), { quantity: "数量未知", quantity_value: null, quantity_unit: null, is_available: 0, version: 6 });
  await run([proposal("add_inventory_item", { name: "精确盐", quantity: "1kg", expirationDate: "2099-12-31" })]);
  const salt = db.prepare("SELECT id FROM inventory_items WHERE food_name='精确盐'").get() as { id: number };
  const decimalAction = proposal("consume_inventory_items", { items: [{ itemId: salt.id, version: 1, mode: "amount", amountValue: 0.2, unit: "g" }] });
  await run([decimalAction]);
  await run([decimalAction]);
  assert.deepEqual(db.prepare("SELECT quantity,quantity_value,version FROM inventory_items WHERE id=?").get(salt.id),
    { quantity: "0.9998kg", quantity_value: 0.9998, version: 2 });
  const beforePrecisionFailure = eventCount();
  await assert.rejects(() => run([proposal("consume_inventory_items", {
    items: [{ itemId: salt.id, version: 2, mode: "amount", amountValue: 1e-20, unit: "kg" }],
  })]), /计量精度/);
  assert.equal(eventCount(), beforePrecisionFailure);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM inventory_change_logs WHERE inventory_item_id=? AND action='consume_partial'").get(salt.id) as { n: number }).n, 1);

});
