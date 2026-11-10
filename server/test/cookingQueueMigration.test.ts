import assert from "node:assert/strict";
import { test } from "node:test";
import Database from "better-sqlite3";
import { runMigrations } from "../src/storage/migrations.js";

test("queue migration separates legacy shared meal links without discarding cooking progress", () => {
  const db = new Database(":memory:");
  try {
    db.exec(`CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE household_members(id INTEGER PRIMARY KEY AUTOINCREMENT);
      CREATE TABLE household_shopping_items(id TEXT PRIMARY KEY);
      CREATE TABLE prepared_meals(id TEXT PRIMARY KEY);
      INSERT INTO prepared_meals VALUES('legacy-meal');
      CREATE TABLE cooking_queue_items(id TEXT PRIMARY KEY,user_id INTEGER,recipe_id INTEGER,status TEXT,
        deleted_at TEXT,recipe_snapshot_json TEXT,version INTEGER,updated_at TEXT);
      CREATE UNIQUE INDEX idx_cooking_queue_active_recipe ON cooking_queue_items(user_id,recipe_id)
        WHERE deleted_at IS NULL AND status IN ('waiting','preparing','ready','cooking');
      CREATE TABLE meal_plans(id TEXT PRIMARY KEY,status TEXT);
      INSERT INTO meal_plans VALUES('plan','active');
      CREATE TABLE meal_plan_items(id TEXT PRIMARY KEY,user_id INTEGER,queue_item_id TEXT,status TEXT,
        deleted_at TEXT,version INTEGER,updated_at TEXT,ingredients_json TEXT,planned_date TEXT,plan_id TEXT,created_at TEXT);
      INSERT INTO cooking_queue_items VALUES('q',1,10,'cooking',NULL,'{"ingredients":[]}',4,NULL);
      INSERT INTO meal_plan_items VALUES('a',1,'q','queued',NULL,2,NULL,'[{"name":"蛋","amount":"6个"}]','2026-09-10','plan','2026-09-01');
      INSERT INTO meal_plan_items VALUES('b',1,'q','queued',NULL,3,NULL,'[]','2026-09-11','plan','2026-09-01');`);
    const record = db.prepare("INSERT INTO schema_migrations VALUES(?, 'existing')");
    for (let version = 1; version <= 61; version++) record.run(version);
    // This fixture isolates queue migrations and has no ingredient/catalog tables.
    record.run(81);
    record.run(82); // Allocation migration has its own complete-schema fixture.
    // Feedback migration is verified against complete schemas in feedbackFlow.test.ts.
    db.prepare("INSERT INTO schema_migrations VALUES(83,'separate feedback fixture')").run();
    // Intake migrations are covered by their own complete-schema fixtures.
    for (const version of [84, 85, 86]) db.prepare("INSERT INTO schema_migrations VALUES(?,'separate intake fixture')").run(version);
    // Execution metadata is verified by the complete recipe fixtures in app.test.ts.
    db.prepare("INSERT INTO schema_migrations VALUES(88,'separate recipe fixture')").run();
    // Email ownership is covered by databaseRehearsal/emailRecovery complete-schema fixtures.
    db.prepare("INSERT INTO schema_migrations VALUES(90,'separate email fixture')").run();
    runMigrations(db);
    assert.equal((db.prepare("SELECT reported_cooking_minutes FROM prepared_meals").get() as { reported_cooking_minutes: number | null }).reported_cooking_minutes,null);
    const q = db.prepare("SELECT * FROM cooking_queue_items").get() as Record<string, unknown>;
    assert.equal(q.source_plan_item_id, "a");
    assert.equal((db.prepare("SELECT confirmed_at FROM meal_plan_items WHERE id='a'").get() as { confirmed_at: string }).confirmed_at,"2026-09-01");
    assert.equal(q.status, "cooking");
    assert.equal(q.version, 5);
    assert.deepEqual(JSON.parse(String(q.recipe_snapshot_json)).ingredients, [{ name: "蛋", amount: "6个" }]);
    assert.deepEqual(db.prepare("SELECT queue_item_id,status,version FROM meal_plan_items WHERE id='b'").get(),
      { queue_item_id: null, status: "planned", version: 4 });
    runMigrations(db);
    assert.equal((db.prepare("SELECT version FROM cooking_queue_items").get() as { version: number }).version, 5);
    db.prepare("INSERT INTO cooking_queue_items VALUES('q2',1,10,'waiting',NULL,'{}',1,NULL,'b')").run();
    assert.throws(() => db.prepare("INSERT INTO cooking_queue_items VALUES('q3',1,10,'waiting',NULL,'{}',1,NULL,'b')").run());
  } finally { db.close(); }
});
