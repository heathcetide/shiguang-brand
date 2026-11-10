import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { Pool, PoolClient } from "pg";
import { SqliteMealPlansRepository } from "../src/modules/mealPlans/sqliteRepository.js";
import { PostgresMealPlansRepository } from "../src/modules/mealPlans/postgresRepository.js";
import { readPostgresReplacementSnapshot } from "../src/modules/mealPlans/postgresReplacementSnapshot.js";
import { replacementInputTables } from "../src/modules/mealPlans/replacementSnapshot.js";
import { executionRecipeKey } from "../src/modules/recipes/execution.js";
import { recipeExecutionProof } from "../src/modules/recipes/planExecution.js";
import { executionFixture } from "./helpers/recipeExecution.js";
import { currentDateKey } from "../src/utils/date.js";
import type { Row } from "../src/modules/mealPlans/formatters.js";

const testDirectory = mkdtempSync(join(tmpdir(), "active-replacement-"));
let db: Database.Database;
before(async () => {
  process.env.DATABASE_PATH = join(testDirectory, "test.sqlite");
  process.env.ADMIN_INITIAL_PASSWORD = "RepositoryFixturePassword1234";
  process.env.ENABLE_DEMO_SEED = "0";
  const storage = await import("../src/storage/db.js");
  db = storage.db;
  storage.initDatabase();
});
after(() => { db?.close(); rmSync(testDirectory, { recursive: true, force: true }); });

function fixture() {
  const userId = Number(db.prepare("INSERT INTO users(username,password_hash) VALUES(?,?)").run(randomUUID(), "unused-test-hash").lastInsertRowid);
  const planId = randomUUID(), itemId = randomUUID(), otherId = randomUUID(), today = currentDateKey();
  const recipes: Row[] = [1, 2].map(n => {
    const id = Number(db.prepare("INSERT INTO recipes(title,status,quality_status,serving_size,cook_time,prep_time,ingredients_json,steps_json) VALUES(?,'approved','trusted',2,10,5,?,?)")
      .run(`合成仓储菜${n}`, JSON.stringify([{ name: "米", amount: "100g" }]), JSON.stringify(["准备", "煮熟", "收尾"])).lastInsertRowid);
    const row = db.prepare("SELECT * FROM recipes WHERE id=?").get(id) as Row;
    const execution = { recipeKey: executionRecipeKey(row), reviewedBy: userId, reviewedAt: "2026-10-20T00:00:00Z", profile: { ...executionFixture, handling: { storage: "fresh_only", maxHoldHours: 0, coldServingAllowed: true, carryAllowed: false, sourceUrl: "https://example.invalid/review", reference: "合成测试存放依据", instructions: "仅用于自动测试，不代表真实食品安全保证" } } };
    db.prepare("UPDATE recipes SET execution_json=? WHERE id=?").run(JSON.stringify(execution), id);
    return { ...row, execution_json: execution };
  });
  const recipeId = Number(recipes[0].id), replacementId = Number(recipes[1].id);
  const executionItems = Object.fromEntries([itemId, otherId].map(id => [id, { targetMealId: `target-${id}`, recipeId, title: recipes[0].title, servings: 2, recipeYield: 2, demands: [{ food_name: "米", amount_value: 100, unit: "g" }] }]));
  const constraints = { executionItems, executionRecipeKeys: Object.fromEntries([itemId, otherId].map(id => [id, recipeExecutionProof(recipes[0])])), currentCookingDraft: { productionDate: today, time: { budgetMinutes: 60 } } };
  db.prepare("INSERT INTO meal_plans(id,user_id,title,start_date,end_date,status,constraints_json) VALUES(?,?,?, ?,?,'active',?)").run(planId,userId,"合成仓储验证",today,today,JSON.stringify(constraints));
  for (const id of [itemId, otherId]) db.prepare("INSERT INTO meal_plan_items(id,plan_id,user_id,planned_date,meal_type,title,recipe_id,ingredients_json,steps_json) VALUES(?,?,?,?,'午餐',?,?,?,?)")
    .run(id,planId,userId,today,recipes[0].title,recipeId,recipes[0].ingredients_json,recipes[0].steps_json);
  db.prepare("INSERT INTO inventory_items(user_id,food_name,category,quantity,quantity_value,quantity_unit,is_available,expiration_date) VALUES(?,'米','主食','300g',300,'g',1,'2099-01-01')").run(userId);
  db.prepare("INSERT INTO kitchenware_items(user_id,name,category,catalog_id,attributes_json) VALUES(?,'测试锅','锅具',1,?)").run(userId,JSON.stringify({ capacityMl: 1000 }));
  db.prepare("INSERT INTO user_health_profiles(user_id,kitchen_constraints_json) VALUES(?,?)").run(userId,JSON.stringify({ meal_time_minutes: 60 }));
  const repository = new SqliteMealPlansRepository(db);
  const state = () => ({ totalChanges: db.prepare("SELECT total_changes() AS count").get(), items: db.prepare("SELECT * FROM meal_plan_items WHERE plan_id=? ORDER BY id").all(planId), plan: db.prepare("SELECT * FROM meal_plans WHERE id=?").get(planId), changes: db.prepare("SELECT * FROM meal_plan_changes WHERE plan_id=? ORDER BY id").all(planId) });
  const item = () => db.prepare("SELECT * FROM meal_plan_items WHERE id=?").get(itemId) as Row;
  const preview = (version = Number(item().version), recipe = replacementId) => repository.previewChange(userId,planId,itemId,{ patch: { version, recipeId: recipe } });
  return { userId, planId, itemId, otherId, recipeId, replacementId, repository, state, item, preview };
}

test("SQLite reviewed replacement round-trips patch, restore and replace without changing another meal", async () => {
  const f = fixture(), originalOther = db.prepare("SELECT * FROM meal_plan_items WHERE id=?").get(f.otherId);
  const preview = await f.preview(); assert.equal(preview?.canApply,true,JSON.stringify(preview?.checks));
  const updated = await f.repository.updateItem(f.userId,f.planId,f.itemId,{ version: 1, recipeId: f.replacementId, validationFingerprint: preview!.fingerprint });
  assert.equal(updated.kind,"updated"); assert.equal(f.item().recipe_id,f.replacementId);
  const change = (await f.repository.listChanges(f.userId,f.planId))[0]; assert.equal(change.status,"applied");
  const restore = await f.repository.previewChange(f.userId,f.planId,f.itemId,{ changeId: change.id, action: "restore" });
  assert.equal(restore?.canApply,true,JSON.stringify(restore?.checks));
  assert.equal((await f.repository.reviewChange(f.userId,f.planId,change.id,"restore",restore!.fingerprint)).kind,"updated");
  assert.equal(f.item().recipe_id,f.recipeId);
  const again = await f.preview(); assert.equal(again?.canApply,true);
  await f.repository.updateItem(f.userId,f.planId,f.itemId,{ version: Number(f.item().version), recipeId: f.replacementId,validationFingerprint: again!.fingerprint });
  assert.equal(f.item().recipe_id,f.replacementId);
  assert.deepEqual(db.prepare("SELECT * FROM meal_plan_items WHERE id=?").get(f.otherId),originalOther);
});

test("SQLite missing proof fails closed with no mutation", async () => {
  const f = fixture(), before = f.state();
  await assert.rejects(f.repository.updateItem(f.userId,f.planId,f.itemId,{ version: 1, recipeId: f.replacementId }),{ code: "MEAL_PLAN_PREVIEW_REQUIRED" });
  assert.deepEqual(f.state(),before);
  db.prepare("UPDATE meal_plans SET constraints_json='{}' WHERE id=?").run(f.planId);
  const preview = await f.preview(); assert.equal(preview?.canApply,false);
  const missing = f.state();
  await assert.rejects(f.repository.updateItem(f.userId,f.planId,f.itemId,{ version: 1, recipeId: f.replacementId,validationFingerprint: preview!.fingerprint }),{ code: "MEAL_PLAN_REVALIDATION_BLOCKED" });
  assert.deepEqual(f.state(),missing);
});

for (const change of ["inventory", "other meal", "execution evidence"] as const) test(`SQLite preview rejects stale ${change} and performs zero additional writes`,async () => {
  const f = fixture(), preview = await f.preview(); assert.equal(preview?.canApply,true,JSON.stringify(preview?.checks));
  if (change === "inventory") db.prepare("UPDATE inventory_items SET quantity_value=quantity_value-1,version=version+1 WHERE user_id=?").run(f.userId);
  else if (change === "other meal") db.prepare("UPDATE meal_plan_items SET meal_type='晚餐',version=version+1 WHERE id=?").run(f.otherId);
  else db.prepare("UPDATE recipes SET execution_json=NULL WHERE id=?").run(f.replacementId);
  const before = f.state();
  await assert.rejects(f.repository.updateItem(f.userId,f.planId,f.itemId,{ version: 1, recipeId: f.replacementId,validationFingerprint: preview!.fingerprint }),{ code: "MEAL_PLAN_PREVIEW_CHANGED" });
  assert.deepEqual(f.state(),before);
});

test("SQLite maintenance proposes without applying; accept validates and terminal replay ignores later stock changes",async () => {
  const f = fixture(), before = f.item();
  await f.repository.updateItem(f.userId,f.planId,f.itemId,{ version: 1, recipeId: f.replacementId },"maintenance");
  assert.deepEqual(f.item(),before);
  const change = (await f.repository.listChanges(f.userId,f.planId))[0]; assert.equal(change.status,"pending");
  const pending = f.state();
  await assert.rejects(f.repository.reviewChange(f.userId,f.planId,change.id,"accept"),{ code: "MEAL_PLAN_PREVIEW_REQUIRED" });
  assert.deepEqual(f.state(),pending);
  const preview = await f.repository.previewChange(f.userId,f.planId,f.itemId,{ changeId: change.id, action: "accept" });
  assert.equal(preview?.canApply,true,JSON.stringify(preview?.checks));
  await f.repository.reviewChange(f.userId,f.planId,change.id,"accept",preview!.fingerprint);
  assert.equal(f.item().recipe_id,f.replacementId);
  db.prepare("UPDATE inventory_items SET quantity_value=0 WHERE user_id=?").run(f.userId);
  const applied = f.state();
  assert.equal((await f.repository.reviewChange(f.userId,f.planId,change.id,"accept",preview!.fingerprint)).kind,"updated");
  assert.deepEqual(f.state(),applied);
});

test("SQLite ordinary confirmation cannot apply a pending replacement",async () => {
  const f = fixture();
  await f.repository.updateItem(f.userId,f.planId,f.itemId,{ version: 1, recipeId: f.replacementId },"maintenance");
  await f.repository.confirmItem(f.userId,f.planId,f.itemId,1);
  assert.equal(f.item().recipe_id,f.recipeId);
  assert.equal((await f.repository.listChanges(f.userId,f.planId))[0].status,"pending");
});

// PostgreSQL protocol assertions only: no real PostgreSQL concurrency is simulated.
test("PostgreSQL replacement snapshot locks parent first and all mutable inputs with NOWAIT",async () => {
  const statements: string[] = [];
  const client = { query: async (sql: string) => { statements.push(sql); return { rows: [] }; } } as unknown as PoolClient;
  await readPostgresReplacementSnapshot(client,7,{ patch: { version: 1, recipeId: 2 } },true);
  assert.equal(statements[0],"SELECT id FROM users WHERE id=$1 FOR UPDATE NOWAIT");
  for (const table of replacementInputTables) assert(statements.includes(`SELECT * FROM ${table} WHERE user_id=$1 ORDER BY id FOR UPDATE NOWAIT`));
  assert(statements.some(sql => /LOCK TABLE .* IN SHARE MODE NOWAIT/.test(sql)));
  assert(statements.some(sql => /FROM recipes .* FOR SHARE NOWAIT/.test(sql)));
});

test("PostgreSQL preview uses a repeatable read read-only transaction without row locks",async () => {
  const statements: string[] = [];
  const client = { query: async (sql: string) => { statements.push(sql); return { rows: [] }; }, release: () => statements.push("RELEASE") };
  const repository = new PostgresMealPlansRepository({ connect: async () => client } as unknown as Pool);
  assert.equal(await repository.previewChange(7,"absent","absent",{ patch: { version: 1, recipeId: 2 } }),null);
  assert.deepEqual(statements.slice(0,2),["BEGIN","SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"]);
  assert.deepEqual(statements.slice(-2),["COMMIT","RELEASE"]);
  assert(!statements.some(sql => /FOR UPDATE|FOR SHARE|LOCK TABLE/.test(sql)));
});

function postgresProtocolFixture(f: ReturnType<typeof fixture>, failLock = false) {
  const statements: string[] = [];
  const query = async (sql: string, values: unknown[] = []) => {
    statements.push(sql);
    if (failLock && sql.includes("FROM inventory_items") && sql.includes("FOR UPDATE NOWAIT")) throw Object.assign(new Error("synthetic lock conflict"),{ code: "55P03" });
    if (/^(BEGIN|COMMIT|ROLLBACK|SET TRANSACTION|LOCK TABLE)/.test(sql) || sql.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (sql.includes("SELECT id FROM users")) return { rows: [{ id: f.userId }] };
    if (sql.includes("SELECT i.*")) return { rows: [{ ...f.item(), plan_constraints_json: (db.prepare("SELECT constraints_json FROM meal_plans WHERE id=?").get(f.planId) as Row).constraints_json }] };
    if (sql.includes("FROM household_shopping_items")) return { rows: [] };
    if (sql.includes("FROM meal_plan_changes") && sql.includes("fingerprint")) return { rows: [] };
    if (sql.includes("FROM meal_plan_changes")) return { rows: db.prepare("SELECT * FROM meal_plan_changes WHERE id=? AND user_id=?").all(values[0] as string,f.userId) };
    if (sql.includes("FROM recipes")) return { rows: db.prepare("SELECT * FROM recipes WHERE id IN (?,?)").all(f.recipeId,f.replacementId) };
    const table = /FROM ([a-z_]+)/.exec(sql)?.[1];
    assert(table && /^(inventory_items|inventory_change_logs|prepared_meals|meal_plans|meal_plan_items|shopping_list_items|cooking_queue_items|user_health_profiles|kitchenware_items|prepared_meal_allocations|kitchenware_catalog|kitchenware_capabilities|kitchenware_catalog_capabilities|kitchenware_substitutions|recipe_kitchenware_requirements)$/.test(table),`Unexpected query: ${sql}`);
    const owned = replacementInputTables.includes(table as typeof replacementInputTables[number]);
    return { rows: owned ? db.prepare(`SELECT * FROM ${table} WHERE user_id=? ORDER BY id`).all(f.userId) : db.prepare(`SELECT * FROM ${table}`).all() };
  };
  const client = { query, release: () => statements.push("RELEASE") };
  return { statements, repository: new PostgresMealPlansRepository({ query, connect: async () => client } as unknown as Pool) };
}

test("PostgreSQL NOWAIT conflict rolls back before domain mapping and releases the client",async () => {
  const f = fixture(), preview = await f.preview(); assert.equal(preview?.canApply,true);
  const protocol = postgresProtocolFixture(f,true);
  await assert.rejects(protocol.repository.updateItem(f.userId,f.planId,f.itemId,{ version: 1, recipeId: f.replacementId,validationFingerprint: preview!.fingerprint }),{ code: "MEAL_PLAN_PREVIEW_CHANGED" });
  assert.deepEqual(protocol.statements.slice(-3),["SELECT * FROM inventory_items WHERE user_id=$1 ORDER BY id FOR UPDATE NOWAIT","ROLLBACK","RELEASE"]);
  const writeStart = protocol.statements.lastIndexOf("BEGIN");
  const writeStatements = protocol.statements.slice(writeStart);
  const parentLock = writeStatements.findIndex(sql => sql.includes("FROM users"));
  assert(parentLock < writeStatements.findIndex(sql => sql.includes("FROM inventory_items")));
  assert(!writeStatements.slice(0,parentLock).some(sql => /FOR UPDATE|FOR SHARE|LOCK TABLE/.test(sql)),"read-only replay checks must not take input locks before the parent lock");
  assert(!writeStatements.some(sql => /^(UPDATE|INSERT|DELETE)/.test(sql)));
});

for (const action of ["accept", "restore"] as const) test(`PostgreSQL terminal ${action} replay with old fingerprint does not acquire inventory locks`,async () => {
  const f = fixture();
  await f.repository.updateItem(f.userId,f.planId,f.itemId,{ version: 1, recipeId: f.replacementId },"maintenance");
  const change = (await f.repository.listChanges(f.userId,f.planId))[0];
  const preview = await f.repository.previewChange(f.userId,f.planId,f.itemId,{ changeId: change.id, action: "accept" });
  await f.repository.reviewChange(f.userId,f.planId,change.id,"accept",preview!.fingerprint);
  if (action === "restore") {
    const restore = await f.repository.previewChange(f.userId,f.planId,f.itemId,{ changeId: change.id,action });
    await f.repository.reviewChange(f.userId,f.planId,change.id,action,restore!.fingerprint);
  }
  db.prepare("UPDATE inventory_items SET quantity_value=0 WHERE user_id=?").run(f.userId);
  const protocol = postgresProtocolFixture(f,true);
  assert.equal((await protocol.repository.reviewChange(f.userId,f.planId,change.id,action,preview!.fingerprint)).kind,"updated");
  const writeStatements = protocol.statements.slice(protocol.statements.lastIndexOf("BEGIN"));
  assert(!writeStatements.some(sql => /FROM inventory_items|FROM users|LOCK TABLE/.test(sql)));
  assert.deepEqual(writeStatements.slice(-2),["COMMIT","RELEASE"]);
});

test("SQLite rechecks after asynchronous preparation inside the write transaction",async () => {
  const f = fixture(), preview = await f.preview(); assert.equal(preview?.canApply,true);
  // updateItem captures its preparation snapshot synchronously, then yields while evaluating
  // kitchen compatibility. Change the live input before its write transaction resumes.
  const pending = f.repository.updateItem(f.userId,f.planId,f.itemId,{ version: 1, recipeId: f.replacementId,validationFingerprint: preview!.fingerprint });
  db.prepare("UPDATE inventory_items SET quantity_value=299,version=version+1 WHERE user_id=?").run(f.userId);
  const before = f.state();
  await assert.rejects(pending,{ code: "MEAL_PLAN_PREVIEW_CHANGED" });
  assert.deepEqual(f.state(),before);
});

for (const legacy of [false,true]) test(`SQLite confirmed ${legacy ? "legacy" : "reviewed"} meal can accept pure skip but restoring demand stays strict`,async () => {
  const f = fixture();
  if (legacy) db.prepare("UPDATE meal_plans SET constraints_json='{}' WHERE id=?").run(f.planId);
  await f.repository.confirmItem(f.userId,f.planId,f.itemId,1);
  const patch = { version: Number(f.item().version), status: "skipped" as const };
  const skip = await f.repository.previewChange(f.userId,f.planId,f.itemId,{ patch });
  assert.equal(skip?.canApply,true,JSON.stringify(skip?.checks));
  assert(skip.checks.some(check => check.code === "commitment_released" && check.severity === "info"));
  await f.repository.updateItem(f.userId,f.planId,f.itemId,patch);
  assert.equal(f.item().status,"planned");
  const change = (await f.repository.listChanges(f.userId,f.planId)).find(row => row.status === "pending")!;
  const accept = await f.repository.previewChange(f.userId,f.planId,f.itemId,{ changeId: change.id, action: "accept" });
  assert.equal(accept?.canApply,true);
  await f.repository.reviewChange(f.userId,f.planId,change.id,"accept",accept!.fingerprint);
  assert.equal(f.item().status,"skipped");
  const restore = await f.repository.previewChange(f.userId,f.planId,f.itemId,{ changeId: change.id,action: "restore" });
  assert.equal(restore?.canApply,!legacy,JSON.stringify(restore?.checks));
  const before = f.state();
  await assert.rejects(f.repository.reviewChange(f.userId,f.planId,change.id,"restore"),{ code: "MEAL_PLAN_PREVIEW_REQUIRED" });
  assert.deepEqual(f.state(),before);
  if (legacy) {
    await assert.rejects(f.repository.reviewChange(f.userId,f.planId,change.id,"restore",restore!.fingerprint),{ code: "MEAL_PLAN_REVALIDATION_BLOCKED" });
    assert.deepEqual(f.state(),before);
    await f.repository.confirmItem(f.userId,f.planId,f.itemId,Number(f.item().version));
    assert.equal(f.item().status,"skipped");
  } else {
    await f.repository.reviewChange(f.userId,f.planId,change.id,"restore",restore!.fingerprint);
    assert.equal(f.item().status,"planned");
    assert.equal((await f.repository.listChanges(f.userId,f.planId)).find(row => row.id === change.id)?.status,"reverted");
    // A separately accepted restoration is itself undoable back to skipped, without
    // creating new demand or requiring stale execution evidence to certify a release.
    await f.repository.updateItem(f.userId,f.planId,f.itemId,{ version: Number(f.item().version), status: "skipped" });
    const secondSkip = (await f.repository.listChanges(f.userId,f.planId)).find(row => row.status === "pending")!;
    await f.repository.reviewChange(f.userId,f.planId,secondSkip.id,"accept");
    await f.repository.updateItem(f.userId,f.planId,f.itemId,{ version: Number(f.item().version), status: "planned" });
    const recovery = (await f.repository.listChanges(f.userId,f.planId)).find(row => row.status === "pending")!;
    const recoveryPreview = await f.repository.previewChange(f.userId,f.planId,f.itemId,{ changeId: recovery.id,action: "accept" });
    assert.equal(recoveryPreview?.canApply,true,JSON.stringify(recoveryPreview?.checks));
    await f.repository.reviewChange(f.userId,f.planId,recovery.id,"accept",recoveryPreview!.fingerprint);
    assert.equal(f.item().status,"planned");
    const undoRecovery = await f.repository.previewChange(f.userId,f.planId,f.itemId,{ changeId: recovery.id,action: "restore" });
    assert.equal(undoRecovery?.canApply,true,JSON.stringify(undoRecovery?.checks));
    assert(undoRecovery.checks.some(check => check.code === "commitment_released"));
    await f.repository.reviewChange(f.userId,f.planId,recovery.id,"restore",undoRecovery.fingerprint);
    assert.equal(f.item().status,"skipped");
  }
});

test("SQLite reviewed fractional portions scale across recipe yields and restore without touching another meal",async () => {
  const f = fixture();
  const recipes = [f.recipeId,f.replacementId].map((id,index) => {
    db.prepare("UPDATE recipes SET serving_size=?,ingredients_json=? WHERE id=?").run(index === 0 ? 1 : 4,JSON.stringify([{ name: "米",amount: index === 0 ? "100g" : "200g" }]),id);
    const row = db.prepare("SELECT * FROM recipes WHERE id=?").get(id) as Row;
    const reviewed = JSON.parse(String(row.execution_json));
    reviewed.recipeKey = executionRecipeKey(row);
    db.prepare("UPDATE recipes SET execution_json=? WHERE id=?").run(JSON.stringify(reviewed),id);
    return { ...row,execution_json: reviewed } as Row;
  });
  const constraints = JSON.parse(String((db.prepare("SELECT constraints_json FROM meal_plans WHERE id=?").get(f.planId) as Row).constraints_json));
  for (const id of [f.itemId,f.otherId]) {
    const servings = id === f.itemId ? 1.5 : 1;
    Object.assign(constraints.executionItems[id],{ servings,recipeYield: 1,demands: [{ food_name: "米",amount_value: 100*servings,unit: "g" }] });
    constraints.executionRecipeKeys[id] = recipeExecutionProof(recipes[0]);
    db.prepare("UPDATE meal_plan_items SET ingredients_json=? WHERE id=?").run(JSON.stringify([{ name: "米",amount: `${100*servings}g` }]),id);
  }
  db.prepare("UPDATE meal_plans SET constraints_json=? WHERE id=?").run(JSON.stringify(constraints),f.planId);
  const other = db.prepare("SELECT * FROM meal_plan_items WHERE id=?").get(f.otherId);
  const preview = await f.preview(); assert.equal(preview?.canApply,true,JSON.stringify(preview?.checks));
  await f.repository.updateItem(f.userId,f.planId,f.itemId,{ version: 1,recipeId: f.replacementId,validationFingerprint: preview!.fingerprint });
  assert.deepEqual(JSON.parse(String(f.item().ingredients_json)),[{ name: "米",amount: "75g" }]);
  let stored = JSON.parse(String((db.prepare("SELECT constraints_json FROM meal_plans WHERE id=?").get(f.planId) as Row).constraints_json));
  assert.equal(stored.executionItems[f.itemId].servings,1.5);
  assert.equal(stored.executionItems[f.itemId].recipeYield,4);
  assert.deepEqual(stored.executionItems[f.otherId],constraints.executionItems[f.otherId]);
  const change = (await f.repository.listChanges(f.userId,f.planId))[0];
  const restore = await f.repository.previewChange(f.userId,f.planId,f.itemId,{ changeId: change.id,action: "restore" });
  assert.equal(restore?.canApply,true,JSON.stringify(restore?.checks));
  await f.repository.reviewChange(f.userId,f.planId,change.id,"restore",restore!.fingerprint);
  assert.deepEqual(JSON.parse(String(f.item().ingredients_json)),[{ name: "米",amount: "150g" }]);
  stored = JSON.parse(String((db.prepare("SELECT constraints_json FROM meal_plans WHERE id=?").get(f.planId) as Row).constraints_json));
  assert.equal(stored.executionItems[f.itemId].servings,1.5);
  assert.equal(stored.executionItems[f.itemId].recipeYield,1);
  assert.deepEqual(stored.executionItems[f.otherId],constraints.executionItems[f.otherId]);
  assert.deepEqual(db.prepare("SELECT * FROM meal_plan_items WHERE id=?").get(f.otherId),other);
});

test("SQLite operation fingerprint is canonical across preview and confirmation patch field order",async () => {
  const f = fixture();
  const first = await f.repository.previewChange(f.userId,f.planId,f.itemId,{ patch: { version: 1,recipeId: f.replacementId,mealType: "晚餐" } });
  const reordered = await f.repository.previewChange(f.userId,f.planId,f.itemId,{ patch: { mealType: "晚餐",recipeId: f.replacementId,version: 1 } });
  assert.equal(first?.canApply,true,JSON.stringify(first?.checks));
  assert.equal(reordered?.fingerprint,first.fingerprint);
  const updated = await f.repository.updateItem(f.userId,f.planId,f.itemId,{ mealType: "晚餐",recipeId: f.replacementId,version: 1,validationFingerprint: first.fingerprint });
  assert.equal(updated.kind,"updated");
  assert.equal(f.item().recipe_id,f.replacementId);
  assert.equal(f.item().meal_type,"晚餐");
});
