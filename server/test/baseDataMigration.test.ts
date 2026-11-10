import assert from "node:assert/strict";
import { test } from "node:test";
import Database from "better-sqlite3";
import { runMigrations } from "../src/storage/migrations.js";

test("a failed base-data schema adoption rolls back the table rebuild and restores foreign keys", () => {
  const db = new Database(":memory:");
  try {
    db.pragma("foreign_keys=ON");
    db.exec(`CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT);
      CREATE TABLE ingredients_library(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT,calories_100g REAL NOT NULL);
      INSERT INTO ingredients_library VALUES(9,'原数据',23);`);
    for (let version = 1; version <= 80; version++) db.prepare("INSERT INTO schema_migrations VALUES(?,'applied')").run(version);
    // The missing recipes table simulates a schema failure after the ingredient rebuild.
    assert.throws(() => runMigrations(db), /no such table/);
    assert.deepEqual(db.prepare("SELECT * FROM ingredients_library").get(), { id: 9, name: "原数据", calories_100g: 23 });
    assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
    assert.equal(db.prepare("SELECT version FROM schema_migrations WHERE version=81").get(), undefined);
    assert.throws(() => db.prepare("INSERT INTO ingredients_library(name,calories_100g) VALUES('未知',NULL)").run(), /NOT NULL/);
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='ingredients_library_base_data_next'").get(), undefined);
  } finally { db.close(); }
});

test("base data migration preserves referenced rows, indexes, IDs and admin edits", () => {
  const db = new Database(":memory:");
  try {
    db.pragma("foreign_keys=ON");
    db.exec(`CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT);
      CREATE TABLE ingredients_library(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT,calories_100g REAL NOT NULL);
      CREATE INDEX ingredient_name ON ingredients_library(name);
      INSERT INTO ingredients_library VALUES(10,'管理员修订的番茄',25),(99,'删除记录',100);
      DELETE FROM ingredients_library WHERE id=99;
      CREATE TABLE child(id INTEGER PRIMARY KEY,ingredient_id INTEGER REFERENCES ingredients_library(id) ON DELETE CASCADE);
      INSERT INTO child VALUES(1,10);
      CREATE TABLE recipes(id INTEGER PRIMARY KEY,automatic_inventory_write_allowed INTEGER NOT NULL DEFAULT 1,base_data_payload TEXT);
      INSERT INTO recipes VALUES(1,0,'{"admin_edit":true}');
      CREATE TABLE cooking_completions(id TEXT PRIMARY KEY,recipe_id INTEGER REFERENCES recipes(id));
      CREATE TABLE prepared_meals(id TEXT PRIMARY KEY,recipe_id INTEGER REFERENCES recipes(id));
      CREATE TABLE kitchenware_catalog(id INTEGER PRIMARY KEY);
      CREATE TABLE users(id INTEGER PRIMARY KEY);
      CREATE TABLE community_posts(id INTEGER PRIMARY KEY);
      CREATE TABLE community_comments(id INTEGER PRIMARY KEY);
      CREATE TABLE inventory_items(id INTEGER PRIMARY KEY);
      CREATE TABLE recipe_favorites(id INTEGER PRIMARY KEY);`);
    for (let version = 1; version <= 80; version++) db.prepare("INSERT INTO schema_migrations VALUES(?,'applied')").run(version);
    db.prepare("INSERT INTO schema_migrations VALUES(82,'separate allocation fixture')").run();
    // Feedback migration is verified against complete schemas in feedbackFlow.test.ts.
    db.prepare("INSERT INTO schema_migrations VALUES(83,'separate feedback fixture')").run();
    // Intake migrations are covered by their own complete-schema fixtures.
    for (const version of [84, 85, 86]) db.prepare("INSERT INTO schema_migrations VALUES(?,'separate intake fixture')").run(version);
    runMigrations(db);
    runMigrations(db);
    assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
    assert.equal((db.prepare("SELECT COUNT(*) n FROM child").get() as { n: number }).n, 1);
    assert.deepEqual(db.prepare("SELECT name,calories_100g FROM ingredients_library WHERE id=10").get(), { name: "管理员修订的番茄", calories_100g: 25 });
    const inserted = db.prepare("INSERT INTO ingredients_library(name,calories_100g) VALUES('未知营养',NULL)").run();
    assert.equal(inserted.lastInsertRowid, 100);
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name='ingredient_name'").get());
    assert.deepEqual(db.prepare("SELECT automatic_inventory_write_allowed,base_data_payload FROM recipes WHERE id=1").get(),
      { automatic_inventory_write_allowed: 0, base_data_payload: '{"admin_edit":true}' });
    assert.throws(() => db.prepare("INSERT INTO cooking_completions VALUES('c',1)").run(), /reference-only/);
    assert.throws(() => db.prepare("INSERT INTO prepared_meals VALUES('p',1)").run(), /reference-only/);
    assert.equal((db.pragma("foreign_key_check") as unknown[]).length, 0);
  } finally { db.close(); }
});
