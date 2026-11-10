import assert from "node:assert/strict";
import { test } from "node:test";
import Database from "better-sqlite3";
import { runMigrations } from "../src/storage/migrations.js";

test("allocation migration retains source records and marks overbooking and foreign batches as conflicts", () => {
  const db = new Database(":memory:");
  try {
    db.pragma("foreign_keys=ON");
    db.exec(`CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT);
      CREATE TABLE users(id INTEGER PRIMARY KEY);
      INSERT INTO users VALUES(1),(2);
      CREATE TABLE meal_plans(id TEXT PRIMARY KEY,user_id INTEGER,status TEXT,deleted_at TEXT,constraints_json TEXT);
      CREATE TABLE prepared_meals(id TEXT PRIMARY KEY,user_id INTEGER,remaining_servings REAL,version INTEGER,is_reserved INTEGER);
      INSERT INTO prepared_meals VALUES('b1',1,1,1,0),('b2',1,2,1,0);`);
    for (let version=1;version<=81;version++) db.prepare("INSERT INTO schema_migrations VALUES(?,'old')").run(version);
    const add = (id: string,user: number,batch: string,status = "active") => {
      const source = { id: "dinner",date: "2099-09-10",mealType: "dinner",allocations: [{ preparedMealId: batch,version: 1,servings: 1,foodName: "原记录" }] };
      const value = JSON.stringify({ savedCookingDraft: { draft: { meals: [source] } } });
      db.prepare("INSERT INTO meal_plans VALUES(?,?,?,NULL,?)").run(id,user,status,value);
      return value;
    };
    const original = add("p1",1,"b1"); add("p2",1,"b1"); add("p3",2,"b2"); add("p4",1,"b2"); add("p5",1,"b2","cancelled"); add("p6",1,"missing");
    // Feedback migration is verified against complete schemas in feedbackFlow.test.ts.
    db.prepare("INSERT INTO schema_migrations VALUES(83,'separate feedback fixture')").run();
    // Intake migrations are covered by their own complete-schema fixtures.
    for (const version of [84, 85, 86]) db.prepare("INSERT INTO schema_migrations VALUES(?,'separate intake fixture')").run(version);
    // Execution metadata is verified by the complete recipe fixtures in app.test.ts.
    db.prepare("INSERT INTO schema_migrations VALUES(88,'separate recipe fixture')").run();
    runMigrations(db); runMigrations(db);
    assert.deepEqual(db.prepare("SELECT plan_id,status FROM prepared_meal_allocations ORDER BY plan_id").all(), [
      { plan_id: "p1",status: "conflict" },{ plan_id: "p2",status: "conflict" },{ plan_id: "p3",status: "conflict" },
      { plan_id: "p4",status: "active" },{ plan_id: "p6",status: "conflict" },
    ]);
    assert.equal((db.prepare("SELECT constraints_json FROM meal_plans WHERE id='p1'").get() as { constraints_json: string }).constraints_json,original);
    assert.equal((db.prepare("SELECT id FROM prepared_meal_allocations WHERE plan_id='p1'").get() as { id: string }).id,"p1:dinner:b1");
    assert.equal((db.prepare("SELECT remaining_servings FROM prepared_meals WHERE id='b1'").get() as { remaining_servings: number }).remaining_servings,1);
    assert.deepEqual(db.pragma("foreign_key_check"),[]);
  } finally { db.close(); }
});
